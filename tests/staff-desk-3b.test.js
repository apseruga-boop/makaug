'use strict';
// Staff desk 3b (Arthur, 21 Nov 2026): mandatory outcome, call summary, pipeline
// buckets, agents to approve, owes us money with Chase, contact history, missed calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const calling = require('../services/callingScreen');
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

test('stageOf puts each number in its furthest bucket', () => {
  const n = (o) => ({ outcomes: [], ...o });
  assert.equal(pipe.stageOf(n({ outcomes: ['no_answer'] })), null);
  assert.equal(pipe.stageOf(n({ outcomes: ['interested'] })), 'interested');
  assert.equal(pipe.stageOf(n({ outcomes: ['interested'], said_hi: true })), 'said_hi');
  assert.equal(pipe.stageOf(n({ outcomes: ['promised'] })), 'to_close');
  assert.equal(pipe.stageOf(n({ outcomes: ['interested'], signed_up: true, said_hi: true })), 'to_close');
  assert.equal(pipe.stageOf(n({ outcomes: ['interested'], paid: true })), 'paid');
  assert.deepEqual(pipe.STAGES, ['interested', 'said_hi', 'to_close', 'paid']);
});

test('last3 masks phone numbers to the last three digits', () => {
  assert.equal(pipe.last3('+256 700 900 301'), '•••301');
  assert.equal(pipe.last3(''), '');
});

test('migration 248 only adds the call_missed table and has a rollback', () => {
  const sql = read('db/migrations/248_call_missed.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS call_missed/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(DROP|DELETE|UPDATE|ALTER TABLE (?!call_missed))\b/i);
  assert.ok(!fs.existsSync(path.join(root, 'db/migrations/247_call_missed.sql')), 'old 247 name is gone');
  const rb = read('scripts/rollback-248-call-missed.sql');
  assert.match(rb, /DROP TABLE IF EXISTS call_missed/);
  assert.match(rb, /filename = '248_call_missed\.sql'/);
  const nums = fs.readdirSync(path.join(root, 'db/migrations')).map((f) => f.slice(0, 3));
  assert.equal(nums.filter((x) => x === '248').length, 1, 'one 248 migration');
});

test('staff may use only their own 3b pipeline endpoints', () => {
  for (const p of ['/desk/owed', '/desk/pipeline', '/desk/approve', '/desk/owes', '/desk/missed']) assert.equal(isStaffSharedKingTool(p, 'GET'), true, p);
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(isStaffSharedKingTool(`/desk/owed/${id}`, 'POST'), true);
  assert.equal(isStaffSharedKingTool(`/desk/owes/${id}/chase`, 'POST'), true);
  assert.equal(isStaffSharedKingTool('/desk/missed', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/desk/missed/12/dismiss', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/desk/owes', 'POST'), false);
  assert.equal(isStaffSharedKingTool(`/desk/owes/${id}`, 'DELETE'), false);
  assert.equal(isStaffSharedKingTool('/desk/missed/abc/dismiss', 'POST'), false);
});

test('owed lists only the person\'s own dialled calls without an outcome, masked', async () => {
  await withDb(async () => [{ id: 'a1', phone_key: '700900301', phone: '+256700900301', full_name: 'Test One', task_key: 'new_agents', tapped_at: new Date(), status: 'abandoned' }], async (seen) => {
    const list = await pipe.owed('ronald');
    assert.equal(list.length, 1);
    assert.equal(list[0].phone, '•••301');
    assert.match(seen[0].sql, /person_key = \$1/);
    assert.match(seen[0].sql, /outcome IS NULL/);
    assert.deepEqual(seen[0].params, ['ronald']);
  });
  assert.deepEqual(await pipe.owed(''), []);
});

test('lateOutcome needs an outcome, a note, a next step and a 24h+ call back', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const origTasks = calling.loadTasks;
  calling.loadTasks = async () => [{ key: 'new_agents', outcomes: [
    { key: 'no_answer', label: 'No answer' }, { key: 'call_back', label: 'Call back', spoke: true, date: 'required' },
    { key: 'interested', label: 'Interested', spoke: true }, { key: 'signed_up', label: 'Signed up', spoke: true, close: true }] }];
  try {
    const attempt = { id, person_key: 'ronald', outcome: null, tapped_at: new Date(), status: 'abandoned', task_key: 'new_agents' };
    await withDb(async (sql) => (/^SELECT \* FROM call_attempts/.test(sql) ? [attempt] : [{ id, outcome: 'x', status: 'done' }]), async (seen) => {
      await assert.rejects(pipe.lateOutcome('amina', id, { outcome: 'no_answer' }), /not found/);
      await assert.rejects(pipe.lateOutcome('ronald', 'nope', { outcome: 'no_answer' }), /Invalid call id/);
      await assert.rejects(pipe.lateOutcome('ronald', id, {}), /Pick what happened/);
      await assert.rejects(pipe.lateOutcome('ronald', id, { outcome: 'signed_up', note: 'they paid' }), /full wrap-up/);
      await assert.rejects(pipe.lateOutcome('ronald', id, { outcome: 'interested' }), /short note/);
      await assert.rejects(pipe.lateOutcome('ronald', id, { outcome: 'interested', note: 'likes it' }), /next step/);
      await assert.rejects(pipe.lateOutcome('ronald', id, { outcome: 'call_back', note: 'busy now' }), /date and time/);
      await assert.rejects(pipe.lateOutcome('ronald', id, { outcome: 'call_back', note: 'busy now', callback_at: new Date(Date.now() + 3600000).toISOString() }), /24 hours/);
      const ok = await pipe.lateOutcome('ronald', id, { outcome: 'no_answer' });
      assert.equal(ok.id, id);
      const upd = seen.find((s) => /^\s*UPDATE call_attempts/.test(s.sql));
      assert.match(upd.sql, /late_outcome/);
      assert.match(upd.sql, /person_key = \$7/);
      assert.equal(upd.params[4], 'Try again next working day');
      await pipe.lateOutcome('ronald', id, { outcome: 'call_back', note: 'busy now', callback_at: new Date(Date.now() + 2 * 86400000).toISOString() });
    });
    attempt.outcome = 'no_answer';
    await withDb(async () => [attempt], async () => { await assert.rejects(pipe.lateOutcome('ronald', id, { outcome: 'no_answer' }), /already has an outcome/); });
  } finally { calling.loadTasks = origTasks; }
});

