'use strict';

/**
 * 10 Oct 2026: every new agent starts with 14 days free, then pays the monthly
 * fee. The existing billing loop (reminders, overdue, take-down, payment
 * extends paid_until) is reused: a free period sets paid_until to the last free
 * day. These tests cover the new pieces: the welcome wording, the trial
 * reminders, the tracker and the WhatsApp commands.
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

test('the trial is 14 days unless the environment says otherwise', () => {
  delete process.env.AGENT_TRIAL_DAYS;
  assert.strictEqual(revenue.agentTrialDays(), 14);
  process.env.AGENT_TRIAL_DAYS = 'nonsense';
  assert.strictEqual(revenue.agentTrialDays(), 14);
  delete process.env.AGENT_TRIAL_DAYS;
  assert.strictEqual(revenue.addDays('2026-10-10', 14 - 1), '2026-10-23', 'free through 23 Oct, first payment 24 Oct');
});

test('the welcome message never mentions the trial, the fee or payment; the video does', () => {
  const body = welcome.buildWelcomeMessage({ agent: trialAgent, stats: { live_listings: 120, views_30d: 4000, visitors_30d: 900, top_countries: [{ name: 'Canada' }] } });
  assert.ok(!/free|14 days|2 weeks|50,000|trial|payment|UGX 50/i.test(body), 'no free/fee wording in the written message');
  assert.match(body, /30\+ countries/);
  assert.match(body, /Canada/);
  assert.match(body, /South Africa/);
  const video = fs.readFileSync(path.join(__dirname, '..', 'services', 'agentReportVideoService.js'), 'utf8');
  assert.match(video, /if \(onTrial\) statement\([^\n]*Your first 14 days/);
  const timeline = require('../services/agentReportVideoService');
  assert.ok(timeline.welcomeDuration({ agent: trialAgent, stats: {} }) > timeline.welcomeDuration({ agent: { id: 'a2' }, stats: {} }), 'trial agents get the extra scene');
});

test('an agent who is not on a trial gets the welcome exactly as before', () => {
  const body = welcome.buildWelcomeMessage({ agent: { id: 'a2', full_name: 'Old Agent' }, stats: {} });
  assert.match(body, /Every listing gets its first 7 days free/);
});

test('the reminder 3 days before names the end date, the fee and Ronald', () => {
  const settings = { agent_fee: { monthly_ugx: 50000 }, pay_to: { number: '0780863394', name: 'MAKAUG' } };
  const pre = billing.buildAgentBillingMessage('pre_due', { agent: trialAgent, settings, payLink: 'https://makaug.com/pay/abc' });
  assert.match(pre, /Your 2 free weeks on makaug end on \*.*23 Oct.*\*/);
  assert.match(pre, /UGX 50,000 a month/);
  assert.match(pre, /https:\/\/makaug\.com\/pay\/abc/);
  assert.match(pre, /Ronald/);
  const today = billing.buildAgentBillingMessage('due_today', { agent: trialAgent, settings });
  assert.match(today, /end \*today\*/);
});

test('once they have paid past the trial, the reminders are the ordinary ones', () => {
  const paid = { ...trialAgent, paid_until: '2026-11-22' };
  assert.strictEqual(billing.onFreeTrial(paid), false);
  const msg = billing.buildAgentBillingMessage('pre_due', { agent: paid, settings: {} });
  assert.ok(!/free weeks/.test(msg));
});

test('trial states: on trial, ending soon, unpaid after, paused, paid', () => {
  const row = (over) => ({ fee_offer_until: '2026-10-23', paid_until: '2026-10-23', ...over });
  assert.strictEqual(billing.trialState(row(), '2026-10-12'), 'on_trial');
  assert.strictEqual(billing.trialState(row(), '2026-10-20'), 'ending_soon');
  assert.strictEqual(billing.trialState(row(), '2026-10-23'), 'ending_soon');
  assert.strictEqual(billing.trialState(row(), '2026-10-24'), 'overdue');
  assert.strictEqual(billing.trialState(row({ billing_suspended_at: new Date() }), '2026-11-05'), 'taken_down');
  assert.strictEqual(billing.trialState(row({ paid_until: '2026-11-22' }), '2026-10-24'), 'paid', 'a payment closes the loop');
});

