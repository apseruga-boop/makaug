'use strict';
/**
 * Ronald's staff desk, 28 Nov 2026 (Arthur: "his agent view is not working").
 * Arthur is King, so every desk route works for him. Ronald is a moderator with a calling-only
 * login, and the desk routes he may use are a short allow-list. "Waiting for their Hi" (added in
 * #878) was never put on it, so his Agents to approve page said nobody was waiting while 109 were.
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const pipe = require('../services/staffPipeline');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
test.after(async () => { try { await db.pool.end(); } catch (_) {} });

async function withDb(handler, fn) {
  const orig = db.query; const seen = [];
  db.query = async (sql, params) => { seen.push({ sql: String(sql), params }); return { rows: (await handler(String(sql), params)) || [] }; };
  try { return await fn(seen); } finally { db.query = orig; }
}

test('every staff desk route (not King-only) is on the allow-list, so a staff login is never refused a page the desk draws', () => {
  const src = read('routes/staffDesk.js');
  const uuid = '11111111-1111-1111-1111-111111111111';
  const missing = [];
  for (const m of src.matchAll(/router\.(get|post|put)\('(\/desk\/[^']+)'/g)) {
    const method = m[1].toUpperCase();
    const p = m[2].replace(/\/missed\/:id\/dismiss/, '/missed/12/dismiss').replace(/\/wa\/:id/, `/wa/${uuid}`).replace(/:[a-z_:]+/g, uuid);
    if (!isStaffSharedKingTool(p, method)) missing.push(`${method} ${m[2]}`);
  }
  assert.deepEqual(missing, []);
});

test('the Waiting for their Hi list and the Connect your phone status are open to staff logins; King-only calling tools stay closed', () => {
  assert.equal(isStaffSharedKingTool('/desk/approve/awaiting-hi', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/calling/connect-status', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/desk/pipeline/call-again', 'POST'), true);
  for (const p of ['/calling/logins', '/calling/evidence', '/calling/numbers', '/calling/pipeline', '/calling/blocks', '/calling/targets']) assert.equal(isStaffSharedKingTool(p, 'GET'), false, p);
  assert.equal(isStaffSharedKingTool('/calling/logins/abc/link', 'POST'), false);
});

test('the Agents to approve page says when the Hi list could not load instead of "Nobody is waiting"', () => {
  const sd = read('assets/staff-desk.js');
  assert.doesNotMatch(sd, /api\('\/desk\/approve\/awaiting-hi'\)\.catch\(function \(\) \{ return \[\]; \}\)/);
  assert.match(sd, /hiFailed/);
  assert.match(sd, /data-sd-hi-empty/);
  assert.match(read('index.html'), /staff-desk\.js\?v=20261128-agentsview1/);
});

test('a failed database read is a 503 with plain words, never an empty list', async () => {
  const orig = db.query;
  db.query = async () => { throw new Error('timeout exceeded when trying to connect'); };
  try {
    await assert.rejects(() => pipe.toApprove('ronald', { caller: true }), (e) => e.status === 503 && /could not load/i.test(e.message));
    await assert.rejects(() => pipe.pipeline('ronald'), (e) => e.status === 503);
  } finally { db.query = orig; }
});

test('Call again puts my own interested number on my call list once, and only if I called it', async () => {
  const id = '22222222-2222-2222-2222-222222222222';
  const mine = { person_key: 'ronald', full_name: 'Test Realty', phone: '+256700000123', phone_key: '700000123' };
  let inserted = 0; let exists = false;
  const handler = (sql) => {
    if (/FROM call_attempts WHERE id/.test(sql)) return [mine];
    if (/FROM call_number_submissions/.test(sql)) return exists ? [{ id: 1 }] : [];
    if (/INSERT INTO call_number_submissions/.test(sql)) { inserted += 1; return []; }
    return [];
  };
  await withDb(handler, async () => {
    const first = await pipe.callAgain('ronald', id);
    assert.deepEqual({ ok: first.ok, queued: first.queued, phone: first.phone }, { ok: true, queued: true, phone: '•••123' });
    assert.equal(inserted, 1);
    exists = true;
    const again = await pipe.callAgain('ronald', id);
    assert.equal(again.queued, false);
    assert.equal(inserted, 1);
    await assert.rejects(() => pipe.callAgain('sharon', id), (e) => e.status === 404);
    await assert.rejects(() => pipe.callAgain('ronald', 'nope'), (e) => e.status === 400);
    await assert.rejects(() => pipe.callAgain('', id), (e) => e.status === 403);
  });
});

test('the route acts as the signed-in person and the pipeline card has the button', () => {
  assert.match(read('routes/staffDesk.js'), /router\.post\('\/desk\/pipeline\/call-again'.*pipe\.callAgain\(needMe\(req\), req\.body\?\.attempt_id\)/);
  assert.match(read('assets/staff-desk.js'), /data-sd-callagain/);
  const src = read('services/staffPipeline.js');
  assert.doesNotMatch(src, /wa\.me|sendMessage|whatsapp_messages[^`]*\b(INSERT|UPDATE|DELETE)\b/i);
});
