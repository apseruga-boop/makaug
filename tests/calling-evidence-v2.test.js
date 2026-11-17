'use strict';

// King's Evidence trail v2: logins used (shared logins visible), drop-offs with when and why,
// a tracking audit, and day/week/month trends. Pure checks always run; DB checks need CALLING_SANDBOX_DB.
if (process.env.CALLING_SANDBOX_DB) process.env.DATABASE_URL = process.env.CALLING_SANDBOX_DB;
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../services/callingScreen');

const t0 = new Date('2026-11-17T06:00:00Z').getTime();
const m = (min) => new Date(t0 + min * 60000).toISOString();

test('loginsUsed: a shared login shows next to the caller, with sessions and calls', () => {
  const r = c.loginsUsed(
    [{ id: 's1', actor_account: 'Moderator 1' }, { id: 's2', actor_account: 'Ronald Makaug' }],
    [{ status: 'done', actor_account: 'Moderator 1' }, { status: 'done', actor_account: 'Moderator 1' }, { status: 'skipped', actor_account: 'Ronald Makaug' }]
  );
  assert.deepEqual(r[0], { login: 'Moderator 1', sessions: 1, calls: 2 });
  assert.deepEqual(r[1], { login: 'Ronald Makaug', sessions: 1, calls: 0 });
});

test('dropOffs: dropped session, page closed, long time away, long gap and missing outcome, each with why', () => {
  const sessions = [{ id: 's1', started_at: m(0), ended_at: m(120), end_reason: 'dropped', last_heartbeat_at: m(120) }];
  const events = [
    { session_id: 's1', kind: 'hidden', detail: '', at: m(10) }, { session_id: 's1', kind: 'visible', detail: '', at: m(22) },
    { session_id: 's1', kind: 'hidden', detail: 'in meeting', at: m(30) }, { session_id: 's1', kind: 'visible', detail: '', at: m(50) },
    { session_id: 's1', kind: 'break_start', detail: '', at: m(61) }, { session_id: 's1', kind: 'break_end', detail: '', at: m(80) },
    { session_id: 's1', kind: 'screen_close', detail: 'page closed', at: m(119) }
  ];
  const attempts = [
    { id: 'a1', session_id: 's1', status: 'done', shown_at: m(1), tapped_at: m(1), wrapped_at: m(3) },
    { id: 'a2', session_id: 's1', status: 'done', shown_at: m(40), tapped_at: m(40), wrapped_at: m(42) },
    { id: 'a3', session_id: 's1', status: 'done', shown_at: m(85), tapped_at: m(85), wrapped_at: m(86) },
    { id: 'a4', session_id: 's1', status: 'abandoned', shown_at: m(100), tapped_at: m(100) }
  ];
  const d = c.dropOffs(sessions, events, attempts);
  const kinds = d.map((x) => x.kind);
  assert.ok(kinds.includes('away') && d.find((x) => x.kind === 'away').minutes === 12, 'away 12 min (meeting time is not away)');
  assert.equal(d.filter((x) => x.kind === 'away').length, 1);
  assert.ok(d.some((x) => x.kind === 'gap' && x.minutes === 37), 'gap 3→40 min flagged');
  assert.ok(!d.some((x) => x.kind === 'gap' && x.minutes === 43), 'gap with a break in between is not flagged');
  assert.ok(d.some((x) => x.kind === 'no_outcome' && x.attempt_id === 'a4'));
  const pc = d.find((x) => x.kind === 'page_closed');
  assert.equal(pc.title, 'Page closed, session dropped', 'closed page + drop are one line');
  assert.ok(!kinds.includes('dropped'));
  for (const x of d) assert.ok(x.at && x.title && x.why, 'every drop-off has when and why');
});

test('trackingAudit: flags missing outcomes, logins, talk time and dropped sessions', () => {
  const a = c.trackingAudit(
    [{ id: 's1', actor_account: '', device: 'laptop', end_reason: 'dropped' }],
    [{ session_id: 's1', kind: 'start' }],
    [{ status: 'done', tapped_at: m(1), ended_at: m(2), spoke: true, talk_s: null, actor_account: 'Moderator 1' }, { status: 'abandoned', tapped_at: m(5) }]
  );
  const by = Object.fromEntries(a.map((x) => [x.label, x]));
  assert.equal(by['Every call has an outcome'].missing, 1);
  assert.equal(by['Every session records the login and device'].ok, false);
  assert.equal(by['Every session closed properly (not dropped)'].missing, 1);
  assert.equal(by['Talk time saved on connected calls'].missing, 1);
  assert.equal(by['Script steps tracked on connected calls'].ok, false);
});

