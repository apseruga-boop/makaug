'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const perf = require('../services/staffPerformance');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('target maths: 85 films, 9 sign-ups, 50% assumed paid → films a day to 1000', () => {
  const rates = perf.conversionRates({ sent: 85, signedUp: 9, paid: 0 }, { assumedPaidRate: 0.5 });
  assert.equal(rates.signup_to_paid_source, 'assumed');
  assert.ok(Math.abs(rates.send_to_signup - 9 / 85) < 1e-9);
  const road = perf.roadTo1000({
    goal: 1000, payingNow: 0, today: '2026-11-16', startsOn: '2026-11-16', endsOn: '2026-12-31', sendToPaid: rates.send_to_paid
  });
  assert.equal(road.days_left, 46);
  assert.equal(road.films_needed, Math.ceil(1000 / ((9 / 85) * 0.5)));
  assert.equal(road.required_films_per_day, Math.ceil(road.films_needed / 46));
  assert.equal(road.required_films_per_day, 411);
  assert.equal(road.required_paying_per_day, 21.7);
});

test('target maths: the measured paid rate takes over after 10 sign-ups with a payment', () => {
  assert.equal(perf.conversionRates({ sent: 200, signedUp: 9, paid: 3 }).signup_to_paid_source, 'assumed');
  const r = perf.conversionRates({ sent: 200, signedUp: 20, paid: 5 }, { assumedPaidRate: 0.5 });
  assert.equal(r.signup_to_paid_source, 'measured');
  assert.equal(r.signup_to_paid, 0.25);
});

test('target maths: before the start nothing has gone yet, and splits add up', () => {
  const road = perf.roadTo1000({ goal: 1000, payingNow: 4, today: '2026-11-15', startsOn: '2026-11-16', endsOn: '2026-12-31', sendToPaid: 0.05 });
  assert.equal(road.days_gone, 0);
  assert.equal(road.actual_films_per_day, 0);
  const split = perf.splitTargets(411, { ronald: 0.6, sharon: 0.25, arthur: 0.15 });
  assert.equal(split.ronald + split.sharon + split.arthur, 411);
  assert.ok(split.ronald > split.sharon && split.sharon > split.arthur);
});

test('targets come from the latest change on or before the day', () => {
  const rows = [
    { person_key: 'ronald', daily_target: 250, effective_from: '2026-11-16' },
    { person_key: 'ronald', daily_target: 300, effective_from: '2026-11-20' },
    { person_key: 'sharon', daily_target: 100, effective_from: '2026-11-16' }
  ];
  assert.equal(perf.targetForDay(rows, 'ronald', '2026-11-15'), 0);
  assert.equal(perf.targetForDay(rows, 'ronald', '2026-11-19'), 250);
  assert.equal(perf.targetForDay(rows, 'ronald', '2026-11-21'), 300);
  assert.equal(perf.targetForDay(rows, 'sharon', '2026-11-21'), 100);
});

test('carry-over: a missed day is owed the next day, extra pays it off but is not banked', () => {
  const sent = { '2026-11-16': 30, '2026-11-17': 60, '2026-11-18': 80, '2026-11-19': 50 };
  const ledger = perf.carryOver(perf.listDays('2026-11-16', '2026-11-19'), () => 50, (d) => sent[d] || 0);
  assert.deepEqual(ledger.map((r) => [r.due, r.owed_after]), [[50, 20], [70, 10], [60, 0], [50, 0]]);
  assert.equal(ledger[1].owed_before, 20);
  assert.equal(perf.streak(ledger), 3);
  // Today not hit yet does not break yesterday's streak.
  const today = perf.carryOver(['a', 'b', 'c'], () => 10, (d) => ({ a: 10, b: 12, c: 3 }[d]));
  assert.equal(perf.streak(today), 2);
});

