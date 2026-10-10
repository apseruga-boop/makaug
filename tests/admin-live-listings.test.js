'use strict';

/**
 * C19 (10 Oct 2026): Admin > Live & Featured showed "Rows loaded here 0 / 4353"
 * ("live listings timed out after 8 seconds"), search could not find a live row
 * by id or MK ref, and "Review" on a live row opened the dashboard home. Nobody
 * could edit a live listing's price.
 *
 * DB-backed parts run when DATABASE_URL points at a test database.
 */

process.env.COUNTRY_CODE = 'UG';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'admin-live-listings-test-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-live-listings-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const hasDb = Boolean(process.env.DATABASE_URL);
const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');

test('the live route is one cached count, 50 rows a page, a small extra_fields subset and a search', () => {
  const route = ADMIN.slice(ADMIN.indexOf("router.get('/properties/live'"), ADMIN.indexOf("router.post('/sourced-inventory-candidates/seed'"));
  assert.match(route, /parseInt\(req\.query\.limit \|\| '50', 10\)/);
  assert.match(route, /adminLiveSearchClause\(req\.query\.q \|\| req\.query\.search/);
  assert.match(route, /jsonb_strip_nulls\(jsonb_build_object\(/, 'no full extra_fields payload');
  assert.doesNotMatch(route, /p\.extra_fields,\n/);
  assert.match(ADMIN, /const ADMIN_LIVE_COUNT_CACHE_MS = 60 \* 1000;/);
});

test('the client waits up to 25 s for live listings, can search them, and Review opens the live editor', () => {
  assert.match(APP, /const ADMIN_LIVE_LISTINGS_TIMEOUT_MS = 25000;/);
  assert.match(APP, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live", headers, \{ limit: 50, maxPages: 1 \}\), \[\], ADMIN_LIVE_LISTINGS_TIMEOUT_MS\)/);
  assert.match(APP, /function adminSearchLiveListings\(query = ""\)/);
  assert.match(APP, /window\.open\(`\/staff-dashboard\/review\/\$\{encodeURIComponent\(id\)\}`, "_blank", "noopener"\)/);
  assert.match(APP, /onclick="adminOpenLiveListingEditor\(\$\{idArg\}\)"/);
  assert.match(APP, /\["approved", "sold", "live", "published"\]\.includes\(status\) \? "adminOpenLiveListingEditor" : "openAdminListingReview"/);
  assert.match(APP, /\/api\/admin\/properties\/live\?limit=5&include_test_like=1&q=/, 'All Listings finds live rows by id or MK ref');
  assert.match(APP, /\|MK-\[0-9A-Z-\]\{4,\}\)\\\/\?\$\/i\);/, 'the direct review URL takes an MK ref');
  assert.match(APP, /data-live-listing-edit="1"/);
});

test('admin live listings: page size, search by MK ref / id / title, and speed', { skip: !hasDb }, async () => {
  const db = require('../config/database');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  const ids = [];
  const stamp = Date.now().toString(36).toUpperCase();
  try {
    for (let i = 0; i < 3; i += 1) {
      const id = crypto.randomUUID();
      ids.push(id);
      await db.query(
        `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, status, inquiry_reference, extra_fields, approved_at, created_at, updated_at)
         VALUES ($1, 'land', $2, 'A plot.', 'Kampala', 'Nakasero', 500000000, 'once', 'approved', $3, $4::jsonb, NOW(), NOW(), NOW())`,
        [id, `C19 live listing ${stamp} ${i}`, `MK-C19${stamp}-${i}`, JSON.stringify({ featured: i === 0, huge_blob: 'x'.repeat(5000), source_platform: 'TikTok' })]
      );
    }
    const started = Date.now();
    const page = await request(app).get('/api/admin/properties/live').set('x-api-key', process.env.ADMIN_API_KEY);
    assert.equal(page.status, 200, JSON.stringify(page.body).slice(0, 300));
    assert.ok(page.body.data.length <= 50);
    assert.equal(page.body.pagination.limit, 50);
    assert.ok(Date.now() - started < 3000, 'within 3 s');
    const mk = await request(app).get(`/api/admin/properties/live?q=MK-C19${stamp}-1`).set('x-api-key', process.env.ADMIN_API_KEY);
    assert.equal(mk.status, 200);
    assert.deepEqual(mk.body.data.map((row) => row.id), [ids[1]]);
    assert.equal(mk.body.data[0].extra_fields.huge_blob, undefined, 'only the small subset');
    assert.equal(mk.body.data[0].extra_fields.source_platform, 'TikTok');
    const byId = await request(app).get(`/api/admin/properties/live?q=${ids[2]}`).set('x-api-key', process.env.ADMIN_API_KEY);
    assert.deepEqual(byId.body.data.map((row) => row.id), [ids[2]]);
    const byTitle = await request(app).get(`/api/admin/properties/live?q=${encodeURIComponent(`live listing ${stamp}`)}`).set('x-api-key', process.env.ADMIN_API_KEY);
    assert.equal(byTitle.body.data.length, 3);
    assert.equal(byTitle.body.pagination.total, 3);
    const weird = await request(app).get('/api/admin/properties/live?q=%25_%27').set('x-api-key', process.env.ADMIN_API_KEY);
    assert.equal(weird.status, 200, 'LIKE wildcards and quotes are escaped');
  } finally {
    if (ids.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]);
  }
});

test('editing a live listing from Preview & edit keeps it live and records before/after', { skip: !hasDb }, async () => {
  const db = require('../config/database');
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const id = crypto.randomUUID();
  const user = (await db.query(
    `INSERT INTO users (id, first_name, last_name, phone, role, status, password_hash)
     VALUES ($1, 'C19', 'Moderator', $2, 'moderator', 'active', 'x') RETURNING id`,
    [crypto.randomUUID(), `+2567${String(Date.now()).slice(-8)}`]
  )).rows[0];
  const token = jwt.sign({ sub: user.id, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  try {
    await db.query(
      `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, status, moderation_stage, inquiry_reference, extra_fields, approved_at)
       VALUES ($1, 'land', 'Land in Nakasero', 'A plot.', 'Kampala', 'Nakasero', 500000000, 'once', 'approved', 'approved', $2, '{}'::jsonb, NOW())`,
      [id, `MK-C19LIVE-${Date.now().toString(36).toUpperCase()}`]
    );
    const res = await request(app)
      .patch(`/api/staff/properties/${id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listing: { price: 450000000, title: 'Land in Nakasero, 1 acre' }, stage: 'in_review' });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    const row = (await db.query('SELECT status, moderation_stage, price, title FROM properties WHERE id = $1', [id])).rows[0];
    assert.equal(row.status, 'approved', 'still live');
    assert.equal(row.moderation_stage, 'approved', 'not sent back to in_review');
    assert.equal(Number(row.price), 450000000);
    const event = (await db.query(
      `SELECT action, actor_id::text AS actor_id, delivery FROM property_moderation_events WHERE property_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]
    )).rows[0];
    assert.equal(event.action, 'staff_live_listing_edited');
    assert.equal(event.actor_id, user.id);
    assert.equal(event.delivery.status_kept, 'approved');
    assert.equal(Number(event.delivery.before.price), 500000000);
    assert.equal(Number(event.delivery.after.price), 450000000);
    assert.equal(event.delivery.before.title, 'Land in Nakasero');
  } finally {
    await db.query('DELETE FROM property_moderation_events WHERE property_id = $1', [id]).catch(() => {});
    await db.query('DELETE FROM properties WHERE id = $1', [id]);
    await db.query('DELETE FROM staff_activity_logs WHERE actor_id = $1', [user.id]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => {});
  }
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
