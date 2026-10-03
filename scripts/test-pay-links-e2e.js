#!/usr/bin/env node
// End-to-end check of payment links against a running local server and a mock Revolut.
// Card (webhook and return-page paths), duplicate webhooks, signature check,
// MoMo claim -> confirm closes the link, reminders carry the link, summary shape.
// Usage: BASE=http://localhost:3999 ADMIN_API_KEY=... DATABASE_URL=... REVOLUT_MOCK=http://127.0.0.1:4555 node scripts/test-pay-links-e2e.js
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE = process.env.BASE || 'http://localhost:3999';
const KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
const MOCK = process.env.REVOLUT_MOCK || 'http://127.0.0.1:4555';
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
async function page(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...opts });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}
async function webhook(orderId, { secret, tamper = false } = {}) {
  const body = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: orderId });
  const headers = { 'content-type': 'application/json' };
  if (secret) {
    const ts = String(Date.now());
    const sig = crypto.createHmac('sha256', secret).update(`v1.${ts}.${body}`).digest('hex');
    headers['Revolut-Request-Timestamp'] = ts;
    headers['Revolut-Signature'] = `v1=${tamper ? sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a') : sig}`;
  }
  const res = await fetch(`${BASE}/api/pay/webhooks/revolut`, { method: 'POST', headers, body });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

