'use strict';

// PR G4: fee exemptions end on a date; billing starts by itself on that date,
// and no message about it goes out until Arthur turns notices on.

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const db = require('../config/database');
const exemption = require('../services/agentFeeExemption');
const billingOps = require('../services/billingOpsService');
const revenue = require('../services/revenueService');
const handoff = require('../services/leadHandoffService');

const ROOT = path.join(__dirname, '..');
const TAG = `exg${crypto.randomBytes(3).toString('hex')}`;
const createdAgents = [];
let savedSettings = null;
const sent = [];
const realDeliver = handoff.deliverWhatsapp;

async function addAgent(fields) {
  const row = (await db.query(
    `INSERT INTO agents (full_name, licence_number, status, phone, whatsapp, fee_exempt, fee_exempt_reason, fee_exempt_until, paid_until, approved_at)
     VALUES ($1, $2, 'approved', $3, $3, $4, $5, $6::date, $7::date, NOW() - INTERVAL '90 days') RETURNING *`,
    [`${TAG} ${fields.name}`, `${TAG}-${createdAgents.length}`, `2567${String(Date.now()).slice(-8)}`.slice(0, 12), fields.fee_exempt ?? true,
      fields.reason || 'Approved before the monthly fee started', fields.until || null, fields.paid_until || null]
  )).rows[0];
  createdAgents.push(row.id);
  return row;
}

