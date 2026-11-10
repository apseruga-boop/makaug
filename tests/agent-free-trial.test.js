'use strict';

/**
 * 10 Oct 2026: every new agent started with 14 days free, then paid the monthly
 * fee. 10 Nov 2026 (Arthur): no more free days. A new agent approved without a
 * payment gets the payment link with the welcome pack and owes from that day.
 * Agents already on a trial keep it to its end date, and the billing loop
 * (reminders, overdue, take-down, payment extends paid_until) is unchanged for
 * them.
 *
 * These tests cover both: the end of the trial for new agents, and the trials
 * still running.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const revenue = require('../services/revenueService');
const billing = require('../services/billingOpsService');
const welcome = require('../services/agentWelcomeService');
const team = require('../services/teamBillingCommandService');
const intake = require('../services/whatsappEmployeeIntakeService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const trialAgent = {
  id: 'a1', full_name: 'Jane Nakato', makaug_agent_number: 'MKA-AG-1',
  fee_offer_mode: 'free_period', fee_offer_until: '2026-10-23', fee_offer_at: '2026-10-10T08:00:00Z',
  paid_until: '2026-10-23'
};

test('from 10 Nov 2026 there is no automatic free trial', () => {
  delete process.env.AGENT_TRIAL_DAYS;
  assert.strictEqual(revenue.agentTrialDays(), 0);
  process.env.AGENT_TRIAL_DAYS = '14';
  assert.strictEqual(revenue.agentTrialDays(), 0, 'an old value left in the environment cannot bring the trial back');
  delete process.env.AGENT_TRIAL_DAYS;
});

test('the welcome message never mentions a free period, the fee or payment', () => {
  for (const agent of [trialAgent, { id: 'a2', full_name: 'New Agent' }]) {
    const body = welcome.buildWelcomeMessage({ agent, stats: { live_listings: 120, views_30d: 4000, visitors_30d: 900, top_countries: [{ name: 'Canada' }] } });
    // ("On track for 20,000 a month" is the audience target, not a price.)
    assert.ok(!/free|14 days|2 weeks|7 days|50,000|trial|payment|UGX 50|UGX 20,000/i.test(body), 'no free/fee wording in the written message');
    assert.match(body, /30\+ countries/);
    assert.match(body, /Canada/);
    assert.match(body, /South Africa/);
  }
});

test('the welcome film: a new agent gets no free-days scene; a hand-given free period says its own length', () => {
  const video = require('../services/agentReportVideoService');
  const plain = { agent: { id: 'a2', full_name: 'New Agent' }, stats: {} };
  assert.ok(video.welcomeDuration({ agent: trialAgent, stats: {} }) > video.welcomeDuration(plain), 'only a free period adds the scene');
  assert.strictEqual(video.trialLengthDays(trialAgent), 14);
  assert.strictEqual(video.trialLengthDays({ fee_offer_mode: 'free_period', fee_offer_at: '2026-11-10T08:00:00Z', fee_offer_until: '2026-12-09' }), 30);
  assert.doesNotMatch(read('services/agentReportVideoService.js'), /Your first 14 days/, 'the length is never hard-coded');
  const preview = video.trialVariant({ agent: { id: 'a3' } });
  assert.strictEqual(video.trialLengthDays(preview.agent), 14, 'the staff preview still shows a real free period, not a negative one');
});

test('agents still on a trial: the reminder names their own end date, the fee and Ronald', () => {
  const settings = { agent_fee: { monthly_ugx: 50000 }, pay_to: { number: '0780863394', name: 'MAKAUG' } };
  const pre = billing.buildAgentBillingMessage('pre_due', { agent: trialAgent, settings, payLink: 'https://makaug.com/pay/abc' });
  assert.match(pre, /Your free trial on makaug ends on \*.*23 Oct.*\*/);
  assert.ok(!/2 free weeks/.test(pre), 'the length is not assumed');
  assert.match(pre, /UGX 50,000 a month/);
  assert.match(pre, /https:\/\/makaug\.com\/pay\/abc/);
  assert.match(pre, /Ronald/);
  const today = billing.buildAgentBillingMessage('due_today', { agent: trialAgent, settings });
  assert.match(today, /ends \*today\*/);
});

test('once they have paid past the trial, the reminders are the ordinary ones', () => {
  const paid = { ...trialAgent, paid_until: '2026-11-22' };
  assert.strictEqual(billing.onFreeTrial(paid), false);
  const msg = billing.buildAgentBillingMessage('pre_due', { agent: paid, settings: {} });
  assert.ok(!/free trial/.test(msg));
});

