'use strict';
// Calling screen: pure rules (no database). Run: node --test tests/calling-screen.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../services/callingScreen');
const x = require('../services/callingExtras');
const scripts = require('../services/callingScripts');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

const task = { key: 'new_agents', config: {} };
const now = new Date('2026-11-16T09:00:00Z');
const done = (o) => ({ status: 'done', task_key: 'new_agents', wrapped_at: '2026-11-10T09:00:00Z', ...o });

test('never twice: open elsewhere, do not contact, called today, already spoken', () => {
  assert.equal(c.eligibility([], task, { now }).ok, true);
  assert.equal(c.eligibility([{ status: 'shown' }], task, { now }).why, 'open_elsewhere');
  assert.equal(c.eligibility([done({ outcome: 'do_not_contact' })], task, { now }).why, 'do_not_contact');
  assert.equal(c.eligibility([done({ outcome: 'rejected', wrapped_at: '2026-11-16T08:00:00Z' })], task, { now }).why, 'called_today');
  assert.equal(c.eligibility([done({ outcome: 'no_answer' })], task, { now }).kind, 'retry');
  assert.equal(c.eligibility([done({ outcome: 'call_back', callback_at: '2026-11-20T09:00:00Z' })], task, { now }).why, 'callback_later');
  assert.equal(c.eligibility([done({ outcome: 'call_back', callback_at: '2026-11-15T09:00:00Z' })], task, { now }).kind, 'callback');
});

test('flags: no tap, rapid tap, no follow-up', () => {
  assert.deepEqual(c.flagsFor({}, {}), ['no_tap']);
  const f = c.flagsFor({ tapped_at: '2026-11-16T09:00:05Z', ended_at: '2026-11-16T09:03:00Z' }, { key: 'interested', spoke: true }, '2026-11-16T09:00:01Z');
  assert.ok(f.includes('rapid_tap') && f.includes('no_follow_up'));
});

test('targets, milestones and streaks', () => {
  assert.match(c.nextMilestone(10, 0), /30 calls to your target of 40/);
  assert.match(c.nextMilestone(40, 1), /1 close to hit/);
  assert.equal(c.streakDays({ '2026-11-15': 40, '2026-11-14': 41, '2026-11-13': 3 }, '2026-11-16'), 2);
  assert.equal(c.variantFor({ script_variants: ['cold_call', 'existing_contact'] }, {}, [done({})]), 'existing_contact');
});

test('suggested replies and close checks', () => {
  assert.ok(scripts.suggestReplies('can I pay by momo?').some((t) => t.includes('27248497')));
  assert.ok(scripts.suggestReplies('xyz').length >= 1);
  for (const k of ['new_agents', 'payments', 'retention']) assert.ok(scripts.CLOSE_CHECKS[k].length >= 4, k);
});

test('setup password rules', () => {
  assert.ok(x.passwordProblem('short1'));
  assert.ok(x.passwordProblem('longpassword'));
  assert.ok(!x.passwordProblem('LongerPass2026'));
});

test('staff-shared calling paths; King-only stays King-only', () => {
  for (const [m, p] of [['GET', '/calling/bootstrap'], ['GET', '/calling/whatsapp'], ['GET', '/calling/whatsapp/abc'], ['GET', '/calling/leads'], ['GET', '/calling/summary'], ['GET', '/calling/timeline'], ['POST', '/calling/sessions/5/claim']]) assert.equal(isStaffSharedKingTool(p, m), true, p);
  for (const [m, p] of [['GET', '/calling/pipeline'], ['POST', '/calling/pipeline/123'], ['GET', '/calling/logins'], ['POST', '/calling/logins/1/link'], ['GET', '/calling/summaries'], ['PUT', '/calling/targets']]) assert.equal(isStaffSharedKingTool(p, m), false, p);
});