test('owes works out months owed from paid-until and shows the last chase', async () => {
  const today = new Date(Date.now() + 3 * 3600000);
  const daysAgo = (d) => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
  await withDb(async (sql) => {
    if (/billing_settings/.test(sql)) return [{ value: { monthly_ugx: 50000 } }];
    if (/FROM agents a/.test(sql)) return [
      { id: 'g1', full_name: 'Paid Closer (test)', phone: '+256700900310', paid_until: daysAgo(45), since: new Date(), k: '700900310' },
      { id: 'g2', full_name: 'Never Paid (test)', phone: '+256700900311', paid_until: null, since: new Date(), k: '700900311' }];
    if (/call_payment_actions/.test(sql)) return [{ phone_key: '700900310', person_key: 'ronald', at: new Date(), note: 'Payment chase' }];
    return [];
  }, async () => {
    const o = await pipe.owes('ronald');
    assert.equal(o.fee_ugx, 50000);
    const [a, b] = o.items;
    assert.equal(a.overdue_days, 45);
    assert.equal(a.owed_ugx, 100000);
    assert.equal(a.phone, '•••310');
    assert.equal(a.last_chase.mine, true);
    assert.equal(b.never_paid, true);
    assert.equal(b.owed_ugx, 50000);
    assert.equal(b.last_chase, null);
  });
});

test('chase logs it and queues the number on my own payments list once; never for do-not-contact', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const origBlock = calling.blockOf;
  try {
    calling.blockOf = async () => null;
    await withDb(async (sql) => (/FROM agents WHERE id/.test(sql) ? [{ id, full_name: 'Paid Closer (test)', phone: '0700900310' }] : []), async (seen) => {
      const r = await pipe.chase('ronald', id, {});
      assert.equal(r.queued, true);
      assert.equal(r.phone, '•••310');
      assert.ok(seen.some((s) => /INSERT INTO call_payment_actions/.test(s.sql) && s.params[1] === 'ronald'));
      const ins = seen.find((s) => /INSERT INTO call_number_submissions/.test(s.sql));
      assert.match(ins.sql, /'payments'/);
    });
    calling.blockOf = async () => ({ reason: 'dnc' });
    await withDb(async (sql) => (/FROM agents WHERE id/.test(sql) ? [{ id, full_name: 'X', phone: '0700900310' }] : []), async (seen) => {
      await assert.rejects(pipe.chase('ronald', id, {}), /do-not-contact/);
      assert.ok(!seen.some((s) => /INSERT/.test(s.sql)));
    });
    await assert.rejects(pipe.chase('', id), /calling name/);
  } finally { calling.blockOf = origBlock; }
});