test('trial states: on trial, ending soon, unpaid after, paused, paid — and no-free-days agents: unpaid or paid', () => {
  const row = (over) => ({ fee_offer_until: '2026-10-23', paid_until: '2026-10-23', ...over });
  assert.strictEqual(billing.trialState(row(), '2026-10-12'), 'on_trial');
  assert.strictEqual(billing.trialState(row(), '2026-10-20'), 'ending_soon');
  assert.strictEqual(billing.trialState(row(), '2026-10-23'), 'ending_soon');
  assert.strictEqual(billing.trialState(row(), '2026-10-24'), 'overdue');
  assert.strictEqual(billing.trialState(row({ billing_suspended_at: new Date() }), '2026-11-05'), 'taken_down');
  assert.strictEqual(billing.trialState(row({ paid_until: '2026-11-22' }), '2026-10-24'), 'paid', 'a payment closes the loop');
  const payNow = { fee_offer_mode: 'pay_later', fee_offer_at: '2026-11-10T08:00:00Z', fee_offer_until: null, paid_until: null };
  assert.strictEqual(billing.trialState(payNow, '2026-11-12'), 'unpaid');
  assert.strictEqual(billing.trialState({ ...payNow, paid_until: '2026-12-10' }, '2026-11-12'), 'paid');
  assert.strictEqual(billing.trialState({ ...payNow, billing_suspended_at: new Date() }, '2026-11-30'), 'taken_down');
});

test('the tracker lists open trials and unpaid new agents, and drops paid ones', async () => {
  const today = revenue.kampalaDate();
  const rows = [
    { id: '1', full_name: 'Open Agent', whatsapp: '256772000001', fee_offer_mode: 'free_period', fee_offer_until: revenue.addDays(today, 9), paid_until: revenue.addDays(today, 9), fee_offer_at: new Date().toISOString(), fee_offer_by: 'whatsapp:256709402189' },
    { id: '2', full_name: 'Paid Agent', whatsapp: '256772000002', fee_offer_mode: 'free_period', fee_offer_until: revenue.addDays(today, -2), paid_until: revenue.addDays(today, 28), fee_offer_at: new Date().toISOString() },
    { id: '3', full_name: 'Late Agent', whatsapp: '256772000003', fee_offer_mode: 'free_period', fee_offer_until: revenue.addDays(today, -3), paid_until: revenue.addDays(today, -3), fee_offer_at: new Date().toISOString() },
    { id: '4', full_name: 'New Agent', whatsapp: '256772000004', fee_offer_mode: 'pay_later', fee_offer_until: null, paid_until: null, fee_offer_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: '5', full_name: 'New Payer', whatsapp: '256772000005', fee_offer_mode: 'pay_later', fee_offer_until: null, paid_until: revenue.addDays(today, 29), fee_offer_at: new Date().toISOString() }
  ];
  let params = null;
  const db = { async query(sql, args) { if (/FROM agents/.test(sql)) { params = args; return { rows }; } return { rows: [] }; } };
  const open = await billing.listAgentTrials(db);
  assert.deepStrictEqual(params, [billing.FIRST_PAYMENT_TRACKED_FROM], 'only agents approved with no free days from 10 Nov 2026 are chased');
  assert.deepStrictEqual(open.map((r) => r.name).sort(), ['Late Agent', 'New Agent', 'Open Agent']);
  const late = open.find((r) => r.name === 'Late Agent');
  assert.strictEqual(late.state, 'overdue');
  assert.strictEqual(late.first_payment_due, revenue.addDays(late.ends, 1));
  const fresh = open.find((r) => r.name === 'New Agent');
  assert.strictEqual(fresh.state, 'unpaid');
  assert.strictEqual(fresh.kind, 'no_free_days');
  assert.strictEqual(fresh.first_payment_due, fresh.started, 'no free days: due the day they were approved');
  assert.strictEqual(fresh.days_left, -2);
  assert.match(billing.formatTrialLine(fresh), /not paid yet, approved .* \(2 days ago\), payment link sent/);
  const all = await billing.listAgentTrials(db, { includeClosed: true });
  assert.strictEqual(all.length, 5);
  assert.strictEqual(all.find((r) => r.name === 'Paid Agent').closed, true);
  assert.strictEqual(all.find((r) => r.name === 'New Payer').closed, true);
});

