'use strict';

// Moderator report, 8 Oct 2026: the header said "Pending Review 22" but only 12
// cards showed, and some cards appeared twice. With 22 pending fixtures (some
// from brokers): every one is reachable by paging, none renders twice, the
// first card is the oldest, the header count equals the reachable total, and
// the MK ref search finds a listing.

process.env.COUNTRY_CODE = process.env.COUNTRY_CODE || 'UG';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-review-queue-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const staffRouter = require('../routes/staff');

const app = express();
app.use(express.json());
app.use('/api/staff', staffRouter);

const TOKEN = `RQT${crypto.randomBytes(4).toString('hex')}`;
const fixtures = []; // { id, broker, created_at, ref }
let staffToken;
let staffUserId;

async function insertFixture(index, broker) {
  const id = crypto.randomUUID();
  // Oldest first: index 0 is the oldest. Spread across 6–8 Oct like the report.
  const createdAt = new Date(Date.UTC(2026, 9, 6, 6, 0, 0) + index * 3 * 3600 * 1000).toISOString();
  const ref = `MK-${TOKEN}-${String(index).padStart(2, '0')}`;
  await db.query(
    `INSERT INTO properties (id, listing_type, title, description, district, area, price, status, moderation_stage,
                             extra_fields, listed_via, source, lister_type, lister_name, lister_phone, inquiry_reference,
                             created_at, updated_at)
     VALUES ($1, 'rent', $2, 'Queue paging fixture', 'Kampala', 'Ntinda', 1500000, 'pending', 'pending',
             $3::jsonb, $4, $5, $6, $7, '+256772000394', $8, $9, NOW() - ($10::int * INTERVAL '1 minute'))`,
    [
      id,
      `${TOKEN} listing ${index}`,
      JSON.stringify(broker ? { broker_submission: true } : {}),
      broker ? 'broker_portal' : 'website',
      broker ? 'broker_portal' : 'website',
      broker ? 'agent' : 'owner',
      broker ? `Broker ${index}` : `Owner ${index}`,
      ref,
      createdAt,
      index // updated_at deliberately in the reverse order of created_at
    ]
  );
  fixtures.push({ id, broker, created_at: createdAt, ref });
}

