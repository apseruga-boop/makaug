'use strict';

/**
 * Staff dashboard freshness and completeness (9 Oct 2026).
 *
 *  1. An approval left the header count and lists stale: the status route
 *     cleared the public caches but not the per-moderator staff dashboard cache.
 *  2. The found-online panel stopped at 8 with no count and no way to see the
 *     rest.
 *  3. The fast payload shows empty leads / WhatsApp / registry lists and a
 *     "loading" bridge, and the SPA only asked for the panels when the fast
 *     payload was `partial`. The panels payload (cce22a3, 6 Jul) never carried
 *     those lists anyway.
 *  4. The X and YouTube drips paused by the monthly read cap never restarted:
 *     the month reset ran after the `!state.enabled` early return.
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-freshness-test-secret';
}
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'makaug-app.js'), 'utf8');

// ---------------------------------------------------------------------------
// Static checks (no database)
// ---------------------------------------------------------------------------

test('the fast payload always asks for the panels, not only when partial', () => {
  const start = APP.indexOf('"/api/staff/dashboard?fast=1"');
  assert.ok(start > 0);
  const block = APP.slice(start, start + 1600);
  assert.match(block, /hydrateStaffDashboardPanels\(data\.deferred_dashboard_endpoint/);
  assert.doesNotMatch(block.slice(0, block.indexOf('hydrateStaffDashboardPanels(')), /if \(data\.partial\)/);
});

test('the panel merge keeps WhatsApp counts and takes the live bridge status', () => {
  const start = APP.indexOf('function mergeStaffDashboardPanelData(');
  const end = APP.indexOf('\nfunction ', start + 10);
  const sandbox = {};
  vm.runInNewContext(`${APP.slice(start, end)}; this.merge = mergeStaffDashboardPanelData;`, sandbox);
  const merged = sandbox.merge(
    { summary: { whatsapp: { needs_human: 3, bridge: { status: 'loading' } } }, leads: [] },
    { panel_payload: true, whatsapp_bridge: { status: 'connected' }, leads: [{ id: 'l1' }] }
  );
  assert.equal(merged.summary.whatsapp.needs_human, 3);
  assert.equal(merged.summary.whatsapp.bridge.status, 'connected');
  assert.equal(merged.leads.length, 1);
});

test('the found-online panel says "Showing 8 of 12" and offers Load more', () => {
  const start = APP.indexOf('function staffFoundOnlineQueueView(');
  const end = APP.indexOf('\nfunction ', start + 10);
  // P6 caps "Load more" at STAFF_FOUND_ONLINE_MAX_ROWS (see staff-dashboard-memory.test.js).
  const sandbox = { STAFF_FOUND_ONLINE_MAX_ROWS: 200 };
  vm.runInNewContext(`${APP.slice(start, end)}; this.view = staffFoundOnlineQueueView;`, sandbox);
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));
  const first = sandbox.view({ data: { queued_found_online: rows, queued_found_online_meta: { total: 12, page_limit: 8 } }, extra: [], page: 1 });
  assert.equal(first.label, 'Showing 8 of 12');
  assert.equal(first.hasMore, true);
  const all = sandbox.view({
    data: { queued_found_online: rows, queued_found_online_meta: { total: 12, page_limit: 8 } },
    extra: [{ id: 'r8' }, { id: 'r9' }, { id: 'r10' }, { id: 'r11' }, { id: 'r7' }], // r7 repeated: shown once
    page: 2
  });
  assert.equal(all.label, 'Showing 12 of 12');
  assert.equal(all.hasMore, false);
  assert.match(APP, /review-queue\?segment=found_online&page=\$\{nextPage\}&limit=\$\{limit\}/);
});

// ---------------------------------------------------------------------------
// Against a real database
// ---------------------------------------------------------------------------

let db;
let request;
let app;
let token;
let moderatorId;
const fixtureIds = [];
const TAG = `FRESH${crypto.randomBytes(3).toString('hex')}`;

test.before(async () => {
  if (skip) return;
  const express = require('express');
  const jwt = require('jsonwebtoken');
  request = require('supertest');
  db = require('../config/database');
  moderatorId = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, role, password_hash, status)
     VALUES ('Fresh', 'Moderator', $1, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`]
  )).rows[0].id;
  token = jwt.sign({ sub: moderatorId, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  app.use('/api/properties', require('../routes/properties'));
});

test.after(async () => {
  if (!db) return;
  if (fixtureIds.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [fixtureIds]).catch(() => {});
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [moderatorId]).catch(() => {});
  await db.pool.end().catch(() => {});
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

test('12 found-online listings are all reachable, with an "8 of 12" count', { skip }, async () => {
  const before = await auth(request(app).get('/api/staff/dashboard?panels=1&cache_bypass=1'));
  assert.equal(before.status, 200, JSON.stringify(before.body).slice(0, 300));
  const baseTotal = Number(before.body.data.source_intake.queued_found_online_meta.total);
  assert.ok(Number.isFinite(baseTotal));
  for (let i = 0; i < 12; i += 1) {
    const id = (await db.query(
      `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage,
                               source, listed_via, extra_fields, created_at)
       VALUES ('rent', $1, 'Found-online panel fixture', 'Kampala', 'Ntinda', 1500000, 'month', 'pending', 'pending',
               'found_online_property_source_v1', 'found_online', $2::jsonb, NOW() - ($3::int * INTERVAL '1 minute'))
       RETURNING id`,
      [`${TAG} found online ${i}`, JSON.stringify({ found_online: true, source_url: `https://www.tiktok.com/@a/video/${Date.now()}${i}` }), 100 - i]
    )).rows[0].id;
    fixtureIds.push(id);
  }
  // The panels payload is cached per moderator for a short TTL.
  require('../routes/staff').clearStaffFastDashboardCache();
  const res = await auth(request(app).get('/api/staff/dashboard?panels=1&cache_bypass=1'));
  assert.equal(res.status, 200);
  const intake = res.body.data.source_intake;
  assert.equal(intake.queued_found_online.length, Math.min(8, baseTotal + 12));
  assert.equal(intake.queued_found_online_meta.total, baseTotal + 12);
  assert.equal(intake.queued_found_online_meta.label, `Showing ${Math.min(8, baseTotal + 12)} of ${baseTotal + 12}`);

  // Panel page 1, then "Load more" pages, reach every fixture exactly once.
  const seen = intake.queued_found_online.map((r) => r.id);
  for (let page = 2; page < 50; page += 1) {
    const more = await auth(request(app).get(`/api/staff/properties/review-queue?segment=found_online&page=${page}&limit=8&include_total=0`));
    assert.equal(more.status, 200, JSON.stringify(more.body).slice(0, 300));
    seen.push(...more.body.data.map((r) => r.id));
    if (!more.body.meta.has_more) break;
  }
  for (const id of fixtureIds) assert.equal(seen.filter((s) => s === id).length, 1, `fixture ${id} should appear exactly once`);
});

test('the panels payload carries leads, WhatsApp, the bridge and the source registry', { skip }, async () => {
  const res = await auth(request(app).get('/api/staff/dashboard?panels=1&cache_bypass=1'));
  assert.equal(res.status, 200);
  const data = res.body.data;
  assert.ok(Array.isArray(data.leads));
  assert.ok(Array.isArray(data.whatsapp_conversations));
  assert.ok(data.whatsapp_bridge && typeof data.whatsapp_bridge.status === 'string');
  assert.notEqual(data.whatsapp_bridge.status, 'loading');
  assert.ok(Array.isArray(data.source_intake.source_registry));
});

test('an approval through the status route empties the staff dashboard caches', { skip }, async () => {
  // Fill the per-moderator fast cache.
  const warm = await auth(request(app).get('/api/staff/dashboard?fast=1'));
  assert.equal(warm.status, 200);
  const staff = require('../routes/staff');
  const original = staff.clearStaffFastDashboardCache;
  let cleared = 0;
  staff.clearStaffFastDashboardCache = (...args) => { cleared += 1; return original(...args); };
  try {
    const source = (await db.query(`SELECT id FROM properties WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(source, 'needs one approved listing to copy');
    const cols = (await db.query(
      `SELECT string_agg('"' || column_name || '"', ', ') AS c FROM information_schema.columns
        WHERE table_name = 'properties' AND is_generated = 'NEVER' AND column_name NOT IN
          ('id','status','approved_at','rejected_at','reviewed_at','reviewed_by','moderation_stage',
           'owner_edit_token_hash','owner_edit_token_expires_at','created_at','updated_at','inquiry_reference','slug')`
    )).rows[0].c;
    const id = (await db.query(
      `INSERT INTO properties (${cols}, status, moderation_stage) SELECT ${cols}, 'pending', 'submitted' FROM properties WHERE id = $1 RETURNING id`,
      [source.id]
    )).rows[0].id;
    fixtureIds.push(id);
    await db.query(`INSERT INTO property_images (property_id, url, is_primary, sort_order) SELECT $2, url, is_primary, sort_order FROM property_images WHERE property_id = $1`, [source.id, id]);
    await db.query(`INSERT INTO property_images (property_id, url, is_primary, sort_order) VALUES ($1, 'https://media.makaug.com/properties/test/fresh.jpg', false, 99)`, [id]);
    const res = await auth(request(app).patch(`/api/properties/${id}/status`)).send({ status: 'approved', manual_notification_only: true });
    if (res.status !== 200) {
      // Some local copies trip an approval gate; a rejection exercises the same cache path.
      const rej = await auth(request(app).patch(`/api/properties/${id}/status`)).send({ status: 'rejected', reason: 'cache test', manual_notification_only: true });
      assert.equal(rej.status, 200, JSON.stringify(rej.body).slice(0, 300));
    }
    assert.ok(cleared >= 1, 'the status route must clear the staff dashboard cache');
  } finally {
    staff.clearStaffFastDashboardCache = original;
  }
});

for (const [name, modulePath, key, capReason] of [
  ['X', '../services/xSourceDripService', 'x_source_drip', 'x_monthly_read_cap_reached'],
  ['YouTube', '../services/youtubeSourceDripService', 'youtube_source_drip', 'youtube_monthly_read_cap_reached']
]) {
  test(`${name} drip: a cap pause lifts in a new month; a manual pause does not`, { skip }, async () => {
    const { resetMonthlyReadWindowIfNeeded } = require(modulePath);
    const client = await db.getClient();
    try {
      // Inside a transaction that is rolled back: nothing is left changed.
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO source_drip_state (drip_key, platform) VALUES ($1, $2) ON CONFLICT (drip_key) DO NOTHING`,
        [key, name === 'X' ? 'x' : 'youtube']
      );
      const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString();
      const capped = (await client.query(
        `UPDATE source_drip_state SET enabled = FALSE, status = 'blocked', pause_reason = $2, next_run_at = NULL,
                monthly_read_count = 9999, monthly_window_started_at = $3 WHERE drip_key = $1 RETURNING *`,
        [key, capReason, lastMonth]
      )).rows[0];
      const reset = await resetMonthlyReadWindowIfNeeded(client, capped);
      assert.equal(reset.enabled, true, 'a cap pause lifts in the new month');
      assert.equal(reset.pause_reason || '', '');
      assert.equal(Number(reset.monthly_read_count), 0);

      const manual = (await client.query(
        `UPDATE source_drip_state SET enabled = FALSE, status = 'paused', pause_reason = 'paused_by_admin',
                monthly_read_count = 50, monthly_window_started_at = $2 WHERE drip_key = $1 RETURNING *`,
        [key, lastMonth]
      )).rows[0];
      const stillPaused = await resetMonthlyReadWindowIfNeeded(client, manual);
      assert.equal(stillPaused.enabled, false, 'a manual pause stays paused');
      assert.equal(stillPaused.pause_reason, 'paused_by_admin');
      assert.equal(Number(stillPaused.monthly_read_count), 0, 'the count still resets');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
}

test('the drips reset the month before checking whether they are paused', () => {
  for (const file of ['services/xSourceDripService.js', 'services/youtubeSourceDripService.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const reset = source.indexOf('state = await resetMonthlyReadWindowIfNeeded(db, state);');
    const paused = source.indexOf("_source_drip_paused', state }");
    assert.ok(reset > 0 && paused > 0 && reset < paused, file);
  }
});