(async () => {
  const listerPhone = '256779000188';
  await pool.query(`DELETE FROM pay_links`);
  await pool.query(`DELETE FROM billing_settings WHERE key = 'revolut_webhook'`);
  await pool.query(`DELETE FROM payment_claims WHERE source = 'pay_link'`);
  await pool.query(`DELETE FROM revenue_entries WHERE account_key = 'revolut_whispers' OR reference LIKE 'PAYTEST%'`);
  await pool.query(`DELETE FROM properties WHERE title LIKE 'PAYTEST %'`);
  await pool.query(`DELETE FROM agents WHERE whatsapp = '256779000199'`);
  await api('PUT', '/revenue/settings/pay_to', { value: { method: 'MTN Mobile Money', number: '256780863394', name: 'MAKAUG ONLINE REAL ESTATE LTD' } });

  const mk = (title) => pool.query(
    `INSERT INTO properties (listing_type, title, description, district, area, status, lister_name, lister_phone)
     VALUES ('rent', $1, 'test', 'Kampala', 'Ntinda', 'approved', 'Grace Namuli', $2) RETURNING id`, [title, listerPhone]);
  const p1 = (await mk('PAYTEST 2 bed Ntinda')).rows[0].id;
  const p2 = (await mk('PAYTEST studio Kira')).rows[0].id;
  const agent = (await pool.query(
    `INSERT INTO agents (full_name, phone, whatsapp, status, licence_number, fee_exempt, paid_until, monthly_fee_ugx)
     VALUES ('Paytest Agent', '256779000199', '256779000199', 'approved', 'PAY-1', false, (NOW() - INTERVAL '2 days')::date, 50000) RETURNING id`)).rows[0];

  console.log('\n1. Create and send a listing pay link');
  const created = await api('POST', '/revenue/pay-links', { purpose: 'listing_fee', property_id: p1, send_to: '447757773202' });
  const link = created.data?.link || {};
  check('link created', created.ok && /^MK[A-Z0-9]{8}$/.test(link.code || ''), created.error || link.code);
  check('amount is the lister fee', Number(link.amount_ugx) === 20000, String(link.amount_ugx));
  check('card price is UGX / rate, rounded up', link.card_amount_minor === 541 && link.card_currency === 'USD', `${link.card_amount_minor} ${link.card_currency}`);
  check('WhatsApp attempted to the test number', created.data?.sent?.to === '447757773202', JSON.stringify(created.data?.sent));
  const again = await api('POST', '/revenue/pay-links', { purpose: 'listing_fee', property_id: p1 });
  check('second request reuses the open link', again.data?.reused === true && again.data?.link?.code === link.code);

  console.log('\n2. Public page');
  const view = await page(`/pay/${link.code}`);
  check('page loads', view.status === 200, String(view.status));
  check('shows UGX amount, card price and MoMo number', view.text.includes('UGX 20,000') && view.text.includes('$5.41') && view.text.includes('0780 863394'));
  check('page is noindex', view.text.includes('noindex'));
  check('unknown code is 404', (await page('/pay/MKZZZZZZZZ')).status === 404);
  check('nonsense code is 404, not an error', (await page('/pay/%27%3Bdrop')).status === 404);

  console.log('\n3. Card by webhook');
  const go = await page(`/pay/${link.code}/card`, { method: 'POST' });
  check('card button redirects to Revolut checkout', go.status === 303 && String(go.location).startsWith(`${MOCK}/checkout/`), `${go.status} ${go.location}`);
  const orderId = String(go.location).split('/').pop();
  const again2 = await page(`/pay/${link.code}/card`, { method: 'POST' });
  check('pressing again resumes the same order', String(again2.location).endsWith(orderId));
  const early = await webhook(orderId);
  const stillOpen = (await pool.query('SELECT status FROM pay_links WHERE code = $1', [link.code])).rows[0].status;
  check('webhook before payment records nothing', early.status === 200 && stillOpen === 'open', JSON.stringify(early.json));
  await fetch(`${MOCK}/__complete/${orderId}`, { method: 'POST' });
  const hook = await webhook(orderId);
  check('webhook after payment records it', hook.status === 200 && hook.json?.result?.paid === true, JSON.stringify(hook.json));
  const entry = (await pool.query(`SELECT * FROM revenue_entries WHERE reference = $1`, [orderId])).rows;
  check('one ledger entry, Revolut account, verified, USD kept', entry.length === 1 && entry[0].account_key === 'revolut_whispers' && entry[0].verified_status === 'verified' && entry[0].currency === 'USD' && Number(entry[0].amount_original) === 5.41,
    JSON.stringify(entry[0] && { a: entry[0].account_key, v: entry[0].verified_status, c: entry[0].currency, o: entry[0].amount_original, u: entry[0].amount_ugx }));
  check('kind listing_fee linked to the listing', entry[0]?.kind === 'listing_fee' && entry[0]?.property_id === p1);
  const prop = (await pool.query('SELECT lister_paid_until FROM properties WHERE id = $1', [p1])).rows[0];
  check('listing paid-until moved on', Boolean(prop.lister_paid_until));
  await webhook(orderId);
  check('duplicate webhook does not double-record', Number((await pool.query(`SELECT COUNT(*) FROM revenue_entries WHERE reference = $1`, [orderId])).rows[0].count) === 1);
  const paidView = await page(`/pay/${link.code}`);
  check('page now says paid', paidView.text.includes('Paid — thank you'));
  const replay = await page(`/pay/${link.code}/card`, { method: 'POST' });
  check('card button on a paid link does not charge again', replay.status === 303 && String(replay.location).includes('/pay/'), replay.location);

  console.log('\n4. Agent subscription by return page (no webhook)');
  const ag = await api('POST', '/revenue/pay-links', { purpose: 'agent_subscription', agent_id: agent.id });
  const agCode = ag.data?.link?.code;
  check('agent link for UGX 50,000', Number(ag.data?.link?.amount_ugx) === 50000 && ag.data?.link?.card_amount_minor === 1352, `${ag.data?.link?.amount_ugx} ${ag.data?.link?.card_amount_minor}`);
  const agGo = await page(`/pay/${agCode}/card`, { method: 'POST' });
  const agOrder = String(agGo.location).split('/').pop();
  const cancelled = await page(`/pay/${agCode}/return`);
  check('returning without paying shows "not completed"', String(cancelled.location).includes('card_cancelled=1'));
  await fetch(`${MOCK}/__complete/${agOrder}`, { method: 'POST' });
  const back = await page(`/pay/${agCode}/return`);
  check('returning after paying records it', back.status === 303 && !String(back.location).includes('cancelled'), back.location);
  const agRow = (await pool.query('SELECT paid_until FROM agents WHERE id = $1', [agent.id])).rows[0];
  const agEntry = (await pool.query(`SELECT kind, agent_id, verified_status FROM revenue_entries WHERE reference = $1`, [agOrder])).rows[0];
  check('agent paid-until is a month ahead', new Date(agRow.paid_until) > new Date(Date.now() + 25 * 86400e3));
  check('agent entry recorded and verified', agEntry?.kind === 'agent_subscription' && agEntry?.agent_id === agent.id && agEntry?.verified_status === 'verified');

  console.log('\n5. Mobile money from the page');
  const mm = await api('POST', '/revenue/pay-links', { purpose: 'listing_fee', property_id: p2 });
  const mmCode = mm.data?.link?.code;
  const bad = await page(`/pay/${mmCode}/momo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'reference=12' });
  check('too-short transaction ID is refused on the page', bad.status === 200 && bad.text.includes('transaction ID'));
  const txid = `PAYTEST${String(Date.now()).slice(-6)}`;
  const claim = await page(`/pay/${mmCode}/momo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `reference=${txid}` });
  check('"I have paid" accepted', claim.status === 303 && String(claim.location).includes('claimed=1'));
  const claimRow = (await pool.query(`SELECT * FROM payment_claims WHERE reference = $1`, [txid])).rows[0];
  check('claim waits for the usual checks, tied to listing + link', claimRow?.status === 'pending' && claimRow?.property_id === p2 && Boolean(claimRow?.pay_link_id));
  const conf = await api('POST', `/revenue/claims/${claimRow.id}/confirm`, { method: 'mtn_momo' });
  check('confirming the claim works', conf.ok, conf.error);
  const mmLink = (await pool.query('SELECT status, paid_method FROM pay_links WHERE code = $1', [mmCode])).rows[0];
  check('link closes as paid by MoMo', mmLink.status === 'paid' && mmLink.paid_method === 'mtn_momo', JSON.stringify(mmLink));

  console.log('\n6. Reminders carry the link; summary');
  const p3 = (await mk('PAYTEST bedsitter Bweyogerere')).rows[0].id;
  const preview = await api('GET', `/revenue/listings/${p3}/billing-message/reminder`);
  check('lister reminder includes a pay link', /\/pay\/MK[A-Z0-9]{8}/.test(preview.data?.text || ''), (preview.data?.text || '').slice(-90));
  const agPreview = await api('GET', `/revenue/agents/${agent.id}/billing-message/reminder`);
  check('agent reminder includes a pay link', /\/pay\/MK[A-Z0-9]{8}/.test(agPreview.data?.text || ''));
  const sum = await api('GET', '/revenue/summary');
  check('summary lists pay links and card status', Array.isArray(sum.data?.pay_links) && sum.data?.card_payments?.configured === true);
  check('Revolut account shows in accounts', (sum.data?.accounts || []).some((a) => a.key === 'revolut_whispers' && Number(a.money_in) > 0));

  console.log('\n7. Webhook signing');
  const connect = await api('POST', '/revenue/card-payments/connect');
  check('webhook registered with Revolut', connect.ok && connect.data?.configured && /\/api\/pay\/webhooks\/revolut$/.test(connect.data?.url || ''), connect.error || connect.data?.url);
  const sum2 = await api('GET', '/revenue/summary');
  check('signing secret never sent to the browser', !JSON.stringify(sum2.data).includes('whsec_') && sum2.data?.card_payments?.webhook_ready === true);
  const unsigned = await webhook(orderId);
  check('unsigned webhook now refused', unsigned.status === 401, String(unsigned.status));
  const tampered = await webhook(orderId, { secret: 'whsec_mocksecret', tamper: true });
  check('tampered signature refused', tampered.status === 401);
  const signed = await webhook(orderId, { secret: 'whsec_mocksecret' });
  check('correctly signed webhook accepted', signed.status === 200, String(signed.status));

  await pool.end();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll pay-link checks passed');
  process.exit(failures ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
