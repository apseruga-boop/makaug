'use strict';

// Calling screen v6: Ugandan-only call queues (international numbers are WhatsApp only), switching
// tasks never runs dry (server falls back to the next task with numbers), "Add & call next", and time per task.
// Pure checks always run; database checks run only against a scratch database (CALLING_SANDBOX_DB).
// Phone numbers here are fake: Ofcom drama numbers (+44 7700 900xxx) and numbers generated at run time.
if (process.env.CALLING_SANDBOX_DB) process.env.DATABASE_URL = process.env.CALLING_SANDBOX_DB;
const test = require('node:test');
const assert = require('node:assert/strict');
const { isUgandanPhone } = require('../utils/ugPhone');

const db = { skip: !process.env.CALLING_SANDBOX_DB };

test('isUgandanPhone: +256 and local 07xx/03xx are Ugandan, everything else is international', () => {
  for (const p of ['+256 700 000 101', '256700000101', '0700 000 101', '0312 000 101', '700000101']) assert.equal(isUgandanPhone(p), true, p);
  for (const p of ['+44 7700 900123', '447700900123', '+254 700 000 101', '+1 555 010 0101', '', '12345']) assert.equal(isUgandanPhone(p), false, p);
});

test('taskTime: splits session time by task, housekeeping and breaks', () => {
  const { taskTime } = require('../services/callingScreen');
  const t0 = new Date('2026-11-17T06:00:00Z').getTime();
  const m = (min) => new Date(t0 + min * 60000);
  const sessions = [{ id: 's1', task_key: 'new_agents', started_at: m(0), ended_at: m(100), last_heartbeat_at: m(100) }];
  const events = [
    { session_id: 's1', kind: 'start', detail: 'new_agents', at: m(0) },
    { session_id: 's1', kind: 'task_switch', detail: 'payments laptop', at: m(30) },
    { session_id: 's1', kind: 'break_start', detail: '', at: m(40) },
    { session_id: 's1', kind: 'break_end', detail: '', at: m(50) },
    { session_id: 's1', kind: 'housekeeping_on', detail: '', at: m(60) },
    { session_id: 's1', kind: 'housekeeping_off', detail: '', at: m(70) },
    { session_id: 's1', kind: 'task_switch', detail: 'retention', at: m(80) }
  ];
  const r = taskTime(sessions, events, m(200));
  const min = (k) => Math.round((r[k] || 0) / 60000);
  assert.equal(min('new_agents'), 30);
  assert.equal(min('payments'), 30, 'break time is not counted; back to payments after housekeeping');
  assert.equal(min('housekeeping'), 10);
  assert.equal(min('retention'), 20);
});

test('international numbers stay out of every calling queue and are listed for King', db, async () => {
  const pg = require('../config/database');
  const c = require('../services/callingScreen');
  const today = c.kampalaDay(new Date());
  const phone = '+44 7700 900' + String(100 + Math.floor(Math.random() * 800));
  const key = phone.replace(/\D/g, '').slice(-9);
  await pg.query("DELETE FROM outreach_list_numbers WHERE person_key = 'ronald' AND full_name = 'V6 intl test'");
  await pg.query(`INSERT INTO outreach_list_numbers (person_key, list_day, full_name, phone, phone_key, accepted) VALUES ('ronald', $1, 'V6 intl test', $2, $3, true)`, [today, phone, key]);
  try {
    for (const t of ['new_agents', 'payments', 'retention']) {
      const task = (await c.loadTasks()).find((x) => x.key === t); const q = task ? await c.eligibleQueue(task, 'ronald') : null;
      if (q) assert.ok(!q.some((x) => String(x.phone_key || '').endsWith(key)), `not in ${t}`);
    }
    const s = (await c.startSession({ personKey: 'ronald', taskKey: 'new_agents', device: 'laptop', isKing: true })).session;
    try {
      for (let i = 0; i < 12; i++) {
        const d = await c.nextNumber(s.id, { fallback: false });
        if (!d.attempt) break;
        assert.ok(!String(d.attempt.phone).includes('7700'), 'never offered to call');
        await c.skip(d.attempt.id, { sessionId: s.id, reason: 'v6 test' }).catch(() => null);
      }
    } finally {
      await c.endSession(s.id).catch(() => null);
      await pg.query('DELETE FROM call_attempts WHERE session_id = $1', [s.id]);
      await pg.query('DELETE FROM call_session_events WHERE session_id = $1', [s.id]).catch(() => null);
      await pg.query('DELETE FROM call_sessions WHERE id = $1', [s.id]);
    }
    const list = await c.internationalNumbers({});
    const mine = list.find((x) => x.name && x.person_key === 'ronald' && x.phone.endsWith(key.slice(-3)));
    assert.ok(mine, 'listed for King');
    assert.equal(mine.label, 'International – WhatsApp only');
    assert.doesNotMatch(mine.phone, /7700/, 'masked to the last 3 digits');
    const counts = await c.queueCounts('ronald');
    assert.ok(counts.international >= 1);
    assert.equal(typeof counts.housekeeping, 'number');
  } finally {
    await pg.query("DELETE FROM outreach_list_numbers WHERE person_key = 'ronald' AND full_name = 'V6 intl test'");
  }
  await assert.rejects(c.submitNumber({ personKey: 'ronald', name: 'x', phone: '+44 7700 900999', mode: 'new_agents', addedBy: 't' }), /WhatsApp only/);
});

