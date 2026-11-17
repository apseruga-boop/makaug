'use strict';

// Practice login (arthurtest) with a real test phone: it rings for real (tel: link), stays only in the
// practice queue, refuses numbers we already know, and never reaches real reports or the King review.
// Runs only against a scratch database (CALLING_SANDBOX_DB). The phone below is an Ofcom drama number, not a real line.
if (process.env.CALLING_SANDBOX_DB) process.env.DATABASE_URL = process.env.CALLING_SANDBOX_DB;
const test = require('node:test');
const assert = require('node:assert/strict');

const FAKE_UK = '+44 7700 900123';
const opts = { skip: !process.env.CALLING_SANDBOX_DB };

test('practice login: own real test phone rings, is recorded, and stays out of real numbers', opts, async () => {
  const db = require('../config/database');
  const c = require('../services/callingScreen');
  await db.query("DELETE FROM call_number_submissions WHERE person_key = 'arthurtest' AND status = 'practice'");
  for (const r of (await db.query("SELECT id FROM call_sessions WHERE person_key = 'arthurtest' AND ended_at IS NULL")).rows) await c.endSession(r.id).catch(() => null);

  await assert.rejects(c.submitNumber({ personKey: 'arthurtest', name: 'x', phone: '0700 000 101', mode: 'new_agents', addedBy: 't' }), /TEST practice numbers/);
  const known = (await db.query("SELECT phone FROM call_attempts WHERE person_key <> 'arthurtest' AND phone_key !~ '^7000001' LIMIT 1")).rows[0];
  if (known) await assert.rejects(c.submitNumber({ personKey: 'arthurtest', name: 'x', phone: known.phone, mode: 'new_agents', addedBy: 't' }), (e) => e.status === 409);

  const added = await c.submitNumber({ personKey: 'arthurtest', name: 'My test phone', phone: FAKE_UK, mode: 'new_agents', addedBy: 't' });
  assert.equal(added.practice, true);
  assert.match(added.phone, /123$/); assert.doesNotMatch(added.phone, /7700 ?900/);

  const s = (await c.startSession({ personKey: 'arthurtest', taskKey: 'payments', device: 'laptop', actorAccount: 'Arthur (test)' })).session;
  const d = await c.nextNumber(s.id);
  assert.equal(d.attempt.phone, '+447700900123', 'own real test phone comes first, in any mode');
  assert.equal(d.tel, 'tel:+447700900123');
  await c.tap(d.attempt.id, { sessionId: s.id }); await c.endCall(d.attempt.id, { sessionId: s.id });
  await c.wrapUp(d.attempt.id, { sessionId: s.id, outcome: 'no_answer', note: 'real test call', nextStep: 'Try again' });
  const n2 = await c.nextNumber(s.id);
  assert.notEqual(n2.attempt && n2.attempt.phone, '+447700900123', 'not offered again straight away');
  if (n2.attempt) await c.skip(n2.attempt.id, { sessionId: s.id }).catch(() => null);
  await c.endSession(s.id).catch(() => null);

  const rec = (await db.query("SELECT outcome, note, tapped_at, wrapped_at FROM call_attempts WHERE person_key = 'arthurtest' AND phone_key = '700900123' ORDER BY shown_at DESC LIMIT 1")).rows[0];
  assert.equal(rec.outcome, 'no_answer'); assert.ok(rec.tapped_at && rec.wrapped_at);

  // "Do not contact" on a tester's real phone never lands on the real do-not-contact list.
  await c.submitNumber({ personKey: 'arthurtest', name: 'Friend', phone: '+44 7700 900124', mode: 'new_agents', addedBy: 't' });
  const s2 = (await c.startSession({ personKey: 'arthurtest', taskKey: 'new_agents', device: 'laptop', actorAccount: 'Arthur (test)' })).session;
  const d2 = await c.nextNumber(s2.id);
  assert.equal(d2.attempt.phone, '+447700900124');
  await c.tap(d2.attempt.id, { sessionId: s2.id }); await c.endCall(d2.attempt.id, { sessionId: s2.id });
  await c.wrapUp(d2.attempt.id, { sessionId: s2.id, outcome: 'do_not_contact', note: 'practice stop', nextStep: 'None' });
  await c.endSession(s2.id).catch(() => null);
  assert.equal((await db.query("SELECT 1 FROM call_blocks WHERE phone_key = '700900124'")).rowCount, 0);

  const king = await c.listSubmissions({ status: 'all' });
  assert.ok(!JSON.stringify(king).includes('700900123'), 'King review never shows practice phones');
  const own = await db.query("SELECT 1 FROM call_number_submissions WHERE phone_key = '700900123' AND status = 'own'");
  assert.equal(own.rowCount, 0, 'never becomes a real own number');
  await db.query("DELETE FROM call_number_submissions WHERE person_key = 'arthurtest' AND status = 'practice'");
});

test.after(async () => { if (process.env.CALLING_SANDBOX_DB) await require('../config/database').pool.end().catch(() => null); });
