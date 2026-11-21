'use strict';
// King review queues (Arthur, 21 Nov 2026): "Found online to review" and "Agent properties to review".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const kr = require('../services/kingReview');
const { registerKingDeskRoutes } = require('../routes/kingDesk');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function withDb(handler, fn) {
  const orig = db.query; const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); return { rows: handler(sql, params) || [] }; };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}
const ID = '11111111-2222-4333-8444-555555555501';

test('found-online rule matches the old queue badge (flags, source and listed_via)', () => {
  for (const k of ["found_online_candidate", "found_online'", "social_search_candidate", 'found_online_property_source_v1', "listed_via"]) assert.ok(kr.FOUND_ONLINE_SQL.includes(k.replace("'", '')), k);
  assert.match(kr.SENT_BACK_SQL, /sent_back_at/);
});

test('platform comes from the source id or url; phones are masked', () => {
  assert.equal(kr.platformOf({ platform_id: 'youtube:abc' }), 'YouTube');
  assert.equal(kr.platformOf({ source_url: 'https://www.tiktok.com/@x/video/1' }), 'TikTok');
  assert.equal(kr.mask('+256700900118'), '•••118');
  assert.equal(kr.mask(''), '');
});

test('send back refuses bad ids and short notes before touching the database', async () => {
  await withDb(() => { throw new Error('db touched'); }, async () => {
    await assert.rejects(kr.sendBack("1' OR 1=1", { note: 'Please add photos' }), /Invalid listing id/);
    await assert.rejects(kr.sendBack(ID, { note: 'no' }), /Write what the agent needs/);
  });
});

test('send back refuses found-online and already decided listings', async () => {
  await withDb(() => [{ id: ID, status: 'pending', found: true }], async () => {
    await assert.rejects(kr.sendBack(ID, { note: 'Please add photos' }), (e) => e.status === 400 && /Found-online/.test(e.message));
  });
  await withDb(() => [{ id: ID, status: 'approved', found: false }], async () => {
    await assert.rejects(kr.sendBack(ID, { note: 'Please add photos' }), (e) => e.status === 409);
  });
});

test('send back keeps the listing pending and writes the note where the agent sees it', async () => {
  await withDb((sql) => (/^SELECT/.test(sql.trim()) ? [{ id: ID, status: 'pending', found: false }] : [{ id: ID, inquiry_reference: 'MK-1' }]), async (calls) => {
    const out = await kr.sendBack(ID, { note: '  Please   add inside photos ', actor: 'King' });
    assert.equal(out.ref, 'MK-1');
    const upd = calls.find((c) => /^UPDATE properties/.test(c.sql.trim()));
    assert.ok(upd, 'update ran');
    assert.doesNotMatch(upd.sql.split('WHERE')[0], /\bstatus\s*=/i, 'status is never changed');
    assert.match(upd.sql, /WHERE p\.id = \$1 AND p\.status = 'pending'/);
    assert.equal(upd.params[1], 'Changes needed: Please add inside photos');
    assert.equal(upd.params[5], 'Please add inside photos');
  });
});

function routes() {
  const h = {}; const router = { get: (p, f) => { h[`GET ${p}`] = f; }, put: (p, f) => { h[`PUT ${p}`] = f; }, post: (p, f) => { h[`POST ${p}`] = f; } };
  registerKingDeskRoutes(router); return h;
}
function call(fn, req) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    fn(req, res, reject);
  });
}

test('review routes are King-only (staff and moderators get 403) and not shared with staff', async () => {
  const h = routes();
  for (const k of ['GET /king/review/counts', 'GET /king/review/:kind(found|agent)', 'POST /king/review/:id/send-back']) assert.ok(h[k], k);
  assert.equal(isStaffSharedKingTool('/king/review/counts', 'GET'), false);
  assert.equal(isStaffSharedKingTool(`/king/review/${ID}/send-back`, 'POST'), false);
  await withDb(() => { throw new Error('db touched'); }, async () => {
    const a = await call(h['GET /king/review/counts'], { adminAuth: { type: 'moderator' }, params: {} });
    assert.equal(a.code, 403);
    const b = await call(h['POST /king/review/:id/send-back'], { adminAuth: { type: 'moderator' }, params: { id: ID }, body: { note: 'Please add photos' } });
    assert.equal(b.code, 403);
  });
});

test('client: two sidebar queues with badges, Short stays separate, old queue kept behind a toggle', () => {
  const kd = read('assets/king-desk.js');
  assert.match(kd, /\['review:found', '🌐', 'Found online to review', 'found_online'\]/);
  assert.match(kd, /\['review:agent', '🏠', 'Agent properties to review', 'agent_props'\]/);
  assert.match(kd, /'review:stays'/);
  const c = read('assets/king-review.js');
  assert.match(c, /openAdminListingReview/, 'approve and reject go through the full review and its checks');
  assert.match(c, /\/send-back/);
  assert.match(c, /kr-legacy/, 'old full queue and Harvest tools stay reachable');
  assert.match(c, /href="sms:/, 'texts go out from the company phone; the King presses send');
  assert.doesNotMatch(c, /wa\.me|whatsapp:\/\//i, 'no WhatsApp links');
  assert.doesNotMatch(c, /location\.href\s*=\s*['"]sms/, 'nothing opens the phone by itself');
  assert.match(read('index.html'), /\/assets\/king-review\.js\?v=/);
});

test('reject from the full review no longer saves the typed reason first (server refused it as the stored note)', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /skipReason: normalizedStatus === "rejected"/);
  assert.match(app, /reason: options\.skipReason \? "" :/);
  const built = read('assets/build/makaug-admin.min.js') + read('assets/build/makaug-app.min.js');
  assert.match(built, /skipReason/, 'bundles rebuilt');
});
