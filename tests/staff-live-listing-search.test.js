'use strict';

// Staff dashboard search used to be pending-only, so MK-20261016-EFB4A3
// (and the suffix EFB4A3) on a live listing answered
// "No pending listing matches". A direct MK ref, that suffix, or a property
// id now finds the listing at any status and opens the same editor. Saving
// still does not change a live listing's status.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  listingDirectLookup,
  listingDirectLookupClause,
  propertyListingSearchClause
} = require('../utils/listingReferenceSearch');

const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const STAFF = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  const body = APP.indexOf(') {', start);
  assert.ok(body > start, `${name} has a body`);
  for (let i = body + 2; i < APP.length; i += 1) {
    if (APP[i] === '{') depth += 1;
    if (APP[i] === '}') {
      depth -= 1;
      if (depth === 0) return APP.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

test('an MK ref, its suffix, or a property id is a direct lookup; a place name is not', () => {
  assert.deepEqual(listingDirectLookup('MK-20261016-EFB4A3'), { kind: 'reference', value: 'MK-20261016-EFB4A3' });
  assert.deepEqual(listingDirectLookup('  mk-20261016-efb4a3 '), { kind: 'reference', value: 'MK-20261016-EFB4A3' });
  assert.deepEqual(listingDirectLookup('EFB4A3'), { kind: 'suffix', value: 'EFB4A3' });
  assert.deepEqual(listingDirectLookup('efb4a3'), { kind: 'suffix', value: 'EFB4A3' });
  assert.deepEqual(
    listingDirectLookup('73FD88D9-2713-473D-B7E0-E1EB067B73DD'),
    { kind: 'id', value: '73fd88d9-2713-473d-b7e0-e1eb067b73dd' }
  );
  assert.equal(listingDirectLookup('Ntinda'), null);
  assert.equal(listingDirectLookup('Kampala'), null);
  assert.equal(listingDirectLookup(''), null);

  const suffixValues = [];
  assert.equal(listingDirectLookupClause('p', listingDirectLookup('EFB4A3'), suffixValues), 'p.inquiry_reference LIKE $1');
  assert.deepEqual(suffixValues, ['MK-________-EFB4A3']);
  const like = new RegExp(`^${suffixValues[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')}$`);
  assert.equal(like.test('MK-20261016-EFB4A3'), true);
  assert.equal(like.test('MK-20261016-EFB4A4'), false);
  assert.equal(like.test('MK-2026101-EFB4A3'), false);

  const refValues = [];
  assert.equal(listingDirectLookupClause('p', listingDirectLookup('MK-20261016-EFB4A3'), refValues), 'p.inquiry_reference = $1');
  assert.deepEqual(refValues, ['MK-20261016-EFB4A3']);

  const idValues = [];
  assert.equal(
    listingDirectLookupClause('p', listingDirectLookup('73fd88d9-2713-473d-b7e0-e1eb067b73dd'), idValues),
    'p.id = $1::uuid'
  );
  assert.deepEqual(idValues, ['73fd88d9-2713-473d-b7e0-e1eb067b73dd']);

  const broad = [];
  const ilike = propertyListingSearchClause('p', 'Ntinda house', broad);
  assert.match(ilike, /ILIKE/);
  assert.equal(ilike.includes('inquiry_reference ='), false);
});

test('the staff review queue drops the pending filter only for a direct lookup', () => {
  const route = STAFF.slice(
    STAFF.indexOf("router.get('/properties/review-queue'"),
    STAFF.indexOf("router.patch('/profile'")
  );
  assert.match(route, /const filters = \[actionablePendingReviewWhere\('p'\)\];/);
  assert.match(route, /const directLookup = listingDirectLookup\(search\)/);
  assert.match(route, /if \(directLookup\) \{[\s\S]*filters\.length = 0;[\s\S]*listingDirectLookupClause\('p', directLookup, values\)/);
  assert.match(route, /else if \(search\) \{\s*filters\.push\(propertyListingSearchClause\('p', search, values\)\);/);
  assert.match(route, /status_scope: 'any'/);
  assert.match(route, /lookup: directLookup\.kind/);
  assert.match(route, /status_scope: 'pending'/);
  assert.match(STAFF, /router\.use\(requireStaffAccess\)/);

  const preview = STAFF.slice(
    STAFF.indexOf('async function loadStaffPropertyPreview'),
    STAFF.indexOf('function staffBulkApprovalChecklist')
  );
  assert.match(preview, /WHERE p\.id = \$1::uuid/);
  assert.match(preview, /WHERE p\.inquiry_reference = \$1/);
  assert.doesNotMatch(preview.slice(0, 500), /actionablePendingReviewWhere/);

  const save = STAFF.slice(
    STAFF.indexOf('async function updateStaffEditableListing'),
    STAFF.indexOf('async function loadStaffPropertyPreview')
  );
  assert.match(save, /const liveEdit = STAFF_LIVE_EDIT_STATUSES\.includes\(existingStatus\)/);
  assert.match(save, /if \(!liveEdit\) add\('moderation_stage', stage\)/);
  assert.doesNotMatch(save, /add\('status'/);
  assert.match(save, /status_kept: existingStatus/);
  assert.match(save, /staff_live_listing_edited/);
});

test('the dashboard search opens the same editor and badges a live listing', () => {
  const sandbox = {
    listingPriceNeedsCheck: () => false,
    adminIsBrokerSubmissionListing: () => false,
    adminEscape: (value) => String(value ?? ''),
    adminAttr: (value) => String(value ?? ''),
    propertyIdArg: (id) => JSON.stringify(String(id || '')),
    staffNumber: (value) => String(value)
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'staffMaskPhone',
    'staffKampalaDateTime',
    'staffListingIsLive',
    'staffLiveListingBadgeHtml',
    'staffListingDirectLookup',
    'staffReviewQueueCardHtml'
  ].map(extractFunction).join('\n'), sandbox);

  assert.equal(sandbox.staffListingDirectLookup('EFB4A3'), 'suffix');
  assert.equal(sandbox.staffListingDirectLookup('MK-20261016-EFB4A3'), 'reference');
  assert.equal(sandbox.staffListingDirectLookup('73fd88d9-2713-473d-b7e0-e1eb067b73dd'), 'id');
  assert.equal(sandbox.staffListingDirectLookup('Ntinda'), '');
  assert.equal(sandbox.staffListingIsLive('approved'), true);
  assert.equal(sandbox.staffListingIsLive('pending'), false);

  const live = sandbox.staffReviewQueueCardHtml({
    id: '73fd88d9-2713-473d-b7e0-e1eb067b73dd',
    title: 'Plot in Kitende',
    status: 'approved',
    inquiry_reference: 'MK-20261016-EFB4A3',
    area: 'Kitende',
    district: 'Wakiso'
  });
  assert.match(live, /data-live-listing-badge>Live listing</);
  assert.match(live, /openStaffListingPreview\("73fd88d9-2713-473d-b7e0-e1eb067b73dd"\)/);
  assert.doesNotMatch(live, /Keep pending/);
  assert.doesNotMatch(live, /Reject with reason/);

  const pending = sandbox.staffReviewQueueCardHtml({ id: 'pending-1', title: 'Waiting', status: 'pending' });
  assert.doesNotMatch(pending, /data-live-listing-badge/);
  assert.match(pending, /Keep pending/);
  assert.match(pending, /Reject with reason/);

  assert.match(APP, /staffListingIsLive\(preview\.status\) \? "Live listing" : "Preview before publishing"/);
  assert.match(APP, /data-live-listing-edit="1"/);
  assert.match(APP, /Saving changes keeps this listing live\. Every change is recorded\./);
  assert.match(APP, /No listing matches/);
  assert.match(APP, /No pending listing matches/);
  assert.match(APP, /statusScope === "any" \? "any status"/);
  assert.match(APP, /openStaffListingPreview\(openId\)/);
  assert.match(APP, /staffListingDirectLookup\(state\.term\)/);
  assert.match(HTML, /id="staff-review-queue-search"[^>]*oninput="staffSearchReviewQueue\(this\.value\)"/);
  assert.match(HTML, /placeholder="MK ref or property id \(any status\), or pending title, area, district, phone, source"/);
});

test('the lookup and the editor stay behind staff sign-in', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-live-listing-search-secret';
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const search = await request(app).get('/api/staff/properties/review-queue?search=EFB4A3');
  assert.equal(search.status, 403);
  assert.equal(search.body.error, 'Staff access required');
  const preview = await request(app).get('/api/staff/properties/73fd88d9-2713-473d-b7e0-e1eb067b73dd/preview');
  assert.equal(preview.status, 403);
  const save = await request(app).patch('/api/staff/properties/73fd88d9-2713-473d-b7e0-e1eb067b73dd/review').send({ listing: { title: 'Changed' }, stage: 'in_review' });
  assert.equal(save.status, 403);
});

test('a live listing is found by ref, suffix and id, and save keeps its status', { skip: !process.env.DATABASE_URL }, async () => {
  const crypto = require('crypto');
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const db = require('../config/database');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-live-listing-search-secret';
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const suffix = 'EFB4A3';
  const reference = `MK-20261016-${suffix}`;
  const id = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const user = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, email, role, password_hash, status)
     VALUES ('Live', 'Editor', $1, $2, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`, `live-edit-${Date.now()}@example.com`]
  )).rows[0];
  const token = jwt.sign({ sub: user.id, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  try {
    await db.query(
      `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, status, moderation_stage, inquiry_reference, extra_fields, approved_at)
       VALUES ($1, 'land', 'Plot in Kitende', 'A plot.', 'Wakiso', 'Kitende', 180000000, 'once', 'approved', 'approved', $2, '{}'::jsonb, NOW())`,
      [id, reference]
    );
    await db.query(
      `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, status, moderation_stage, inquiry_reference, extra_fields)
       VALUES ($1, 'land', 'Plot in Kitende waiting', 'A plot.', 'Wakiso', 'Kitende', 90000000, 'once', 'pending', 'pending', $2, '{}'::jsonb)`,
      [pendingId, 'MK-20261016-AAAAAA']
    );
    const bySuffix = await auth(request(app).get(`/api/staff/properties/review-queue?search=${suffix}`));
    assert.equal(bySuffix.status, 200, JSON.stringify(bySuffix.body).slice(0, 300));
    assert.deepEqual(bySuffix.body.data.map((row) => row.id), [id]);
    assert.equal(bySuffix.body.meta.status_scope, 'any');
    assert.equal(bySuffix.body.meta.lookup, 'suffix');
    const byRef = await auth(request(app).get(`/api/staff/properties/review-queue?search=${encodeURIComponent(reference.toLowerCase())}`));
    assert.deepEqual(byRef.body.data.map((row) => row.id), [id]);
    assert.equal(byRef.body.meta.lookup, 'reference');
    const byId = await auth(request(app).get(`/api/staff/properties/review-queue?search=${id}`));
    assert.deepEqual(byId.body.data.map((row) => row.id), [id]);
    assert.equal(byId.body.meta.lookup, 'id');
    const byTitle = await auth(request(app).get('/api/staff/properties/review-queue?search=Kitende%20waiting'));
    assert.equal(byTitle.body.meta.status_scope, 'pending');
    assert.deepEqual(byTitle.body.data.map((row) => row.id), [pendingId]);
    const liveTitle = await auth(request(app).get('/api/staff/properties/review-queue?search=Plot%20in%20Kitende'));
    assert.equal(liveTitle.body.data.some((row) => row.id === id), false);
    const preview = await auth(request(app).get(`/api/staff/properties/${id}/preview`));
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.status, 'approved');
    const saved = await auth(request(app).patch(`/api/staff/properties/${id}/review`)).send({
      listing: { title: 'Plot in Kitende, revised', price: 170000000 },
      stage: 'in_review'
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 300));
    const row = (await db.query('SELECT status, moderation_stage, title, price FROM properties WHERE id = $1', [id])).rows[0];
    assert.equal(row.status, 'approved');
    assert.equal(row.moderation_stage, 'approved');
    assert.equal(row.title, 'Plot in Kitende, revised');
    assert.equal(Number(row.price), 170000000);
  } finally {
    await db.query('DELETE FROM property_moderation_events WHERE property_id = ANY($1::uuid[])', [[id, pendingId]]).catch(() => {});
    await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [user.id]).catch(() => {});
    await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [[id, pendingId]]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => {});
  }
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) { /* no pool */ }
});
