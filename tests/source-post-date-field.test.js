'use strict';

/**
 * C12 (10 Oct 2026, Fisher): staff Preview & edit had no field for when the
 * source post was published. It now has "Posted on <platform> on", saved to
 * extra_fields.source_published_at as staff_confirmed with high confidence.
 * (The "Added to makaug" date already uses created_at, P3 #397.)
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'source-post-date-secret';
}
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';

const { normalizeStaffSourcePostDate, staffSourcePostDateExtra } = require('../utils/sourcePostDate');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the post date is validated: a real date, not in the future, not before 2015', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ok = normalizeStaffSourcePostDate('2026-10-08', { now });
  assert.equal(ok.ok, true);
  assert.equal(ok.date, '2026-10-08');
  assert.equal(ok.iso, '2026-10-08T09:00:00.000Z', 'noon in Kampala');
  assert.equal(normalizeStaffSourcePostDate('2026-10-11', { now }).error, 'The source post date cannot be in the future.');
  assert.equal(normalizeStaffSourcePostDate('2014-12-31', { now }).error, 'The source post date cannot be before 2015.');
  assert.equal(normalizeStaffSourcePostDate('2026-02-30', { now }).error, 'The source post date is not a real date.');
  assert.equal(normalizeStaffSourcePostDate('8 Oct', { now }).ok, false);
  const extra = staffSourcePostDateExtra(ok, { actorId: 'staff-1', now });
  assert.equal(extra.source_post_date_status, 'staff_confirmed');
  assert.equal(extra.source_post_date_confidence, 'high_staff_confirmed');
  assert.equal(extra.source_post_date_confirmed_by, 'staff-1');
  assert.equal(extra.first_posted_online_at, ok.iso);
});

test('the public payload shows the confirmed post date and "Added to makaug" from created_at', () => {
  const { publicPropertyRow } = require('../routes/properties')._test;
  const row = publicPropertyRow({
    id: '56ec3ed3-3962-4aa1-aea1-4bf333279083',
    listing_type: 'sale',
    title: 'House for sale in Akright City',
    status: 'approved',
    source: 'found_online_property_source_v1',
    created_at: '2026-10-09T08:00:00.000Z',
    extra_fields: {
      found_online: true,
      source_platform: 'TikTok',
      source_url: 'https://www.tiktok.com/@agent/video/7691604548967763208',
      added_to_makaug_at: '2026-05-20T00:00:00.000Z',
      added_to_makaug_label: 'Added to makaug source review on 20 May 2026',
      ...staffSourcePostDateExtra(normalizeStaffSourcePostDate('2026-10-08', { now: new Date('2026-10-10T12:00:00Z') }))
    }
  }, []);
  const extra = row.extra_fields || {};
  assert.equal(extra.source_published_at, '2026-10-08T09:00:00.000Z');
  assert.equal(extra.source_post_date_status, 'staff_confirmed');
  assert.equal(extra.added_to_makaug_at, '2026-10-09T08:00:00.000Z', 'created_at, not the 20 May metadata');
  const app = read('assets/makaug-app.js');
  assert.match(app, /function adminReviewSourcePostDateFieldHtml\(review = \{\}\)/);
  assert.match(app, /\$\{adminReviewSourcePostDateFieldHtml\(review\)\}/);
  assert.match(app, /\? \{ source_post_date: get\("admin-review-source-post-date-edit"\) \}/);
  assert.match(app, /const addedToMakaugRaw = p\.created_at \|\| p\.createdAt/);
});

let db;
let token;
let moderatorId;
const ids = [];
const TAG = `POSTDATE${crypto.randomBytes(3).toString('hex')}`;

test.after(async () => {
  if (!db) return;
  if (ids.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
  await db.query('DELETE FROM property_moderation_events WHERE actor_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [moderatorId]).catch(() => {});
  await db.pool.end().catch(() => {});
});

test('against a database: the staff save stores the date; a future date is refused', { skip }, async () => {
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  db = require('../config/database');
  moderatorId = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, role, password_hash, status)
     VALUES ('Date', 'Moderator', $1, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`]
  )).rows[0].id;
  token = jwt.sign({ sub: moderatorId, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const id = (await db.query(
    `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage, source, listed_via, extra_fields)
     VALUES ('sale', $1, 'Found-online house for sale in Kira with parking.', 'Wakiso', 'Kira', 450000000, 'once', 'pending', 'pending', 'found_online_property_source_v1', 'found_online', '{"found_online":true,"source_platform":"TikTok"}'::jsonb)
     RETURNING id`,
    [`${TAG} house`]
  )).rows[0].id;
  ids.push(id);
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const refused = await auth(request(app).patch(`/api/staff/properties/${id}/review`)).send({ listing: { source_post_date: future }, stage: 'in_review' });
  assert.equal(refused.status, 400);
  assert.match(JSON.stringify(refused.body), /cannot be in the future/);
  const saved = await auth(request(app).patch(`/api/staff/properties/${id}/review`)).send({ listing: { source_post_date: '2026-10-08' }, stage: 'in_review' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 400));
  const extra = (await db.query('SELECT extra_fields FROM properties WHERE id = $1', [id])).rows[0].extra_fields;
  assert.equal(extra.source_published_at, '2026-10-08T09:00:00.000Z');
  assert.equal(extra.source_post_date_status, 'staff_confirmed');
  assert.equal(extra.source_post_date_confirmed_by, moderatorId);
});
