'use strict';
// "No answer" is not a call (Arthur, 17 Nov 2026). Pure rules, no database.
// Run: node --test tests/calling-no-answer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../services/callingScreen');

const task = { key: 'new_agents', config: {} };
const now = new Date('2026-11-17T12:00:00Z');
const at = (h) => new Date(now.getTime() - h * 3600000).toISOString();
const done = (o) => ({ status: 'done', task_key: 'new_agents', person_key: 'ronald', tapped_at: o.wrapped_at, ...o });

test('no answer is kept but not counted: calls, connected, closes, by task, by hour; shown separately', () => {
  const list = [
    done({ outcome: 'no_answer', wrapped_at: at(3) }),
    done({ outcome: 'no_answer', wrapped_at: at(2.5) }),
    done({ outcome: 'interested', spoke: true, talk_s: 120, wrapped_at: at(2) }),
    done({ outcome: 'signed_up', spoke: true, is_close: true, talk_s: 300, wrapped_at: at(1) }),
    { status: 'skipped', skip_reason: 'Busy', task_key: 'new_agents', shown_at: at(0.5) }
  ];
  const s = c.summarize(list, [{ key: 'new_agents', name: 'New agents' }]);
  assert.equal(s.calls, 2);
  assert.equal(s.not_answered, 2);
  assert.equal(s.connected, 2);
  assert.equal(s.closes, 1);
  assert.equal(s.avg_talk_s, 210, 'average over real calls only');
  assert.equal(s.by_task.new_agents.calls, 2);
  assert.equal(Object.values(s.by_hour).reduce((a, b) => a + b, 0), 2);
  assert.equal(s.outcomes.no_answer, 2, 'still in the outcome breakdown (grey in Evidence)');
  assert.equal(s.skipped, 1);
  assert.equal(s.calls + s.not_answered + s.skipped, list.length, 'every attempt is in exactly one bucket: no double counting');
});

test('a no-answer number comes back 24 hours later, in any task, and the history keeps it', () => {
  const miss = done({ outcome: 'no_answer', wrapped_at: at(2) });
  assert.equal(c.eligibility([miss], task, { now }).why, 'no_answer_24h');
  assert.equal(c.eligibility([miss], { key: 'payments', config: { cooldown_days: 0 } }, { now }).why, 'no_answer_24h', 'not just in the same task');
  assert.equal(c.eligibility([done({ outcome: 'no_answer', wrapped_at: at(23.9) })], task, { now }).why, 'no_answer_24h');
  const back = c.eligibility([done({ outcome: 'no_answer', wrapped_at: at(24.1) })], task, { now });
  assert.equal(back.ok, true);
  assert.equal(back.kind, 'retry', 'back in the same queue');
  // Yesterday afternoon: not "called today" this morning, but held until 24 h have passed.
  assert.equal(c.eligibility([done({ outcome: 'no_answer', wrapped_at: '2026-11-16T14:00:00Z' })], task, { now }).why, 'no_answer_24h');
  // Three no-answers in a row still park the number (7 days), as before.
  const three = [at(25), at(49), at(73)].map((w) => done({ outcome: 'no_answer', wrapped_at: w }));
  assert.equal(c.eligibility(three, task, { now }).why, 'parked_no_answer');
  // An answered call today still blocks the number for the day.
  assert.equal(c.eligibility([done({ outcome: 'rejected', wrapped_at: at(1) })], task, { now }).why, 'called_today');
});

test('the same number no-answered again and again inflates nothing', () => {
  const list = Array.from({ length: 10 }, (_, i) => done({ outcome: 'no_answer', phone_key: '700000123', wrapped_at: at(i * 0.1) }));
  const s = c.summarize(list, []);
  assert.equal(s.calls, 0);
  assert.equal(s.closes, 0);
  assert.equal(s.not_answered, 10);
  assert.equal(c.nextMilestone(s.calls, s.closes, c.DEFAULT_TARGETS), '40 calls to your target of 40');
  // The money for the caller is only payments and closes, never attempts.
  const logins = c.loginsUsed([{ actor_account: 'Ronald' }], list.map((a) => ({ ...a, actor_account: 'Ronald' })));
  assert.equal(logins[0].calls, 0);
});

test('Evidence: no-answers stay on the chart (grey) but the summary counts real calls only', () => {
  const list = [
    done({ id: 1, session_id: 's', outcome: 'no_answer', tapped_at: at(3), ended_at: at(2.99), wrapped_at: at(2.98) }),
    done({ id: 2, session_id: 's', outcome: 'interested', talk_s: 60, tapped_at: at(2), ended_at: at(1.98), wrapped_at: at(1.97) })
  ];
  const o = c.onCallSegments(list, []);
  assert.equal(o.calls.length, 2, 'both attempts shown');
  assert.equal(o.calls[0].outcome, 'no_answer');
  assert.equal(o.summary.calls, 1);
  assert.equal(o.summary.not_answered, 1);
  const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'calling-screen.js'), 'utf8');
  assert.match(js, /m\.c\.outcome === 'no_answer' \? '#cbd5e1'/, 'grey segment');
  assert.match(js, /No answer \(not counted\)/);
  assert.match(js, /Not answered: /);
});

test('every SQL count of calls leaves no-answers out', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'callingScreen.js'), 'utf8');
  assert.match(src, /COUNTED_SQL = \(t = ''\) => `\$\{t\}status = 'done' AND \$\{t\}outcome IS DISTINCT FROM '\$\{NO_ANSWER\}'`/);
  assert.match(src, /COUNT\(\*\) FILTER \(WHERE \$\{COUNTED_SQL\(\)\}\)::int AS calls/, 'leaderboard');
  assert.match(src, /COUNT\(a\.id\) FILTER \(WHERE \$\{COUNTED_SQL\('a\.'\)\}\)::int AS calls/, 'Evidence trends');
  assert.match(src, /WHERE person_key = \$1 AND \$\{COUNTED_SQL\(\)\} AND \(wrapped_at/, 'calls by day (streak, last 7 days)');
  const planner = fs.readFileSync(path.join(__dirname, '..', 'services', 'callingPlanner.js'), 'utf8');
  assert.match(planner, /status = 'done' AND outcome IS DISTINCT FROM 'no_answer'/, 'day plan blocks');
  const day = fs.readFileSync(path.join(__dirname, '..', 'services', 'callingDay.js'), 'utf8');
  assert.match(day, /a\.outcome === 'no_answer'\) \{ c\.not_answered \+= 1;/, 'Staff Performance days');
  const commission = fs.readFileSync(path.join(__dirname, '..', 'services', 'staffCommission.js'), 'utf8');
  assert.match(commission, /kind = 'outcome' AND outcome IS DISTINCT FROM 'no_answer'/, 'a no-answer is not a claim on the number');
});
