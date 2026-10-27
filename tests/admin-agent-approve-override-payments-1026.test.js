'use strict';

// Approve anyway + payment tracker (26 Oct 2026, Arthur): King can approve a
// pending agent whose approval is blocked (e.g. ID missing) through the normal
// approval, with a reason that is audit-logged; the agent then carries an
// "Approved – ID still needed" reminder until the NIN is saved. The Agents tab
// also shows each agent's payment countdown from real data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const app = read('assets', 'makaug-app.js');
const adminRoutes = read('routes', 'admin.js');
const managerSrc = read('routes', 'adminAgentManager.js');
const { paymentTracker, idStillNeeded, approvedAnyway, kampalaDay } = require('../routes/adminAgentManager');

const NOW = new Date('2026-10-26T09:00:00Z'); // 12:00 in Kampala, 26 Oct

test('kampala day rolls over at 21:00 UTC', () => {
  assert.equal(kampalaDay(new Date('2026-10-26T20:59:00Z')), '2026-10-26');
  assert.equal(kampalaDay(new Date('2026-10-26T21:00:00Z')), '2026-10-27');
});

test('countdown: next payment is the day after paid_until, with red/amber tones', () => {
  const t = (paid_until, extra = {}) => paymentTracker({ paid_until, ...extra }, null, NOW);
  assert.deepEqual([t('2026-10-26').next_due, t('2026-10-26').days_left, t('2026-10-26').tone], ['2026-10-27', 1, 'amber']);
  const due = t('2026-10-25');
  assert.deepEqual([due.next_due, due.days_left, due.overdue, due.tone], ['2026-10-26', 0, false, 'amber']);
  const late = t('2026-10-24');
  assert.deepEqual([late.days_left, late.overdue, late.days_overdue, late.tone], [-1, true, 1, 'red']);
  assert.deepEqual([t('2026-11-01').days_left, t('2026-11-01').tone], [7, 'amber']);
  assert.deepEqual([t('2026-11-02').days_left, t('2026-11-02').tone], [8, 'ok']);
  // A Date object (as pg returns DATE) is read as the Kampala day, not shifted.
  assert.equal(paymentTracker({ paid_until: new Date('2026-10-31T21:00:00Z') }, null, NOW).paid_until, '2026-11-01');
});

test('countdown: nothing is invented when there is no data or no fee', () => {
  const none = paymentTracker({}, null, NOW);
  assert.equal(none.next_due, null);
  assert.equal(none.days_left, null);
  assert.equal(none.tone, null);
  assert.equal(none.plan, 'Not set');
  assert.equal(none.last_payment_on, null);
  assert.equal(none.days_on_period, null);
  const free = paymentTracker({ fee_exempt: true, paid_until: '2026-10-01' }, null, NOW);
  assert.equal(free.next_due, null);
  assert.equal(free.plan, 'Free (staff override)');
});

test('countdown: free trial, staff-typed and ledger sources', () => {
  const trial = paymentTracker({ paid_until: '2026-11-08', fee_offer_mode: 'free_period', fee_offer_until: '2026-11-08', fee_offer_at: '2026-10-26T08:00:00Z' }, null, NOW);
  assert.deepEqual([trial.plan, trial.period_start, trial.period_source, trial.days_on_period, trial.days_left], ['Free trial', '2026-10-26', 'free_trial', 1, 14]);
  const staff = paymentTracker({ paid_until: '2026-10-24', plan_started_on: '2026-09-25', last_payment_on: '2026-09-25', last_payment_ugx: 50000 }, null, NOW);
  assert.deepEqual([staff.period_source, staff.days_on_period, staff.last_payment_on, staff.last_payment_ugx, staff.last_payment_source], ['staff', 32, '2026-09-25', 50000, 'staff']);
  const ledger = { paid_at: '2026-10-01T10:00:00Z', amount_ugx: 60000, period_start: '2026-10-01', period_end: '2026-10-31' };
  const fromLedger = paymentTracker({ paid_until: '2026-10-31', last_payment_on: '2026-09-01', last_payment_ugx: 50000 }, ledger, NOW);
  assert.deepEqual([fromLedger.plan, fromLedger.period_source, fromLedger.last_payment_on, fromLedger.last_payment_ugx, fromLedger.last_payment_source], ['Monthly', 'ledger', '2026-10-01', 60000, 'ledger']);
  const newerManual = paymentTracker({ paid_until: '2026-10-31', last_payment_on: '2026-10-20', last_payment_ugx: 50000 }, ledger, NOW);
  assert.equal(newerManual.last_payment_source, 'staff');
});