test.before(async () => {
  const user = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, email, role, password_hash, status)
     VALUES ('Queue', 'Moderator', $1, $2, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`, `queue-mod-${Date.now()}@example.com`]
  )).rows[0];
  staffUserId = user.id;
  staffToken = jwt.sign({ sub: user.id, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  // 22 pending: 7 broker, 15 owner, interleaved.
  for (let i = 0; i < 22; i += 1) await insertFixture(i, i % 3 === 1);
});

test.after(async () => {
  await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [fixtures.map((f) => f.id)]).catch(() => {});
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [staffUserId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [staffUserId]).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});

const get = (url) => request(app).get(url).set('Authorization', `Bearer ${staffToken}`);

async function pageAll(segment, extra = '') {
  const ids = [];
  let total = null;
  for (let page = 1; page < 50; page += 1) {
    const res = await get(`/api/staff/properties/review-queue?segment=${segment}&page=${page}&limit=5${extra}`);
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    total = res.body.pagination.total;
    ids.push(...res.body.data.map((row) => row.id));
    if (!res.body.meta.has_more) break;
  }
  return { ids, total };
}

test('all 22 are reachable by paging, split between main and broker with no overlap', async () => {
  const search = `&search=${TOKEN}`;
  const main = await pageAll('main', search);
  const broker = await pageAll('broker', search);
  assert.equal(main.total, 15);
  assert.equal(broker.total, 7);
  assert.equal(new Set(main.ids).size, main.ids.length, 'no id twice in main');
  assert.equal(new Set(broker.ids).size, broker.ids.length, 'no id twice in broker');
  const overlap = main.ids.filter((id) => broker.ids.includes(id));
  assert.deepEqual(overlap, [], 'no id in both lists');
  assert.deepEqual(new Set([...main.ids, ...broker.ids]), new Set(fixtures.map((f) => f.id)));
  const brokerIds = fixtures.filter((f) => f.broker).map((f) => f.id);
  assert.deepEqual(new Set(broker.ids), new Set(brokerIds));
});

test('oldest first: the first card is the oldest, and pages keep created_at order', async () => {
  const main = await pageAll('main', `&search=${TOKEN}`);
  const expected = fixtures.filter((f) => !f.broker).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((f) => f.id);
  assert.deepEqual(main.ids, expected);
});

test('dashboard: header count = reachable total, lists are disjoint and oldest-first', async () => {
  const res = await get('/api/staff/dashboard');
  assert.equal(res.status, 200);
  const data = res.body.data;
  const header = data.summary.listings.pending_review;
  const brokerHeader = data.summary.listings.broker_pending_review;
  const main = await pageAll('main');
  const broker = await pageAll('broker');
  assert.equal(header, main.total + broker.total, 'header count equals what paging can reach');
  assert.equal(main.ids.length + broker.ids.length, header);
  assert.equal(brokerHeader, broker.total);
  const reviewIds = data.review_queue.map((row) => row.id);
  const brokerQueueIds = data.broker_review_queue.map((row) => row.id);
  assert.equal(reviewIds.length, 12, 'fast first page stays at 12');
  assert.deepEqual(reviewIds.filter((id) => brokerQueueIds.includes(id)), []);
  assert.equal(reviewIds[0], main.ids[0], 'first card is the oldest pending listing');
  assert.equal(data.review_queue_meta.total, main.total);
  assert.equal(data.broker_review_queue_meta.total, broker.total);
});

test('dashboard panels payload: no id in both lists, oldest first', async () => {
  const res = await get('/api/staff/dashboard?panels=1');
  assert.equal(res.status, 200);
  const data = res.body.data;
  const reviewIds = data.review_queue.map((row) => row.id);
  const brokerIds = data.broker_review_queue.map((row) => row.id);
  assert.deepEqual(reviewIds.filter((id) => brokerIds.includes(id)), []);
  const created = data.review_queue.map((row) => new Date(row.created_at).getTime());
  assert.deepEqual(created, [...created].sort((a, b) => a - b));
});

test('MK ref search finds the listing', async () => {
  const target = fixtures[17];
  const res = await get(`/api/staff/properties/review-queue?search=${encodeURIComponent(target.ref)}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((row) => row.id), [target.id]);
  assert.equal(res.body.pagination.total, 1);
});

// ---- frontend helpers (extracted from assets/makaug-app.js and run in a VM) --

const appSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = appSource.indexOf(') {', start) + 2; i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') { depth -= 1; if (depth === 0) return appSource.slice(start, i + 1); }
  }
  throw new Error(`could not extract ${name}`);
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  'staffMaskPhone', 'staffKampalaDateTime', 'staffDedupeRows',
  'adminReviewOriginalAmountState', 'adminReviewPricePatchFields'
].map(extractFunction).join('\n'), sandbox);

test('card helpers: masked phone, Kampala time, dedupe by id', () => {
  assert.equal(sandbox.staffMaskPhone('+256 772 000 394'), '+256 7•• ••• 394');
  assert.equal(sandbox.staffMaskPhone('0772000394'), '+256 7•• ••• 394');
  assert.equal(sandbox.staffMaskPhone(''), '');
  assert.match(sandbox.staffKampalaDateTime('2026-10-06T06:00:00.000Z'), /6 Oct 2026, 09:00 EAT/);
  const rows = sandbox.staffDedupeRows([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }], new Set(['c']));
  assert.equal(JSON.stringify(rows.map((r) => r.id)), '["a","b"]');
});

test('the queue card shows MK ref, submitter, masked phone, date, type and area', () => {
  const card = extractFunction('staffReviewQueueCardHtml');
  assert.match(card, /inquiry_reference/);
  assert.match(card, /Submitted by/);
  assert.match(card, /staffMaskPhone\(item\.lister_phone\)/);
  assert.match(card, /staffKampalaDateTime\(item\.created_at\)/);
  assert.doesNotMatch(card, /Owner\/contact: \$\{adminEscape\(item\.lister_name \|\| item\.lister_phone/, 'the full phone is no longer printed on the card');
  assert.match(appSource, /Showing \$\{staffNumber\(shown\)\}/);
  assert.match(appSource, /staffLoadMoreReviewQueue/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="staff-review-queue-search"[^>]*oninput="staffSearchReviewQueue\(this\.value\)"/);
});