test.before(async () => {
  savedSettings = (await db.query(`SELECT key, value FROM billing_settings WHERE key IN ('pay_to', 'exempt_end_notices_enabled')`)).rows;
  await db.query(`INSERT INTO billing_settings (key, value, updated_by) VALUES ('pay_to', '{"method":"MTN Mobile Money","number":"0780 000000","name":"TEST"}', 'test')
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await db.query(`DELETE FROM billing_settings WHERE key = 'exempt_end_notices_enabled'`);
  handoff.deliverWhatsapp = async (payload) => { sent.push(payload); return { status: 'test' }; };
});

test.after(async () => {
  handoff.deliverWhatsapp = realDeliver;
  await db.query('DELETE FROM pay_links WHERE agent_id = ANY($1::uuid[])', [createdAgents]).catch(() => {});
  await db.query('DELETE FROM agents WHERE id = ANY($1::uuid[])', [createdAgents]).catch(() => {});
  await db.query(`DELETE FROM billing_settings WHERE key IN ('pay_to', 'exempt_end_notices_enabled')`);
  for (const row of savedSettings || []) {
    await db.query('INSERT INTO billing_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)', [row.key, JSON.stringify(row.value), 'test-restore']);
  }
  await db.pool?.end?.().catch?.(() => {});
});

test('exempt on 31 Jan, billable on 1 Feb, first due date 1 Feb (not the approval date)', () => {
  const agent = { fee_exempt: true, fee_exempt_until: '2027-02-01', paid_until: null, approved_at: '2026-09-01' };
  assert.deepEqual(exemption.exemptionState(agent, '2027-01-31'), { exempt: true, until: '2027-02-01', ended: false });
  assert.deepEqual(exemption.exemptionState(agent, '2027-02-01'), { exempt: false, until: '2027-02-01', ended: true });
  assert.equal(exemption.firstDueDate(agent, '2027-02-01'), '2027-02-01');
  assert.equal(exemption.exemptionLabel(agent, '2027-01-31'), 'fee-exempt until 1 Feb 2027');
  assert.equal(exemption.exemptionLabel({ fee_exempt: true }, '2027-01-31'), 'fee-exempt (no end date set)');
  assert.equal(exemption.endedExemptionNote(agent, {}, '2027-02-01'), 'billing started 1 Feb 2027 · notices held');
  assert.equal(exemption.endedExemptionNote(agent, { exempt_end_notices_enabled: true }, '2027-02-01'), 'billing started 1 Feb 2027');
  // The approval-time fee check follows the end date too.
  assert.equal(revenue.agentFeeRequired({ ...agent }, new Date('2027-01-30T12:00:00Z')), false);
  assert.equal(revenue.agentFeeRequired({ ...agent }, new Date('2027-02-01T12:00:00Z')), true);
});

test('with the notices knob off, the billing tick sends nothing to an agent whose exemption ended, and nothing is taken down', async () => {
  const today = revenue.kampalaDate();
  const ended = await addAgent({ name: 'ended today', until: today });
  sent.length = 0;
  await billingOps.runAgentFeeReminders(db);
  assert.equal(sent.filter((m) => String(m.to).endsWith(String(ended.phone).slice(-9))).length, 0, 'no reminder while notices are held');
  await assert.rejects(billingOps.takeDownAgentForBilling(db, { agentId: ended.id, actor: 'test' }), /notices held/);
  await assert.rejects(billingOps.sendAgentBillingMessage(db, { agentId: ended.id, kind: 'reminder', actor: 'test' }), /held/);

  // Staff still see them as billable from the end date.
  const summary = await revenue.revenueSummary(db);
  const row = summary.billing.find((a) => a.id === ended.id);
  assert.ok(row, 'the agent is on the staff billing list');
  assert.equal(row.due_from, today);
  assert.equal(row.fee_exempt, false);
  assert.match(row.exemption_note, /^billing started \d{1,2} [A-Z][a-z]{2} \d{4} · notices held$/);

  // Once Arthur turns notices on, the same tick reminds them on the end date.
  await db.query(`INSERT INTO billing_settings (key, value, updated_by) VALUES ('exempt_end_notices_enabled', 'true'::jsonb, 'test')
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  sent.length = 0;
  await billingOps.runAgentFeeReminders(db);
  assert.equal(sent.filter((m) => String(m.to).endsWith(String(ended.phone).slice(-9)) && /agent_billing_due_today/.test(m.kind)).length, 1);
  await db.query(`DELETE FROM billing_settings WHERE key = 'exempt_end_notices_enabled'`);
});

test('a still-exempt agent gets no reminder, and a pay link is refused without the logged override', async () => {
  const exempt = await addAgent({ name: 'still exempt', until: '2027-02-01' });
  sent.length = 0;
  await billingOps.runAgentFeeReminders(db);
  assert.equal(sent.filter((m) => String(m.to).endsWith(String(exempt.phone).slice(-9))).length, 0);
  const payLinks = require('../services/payLinkService');
  await assert.rejects(payLinks.createPayLink(db, { purpose: 'agent_subscription', agent_id: exempt.id }, 'test'), /fee-exempt until 1 Feb 2027/);
  const created = await payLinks.createPayLink(db, { purpose: 'agent_subscription', agent_id: exempt.id, allow_exempt: true }, 'test');
  assert.ok(created.code || created.link?.code, 'the override creates the link');
});

test('staff wording comes from the date everywhere', () => {
  const fs = require('fs');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const file of ['services/billingOpsService.js', 'services/payLinkService.js', 'services/teamBillingCommandService.js', 'routes/whatsapp.js', 'routes/admin.js', 'assets/makaug-app.js']) {
    assert.doesNotMatch(read(file), /lists for free|list for free, for good|This agent lists for free|lists free \(joined/, file);
  }
  assert.match(read('assets/makaug-app.js'), /fee-exempt until \$\{adminExemptionDate\(until\)\}/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

test('"waive" without an end date is refused', async () => {
  const pending = (await db.query(
    `INSERT INTO agents (full_name, licence_number, status, phone) VALUES ($1, $2, 'pending', '256700777123') RETURNING id`,
    [`${TAG} waive`, `${TAG}-waive`]
  )).rows[0];
  createdAgents.push(pending.id);
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test', MEMORY_LOG: 'off', AGENT_FEE_START_DATE: '2026-10-05' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 180; i += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const res = await fetch(`${base}/api/admin/agents/${pending.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY || '' },
      body: JSON.stringify({ status: 'approved', fee_override: { mode: 'waive', reason: 'test waive' } })
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /end date/);
    const row = (await db.query('SELECT status, fee_exempt FROM agents WHERE id = $1', [pending.id])).rows[0];
    assert.equal(row.status, 'pending');
    assert.equal(row.fee_exempt, false);
  } finally {
    child.kill('SIGTERM');
  }
});
