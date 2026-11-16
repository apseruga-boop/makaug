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
  assert.equal(c.eligibility([done({ outcome: 'wrong_number' })], task, { now }).why, 'do_not_contact');
  // "Do not contact" is enforced by call_blocks (so King can lift it), not by call history.
  assert.notEqual(c.eligibility([done({ outcome: 'do_not_contact' })], task, { now }).why, 'do_not_contact');
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

test('v2: skip reasons, money-first order, source labels', () => {
  assert.equal(c.skipCodeOf('Wrong number'), 'wrong_number');
  assert.equal(c.skipCodeOf('Busy: call at 4'), 'busy');
  assert.equal(c.skipCodeOf('Other: something'), 'other');
  assert.equal(c.eligibility([{ status: 'skipped', skip_reason: 'Wrong number', task_key: 'new_agents', shown_at: '2026-11-01T09:00:00Z' }], task, { now }).why, 'do_not_contact');
  assert.equal(c.eligibility([{ status: 'skipped', skip_reason: 'Busy', task_key: 'new_agents', shown_at: '2026-11-16T08:00:00Z' }], task, { now }).why, 'skipped_today');
  assert.equal(c.eligibility([{ status: 'skipped', skip_reason: 'Busy', task_key: 'new_agents', shown_at: '2026-11-10T08:00:00Z' }], task, { now }).ok, true);
  assert.equal(c.eligibility([{ status: 'skipped', skip_reason: 'Already an agent', task_key: 'new_agents', shown_at: '2026-11-10T08:00:00Z' }], { ...task, queue_kind: 'new_agents' }, { now }).ok, false);
  assert.ok(c.moneyScore({ source_kind: 'agent', reason: 'Signed up 2026-11-01, not paid yet · 3 live' }) > c.moneyScore({ source_kind: 'agent', reason: 'Renewal overdue since 2026-11-10' }));
  assert.ok(c.moneyScore({ source_kind: 'lead' }) > c.moneyScore({ source_kind: 'list' }));
  assert.equal(c.sourceKindLabel({ source_kind: 'list', source_label: 'Your list 2026-11-16 · found online' }), 'Found online');
});

test('v2: "Hello on WhatsApp" is a must in every script and every close checklist', () => {
  for (const [k, v] of Object.entries(scripts.VARIANTS)) for (const lang of ['en', 'lg']) assert.ok(v[lang].some((st) => st[2] === 'hello'), `${k} ${lang}`);
  for (const k of ['new_agents', 'payments', 'retention']) assert.ok(scripts.CLOSE_CHECKS[k].some((t) => /Hello/.test(t)), k);
});

test('v2: caller logins are limited to the calling screen on every staff route', () => {
  const { isCallerOnly } = require('../middleware/auth');
  assert.equal(isCallerOnly({ role: 'moderator', profile_data: { staff_scope: 'caller' } }), true);
  assert.equal(isCallerOnly({ role: 'moderator', profile_data: {} }), false);
  assert.equal(isCallerOnly({ role: 'admin', profile_data: { staff_scope: 'caller' } }), false);
});

test('v2: no answer 3 times parks the number for 7 days; best time from answered calls', () => {
  const miss = (d) => ({ status: 'done', task_key: 'new_agents', outcome: 'no_answer', wrapped_at: d });
  const three = [miss('2026-11-14T09:00:00Z'), miss('2026-11-13T09:00:00Z'), miss('2026-11-12T09:00:00Z')];
  assert.equal(c.eligibility(three, task, { now }).why, 'parked_no_answer');
  assert.equal(c.eligibility(three.slice(0, 2), task, { now }).kind, 'retry');
  assert.equal(c.eligibility(three, task, { now: new Date('2026-11-22T09:00:00Z') }).kind, 'retry');
  const bt = c.bestTimeFrom([{ tapped_at: '2026-11-10T07:20:00Z', spoke: true }, { tapped_at: '2026-11-11T07:40:00Z', spoke: true }, { tapped_at: '2026-11-12T13:00:00Z', spoke: false }]);
  assert.equal(bt.hour, 10); assert.equal(bt.answered, 2); assert.equal(bt.tries, 3);
  assert.equal(c.bestTimeFrom([]), null);
});

test('v3: transcript is text only, phone numbers masked, and every call closes the loop', () => {
  const t = c.cleanTranscript({ text: 'my number is 0772 123 456 call me tomorrow', summary: 'Call back', suggested_next_step: 'Call back tomorrow 10:00', confirmed: true });
  assert.ok(!/0772 123 456/.test(t.text) && /•••456/.test(t.text));
  assert.equal(t.audio_kept, false); assert.equal(t.engine, 'chrome-web-speech');
  assert.equal(c.cleanTranscript({}), null);
  assert.equal(c.closesLoop({ close: true }), true);
  assert.equal(c.closesLoop({ terminal: true }), true);
  assert.equal(c.closesLoop({ key: 'interested' }), false);
});

test('v4: SMS text names us, our WhatsApp and the Hi ask; shared tools cover the new caller routes only', () => {
  const k = require('../services/callingContact');
  for (const lang of ['en', 'lg']) {
    const t = k.smsText(lang, 'ronald');
    assert.match(t, /makaug\.com/); assert.match(t, /0780 863 394/); assert.match(t, /"Hi"/); assert.match(t, /Ronald/);
  }
  const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
  const shared = (p, m) => isStaffSharedKingTool(p, m) || isStaffSharedKingTool({ path: p, method: m });
  assert.ok(shared('/calling/sessions/abc/inbound', 'POST'));
  assert.ok(shared('/calling/attempts/abc/video-request', 'POST'));
  assert.ok(shared('/calling/search', 'GET'));
  assert.ok(shared('/calling/live', 'GET'));
  assert.ok(!shared('/calling/videos/abc/decide', 'POST'));
  assert.ok(!shared('/calling/blocks/700000000/remove', 'POST'));
  assert.ok(!shared('/calling/calls-summary', 'GET'));
});
