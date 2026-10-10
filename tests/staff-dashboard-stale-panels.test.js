'use strict';

/**
 * C5 (10 Oct 2026, Fisher): a stale staff dashboard.
 *  1. One slow widget (staff_dashboard_partial:pool_timeout, 9 Oct 13:47 and
 *     10 Oct 06:42) made the refresh throw and keep the whole old snapshot.
 *  2. Preview & edit saved a new title, but PATCH /review didn't clear the
 *     staff caches, so the queue showed the old one.
 *  3. The WhatsApp panels read whatsapp_message_logs (last row 12 Sep); the
 *     bridge writes whatsapp_messages and the outbox.
 *  4. The marketplace drip panel read a run log last written 20 Jul and never
 *     said it wasn't running.
 *  Addendum: a Kyanja search showed one listing's title and price on cards
 *  that linked to three other listings.
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
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-stale-panels-secret';
}
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'makaug-app.js'), 'utf8');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const fn = (name) => {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = APP.indexOf('\nfunction ', start + 10);
  return APP.slice(start, end);
};

test('a refresh with one failing widget keeps that widget\'s last good value and updates the rest', () => {
  const merge = require('../routes/staff').__mergeStaffFastDashboardPayload;
  assert.equal(typeof merge, 'function');
  const previousAt = Date.parse('2026-10-10T05:30:00Z');
  const now = Date.parse('2026-10-10T05:42:00Z');
  const previous = {
    summary: { listings: { live: 4300, pending_review: 160 }, leads: { open: 12 }, whatsapp: { open: 4, bridge: { status: 'loading' } }, sources: { total_sources: 90 } },
    source_intake: { summary: { total_sources: 90 } },
    widget_as_of: { listings: '2026-10-10T05:30:00.000Z', leads: '2026-10-10T05:30:00.000Z' }
  };
  const fresh = {
    partial: true,
    summary: {
      listings: { live: 4353, pending_review: 152 },
      leads: { open: null, _fallback_reason: 'pool_timeout' },
      whatsapp: { open: 7, bridge: { status: 'loading' } },
      sources: { total_sources: null, _fallback_reason: 'statement_timeout' }
    },
    source_intake: { summary: { total_sources: null, _fallback_reason: 'statement_timeout' } },
    meta: { partial: true, fallback_reasons: ['pool_timeout', 'statement_timeout'] }
  };
  const merged = merge(previous, fresh, { previousAt, now });
  assert.equal(merged.summary.listings.live, 4353, 'healthy widgets take the fresh value');
  assert.equal(merged.summary.listings.pending_review, 152);
  assert.equal(merged.summary.whatsapp.open, 7);
  assert.equal(merged.summary.leads.open, 12, 'a failed widget keeps its last good value');
  assert.equal(merged.summary.sources.total_sources, 90);
  assert.equal(merged.source_intake.summary.total_sources, 90, 'the mirrored copy follows');
  assert.equal(merged.stale_widgets.leads.as_of, '2026-10-10T05:30:00.000Z');
  assert.equal(merged.stale_widgets.leads.reason, 'pool_timeout');
  assert.equal(merged.stale_widgets.leads.age_ms, 12 * 60 * 1000);
  assert.equal(merged.widget_as_of.listings, '2026-10-10T05:42:00.000Z');
  assert.equal(merged.partial, false, 'nothing is missing, so not partial');
  // With no last good value the widget is reported as unavailable.
  const first = merge(null, fresh, { now });
  assert.deepEqual(first.meta.unavailable_widgets.sort(), ['leads', 'sources']);
  assert.equal(first.partial, true);
});

test('the refresh path caches the merged payload instead of throwing on a partial one', () => {
  const src = read('routes/staff.js');
  const start = src.indexOf('function refreshStaffFastDashboardCache(');
  const block = src.slice(start, src.indexOf('\nasync function dashboardFastPayload', start));
  assert.doesNotMatch(block, /throw error/);
  assert.match(block, /mergeStaffFastDashboardPayload\(previous\?\.payload, payload/);
  assert.match(block, /staffFastDashboardCache\.set\(cacheKey, \{ at: now, payload: merged \}\)/);
});

test('PATCH /review and every other successful staff write clear the staff caches', () => {
  const src = read('routes/staff.js');
  const start = src.indexOf("router.patch('/properties/:id/review'");
  assert.match(src.slice(start, start + 2400), /clearStaffFastDashboardCache\(\);/);
  assert.match(src, /if \(\['GET', 'HEAD', 'OPTIONS'\]\.includes\(req\.method\) \|\| STAFF_WRITE_CACHE_EXEMPT\.test\(req\.path\)\) return next\(\);/);
});

test('the staff header says when the counts and the queue were read, and which counts are older', () => {
  const nodes = {};
  const sandbox = {
    document: { getElementById: (id) => (nodes[id] = nodes[id] || { textContent: '', classList: { toggle() {} } }) },
    Date
  };
  vm.runInNewContext(`${fn('staffKampalaDateTime')}\nconst STAFF_WIDGET_LABELS = { leads: "leads", sources: "sources" };\n${fn('staffRenderDashboardFreshness')}\nthis.render = staffRenderDashboardFreshness;`, sandbox);
  sandbox.render({ meta: { as_of: '2026-10-10T09:42:00Z' }, panels_as_of: '2026-10-10T09:42:30Z', stale_widgets: { leads: { as_of: '2026-10-10T09:30:00Z' } } });
  assert.match(nodes['staff-dashboard-freshness'].textContent, /^Counts as of 10 Oct 2026, 12:42 EAT · queue as of 10 Oct 2026, 12:42 EAT · older \(slow query\): leads from 10 Oct 2026, 12:30 EAT$/);
  assert.match(read('index.html'), /id="staff-dashboard-freshness"/);
});

test('the marketplace drip panel says "not running" with the last good run and the last error', () => {
  const { marketplaceDripHealth } = require('../services/marketplaceNationalDripService');
  const now = Date.parse('2026-10-10T12:00:00Z');
  const failing = marketplaceDripHealth({
    runs: [{ status: 'completed', created_at: '2026-07-20T18:10:00Z' }],
    scheduler: { failing_since: '2026-10-10T09:24:00Z', last_error_at: '2026-10-10T11:58:00Z', last_error: 'Marketplace drip timed out' },
    state: { enabled: true },
    now
  });
  assert.equal(failing.status, 'not_running');
  assert.equal(failing.last_success_at, '2026-07-20T18:10:00.000Z');
  assert.equal(failing.last_error, 'Marketplace drip timed out');
  assert.match(failing.label, /^Not running: no successful run since 2026-07-20/);
  assert.equal(marketplaceDripHealth({ scheduler: { disabled_by_env: true }, state: { enabled: true }, now }).status, 'off');
  assert.equal(marketplaceDripHealth({ runs: [{ status: 'completed', created_at: '2026-10-10T11:40:00Z' }], scheduler: {}, state: { enabled: true }, now }).status, 'running');
  assert.equal(marketplaceDripHealth({ runs: [], scheduler: {}, state: { enabled: false, pause_reason: 'manual' }, now }).status, 'paused');
  assert.match(APP, /function marketplaceDripHealthHtml\(health = null\)/);
  assert.match(read('services/marketplaceNationalDripService.js'), /health: marketplaceDripHealth\(\{ runs: runs\.rows, scheduler: schedulerStatus\(\), state \}\)/);
});

test('"failed WhatsApp" counts read the outbox, not the dead log table', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /adminCommandCentreMetric\('failed_whatsapp', \(\) => safeCount\(FAILED_WHATSAPP_SQL\)\)/);
  assert.match(admin, /failedWhatsApp: await safeCount\(FAILED_WHATSAPP_SQL\)/);
  assert.doesNotMatch(admin, /SELECT \*\s+FROM whatsapp_message_logs/);
  assert.match(require('../services/whatsappActivityService').FAILED_WHATSAPP_SQL, /FROM outbound_message_queue/);
});

test('search cards always show the row they link to (Kyanja addendum)', () => {
  const sandbox = { PROPERTIES: [], publicCategoryPageRowsCache: {} };
  vm.runInNewContext(`
    ${fn('propertyIdentityForUi')}
    ${fn('findPropertyForUi')}
    function publicPaginationKey(category) { return category; }
    function publicPaginationCacheFor(key) { publicCategoryPageRowsCache[key] = publicCategoryPageRowsCache[key] || {}; return publicCategoryPageRowsCache[key]; }
    function mapRemotePropertyForUi(row) { return { ...row, type: row.listing_type, mapped: true }; }
    ${fn('cachePublicCategoryPageRows')}
    this.cache = cachePublicCategoryPageRows;
  `, sandbox);
  // A polluted client object: the apartment block's title and price under another listing's backend id.
  sandbox.PROPERTIES.push(
    { id: '77238126-0000-4000-8000-000000000001', backend_id: '77238126-0000-4000-8000-000000000001', title: 'Apartment block for sale in Kisaasi', price: 2_500_000_000 },
    { id: 'local-7', backend_id: 'c7c64250-0000-4000-8000-000000000002', title: 'Apartment block for sale in Kisaasi', price: 2_500_000_000 }
  );
  const rows = [
    { id: 'c7c64250-0000-4000-8000-000000000002', listing_type: 'sale', title: 'Mansion for sale in Najjera', price: null, remote_source: 'api' },
    { id: 'a96671f1-0000-4000-8000-000000000003', listing_type: 'sale', title: 'Duplex for sale in Kisasi', price: null },
    { id: '77238126-0000-4000-8000-000000000001', listing_type: 'sale', title: 'Apartment block for sale in Kisaasi', price: 2_500_000_000, remote_source: 'api' }
  ];
  const shown = sandbox.cache('sale', 1, rows);
  assert.deepEqual(shown.map((row) => [String(row.backend_id || row.id), row.title]), rows.map((row) => [row.id, row.title]));
  // The staff approval lookup matches the backend id first.
  assert.match(APP, /const listing = listingLists\.reduce\(\(found, list\) => found \|\| \(Array\.isArray\(list\) \? list\.find\(byBackend\) : null\), null\)/);
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
const TAG = `STALE${crypto.randomBytes(3).toString('hex')}`;

test.before(async () => {
  if (skip) return;
  const express = require('express');
  const jwt = require('jsonwebtoken');
  request = require('supertest');
  db = require('../config/database');
  moderatorId = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, role, password_hash, status)
     VALUES ('Stale', 'Moderator', $1, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`]
  )).rows[0].id;
  token = jwt.sign({ sub: moderatorId, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  app.use('/api/admin', (req, _res, next) => { req.adminAuth = { userId: moderatorId, role: 'super_admin' }; next(); });
});

test.after(async () => {
  if (!db) return;
  if (fixtureIds.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [fixtureIds]).catch(() => {});
  await db.query(`DELETE FROM whatsapp_messages WHERE wa_message_id LIKE $1`, [`${TAG}%`]).catch(() => {});
  await db.query('DELETE FROM property_moderation_events WHERE actor_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [moderatorId]).catch(() => {});
  await db.pool.end().catch(() => {});
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

test('PATCH /review followed by the dashboard returns the new title', { skip }, async () => {
  const id = (await db.query(
    `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage, source, listed_via, created_at)
     VALUES ('rent', $1, 'Stale title fixture for the staff queue.', 'Kampala', 'Ntinda', 1500000, 'month', 'pending', 'pending', 'website', 'website', NOW())
     RETURNING id`,
    [`${TAG} old title`]
  )).rows[0].id;
  fixtureIds.push(id);
  // Warm the per-moderator caches with the old title.
  const before = await auth(request(app).get('/api/staff/dashboard?panels=1'));
  assert.equal(before.status, 200, JSON.stringify(before.body).slice(0, 300));
  await auth(request(app).get('/api/staff/dashboard?fast=1'));
  const saved = await auth(request(app).patch(`/api/staff/properties/${id}/review`)).send({ listing: { title: `${TAG} new title` }, stage: 'in_review' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 400));
  const after = await auth(request(app).get('/api/staff/dashboard?panels=1'));
  assert.equal(after.status, 200);
  const queue = [...(after.body.data.review_queue || []), ...(after.body.data.broker_review_queue || [])];
  const row = queue.find((item) => item.id === id);
  if (row) assert.equal(row.title, `${TAG} new title`);
  else {
    const page = await auth(request(app).get('/api/staff/properties/review-queue?segment=main&page=1&limit=200'));
    assert.equal((page.body.data || []).find((item) => item.id === id)?.title, `${TAG} new title`);
  }
});

test('the WhatsApp panel query returns a message the bridge logged', { skip }, async () => {
  const { logWhatsappMessage } = require('../routes/whatsapp').__test;
  await logWhatsappMessage({ userPhone: '+256700111222', waMessageId: `${TAG}-in`, direction: 'inbound', messageType: 'text', payload: { text: 'Hello, is the Kyanja flat available?' } });
  const { listWhatsappActivity, whatsappActivityFreshness } = require('../services/whatsappActivityService');
  const activity = await listWhatsappActivity(db, { limit: 20 });
  const row = activity.rows.find((item) => item.preview === 'Hello, is the Kyanja flat available?');
  assert.ok(row, JSON.stringify(activity.rows.slice(0, 3)));
  assert.equal(row.status, 'received');
  assert.equal(row.recipient_phone_masked, '2567***222');
  const freshness = await whatsappActivityFreshness(db);
  assert.equal(freshness.source, 'whatsapp_messages');
  assert.ok(Date.now() - Date.parse(freshness.last_inbound_at) < 60_000);
});