test('the tracker lists open trials with dates and drops paid ones', async () => {
  const today = revenue.kampalaDate();
  const rows = [
    { id: '1', full_name: 'Open Agent', whatsapp: '256772000001', fee_offer_until: revenue.addDays(today, 9), paid_until: revenue.addDays(today, 9), fee_offer_at: new Date().toISOString(), fee_offer_by: 'whatsapp:256709402189' },
    { id: '2', full_name: 'Paid Agent', whatsapp: '256772000002', fee_offer_until: revenue.addDays(today, -2), paid_until: revenue.addDays(today, 28), fee_offer_at: new Date().toISOString() },
    { id: '3', full_name: 'Late Agent', whatsapp: '256772000003', fee_offer_until: revenue.addDays(today, -3), paid_until: revenue.addDays(today, -3), fee_offer_at: new Date().toISOString() }
  ];
  const db = { async query(sql) { return /FROM agents/.test(sql) ? { rows } : { rows: [] }; } };
  const open = await billing.listAgentTrials(db);
  assert.deepStrictEqual(open.map((r) => r.name).sort(), ['Late Agent', 'Open Agent']);
  const late = open.find((r) => r.name === 'Late Agent');
  assert.strictEqual(late.state, 'overdue');
  assert.strictEqual(late.first_payment_due, revenue.addDays(late.ends, 1));
  const all = await billing.listAgentTrials(db, { includeClosed: true });
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all.find((r) => r.name === 'Paid Agent').closed, true);
});

test('the team digest chases unpaid and ending agents, and stays quiet otherwise', () => {
  const base = { phone: '256772000003', paid_until: '', ends: '2026-10-23' };
  assert.strictEqual(billing.buildTrialDigest([{ ...base, name: 'Calm', state: 'on_trial', days_left: 9 }]), '');
  const body = billing.buildTrialDigest([
    { ...base, name: 'Late Agent', state: 'overdue', days_left: -3 },
    { ...base, name: 'Soon Agent', state: 'ending_soon', days_left: 2 },
    { ...base, name: 'Calm', state: 'on_trial', days_left: 9 }
  ]);
  assert.match(body, /Unpaid after the trial/);
  assert.match(body, /Late Agent.*3 days ago/);
  assert.match(body, /Soon Agent.*2 days left/);
  assert.match(body, /1 more agent is still comfortably/);
});

test('team commands: NEW AGENT goes live on the trial, TRIALS lists, plain "trial" chat is untouched', async () => {
  const src = read('services/teamBillingCommandService.js');
  assert.match(src, /mode: 'free_period', days/);
  assert.match(src, /trials\?/);
  assert.match(team.help(), /14-day free trial/);
  assert.match(team.help(), /\*TRIALS\*/);
  const db = { async query() { return { rows: [] }; } };
  assert.strictEqual(await team.handleTeamBillingCommand(db, { phone: '256709402189', body: 'trial run tomorrow?' }), null);
});

test('approving without a payment now starts the free trial, unless payment is required', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /feeOverride = \{ mode: 'free_period', days, reason: `New agent \$\{days\}-day free trial` \}/);
  assert.match(admin, /req\.body\.require_payment !== true/);
  assert.match(admin, /req\.body\.payment && typeof req\.body\.payment === 'object'/);
});

test('the doorstep intake tells the employee about the trial instead of asking about a pay link', () => {
  const note = intake.employeeAgentTrialNotice('Jane Nakato', 14, 'UGX 50,000');
  assert.match(note, /Jane Nakato\* gets 14 days free/);
  assert.match(note, /UGX 50,000 a month/);
  const route = read('routes/whatsapp.js');
  assert.match(route, /employeeAgentTrialNotice\(data\.agent\.full_name/);
});

test('the daily scheduler sends the trial digest', () => {
  const src = read('services/billingOpsService.js');
  assert.match(src, /runTrialDigest\(db\)/);
});

test('admins can read the trial list over the API', () => {
  assert.match(read('routes/admin.js'), /router\.get\('\/revenue\/agent-trials'/);
});
