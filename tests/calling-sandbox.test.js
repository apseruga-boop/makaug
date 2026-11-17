'use strict';

// "Arthur (test)" practice caller: TEST numbers only, nothing sent, nothing counted.
// The database part runs when CALLING_SANDBOX_DB is set to a scratch database
// that has migrations up to 237 (never production).
if (process.env.CALLING_SANDBOX_DB) process.env.DATABASE_URL = process.env.CALLING_SANDBOX_DB;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sbx = require('../services/callingSandbox');

test('practice numbers are all in the TEST range and named TEST', () => {
  const list = sbx.practiceNumbers();
  assert.ok(list.length >= 20);
  for (const n of list) {
    assert.match(n.phone_key, /^7000001\d{2}$/); assert.equal(n.phone, `+256${n.phone_key}`);
    assert.ok(n.full_name.startsWith('TEST – ')); assert.ok(sbx.isTestKey(n.phone_key)); assert.ok(sbx.isTestPhone(n.phone));
  }
  assert.equal(new Set(list.map((n) => n.phone_key)).size, list.length);
  assert.equal(sbx.isTestKey('772123456'), false); assert.equal(sbx.isTestKey('700000200'), false); assert.equal(sbx.isTestPhone('0700000101'), true);
});

test('migration 237: one sandbox caller login, no password, no commission, rollback + backup written down', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/237_calling_sandbox_arthur_test.sql'), 'utf8');
  assert.match(sql, /'sandbox', true/); assert.match(sql, /'staff_scope', 'caller'/); assert.match(sql, /arthur\.test@staff\.makaug\.internal/);
  assert.match(sql, /crypt\(encode\(gen_random_bytes\(32\)/); // nobody knows the password; King makes a setup link
  assert.doesNotMatch(sql, /INSERT INTO commission_staff/i);
  assert.match(sql, /Rollback:/); assert.match(sql, /calling_sandbox_backup_237/); assert.match(sql, /CREATE OR REPLACE VIEW calling_sandbox_people/);
});

const DB = process.env.CALLING_SANDBOX_DB;
test('no real side effects from the practice account', { skip: !DB && 'set CALLING_SANDBOX_DB to a scratch database' }, async () => {
  const db = require('../config/database');
  const c = require('../services/callingScreen');
  const day = require('../services/callingDay');
  const contact = require('../services/callingContact');
  const extras = require('../services/callingExtras');
  const proof = require('../services/paymentSmsProof');
  const meeting = require('../services/callingMeeting');
  const count = async () => Object.fromEntries(Object.entries((await db.query(`SELECT
      (SELECT COUNT(*) FROM payment_claims)::int AS claims, (SELECT COUNT(*) FROM revenue_entries)::int AS revenue,
      (SELECT COUNT(*) FROM call_payment_actions)::int AS pay_actions, (SELECT COUNT(*) FROM call_video_requests)::int AS videos,
      (SELECT COUNT(*) FROM payment_sms_proofs)::int AS proofs, (SELECT COUNT(*) FROM call_number_submissions WHERE status <> 'practice')::int AS numbers,
      (SELECT COUNT(*) FROM outreach_list_numbers)::int AS list_numbers, (SELECT COUNT(*) FROM whatsapp_messages WHERE direction <> 'inbound')::int AS wa_out,
      (SELECT COUNT(*) FROM pipeline_items)::int AS pipeline, (SELECT COUNT(*) FROM cash_checks)::int AS cash`)).rows[0]).map(([k, v]) => [k, Number(v)]));
  sbx.clearCache();
  const u = (await db.query("SELECT id FROM users WHERE email = 'arthur.test@staff.makaug.internal'")).rows[0];
  assert.ok(u, 'migration 237 applied');
  const boot = await c.bootstrap({ userId: u.id, scope: 'caller' });
  assert.equal(boot.locked_person, 'arthurtest'); assert.equal(boot.sandbox, true);
  for (const s of (await db.query("SELECT id FROM call_sessions WHERE person_key = 'arthurtest' AND ended_at IS NULL")).rows) await c.endSession(s.id).catch(() => null);
  await db.query("DELETE FROM call_number_submissions WHERE person_key = 'arthurtest' AND status = 'practice'");
  const before = await count();
  const roadBefore = await c.roadTo1000();
  const s = (await c.startSession({ personKey: 'arthurtest', taskKey: 'new_agents', device: 'laptop', actorAccount: 'Arthur (test)', isKing: true })).session;
  const seen = [];
  let a = null;
  for (let i = 0; i < 4; i += 1) {
    const n = await c.nextNumber(s.id); a = n.attempt;
    assert.ok(sbx.isTestKey(a.phone_key || String(a.phone || '').replace(/\D/g, '').slice(-9)), 'practice queue gives only TEST numbers');
    seen.push(a);
    if (i < 3) await c.skip(a.id, { sessionId: s.id, reason: 'busy', reasonCode: 'busy' });
  }
  const id = a.id;
  await assert.rejects(day.sendPayment(id, { how: 'link', personKey: 'arthurtest' }), /Practice account/);
  await assert.rejects(day.sendPayment(id, { how: 'momo', personKey: 'arthurtest' }), /Practice account/);
  await assert.rejects(day.markClaimed(id, { personKey: 'arthurtest' }), /Practice account/);
  await assert.rejects(contact.requestVideo(id, { personKey: 'arthurtest' }), /Practice account/);
  await assert.rejects(proof.submitProof({ attemptId: id, personKey: 'arthurtest', imageDataUrl: 'data:image/png;base64,AAAA', ocrText: 'You have received UGX 50,000 Transaction ID: 99887766554', fields: {} }), /Practice account/);
  // A tester's own phone goes only into the practice queue (status 'practice'), never a real list.
  const own = await c.submitNumber({ personKey: 'arthurtest', name: 'Real Person', phone: '0772 123 456' });
  assert.equal(own.practice, true); assert.equal(own.phone.replace(/\D/g, '').slice(-3), '456');
  await db.query("DELETE FROM call_number_submissions WHERE person_key = 'arthurtest' AND status = 'practice'");
  await assert.rejects(extras.claimContact(s.id, { kind: 'lead', ref: 'x' }), /Practice account/);
  await assert.rejects(day.saveCash({ personKey: 'arthurtest', initials: 'AT', entries: [] }), /Practice account/);
  await assert.rejects(meeting.saveNotes('arthurtest', { actions: [{ text: 'Call him', phone: '0772 123 456' }] }), /Practice account/);
  await assert.rejects(c.startInbound(s.id, { phone: '0772 123 457' }), /TEST practice number/);
  await c.tap(id, { sessionId: s.id }); await c.endCall(id, { sessionId: s.id });
  await c.wrapUp(id, { sessionId: s.id, outcome: 'call_back', note: 'practice', callbackAt: new Date(Date.now() + 25 * 3600e3).toISOString(), nextStep: 'Call back' });
  assert.deepEqual(await count(), before, 'no claim, payment, revenue, video, proof, number, WhatsApp, pipeline or cash row was made');
  // Left out of every team total, and real callers never get TEST numbers.
  const act = await day.activity({ period: 'day' });
  assert.ok(!act.people.some((p) => p.person_key === 'arthurtest'));
  assert.ok(!(await c.performance()).people.some((p) => p.person_key === 'arthurtest'));
  const sum = await c.callsSummary(day.periodRange('day'));
  assert.ok(!sum.by_person.arthurtest);
  assert.ok(!(await extras.pipeline()).items.some((x) => sbx.isTestKey(x.phone_key)));
  assert.ok(!(await c.callbacksDue('')).some((x) => x.person_key === 'arthurtest'));
  const tasks = await c.loadTasks({ all: true });
  for (const t of tasks) assert.ok(!(await c.eligibleQueue(t, 'ronald')).some((x) => sbx.isTestKey(x.phone_key)), `ronald's ${t.key} queue has no TEST numbers`);
  assert.deepEqual(await c.roadTo1000(), roadBefore);
  // Its own report still shows its practice.
  assert.ok((await day.activity({ period: 'day', personKey: 'arthurtest' })).people[0].days[0].calls >= 1);
  await c.endSession(s.id).catch(() => null);
  await db.pool.end();
});