test('an empty task falls back to the next task with numbers, and Add & call next goes first', db, async () => {
  const pg = require('../config/database');
  const c = require('../services/callingScreen');
  const counts = await c.queueCounts('ronald');
  const s = (await c.startSession({ personKey: 'ronald', taskKey: 'new_agents', device: 'laptop', isKing: true })).session;
  try {
    let seen = 0; let fell = null;
    for (let i = 0; i < (counts.new_agents || 0) + 3; i++) {
      const d = await c.nextNumber(s.id);
      if (!d.attempt) { assert.ok(d.all_empty || d.empty !== undefined); break; }
      if (d.fell_back_from) { fell = d; break; }
      seen++;
      await c.tap(d.attempt.id, { sessionId: s.id }); await c.endCall(d.attempt.id, { sessionId: s.id });
      await c.wrapUp(d.attempt.id, { sessionId: s.id, outcome: 'no_answer', note: 'v6 test' });
    }
    if (counts.payments || counts.retention) {
      assert.ok(fell, `fell back after ${seen} new agents numbers`);
      assert.equal(fell.fell_back_from.key, 'new_agents');
      assert.notEqual(fell.task_key, 'new_agents');
      const ev = (await pg.query("SELECT detail FROM call_session_events WHERE session_id = $1 AND kind = 'auto_fallback'", [s.id]).catch(() => ({ rows: [] }))).rows;
      assert.ok(ev.length >= 1, 'fallback is logged');
    }
  } finally {
    await c.endSession(s.id).catch(() => null);
    await pg.query('DELETE FROM call_attempts WHERE session_id = $1', [s.id]);
    await pg.query('DELETE FROM call_session_events WHERE session_id = $1', [s.id]).catch(() => null);
    await pg.query('DELETE FROM call_sessions WHERE id = $1', [s.id]);
  }
});

test('Add & call next: the added number is the very next call (practice login)', db, async () => {
  const pg = require('../config/database');
  const c = require('../services/callingScreen');
  await pg.query("DELETE FROM call_number_submissions WHERE person_key = 'arthurtest' AND status = 'practice'");
  for (const r of (await pg.query("SELECT id FROM call_sessions WHERE person_key = 'arthurtest' AND ended_at IS NULL")).rows) await c.endSession(r.id).catch(() => null);
  const s = (await c.startSession({ personKey: 'arthurtest', taskKey: 'payments', device: 'laptop', isKing: true })).session;
  try {
    const added = await c.submitNumber({ personKey: 'arthurtest', name: 'Call me next', phone: '+44 7700 900456', mode: 'payments', addedBy: 't' });
    const d = await c.nextNumber(s.id, { preferSubmission: added.id });
    assert.match(d.attempt.phone, /456$/);
  } finally {
    await c.endSession(s.id).catch(() => null);
    await pg.query("DELETE FROM call_number_submissions WHERE person_key = 'arthurtest' AND status = 'practice'");
  }
});

test('King performance and evidence carry time per task and a call summary', db, async () => {
  const c = require('../services/callingScreen');
  const perf = await c.performance({});
  const people = perf.people || perf;
  assert.ok(Array.isArray(people));
  for (const p of people) assert.equal(typeof (p.task_ms || {}), 'object');
  const ev = await c.evidence('ronald');
  assert.ok(ev.summary && typeof ev.summary.calls === 'number');
  assert.equal(typeof ev.task_ms, 'object');
});

test.after(async () => { if (process.env.CALLING_SANDBOX_DB) await require('../config/database').pool.end().catch(() => null); });