test('phone matching: last nine digits, only sign-ups after the film, payments credited to the film', () => {
  const sends = [
    { id: 's1', phone_key: '772123456', pitched_at: '2026-11-16T08:00:00Z' },
    { id: 's2', phone_key: '701000111', pitched_at: '2026-11-16T08:00:00Z' },
    { id: 's3', phone_key: '755999888', pitched_at: '2026-11-16T08:00:00Z' }
  ];
  const agents = [
    { id: 'a1', phone: '+256 772 123 456', created_at: '2026-11-17T09:00:00Z' },
    { id: 'a2', whatsapp: '0701000111', created_at: '2026-10-01T09:00:00Z' }
  ];
  const payments = [
    { agent_id: 'a1', paid_at: '2026-11-18T10:00:00Z' },
    { agent_id: 'a2', paid_at: '2026-11-18T10:00:00Z' }
  ];
  const [m1, m2, m3] = perf.matchSends(sends, agents, payments);
  assert.equal(m1.agent_id, 'a1');
  assert.equal(m1.paid_at, '2026-11-18T10:00:00Z');
  assert.equal(m2.agent_id, null);
  assert.equal(m2.already_agent_before_film, true);
  assert.equal(m2.paid_at, null);
  assert.equal(m3.agent_id, null);
});

test('funnel counts and rates per film, paid as a share of sign-ups', () => {
  const f = perf.funnel([
    { replied: true, spoke: true, signed_up: true, paid: true },
    { replied: true, spoke: true, signed_up: true, paid: false, paid_claimed: true },
    { replied: true, spoke: false, signed_up: false, paid: false },
    { replied: false }
  ]);
  assert.deepEqual([f.sent, f.replied, f.spoke, f.signed_up, f.paid, f.paid_claimed], [4, 3, 2, 2, 1, 1]);
  assert.equal(f.reply_rate, 75);
  assert.equal(f.signup_rate, 50);
  assert.equal(f.paid_rate, 50);
  assert.equal(f.send_to_paid_rate, 25);
});

test('send state: auto sign-up counts as replied; tapped Paid is only a claim', () => {
  const s = perf.sendState({ signed_up_at: '2026-11-17T00:00:00Z' }, [
    { kind: 'outcome', outcome: 'paid', created_at: '2026-11-18T00:00:00Z' }
  ]);
  assert.equal(s.replied, true);
  assert.equal(s.signed_up, true);
  assert.equal(s.paid, false);
  assert.equal(s.paid_claimed, true);
  const spoke = perf.sendState({}, [{ kind: 'call_started', created_at: 'x' }, { kind: 'outcome', outcome: 'no_answer', created_at: 'y' }]);
  assert.equal(spoke.spoke, false);
  // A "No answer" is not a call (17 Nov 2026): kept, shown separately.
  assert.equal(spoke.calls, 0);
  assert.equal(spoke.not_answered, 1);
});

test('follow-ups: tapped date, a WhatsApp reply nobody answered, and silence after two days', () => {
  const due = perf.followUpsDue([
    { id: 'a', pitched_at: '2026-11-10T08:00:00Z', last_outcome: 'no_answer', last_outcome_at: '2026-11-15T08:00:00Z', follow_up_on: '2026-11-16' },
    { id: 'b', pitched_at: '2026-11-15T08:00:00Z', replied: true, replied_at: '2026-11-16T07:00:00Z' },
    { id: 'c', pitched_at: '2026-11-13T08:00:00Z' },
    { id: 'd', pitched_at: '2026-11-15T08:00:00Z' },
    { id: 'e', pitched_at: '2026-11-10T08:00:00Z', last_outcome: 'not_interested', last_outcome_at: '2026-11-11T08:00:00Z' },
    { id: 'f', pitched_at: '2026-11-10T08:00:00Z', do_not_contact: true },
    { id: 'g', pitched_at: '2026-11-10T08:00:00Z', signed_up: true, signed_up_at: '2026-11-15T08:00:00Z', replied: true, replied_at: '2026-11-11T08:00:00Z' },
    { id: 'h', pitched_at: '2026-11-10T08:00:00Z', signed_up: true, paid: true }
  ], '2026-11-16');
  // Most overdue first; on the same day, someone who wrote back comes first.
  assert.deepEqual(due.map((d) => d.id), ['c', 'b', 'g', 'a']);
  assert.match(due.find((d) => d.id === 'g').reason, /not paid yet.*27248497/);
  assert.equal(due[0].overdue_days, 1);
});

