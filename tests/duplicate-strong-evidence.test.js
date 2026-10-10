'use strict';

/**
 * C10 (10 Oct 2026, Fisher): "Possible duplicate listing found on makaug" fired
 * for any listing with the same lister phone or the same title. 17 phone groups
 * covered 80 of the 160 pending listings, and template titles ("Property for
 * sale in Kira") matched unrelated listings. A duplicate now needs strong
 * evidence: the same source post, the same photo, or the same agent + area +
 * type + bedrooms + price within 5%.
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) process.env.DATABASE_URL = DB_URL;
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';

const { classifyDuplicates, duplicateReason, sourcePostKey, duplicateGroupsCountSql, findLikelyDuplicates } = require('../utils/duplicateEvidence');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const agent = (overrides) => ({ lister_phone: '+256 772 123 456', district: 'Wakiso', status: 'pending', ...overrides });

test('one agent with three different listings is not a duplicate', () => {
  const listing = agent({ id: 'a', title: 'House for sale in Akright City', listing_type: 'sale', area: 'Akright City', bedrooms: 4, price: 450_000_000 });
  const others = [
    agent({ id: 'b', title: 'House for sale in Akright City', listing_type: 'sale', area: 'Akright City', bedrooms: 3, price: 380_000_000, lister_phone: '0772123456' }),
    agent({ id: 'c', title: 'Apartment for rent in Kira', listing_type: 'rent', area: 'Kira', bedrooms: 2, price: 1_500_000 }),
    agent({ id: 'd', title: 'Land for sale in Bwebajja', listing_type: 'land', area: 'Bwebajja', price: 120_000_000 })
  ];
  assert.deepEqual(classifyDuplicates(listing, others), []);
  // Same agent, same area, type and bedrooms, and a price within 5%: that is one.
  const near = agent({ id: 'e', listing_type: 'sale', area: 'akright city', bedrooms: 4, price: 440_000_000 });
  assert.deepEqual(duplicateReason(listing, near), { code: 'same_agent_area_price', label: 'same agent, same area and price' });
  assert.equal(duplicateReason(listing, { ...near, price: 400_000_000 }), null, '11% apart is not');
});

test('the same source post is a duplicate, whatever the URL form', () => {
  const listing = { id: 'a', source_url: 'https://www.tiktok.com/@agent/video/7691604548967763208?is_from_webapp=1', lister_phone: '' };
  const repost = { id: 'b', status: 'approved', source_url: 'https://m.tiktok.com/@agent/video/7691604548967763208' };
  const dupes = classifyDuplicates(listing, [repost]);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].duplicate_reason, 'same TikTok post');
  assert.equal(sourcePostKey('https://youtu.be/abcDEF12345').key, 'youtube:abcDEF12345');
  assert.equal(sourcePostKey('https://www.youtube.com/watch?v=abcDEF12345&t=3').key, 'youtube:abcDEF12345');
  assert.equal(sourcePostKey('https://x.com/agent/status/1890000000000000000').label, 'same X post');
});

test('the same photo is a duplicate', () => {
  const listing = { id: 'a', title: 'Flat in Ntinda', lister_phone: '' };
  const dupes = classifyDuplicates(listing, [], [{ id: 'z', title: 'Flat in Bukoto', status: 'pending', url: 'https://media.makaug.com/x.jpg' }]);
  assert.deepEqual(dupes.map((row) => [row.id, row.duplicate_reason]), [['z', 'same photo']]);
});

test('two template-titled listings in different areas are not duplicates, and rejected rows never are', () => {
  const listing = { id: 'a', title: 'Property for sale in Kira', listing_type: 'sale', area: 'Kira', price: 300_000_000, lister_phone: '0700111222' };
  const other = { id: 'b', title: 'Property for sale in Kira', listing_type: 'sale', area: 'Kira Town', price: 300_000_000, lister_phone: '0700999888', status: 'pending' };
  assert.deepEqual(classifyDuplicates(listing, [other]), []);
  const rejectedRepost = { id: 'c', status: 'rejected', source_url: 'https://www.tiktok.com/@a/video/1234567890123' };
  assert.deepEqual(classifyDuplicates({ id: 'a', source_url: 'https://www.tiktok.com/@a/video/1234567890123' }, [rejectedRepost]), []);
});

test('staff, admin and the properties review all use the one helper; the dashboard counts strong groups', () => {
  const staff = read('routes/staff.js');
  assert.match(staff, /safeRows\(DUPLICATE_CANDIDATES_SQL, duplicateCandidateParams\(property\), previewQueryOptions\)/);
  assert.match(staff, /const duplicates = classifyDuplicates\(property, duplicateCandidates, reusedImages\);/);
  assert.match(staff, /duplicateGroupsCountSql\(activePendingReviewWhere\('p'\)\)/);
  assert.doesNotMatch(staff, /SELECT lister_phone AS duplicate_key FROM pending/);
  assert.match(read('routes/admin.js'), /likely_duplicates: classifyDuplicates\(/);
  assert.match(read('routes/properties.js'), /likelyDuplicates: classifyDuplicates\(\{ \.\.\.property, id: propertyId \}, likelyDuplicates\.rows, reusedImages\.rows\)/);
  assert.match(read('services/listingModerationService.js'), /Possible duplicate listing found on makaug: \$\{/);
  assert.match(duplicateGroupsCountSql('TRUE'), /same_agent_area_price_groups/);
  assert.match(read('assets/makaug-app.js'), /data-duplicate-reason="\$\{adminAttr\(row\.duplicate_reason_code \|\| ""\)\}"/);
});

let db;
const ids = [];
const TAG = `DUP${crypto.randomBytes(3).toString('hex')}`;

test.after(async () => {
  if (!db) return;
  if (ids.length) {
    await db.query('DELETE FROM property_images WHERE property_id = ANY($1::uuid[])', [ids]).catch(() => {});
    await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
  }
  await db.pool.end().catch(() => {});
});

test('against a database: the queries find the strong matches and the dashboard counts real groups only', { skip }, async () => {
  db = require('../config/database');
  const insert = async (title, extra = {}, fields = {}) => {
    const row = { listing_type: 'sale', area: 'Akright City', district: 'Wakiso', price: 450_000_000, bedrooms: 4, lister_phone: '+256772555444', ...fields };
    const id = (await db.query(
      `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, bedrooms, lister_phone, status, moderation_stage, source, listed_via, extra_fields)
       VALUES ($1, $2, 'Duplicate evidence fixture house with parking and water.', $3, $4, $5, 'once', $6, $7, 'pending', 'pending', 'website', 'website', $8::jsonb) RETURNING id`,
      [row.listing_type, `${TAG} ${title}`, row.district, row.area, row.price, row.bedrooms, row.lister_phone, JSON.stringify(extra)]
    )).rows[0].id;
    ids.push(id);
    return { id, ...row, title: `${TAG} ${title}`, extra_fields: extra };
  };
  const query = async (sql, params) => (await db.query(sql, params)).rows;
  const before = (await db.query(duplicateGroupsCountSql(`p.title LIKE '${TAG}%'`))).rows[0];
  assert.equal(before.possible_duplicates, 0);
  const a = await insert('house a');
  await insert('house b', {}, { bedrooms: 3, price: 380_000_000 });
  await insert('flat c', {}, { listing_type: 'rent', area: 'Kira', bedrooms: 2, price: 1_500_000 });
  assert.deepEqual(await findLikelyDuplicates(query, a), [], 'same agent, different listings');
  const near = await insert('house a again', {}, { price: 445_000_000 });
  const tiktok = 'https://www.tiktok.com/@agent/video/7691604548967700001';
  const t1 = await insert('tiktok one', { source_url: tiktok }, { lister_phone: '', area: 'Kira' });
  await insert('tiktok two', { source_url: `${tiktok}?lang=en` }, { lister_phone: '', area: 'Najjera' });
  const matchesA = await findLikelyDuplicates(query, a);
  assert.deepEqual(matchesA.map((row) => [row.id, row.duplicate_reason]), [[near.id, 'same agent, same area and price']]);
  const matchesT = await findLikelyDuplicates(query, t1);
  assert.equal(matchesT.length, 1);
  assert.equal(matchesT[0].duplicate_reason, 'same TikTok post');
  const after = (await db.query(duplicateGroupsCountSql(`p.title LIKE '${TAG}%'`))).rows[0];
  assert.equal(after.same_agent_area_price_groups, 1);
  assert.equal(after.same_source_groups, 1, 'the two TikTok URLs differ only by a query string');
  assert.equal(after.possible_duplicates, 2);
});