test('the team digest chases unpaid new agents and trials, and stays quiet otherwise', () => {
  const base = { phone: '256772000003', paid_until: '', ends: '2026-10-23' };
  assert.strictEqual(billing.buildTrialDigest([{ ...base, name: 'Calm', state: 'on_trial', days_left: 9 }]), '');
  assert.strictEqual(billing.buildTrialDigest([{ ...base, name: 'Today', state: 'unpaid', kind: 'no_free_days', started: '2026-11-10', ends: '2026-11-10', days_left: 0 }]), '',
    'an agent approved today has only just had the link');
  const body = billing.buildTrialDigest([
    { ...base, name: 'New Agent', state: 'unpaid', kind: 'no_free_days', started: '2026-11-10', ends: '2026-11-10', days_left: -3 },
    { ...base, name: 'Today', state: 'unpaid', kind: 'no_free_days', started: '2026-11-13', ends: '2026-11-13', days_left: 0 },
    { ...base, name: 'Late Agent', state: 'overdue', days_left: -3 },
    { ...base, name: 'Soon Agent', state: 'ending_soon', days_left: 2 },
    { ...base, name: 'Calm', state: 'on_trial', days_left: 9 }
  ]);
  assert.match(body, /New agents — payment follow-ups/);
  assert.match(body, /New agents who have not paid yet — chase today/);
  assert.match(body, /New Agent.*3 days ago/);
  assert.match(body, /Unpaid after the trial/);
  assert.match(body, /Late Agent.*3 days ago/);
  assert.match(body, /Soon Agent.*2 days left/);
  assert.match(body, /1 new agent approved today has the payment link already/);
  assert.match(body, /1 more agent is still comfortably/);
  assert.match(body, /\*UNPAID\*/);
});

test('team commands: NEW AGENT goes live and is sent the payment link; UNPAID and TRIALS list; plain chat is untouched', async () => {
  const src = read('services/teamBillingCommandService.js');
  assert.doesNotMatch(src, /mode: 'free_period'/, 'no command gives a free trial any more');
  assert.match(src, /mode: 'pay_later'/);
  assert.match(src, /trials\?\|unpaid/);
  assert.match(team.help(), /\*NEW AGENT\*/);
  assert.match(team.help(), /UGX 50,000 payment link \(no free days\)/);
  assert.match(team.help(), /\*UNPAID\*/);
  assert.ok(!/free trial,/.test(team.help()));
  assert.strictEqual(team.newAgentPayLater('whatsapp:256709402189', 'signed up').mode, 'pay_later');
  assert.match(team.payLinkSentLine({ fee_link: { sent: true } }), /UGX 50,000 payment link follows the welcome pack/);
  assert.match(team.payLinkSentLine({ fee_link: { sent: false, reason: 'employee_declined' } }), /PAY LINK/);
  const db = { async query() { return { rows: [] }; } };
  assert.strictEqual(await team.handleTeamBillingCommand(db, { phone: '256709402189', body: 'trial run tomorrow?' }), null);
});

test('approving without a payment no longer starts an automatic free trial', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /not put on an automatic free trial/);
  assert.doesNotMatch(admin, /New agent \$\{days\}-day free trial/);
  assert.match(admin, /if \(mode === 'pay_later'\) req\.body\.send_pay_link = true;/, 'pay later sends the link with the welcome pack');
});

test('the doorstep intake tells the employee the fee and that the payment link goes with the welcome pack', () => {
  const note = intake.employeeAgentTrialNotice('Jane Nakato', 0, 'UGX 50,000');
  assert.match(note, /Jane Nakato\* pays UGX 50,000 a month from the day they are approved/);
  assert.match(note, /payment link goes with their welcome pack/);
  assert.ok(!/days free/.test(note));
  assert.match(intake.employeeAgentTrialNotice('Jane Nakato', 14, 'UGX 50,000'), /gets 14 days free/, 'a hand-given free period still reads right');
  const route = read('routes/whatsapp.js');
  assert.match(route, /employeeAgentTrialNotice\(data\.agent\.full_name/);
});

test('the daily scheduler sends the digest', () => {
  const src = read('services/billingOpsService.js');
  assert.match(src, /runTrialDigest\(db\)/);
});

test('admins can read the list over the API', () => {
  assert.match(read('routes/admin.js'), /router\.get\('\/revenue\/agent-trials'/);
});