test('list dedupe: one person per number, refused numbers keep a reason, found-online allowed but tagged', () => {
  const lines = perf.parsePastedList('Kato Brian, 0772 123 456\n0701000111\n256755999888 Amina\n0772123456\n0789\nNakato 0700111222\n0700333444');
  const out = perf.dedupeList(lines, {
    sent: new Map([['701000111', 'film sent 2026-11-12 by Ronald']]),
    agents: new Set(['755999888']),
    listed: new Map([['700111222', "on sharon's list"]]),
    foundOnline: new Set(['700333444'])
  });
  assert.equal(out[0].name, 'Kato Brian');
  assert.deepEqual(out.map((o) => o.accepted ? 'ok' : o.refused_reason), [
    'ok', 'duplicate_sent', 'existing_agent', 'duplicate_list', 'invalid', 'duplicate_list', 'ok'
  ]);
  // Found-online listers are allowed since 15 Nov 2026, and tagged.
  assert.equal(out[6].lead_source, 'found_online');
  assert.equal(out[0].lead_source, null);
});

test('points and the King-only settings route', () => {
  assert.equal(perf.pointsFor({ sent: 10, replied: 2, signed_up: 1, paid: 1 }), 10 + 6 + 10 + 25);
  assert.equal(perf.pointsFor({ sent: 10 }, { send: 2 }), 20);
  assert.equal(isStaffSharedKingTool('/staff-performance', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/staff-performance/prospects/abc/call', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/staff-performance/prospects/abc/outcome', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/staff-performance/lists', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/staff-performance/settings', 'PUT'), false);
});

test('the tab sits between Outreach and Agents for King and staff, with no full numbers in code', () => {
  const html = read('index.html');
  for (const prefix of ['data-admin-tab-button=', 'data-staff-tools-tab=']) {
    const o = html.indexOf(`${prefix}"outreach"`);
    const p = html.indexOf(`${prefix}"performance"`);
    const a = html.indexOf(`${prefix}"agents"`);
    assert.ok(o > 0 && o < p && p < a, prefix);
  }
  const src = read('services/staffPerformance.js') + read('routes/staffPerformance.js') + read('db/migrations/226_staff_performance_road_to_1000.sql');
  assert.doesNotMatch(src, /\b(?:0|256)7\d{8}\b/);
});

test('15 Nov rule change: a found-online lister may be sent the film; do-not-contact and repeats still stop', async () => {
  const db = require('../config/database');
  const prospects = require('../services/agentProspectService');
  const original = db.query;
  let existing = null;
  db.query = async (sql) => {
    if (/FROM properties p/.test(sql)) return { rows: [{ '?column?': 1 }] };
    if (/FROM agent_prospects/.test(sql)) return { rows: existing ? [existing] : [] };
    return { rows: [] };
  };
  try {
    const fresh = await prospects.evaluateOutreachSend({ phone: '0799000123', videoKind: 'agent' });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.found_online, true);
    existing = { id: 'x', full_name: 'Test', do_not_contact: true, pitched_at: '2026-11-10T08:00:00Z', video_kind: 'agent' };
    assert.equal((await prospects.evaluateOutreachSend({ phone: '0799000123', videoKind: 'agent' })).code, 'do_not_contact');
    existing = { id: 'x', full_name: 'Test', do_not_contact: false, status: 'pitched', pitched_at: '2026-11-10T08:00:00Z', video_kind: 'agent' };
    assert.equal((await prospects.evaluateOutreachSend({ phone: '0799000123', videoKind: 'agent' })).code, 'already_sent');
  } finally {
    db.query = original;
  }
});