test('"ID still needed" is approved + no NIN, and clears when the NIN is saved', () => {
  assert.equal(idStillNeeded({ status: 'approved', nin: '' }), true);
  assert.equal(idStillNeeded({ status: 'approved', nin: 'CM123' }), false);
  assert.equal(idStillNeeded({ status: 'pending', nin: '' }), false);
  assert.equal(idStillNeeded({ status: 'approved', nin: '', removed_at: '2026-10-01' }), false);
  const hist = [{ action: 'admin_agent_details_updated', details: {} }, { action: 'admin_agent_approved_anyway', created_at: '2026-10-26T15:00:00Z', details: { by: 'Arthur', reason: 'met in person', missing: ['nin'] } }];
  assert.deepEqual(approvedAnyway(hist), { at: '2026-10-26T15:00:00Z', by: 'Arthur', reason: 'met in person', missing: ['nin'] });
  assert.equal(approvedAnyway([]), null);
});

test('approve anyway uses the normal status route, gated to owner roles with a reason', () => {
  const start = adminRoutes.indexOf("router.patch('/agents/:id/status'");
  assert.ok(start > -1);
  const route = adminRoutes.slice(start, start + 40000);
  assert.match(route, /approval_override/);
  assert.match(route, /Only the owner \(King\) account can approve anyway/);
  assert.match(route, /super_admin/);
  const normalAudit = route.indexOf("'admin_agent_status_updated'");
  const overrideAudit = route.indexOf("'admin_agent_approved_anyway'");
  assert.ok(normalAudit > -1 && overrideAudit > normalAudit, 'override is recorded after the normal approval is written');
  // No separate approval path: the UI goes through adminSetAgentStatus.
  assert.match(app, /adminSetAgentStatus\(agentId, "approved", null, null, \{ approval_override: \{ reason \} \}\)/);
});

test('UI: approve anyway for every pending agent, reminders, filter and payment columns', () => {
  assert.match(app, /function adminAgentManagerCanApprove\(agent = \{\}\) \{\s*return String\(agent\.status \|\| ""\) === "pending" && !agent\.removed_at;/);
  for (const label of ['Approve anyway', 'Yes, approve anyway', 'Approved – ID still needed', 'still missing ID', 'Live listings',
    'Next payment due', 'Days left', 'Payment overdue', 'Pending approval', 'Plan start (current period)', 'Last payment date',
    'Last payment amount (UGX)', 'Display name (shown on the site and listings)', 'Company name (shown on the site)', '— not set']) {
    assert.ok(app.includes(label), `UI should include "${label}"`);
  }
  // Row quick action and Manage page both use the same button helper.
  assert.ok((app.match(/adminAgentManagerApproveButton\(a(, "lg")?\)/g) || []).length >= 3);
  // The plan field no longer pre-fills the sign-up tier (saving would have written it).
  assert.ok(!app.includes('field("billing_plan", "Plan", a.billing_plan || a.plan)'));
});

test('manual payment fields are saved through the audited PATCH and a migration with rollback', () => {
  assert.match(read('db', 'migrations', '189_agent_manual_payment_tracker.sql'), /ADD COLUMN IF NOT EXISTS plan_started_on DATE/);
  const rollback = read('scripts', 'rollback-189-agent-manual-payment-tracker.sql');
  assert.match(rollback, /DROP COLUMN IF EXISTS last_payment_ugx/);
  assert.match(rollback, /schema_migrations/);
  for (const key of ['plan_started_on', 'last_payment_on', 'last_payment_ugx']) assert.ok(managerSrc.includes(key));
});
