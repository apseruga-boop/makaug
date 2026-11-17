'use strict';

// Calling screen v5: the branching scripts, the day split and the 24-hour call back rule.
// The database parts run when CALLING_SANDBOX_DB points at a scratch database (never production).
if (process.env.CALLING_SANDBOX_DB) process.env.DATABASE_URL = process.env.CALLING_SANDBOX_DB;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROUTES, PICKUP } = require('../services/callingRoutes');
const planner = require('../services/callingPlanner');

const WHEN = new Set(['24h', '2d', '3d', 'mon']);

for (const task of ['new_agents', 'payments', 'retention']) {
  test(`${task}: every reply leads somewhere, every branch is reachable and ends in an outcome`, () => {
    const R = ROUTES[task];
    assert.ok(R && R.nodes[R.start], 'has a start');
    const seen = new Set(); const stack = [R.start];
    while (stack.length) {
      const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
      const n = R.nodes[id]; assert.ok(n, `${task}: missing node ${id}`);
      if (n.end) {
        assert.ok(n.end.outcome, `${task}.${id}: ends with an outcome`);
        if (n.end.when) assert.ok(WHEN.has(n.end.when), `${task}.${id}: call back is 24h or later`);
        continue;
      }
      assert.ok(n.say && n.say.length > 5, `${task}.${id}: says something`);
      assert.ok(Array.isArray(n.replies) && n.replies.length, `${task}.${id}: has replies`);
      for (const [label, to] of n.replies) { assert.ok(label); assert.ok(R.nodes[to], `${task}.${id} → ${to}`); stack.push(to); }
    }
    assert.deepEqual([...seen].sort(), Object.keys(R.nodes).sort(), `${task}: no unreachable nodes`);
  });
}

test('pick-up buttons cover answered and no answer', () => {
  assert.ok(PICKUP.some((p) => p[1] === 'answered'));
  assert.ok(PICKUP.some((p) => p[1] === 'no_answer'));
});

test('route ends use outcomes the task really has (scratch DB)', { skip: !process.env.CALLING_SANDBOX_DB }, async () => {
  const db = require('../config/database');
  const rows = (await db.query("SELECT key, outcomes FROM call_tasks WHERE key IN ('new_agents','payments','retention')")).rows;
  for (const t of rows) {
    const outs = new Map((t.outcomes || []).map((o) => [o.key, o]));
    for (const [id, n] of Object.entries(ROUTES[t.key].nodes)) {
      if (!n.end) continue;
      const o = outs.get(n.end.outcome); assert.ok(o, `${t.key}.${id}: ${n.end.outcome}`);
      if (o.date) assert.ok(n.end.when, `${t.key}.${id}: ${n.end.outcome} needs a date, so the route gives one`);
      if (!o.terminal && !o.close) assert.ok(n.end.next || n.end.when, `${t.key}.${id}: has a next step`);
    }
  }
});

test('day split: defaults are sane and bad splits are refused', () => {
  const d = planner.cleanSplit(planner.DEFAULT_SPLIT);
  assert.equal(d.blocks.length, 6);
  assert.ok(d.blocks.some((b) => b.kind === 'housekeeping') && d.blocks.some((b) => b.kind === 'new') && d.blocks.some((b) => b.kind === 'existing'));
  assert.throws(() => planner.cleanSplit({ blocks: [] }), /at least one block/);
  assert.throws(() => planner.cleanSplit({ blocks: [{ start: '10:00', end: '09:00', kind: 'new' }] }), /after the start/);
  assert.throws(() => planner.cleanSplit({ blocks: [{ start: '08:00', end: '10:00', kind: 'new' }, { start: '09:30', end: '11:00', kind: 'existing' }] }), /overlap/);
  const s = planner.cleanSplit({ blocks: [{ start: '12:00', end: '13:00', kind: 'new' }, { start: '08:00', end: '09:00', kind: 'existing' }, { start: '1', end: 'x', kind: 'new' }] });
  assert.deepEqual(s.blocks.map((b) => b.start), ['08:00', '12:00'], 'sorted, junk dropped');
});

test('call backs are at least 24 hours away (server and screen)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'callingScreen.js'), 'utf8');
  assert.match(src, /CALLBACK_MIN_HOURS = 24/);
  const client = fs.readFileSync(path.join(__dirname, '..', 'assets', 'calling-screen.js'), 'utf8');
  assert.doesNotMatch(client, /In 1 hour|Today 18:00/);
});

test('wrapUp refuses a call back under 24 hours (scratch DB)', { skip: !process.env.CALLING_SANDBOX_DB }, async () => {
  const db = require('../config/database');
  const c = require('../services/callingScreen');
  for (const r of (await db.query("SELECT id FROM call_sessions WHERE person_key = 'arthurtest' AND ended_at IS NULL")).rows) await c.endSession(r.id).catch(() => null);
  const s = (await c.startSession({ personKey: 'arthurtest', taskKey: 'payments', device: 'laptop', actorAccount: 'Arthur (test)', isKing: true })).session;
  const a = (await c.nextNumber(s.id)).attempt;
  assert.ok(a, 'a practice number is free');
  await c.tap(a.id, { sessionId: s.id }); await c.endCall(a.id, { sessionId: s.id });
  const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  await assert.rejects(c.wrapUp(a.id, { sessionId: s.id, outcome: 'call_back', note: 'practice', callbackAt: at(3), nextStep: 'Call back' }), (e) => e.status === 400 && /24 hours/.test(e.message));
  await assert.rejects(c.wrapUp(a.id, { sessionId: s.id, outcome: 'call_back', note: 'practice', callbackAt: at(23), nextStep: 'Call back' }), /24 hours/);
  await c.wrapUp(a.id, { sessionId: s.id, outcome: 'call_back', note: 'practice', callbackAt: at(24.5), nextStep: 'Call back' });
  await c.endSession(s.id);
});

test.after(async () => { if (process.env.CALLING_SANDBOX_DB) await require('../config/database').pool.end().catch(() => null); });