test('onCallSegments: one segment per tapped call, gaps since the last call (breaks not counted), summary', () => {
  const attempts = [
    { id: 'a2', session_id: 's1', status: 'done', outcome: 'interested', tapped_at: m(20), ended_at: m(23), wrapped_at: m(24), talk_s: 170 },
    { id: 'a1', session_id: 's1', status: 'done', outcome: 'no_answer', tapped_at: m(0), ended_at: m(1), wrapped_at: m(2), talk_s: 0 },
    { id: 'a3', session_id: 's2', status: 'abandoned', tapped_at: m(90), ended_at: null, wrapped_at: null, talk_s: null },
    { id: 'x', session_id: 's1', status: 'skipped', tapped_at: null, shown_at: m(30) }
  ];
  const events = [{ kind: 'break_start', at: m(40) }, { kind: 'break_end', at: m(70) }];
  const r = c.onCallSegments(attempts, events);
  assert.deepEqual(r.calls.map((x) => x.attempt_id), ['a1', 'a2', 'a3'], 'tapped calls only, in time order');
  assert.equal(r.calls[0].gap_s, null, 'first call has no gap');
  assert.equal(r.calls[1].gap_s, 18 * 60, 'gap from wrap-up saved (m2) to next tap (m20)');
  assert.equal(r.calls[2].gap_s, (90 - 24 - 30) * 60, 'the 30 min break is not counted');
  assert.equal(r.calls[1].from, m(20)); assert.equal(r.calls[1].to, m(23));
  assert.equal(r.calls[2].outcome, 'no outcome saved');
  assert.equal(r.calls[2].to, m(90), 'open call without an end is a thin mark at the tap');
  assert.deepEqual(r.summary, { calls: 3, talk_s: 170, avg_gap_s: (18 * 60 + 36 * 60) / 2, longest_gap_s: 36 * 60, longest_gap_before: m(90) });
  assert.deepEqual(c.onCallSegments([], []).summary, { calls: 0, talk_s: 0, avg_gap_s: null, longest_gap_s: null, longest_gap_before: null });
});

const db = { skip: !process.env.CALLING_SANDBOX_DB };

test('heartbeat keeps script steps and unknown screen events instead of dropping them', db, async () => {
  const pg = require('../config/database');
  for (const r of (await pg.query("SELECT id FROM call_sessions WHERE person_key = 'arthurtest' AND ended_at IS NULL")).rows) await c.endSession(r.id).catch(() => null);
  const s = (await c.startSession({ personKey: 'arthurtest', taskKey: 'payments', device: 'laptop', isKing: true })).session;
  try {
    await c.heartbeat(s.id, { events: [{ kind: 'route', detail: 'opening' }, { kind: 'brand_new_kind', detail: 'x' }] });
    const ev = (await pg.query('SELECT kind, detail FROM call_session_events WHERE session_id = $1 ORDER BY at', [s.id])).rows;
    assert.ok(ev.some((e) => e.kind === 'route' && e.detail === 'opening'));
    assert.ok(ev.some((e) => e.kind === 'action' && e.detail === 'brand_new_kind:x'));
  } finally { await c.endSession(s.id).catch(() => null); }
});

test('evidence carries logins, drop-offs, audit and day/week/month trends', db, async () => {
  const e = await c.evidence('ronald');
  assert.ok(Array.isArray(e.logins) && Array.isArray(e.dropoffs) && Array.isArray(e.audit));
  assert.equal(e.trends.day.length, 14); assert.equal(e.trends.week.length, 8); assert.equal(e.trends.month.length, 6);
  for (const r of e.trends.day) { assert.match(r.k, /^\d{4}-\d{2}-\d{2}$/); assert.equal(typeof r.calls, 'number'); assert.equal(typeof r.outcomes, 'object'); }
  const today = e.trends.day[e.trends.day.length - 1];
  assert.equal(today.calls, e.summary.calls, 'today in the chart matches today\'s calls');
  for (const a of e.attempts) assert.ok('login' in a);
  assert.ok(e.on_call && Array.isArray(e.on_call.calls) && typeof e.on_call.summary.calls === 'number');
  assert.equal(e.on_call.summary.calls, e.attempts.filter((a) => a.tapped_at).length);
});

test.after(async () => { if (process.env.CALLING_SANDBOX_DB) await require('../config/database').pool.end().catch(() => null); });
