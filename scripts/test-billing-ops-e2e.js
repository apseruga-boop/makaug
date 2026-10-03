#!/usr/bin/env node
// End-to-end check of billing operations against a running local server:
// pay-to gate, reminders, final reminder, take-down + snapshot, paused-agent reply,
// "I have paid" claim from WhatsApp, MoMo SMS match, confirm -> reinstated unchanged,
// private-lister views message (edited), lister take-down + payment, statement upload.
// Usage: BASE=http://localhost:3999 ADMIN_API_KEY=... DATABASE_URL=... node scripts/test-billing-ops-e2e.js
const { Pool } = require('pg');

const BASE = process.env.BASE || 'http://localhost:3999';
const KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
const BRIDGE = process.env.WHATSAPP_WEB_BRIDGE_TOKEN || 'bridge-test';
const SMS_TOKEN = process.env.MONEY_SMS_WEBHOOK_TOKEN || 'test-sms-token-1234567890';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}
async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/admin${path}`, { method, headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}
async function inbound(phone, body) {
  const res = await fetch(`${BASE}/api/whatsapp/web-bridge/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-whatsapp-web-bridge-token': BRIDGE },
    body: JSON.stringify({ phone, body, message_id: `bill-${Date.now()}-${Math.random()}`, created_at: new Date().toISOString(), metadata: {} })
  });
  return (await res.json().catch(() => ({})))?.data?.message || '';
}
async function lastOutbound(phone) {
  return (await pool.query(`SELECT payload->>'text' AS text FROM outbound_message_queue WHERE user_phone LIKE $1 ORDER BY created_at DESC LIMIT 1`, [`%${phone.slice(-9)}`])).rows[0]?.text || '';
}
const day = (offset) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

