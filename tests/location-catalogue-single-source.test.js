'use strict';

/**
 * C11 (10 Oct 2026, Fisher) + the town-save addendum.
 *  - Town/Neighbourhood dropdowns only asked the server catalogue when the
 *    in-browser tree had nothing for the district.
 *  - Kampala still had a "Kampala" town beside its five divisions; Wakiso had
 *    "Wakiso" and "Wakiso Town".
 *  - Missing places: Kungu, Kigoowa, Kiwologoma, Busiika, Kitukutwe, Kigunga.
 *  - Picking "Kira" for MK-20261009-71C398 reverted to "Wakiso Town" on reload.
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'location-catalogue-secret';
}
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';

const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');
const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');

function catalogApp() {
  const app = express();
  app.use('/api/properties', require('../routes/properties'));
  return app;
}

test('Luzira resolves to Nakawa, Kampala; Kampala has exactly the five divisions', async () => {
  const luzira = canonicalizeUgandaLocation('Luzira', 'Kampala');
  assert.equal(luzira.town, 'Nakawa');
  assert.equal(luzira.district, 'Kampala');
  const res = await request(catalogApp()).get('/api/properties/locations/catalog?district=Kampala');
  assert.equal(res.status, 200);
  const towns = [...new Set(res.body.data.map((row) => row.town))].sort();
  assert.deepEqual(towns, ['Central', 'Kawempe', 'Makindye', 'Nakawa', 'Rubaga']);
  assert.ok(!towns.some((town) => /^Kampala|Division$/.test(town)));
});

test('the missing places resolve with their district and town', () => {
  const expected = [
    ['Naalya', 'Wakiso', 'Kira'], ['Kiwologoma', 'Wakiso', 'Kira'],
    // Busiika Town Council is in Luweero (UBOS, #368), not Wakiso.
    ['Busiika', 'Luwero', 'Busiika'],
    ['Namanve', 'Mukono', 'Mukono'], ['Kitukutwe', 'Wakiso', 'Kira'], ['Kungu', 'Wakiso', 'Kira'],
    ['Kigoowa', 'Kampala', 'Nakawa'], ['Kigunga', 'Mukono', 'Mukono'], ['Mbalwa', 'Wakiso', 'Kira'],
    ['Kyaliwajjala', 'Wakiso', 'Kira'], ['Maya', 'Wakiso', 'Nsangi']
  ];
  for (const [name, district, town] of expected) {
    const place = canonicalizeUgandaLocation(name, district);
    assert.ok(place, name);
    assert.deepEqual([place.district, place.town], [district, town], name);
  }
  // Kigoowa keeps the existing kampala:kigowa key, so saved listings still resolve.
  assert.equal(canonicalizeUgandaLocation('Kigoowa', 'Kampala').key, 'kampala:kigowa');
});

test('?district=Entebbe is a 400; Wakiso has no "Wakiso Town" twin', async () => {
  const app = catalogApp();
  assert.equal((await request(app).get('/api/properties/locations/catalog?district=Entebbe')).status, 400);
  const wakiso = await request(app).get('/api/properties/locations/catalog?district=Wakiso');
  const towns = new Set(wakiso.body.data.map((row) => row.town));
  assert.ok(towns.has('Wakiso') && !towns.has('Wakiso Town'));
  assert.ok(towns.has('Kira') && towns.has('Nsangi'));
  const names = wakiso.body.data.map((row) => row.name);
  assert.ok(['Kiwologoma', 'Kungu', 'Kitukutwe', 'Mbalwa'].every((name) => names.includes(name)));
});

test('the dropdown for Wakiso lists every catalogue town (server wins, browser-only places kept)', async () => {
  const start = APP.indexOf('function mergeLocationTreeWithServerRows(');
  const end = APP.indexOf('\nasync function loadSharedLocationCatalogForDistrict', start);
  const sandbox = {};
  vm.runInNewContext(`${APP.slice(start, end)}; this.merge = mergeLocationTreeWithServerRows;`, sandbox);
  const rows = (await request(catalogApp()).get('/api/properties/locations/catalog?district=Wakiso')).body.data;
  const browserTree = [
    { city: 'Wakiso Town', neighborhoods: [{ name: 'Kyaliwajjala' }, { name: 'Browser Only Place' }] },
    { city: 'Kira', neighborhoods: [{ name: 'Najjera' }] }
  ];
  const tree = sandbox.merge('Wakiso', rows, browserTree);
  const dropdownTowns = new Set(tree.map((node) => node.city));
  for (const town of new Set(rows.map((row) => row.town))) assert.ok(dropdownTowns.has(town), town);
  assert.ok(!dropdownTowns.has('Wakiso Town'), 'the old spelling is not offered');
  const kira = tree.find((node) => node.city === 'Kira');
  assert.ok(kira.neighborhoods.some((n) => n.name === 'Kyaliwajjala'), 'the server town wins for Kyaliwajjala');
  assert.ok(tree.some((node) => node.neighborhoods.some((n) => n.name === 'Browser Only Place')), 'browser-only places are kept');
  assert.match(APP, /if \(district && !options\.catalogLoaded && !serverLocationCatalogDistricts\.has\(district\)\) \{/);
});

test('a town staff pick in this save is kept; a stored one follows the catalogue', () => {
  const picked = normalizeReviewLocationHierarchy({ area: 'Nsangi', district: 'Wakiso', city: 'Kira' }, { preferChosenCity: true });
  assert.equal(picked.city, 'Kira');
  assert.deepEqual(picked.errors, []);
  const stored = normalizeReviewLocationHierarchy({ area: 'Kyaliwajjala', district: 'Wakiso', city: 'Wakiso Town' });
  assert.equal(stored.city, 'Kira', 'an old stored town follows the corrected catalogue');
  const division = normalizeReviewLocationHierarchy({ area: 'Luzira', district: 'Kampala', city: 'Nakawa Division' }, { preferChosenCity: true });
  assert.equal(division.city, 'Nakawa');
  assert.deepEqual(division.errors, []);
});

let db;
let token;
let moderatorId;
const ids = [];
const TAG = `TOWN${crypto.randomBytes(3).toString('hex')}`;

test.after(async () => {
  if (!db) return;
  if (ids.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
  await db.query('DELETE FROM property_moderation_events WHERE actor_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [moderatorId]).catch(() => {});
  await db.pool.end().catch(() => {});
});

test('against a database: a town picked in Preview & edit survives the save and a reload', { skip }, async () => {
  db = require('../config/database');
  const jwt = require('jsonwebtoken');
  moderatorId = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, role, password_hash, status)
     VALUES ('Town', 'Moderator', $1, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`]
  )).rows[0].id;
  token = jwt.sign({ sub: moderatorId, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const id = (await db.query(
    `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage, source, listed_via, extra_fields)
     VALUES ('rent', $1, 'Two-bedroom flat to let in Wakiso with parking.', 'Wakiso', 'Nsangi', 900000, 'month', 'pending', 'pending', 'website', 'website', '{"city":"Wakiso Town"}'::jsonb)
     RETURNING id`,
    [`${TAG} flat`]
  )).rows[0].id;
  ids.push(id);
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);
  const saved = await auth(request(app).patch(`/api/staff/properties/${id}/review`)).send({ listing: { district: 'Wakiso', city: 'Kira', area: 'Nsangi', neighborhood: 'Nsangi' }, stage: 'in_review' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 400));
  const row = (await db.query(`SELECT extra_fields->>'city' AS city FROM properties WHERE id = $1`, [id])).rows[0];
  assert.equal(row.city, 'Kira');
  const preview = await auth(request(app).get(`/api/staff/properties/${id}/preview`));
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.extra_fields?.city || preview.body.data.city, 'Kira');
});
