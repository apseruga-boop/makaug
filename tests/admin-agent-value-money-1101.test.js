'use strict';

// Agent value view (1 Nov 2026): King → Agents shows what each agent has paid,
// what the next payment is and what is overdue, with business-wide totals that
// come from the same ledger and fee rule as Sales & Revenue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { agentMoney, agentMoneyTotals, paymentTracker } = require('../routes/adminAgentManager');

const now = new Date('2026-11-01T09:00:00Z');
const fee = { feeUgx: 50000 };

test('free-trial agent: UGX 0 paid, flagged free trial, nothing owed', () => {
  const agent = { status: 'approved', paid_until: '2026-11-20', fee_offer_mode: 'free_period', fee_offer_until: '2026-11-20', paid_to_date_ugx: 0 };
  const m = agentMoney(agent, paymentTracker(agent, null, now), fee);
  assert.equal(m.paid_to_date_ugx, 0);
  assert.equal(m.free_trial, true);
  assert.equal(m.owed_ugx, 0);
  assert.equal(m.next_amount_ugx, 50000);
  assert.equal(m.next_due, '2026-11-21');
});

test('overdue agent owes one fee per 30 days late; own fee beats the default', () => {
  const agent = { status: 'approved', paid_until: '2026-09-20', monthly_fee_ugx: 70000, paid_to_date_ugx: 140000, payment_count: 2 };
  const m = agentMoney(agent, paymentTracker(agent, null, now), fee);
  assert.equal(m.paid_to_date_ugx, 140000);
  assert.equal(m.cycles_owed, 2);
  assert.equal(m.owed_ugx, 140000);
});

test('never paid approved agent owes one fee; exempt and removed agents owe nothing', () => {
  const never = { status: 'approved' };
  assert.equal(agentMoney(never, paymentTracker(never, null, now), fee).owed_ugx, 50000);
  const exempt = { status: 'approved', fee_exempt: true, paid_to_date_ugx: 0 };
  const e = agentMoney(exempt, paymentTracker(exempt, null, now), fee);
  assert.deepEqual([e.owed_ugx, e.next_amount_ugx], [0, 0]);
  const removed = { status: 'approved', removed_at: '2026-10-01', paid_to_date_ugx: 50000 };
  const r = agentMoney(removed, paymentTracker(removed, null, now), fee);
  assert.deepEqual([r.owed_ugx, r.paid_to_date_ugx], [0, 50000]);
});

test('totals add lifetime money (removed agents included) and skip removed agents for dues', () => {
  const rows = [
    { status: 'approved', money: { paid_to_date_ugx: 100000, next_amount_ugx: 50000, owed_ugx: 0 } },
    { status: 'approved', money: { paid_to_date_ugx: 0, next_amount_ugx: 50000, owed_ugx: 50000 } },
    { status: 'approved', removed_at: '2026-10-01', money: { paid_to_date_ugx: 30000, next_amount_ugx: 0, owed_ugx: 0 } },
    { status: 'pending', money: { paid_to_date_ugx: 0, next_amount_ugx: 50000, owed_ugx: 0 } }
  ];
  assert.deepEqual(agentMoneyTotals(rows), { collected_ugx: 130000, due_next_cycle_ugx: 100000, overdue_ugx: 50000, overdue_agents: 1, paying_agents: 2 });
});

test('list route reads paid-to-date from the Sales & Revenue ledger', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAgentManager.js'), 'utf8');
  assert.match(src, /kind = 'agent_subscription' AND direction = 'in' AND voided_at IS NULL/);
  assert.match(src, /money_totals/);
});

test('UI: money chips, sortable paid column, top payer badge, free trial note, mobile strip', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  for (const marker of ['data-money-collected', 'data-money-due-next', 'data-money-overdue', 'data-agent-manager-sort-paid',
    'Paid to date (highest first)', 'data-agent-value-badge', 'data-agent-free-trial', 'data-agent-money-mobile', 'data-public-money',
    'Next payment due', 'Days left', 'Approved listings', 'Manage']) {
    assert.ok(app.includes(marker), `missing ${marker}`);
  }
  const pick = (name) => app.slice(app.indexOf(`function ${name}(`), app.indexOf('\n}\n', app.indexOf(`function ${name}(`)) + 2);
  const ctx = { adminEscape: (v) => String(v), adminAgentManagerDay: (v) => v || '—' };
  vm.createContext(ctx);
  vm.runInContext(['adminAgentMoneyUgx', 'adminAgentManagerTopPayers', 'adminAgentManagerSortRows'].map(pick).join('\n'), ctx);
  assert.equal(ctx.adminAgentMoneyUgx(1250000), 'UGX 1,250,000');
  const rows = [{ id: 'a', full_name: 'A', money: { paid_to_date_ugx: 10 } }, { id: 'b', full_name: 'B', money: { paid_to_date_ugx: 90 } }, { id: 'c', full_name: 'C', money: { paid_to_date_ugx: 0 } }];
  assert.deepEqual(ctx.adminAgentManagerSortRows(rows, 'paid').map((r) => r.id), ['b', 'a', 'c']);
  const top = ctx.adminAgentManagerTopPayers(rows);
  assert.equal(top.get('b'), 1);
  assert.equal(top.has('c'), false);
});