(async () => {
  const phone = '256779000077';
  const txid = String(Date.now()).slice(-11);
  const originalSettings = (await api('GET', '/revenue/summary')).data.settings;

  // Seed: an agent 10 days overdue with two live listings and one pending.
  await pool.query(`DELETE FROM whatsapp_sessions WHERE phone LIKE '%779000077%'`);
  await pool.query(`DELETE FROM properties WHERE title LIKE 'BILLTEST %'`);
  await pool.query(`DELETE FROM agents WHERE whatsapp = $1`, [phone]);
  const agent = (await pool.query(
    `INSERT INTO agents (full_name, phone, whatsapp, status, licence_number, fee_exempt, paid_until, monthly_fee_ugx)
     VALUES ('Billtest Okello', $1, $1, 'approved', 'BILL-1', false, $2::date, 50000) RETURNING id`, [phone, day(-10)])).rows[0];
  const mk = (title, status, extra = {}) => pool.query(
    `INSERT INTO properties (listing_type, title, description, district, area, status, agent_id, lister_name, lister_phone, created_at)
     VALUES ('sale', $1, 'test', 'Wakiso', 'Kira', $2, $3, $4, $5, COALESCE($6::timestamptz, NOW())) RETURNING id`,
    [title, status, extra.agentId === undefined ? agent.id : extra.agentId, extra.name || 'Billtest Okello', extra.phone || phone, extra.created || null]);
  const p1 = (await mk('BILLTEST house A', 'approved')).rows[0].id;
  const p2 = (await mk('BILLTEST plot B', 'pending')).rows[0].id;

  console.log('\n1. Pay-to gate');
  await api('PUT', '/revenue/settings/pay_to', { value: { method: 'MTN Mobile Money', number: '', name: '' } });
  const blocked = await api('POST', `/revenue/agents/${agent.id}/billing-message`, { kind: 'reminder' });
  check('reminder refused without pay-to number', blocked.status >= 400, blocked.error);
  await api('PUT', '/revenue/settings/pay_to', { value: { method: 'MTN Mobile Money', number: '0780 111222', name: 'MAKAUG TEST LTD' } });

  console.log('\n2. Reminder + final reminder');
  const preview = await api('GET', `/revenue/agents/${agent.id}/billing-message/reminder`);
  check('preview names the agent and pay-to', /Okello|Billtest/.test(preview.data?.text) && /0780 111222/.test(preview.data?.text), preview.data?.text?.slice(0, 80));
  const sent = await api('POST', `/revenue/agents/${agent.id}/billing-message`, { kind: 'reminder' });
  check('reminder sent', sent.ok, sent.data?.status);
  check('reminder is in the WhatsApp outbox', /0780 111222/.test(await lastOutbound(phone)));
  const fin = await api('POST', `/revenue/agents/${agent.id}/billing-message`, { kind: 'final_reminder' });
  check('final reminder allowed at 10 days overdue', fin.ok, fin.error || fin.data?.status);

  console.log('\n3. Take down (saved, not deleted)');
  const down = await api('POST', `/revenue/agents/${agent.id}/take-down`);
  check('take-down hides 2 listings', down.data?.listings_hidden === 2, JSON.stringify(down.data || down.error).slice(0, 120));
  const afterDown = (await pool.query(`SELECT id, status FROM properties WHERE id = ANY($1::uuid[])`, [[p1, p2]])).rows;
  check('listings hidden', afterDown.every((r) => r.status === 'hidden'));

  console.log('\n4. Paused agent writes in');
  const paused = await inbound(phone, 'Hello, I have a new house in Kira');
  check('bot says paused + gives Ronald’s number', /paus|taken down|call/i.test(paused) && /0709|709402189|Ronald/i.test(paused), paused.replace(/\n/g, ' ').slice(0, 140));

  console.log('\n5. “I have paid” → SMS match → confirm');
  const claimReply = await inbound(phone, `I have paid 50000 transaction id ${txid}`);
  check('bot acknowledges the transaction ID', claimReply.includes(txid), claimReply.replace(/\n/g, ' ').slice(0, 140));
  const sms = await fetch(`${BASE}/api/money-sms/inbound`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-money-sms-token': SMS_TOKEN },
    body: JSON.stringify({ sender: 'MobileMoney', body: `You have received UGX 50,000 from BILLTEST OKELLO (256779000077) on 2026-10-02. Reason: fee. Your new balance:UGX 90,000. Transaction ID: ${txid}.` })
  }).then((r) => r.json());
  check('SMS webhook accepted', sms?.ok === true && !sms.duplicate, JSON.stringify(sms).slice(0, 160));
  const summary = await api('GET', '/revenue/summary');
  const claim = (summary.data.claims || []).find((c) => c.reference === txid);
  check('claim shows ① ID and ② SMS match', claim && claim.sms_id && claim.status === 'pending');
  const conf = await api('POST', `/revenue/claims/${claim?.id}/confirm`, { method: 'mtn_momo', amount: 50000 });
  check('③ confirmed', conf.ok, conf.error || conf.data?.period_end);
  const back = (await pool.query(`SELECT id, status FROM properties WHERE id = ANY($1::uuid[]) ORDER BY title`, [[p1, p2]])).rows;
  check('listings restored exactly (approved + pending)', back.map((r) => r.status).sort().join() === 'approved,pending', back.map((r) => r.status).join());
  const ag = (await pool.query(`SELECT status, billing_suspended_at, paid_until FROM agents WHERE id = $1`, [agent.id])).rows[0];
  check('agent active again, paid until moved on', ag.status === 'approved' && !ag.billing_suspended_at && String(ag.paid_until.toISOString?.() || ag.paid_until).slice(0, 10) > day(0));
  const entry = (await pool.query(`SELECT verified_status, verification_source FROM revenue_entries WHERE reference = $1`, [txid])).rows[0];
  check('ledger entry verified via sms_match+confirmed', entry?.verification_source === 'sms_match+confirmed');
  const dup = await api('POST', `/revenue/claims/${claim?.id}/confirm`, {});
  check('claim cannot be confirmed twice', dup.status === 409);

  console.log('\n6. Private lister: views message, take down, payment');
  await api('PUT', '/revenue/settings/lister_fee', { value: { ...originalSettings.lister_fee, start_date: '2026-09-01' } });
  const lphone = '256779000078';
  const lp = (await mk('BILLTEST private flat', 'approved', { agentId: null, name: 'Mary Test', phone: lphone, created: new Date(Date.now() - 12 * 86400e3).toISOString() })).rows[0].id;
  const s2 = await api('GET', '/revenue/summary');
  const row = (s2.data.listers || []).find((p) => p.id === lp);
  check('lister shows as due after the free week', row?.billing_state === 'due', row?.billing_state);
  const vprev = await api('GET', `/revenue/listings/${lp}/billing-message/views`);
  check('views preview filled in', /Mary/.test(vprev.data?.text) && !/\{\w+\}/.test(vprev.data?.text), vprev.data?.text?.slice(0, 80));
  await api('POST', `/revenue/listings/${lp}/billing-message`, { kind: 'views', text: 'Hi Mary — edited by Ronald. 12 people looked.' });
  check('edited text is what was sent', /edited by Ronald/.test(await lastOutbound(lphone)));
  const ldown = await api('POST', `/revenue/listings/${lp}/take-down`);
  check('lister listing taken down', ldown.ok && (await pool.query('SELECT status FROM properties WHERE id = $1', [lp])).rows[0].status === 'hidden');
  const lpay = await api('POST', `/revenue/listings/${lp}/payment`, { amount: 25000, method: 'airtel_money', reference: `AT${txid}`, payer_name: 'Mary Test' });
  check('lister payment recorded', lpay.ok, lpay.error || lpay.data?.period_end);
  check('listing back live', (await pool.query('SELECT status FROM properties WHERE id = $1', [lp])).rows[0].status === 'approved');

  console.log('\n7. Absa USD + statement reconciliation');
  const usd = await api('POST', '/revenue/entries', { direction: 'in', kind: 'other_income', method: 'absa_usd', amount_original: '100', fx_rate_ugx: '3650', reference: `ABS${txid}`, paid_at: day(-1), note: 'USD test' });
  check('USD entry valued in UGX ($100 × 3650)', Number(usd.data?.amount_ugx ?? usd.data?.entry?.amount_ugx) === 365000, JSON.stringify(usd.data || usd.error).slice(0, 120));
  const csv = `Date,Description,Reference,Amount,Balance\n${day(-1)},TRANSFER IN ABS${txid},ABS${txid},100.00,1100.00\n${day(-1)},BANK CHARGE,,-2.50,1097.50\n`;
  const st = await api('POST', '/revenue/statements', { account_key: 'absa_usd', csv });
  check('statement matched the USD entry', st.data?.matched === 1, JSON.stringify({ m: st.data?.matched, read: st.data?.lines_read, e: st.error }));
  check('unrecorded bank charge flagged', (st.data?.unmatched_lines || []).some((l) => /CHARGE/.test(l.description)));

  // restore settings
  await api('PUT', '/revenue/settings/lister_fee', { value: originalSettings.lister_fee });
  await api('PUT', '/revenue/settings/pay_to', { value: originalSettings.pay_to });
  await pool.end();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll billing checks passed');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