test('logMissed validates the number and time, and queues a ring-back once', async () => {
  const origBlock = calling.blockOf;
  calling.blockOf = async () => null;
  try {
    await withDb(async (sql) => (/INSERT INTO call_missed/.test(sql) ? [{ id: 7 }] : []), async (seen) => {
      await assert.rejects(pipe.logMissed('ronald', { phone: '12' }), /Ugandan number/);
      await assert.rejects(pipe.logMissed('ronald', { phone: '0700900320', at: new Date(Date.now() - 20 * 86400000).toISOString() }), /last 14 days/);
      const r = await pipe.logMissed('ronald', { phone: '0700900320', name: 'Missed (test)' });
      assert.equal(r.id, 7);
      const q = seen.find((s) => /INSERT INTO call_number_submissions/.test(s.sql));
      assert.match(q.sql, /missed_call/);
      assert.equal(q.params[0], 'ronald');
    });
    await withDb(async () => [], async () => { await assert.rejects(pipe.dismissMissed('ronald', 99), /not found/); });
  } finally { calling.blockOf = origBlock; }
});

test('pipeline groups my calls by number into the four buckets, masked', async () => {
  const at = new Date();
  await withDb(async (sql) => {
    if (/FROM call_attempts/.test(sql)) return [
      { id: 'c1', phone_key: '700900301', phone: '+256700900301', full_name: 'A (test)', outcome: 'interested', at, hi: false },
      { id: 'c2', phone_key: '700900302', phone: '+256700900302', full_name: 'B (test)', outcome: 'interested', at, hi: true },
      { id: 'c3', phone_key: '700900303', phone: '+256700900303', full_name: 'C (test)', outcome: 'promised', at, hi: false },
      { id: 'c4', phone_key: '700900304', phone: '+256700900304', full_name: 'D (test)', outcome: 'paid', at, hi: false },
      { id: 'c5', phone_key: '700900305', phone: '+256700900305', full_name: 'E (test)', outcome: 'no_answer', at, hi: false }];
    return [];
  }, async (seen) => {
    const p = await pipe.pipeline('ronald');
    const count = Object.fromEntries(p.stages.map((s) => [s.key, s.items.map((i) => i.name)]));
    assert.deepEqual(count, { interested: ['A (test)'], said_hi: ['B (test)'], to_close: ['C (test)'], paid: ['D (test)'] });
    assert.equal(p.stages[0].items[0].phone, '•••301');
    assert.ok(seen.every((s) => !/INSERT|UPDATE|DELETE/.test(s.sql)), 'pipeline is read-only');
  });
});

test('sessions are blocked until owed calls get an outcome (not for King)', () => {
  const src = read('services/callingScreen.js');
  assert.match(src, /const owedCalls = isKing \? \[\] :/);
  assert.match(src, /e\.code = 'outcome_owed'/);
  assert.match(read('routes/calling.js'), /error\.code \? \{ code: error\.code \}/);
});

test('client: owed modal, call summary, history, the four pages; no WhatsApp sending or films', () => {
  const cs = read('assets/calling-screen.js');
  assert.match(cs, /e\.code === 'outcome_owed'/);
  assert.match(cs, /function openOwed\(/);
  assert.match(cs, /data-mkc-callsum/);
  assert.match(cs, /openHistory: function/);
  const sd = read('assets/staff-desk.js');
  for (const k of ['pipeline', 'approve', 'owes', 'missed']) assert.match(sd, new RegExp(`\\['${k}', '`), k);
  for (const h of ['data-sd-stage', 'data-sd-hist', 'data-sd-approve', 'data-sd-chase', 'data-sd-missed-form', 'data-sd-owed-go']) assert.ok(sd.includes(h), h);
  const svc = read('services/staffPipeline.js');
  for (const f of [svc, sd]) { assert.doesNotMatch(f, /wa\.me|send the film|Share on WhatsApp/i); }
  assert.doesNotMatch(svc, /whatsapp_messages[^`]*\b(INSERT|UPDATE|DELETE)\b/i);
  const idx = read('index.html');
  assert.match(idx, /staff-desk\.js\?v=20261121-(sd3|ops3)/);
  assert.match(idx, /calling-screen\.js\?v=20261121-(pipe1|ops2)/);
});
