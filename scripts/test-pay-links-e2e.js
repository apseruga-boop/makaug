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
  await pool.query(`DELETE FROM revenue_entries WHERE reference LIKE 'PAYTESTMM%'`);
  await pool.query(`DELETE FROM revenue_entries WHERE reference LIKE 'PAYTESTST%'`);
  await pool.query(`DELETE FROM agents WHERE whatsapp = '256779000199'`);
  await api('PUT', '/revenue/settings/lister_fee', { value: { free_days: 7, monthly_ugx: 25000, views_message_day: 3, start_date: '2026-10-05' } });
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
  check('amount is the lister fee', Number(link.amount_ugx) === 25000, String(link.amount_ugx));
  check('card price is UGX / rate, rounded up', link.card_amount_minor === 676 && link.card_currency === 'USD', `${link.card_amount_minor} ${link.card_currency}`);
  check('WhatsApp attempted to the test number', created.data?.sent?.to === '447757773202', JSON.stringify(created.data?.sent));
  const again = await api('POST', '/revenue/pay-links', { purpose: 'listing_fee', property_id: p1 });
  check('second request reuses the open link', again.data?.reused === true && again.data?.link?.code === link.code);

  console.log('\n2. Public page');
  const view = await page(`/pay/${link.code}`);
  check('page loads', view.status === 200, String(view.status));
  check('shows UGX amount, card price and MoMo number', view.text.includes('UGX 25,000') && view.text.includes('$6.76') && view.text.includes('0780 863394'));
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
  check('one ledger entry, Revolut account, verified, USD kept', entry.length === 1 && entry[0].account_key === 'revolut_whispers' && entry[0].verified_status === 'verified' && entry[0].currency === 'USD' && Number(entry[0].amount_original) === 6.76,
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

  console.log('\n6b. New agent pays before approval (Ronald\'s journey)');
  await pool.query(`DELETE FROM agents WHERE whatsapp = '256779000211'`);
  await pool.query(`DELETE FROM outbound_message_queue WHERE user_phone LIKE '%779000211'`);
  const newAgent = (await pool.query(
    `INSERT INTO agents (full_name, phone, whatsapp, status, licence_number, fee_exempt) VALUES ('Newbie Agent', '256779000211', '256779000211', 'pending', 'PAY-NEW', false) RETURNING id`)).rows[0];
  const gate = await api('PATCH', `/agents/${newAgent.id}/status`, { status: 'approved' });
  check('approving an unpaid new agent asks for payment', gate.status === 402 && gate.error === 'payment_required', `${gate.status} ${gate.error}`);
  const naLink = await api('POST', '/revenue/pay-links', { purpose: 'agent_subscription', agent_id: newAgent.id, send_to: '256779000211' });
  check('Ronald can send the new agent a pay link', naLink.ok && /\/pay\/MK/.test(naLink.data?.url || '') && naLink.data?.sent?.to === '256779000211', naLink.error);
  const naGo = await page(`/pay/${naLink.data.link.code}/card`, { method: 'POST' });
  const naOrder = String(naGo.location).split('/').pop();
  await fetch(`${MOCK}/__complete/${naOrder}`, { method: 'POST' });
  await webhook(naOrder);
  const na = (await pool.query('SELECT status, paid_until, paid_awaiting_approval_at FROM agents WHERE id = $1', [newAgent.id])).rows[0];
  check('paid new agent stays pending but is flagged "paid — ready to approve"', na.status === 'pending' && na.paid_until && na.paid_awaiting_approval_at, JSON.stringify(na));
  const naMsg = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE user_phone LIKE '%779000211' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('agent is told payment received and checks are being finished (not "live again")', /Payment received/.test(naMsg) && /finishing your checks/.test(naMsg) && !/live again/.test(naMsg), naMsg.slice(0, 120));
  const teamMsg = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE payload->>'text' LIKE '%ready to approve%' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('team is told the new agent paid and can be approved', /Newbie Agent/.test(teamMsg), teamMsg.slice(0, 80) || '(no team recipients configured in test env)');
  const approve = await api('PATCH', `/agents/${newAgent.id}/status`, { status: 'approved' });
  const na2 = (await pool.query('SELECT status, paid_awaiting_approval_at FROM agents WHERE id = $1', [newAgent.id])).rows[0];
  check('approving now goes straight through without asking for payment again', approve.ok && na2.status === 'approved' && !na2.paid_awaiting_approval_at, approve.error);

  console.log('\n6c. Short stay: fee asked for on approval, card closes the loop');
  await pool.query(`DELETE FROM st_listing WHERE reference LIKE 'PAYTEST-ST%'`);
  const st = (await pool.query(
    `INSERT INTO st_listing (reference, slug, title, description, district, area, base_nightly_ugx, host_name, host_phone)
     VALUES ('PAYTEST-ST1', 'paytest-st1-${Date.now()}', 'Lakeview cottage', 'test', 'Wakiso', 'Entebbe', 150000, 'Host Harriet', '256779000222') RETURNING id`)).rows[0];
  const stLink = await api('POST', '/revenue/pay-links', { purpose: 'short_term_fee', st_listing_id: st.id, send_to: '256779000222' });
  check('short-stay link is UGX 50,000 for the listing', stLink.ok && Number(stLink.data?.link?.amount_ugx) === 50000 && /short stay/.test(stLink.data?.link?.description || ''), stLink.error || stLink.data?.link?.description);
  const stGo = await page(`/pay/${stLink.data.link.code}/card`, { method: 'POST' });
  const stOrder = String(stGo.location).split('/').pop();
  await fetch(`${MOCK}/__complete/${stOrder}`, { method: 'POST' });
  await webhook(stOrder);
  const stRow = (await pool.query('SELECT listing_fee_status, expires_at FROM st_listing WHERE id = $1', [st.id])).rows[0];
  const stPay = (await pool.query(`SELECT status, method FROM st_listing_payment WHERE listing_id = $1`, [st.id])).rows[0];
  const stEntry = (await pool.query(`SELECT kind, account_key, st_listing_id, verified_status FROM revenue_entries WHERE reference = $1`, [stOrder])).rows[0];
  check('listing marked paid with 3 months from today', stRow.listing_fee_status === 'paid' && new Date(stRow.expires_at) > new Date(Date.now() + 85 * 86400e3), JSON.stringify(stRow));
  check('short-stay payment record shows card, paid', stPay?.status === 'paid' && stPay?.method === 'card', JSON.stringify(stPay));
  check('ledger entry: short_term_fee, Revolut, verified, linked', stEntry?.kind === 'short_term_fee' && stEntry?.account_key === 'revolut_whispers' && stEntry?.st_listing_id === st.id && stEntry?.verified_status === 'verified', JSON.stringify(stEntry));
  const again3 = await api('POST', '/revenue/pay-links', { purpose: 'short_term_fee', st_listing_id: st.id });
  check('no second link once the fee is paid', again3.status === 409, String(again3.status));

  console.log('\n6d. Short stay paid by MoMo from the link');
  const st2 = (await pool.query(
    `INSERT INTO st_listing (reference, slug, title, description, district, area, base_nightly_ugx, host_name, host_phone)
     VALUES ('PAYTEST-ST2', 'paytest-st2-${Date.now()}', 'Garden studio', 'test', 'Kampala', 'Muyenga', 90000, 'Host Ivan', '256779000233') RETURNING id`)).rows[0];
  const st2Link = await api('POST', '/revenue/pay-links', { purpose: 'short_term_fee', st_listing_id: st2.id });
  const stTx = `PAYTESTST${String(Date.now()).slice(-6)}`;
  await page(`/pay/${st2Link.data.link.code}/momo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `reference=${stTx}` });
  const stClaim = (await pool.query(`SELECT * FROM payment_claims WHERE reference = $1`, [stTx])).rows[0];
  check('MoMo claim is tied to the short stay', stClaim?.st_listing_id === st2.id && stClaim?.purpose === 'short_term_fee');
  const stConf = await api('POST', `/revenue/claims/${stClaim.id}/confirm`, { method: 'mtn_momo' });
  const st2Row = (await pool.query('SELECT listing_fee_status FROM st_listing WHERE id = $1', [st2.id])).rows[0];
  const st2Entry = (await pool.query(`SELECT kind, account_key FROM revenue_entries WHERE reference = $1`, [stTx])).rows[0];
  check('confirming it marks the short stay paid and records it under MoMo', stConf.ok && st2Row.listing_fee_status === 'paid' && st2Entry?.kind === 'short_term_fee' && st2Entry?.account_key === 'mtn_momo', stConf.error || JSON.stringify(st2Entry));

  console.log('\n6e. Ronald sets up an agent on WhatsApp');
  const RONALD = '256709402189';
  const NEWBIE = '256779000244';
  async function bridge(fromPhone, body) {
    const res = await fetch(`${BASE}/api/whatsapp/web-bridge/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whatsapp-web-bridge-token': process.env.WHATSAPP_WEB_BRIDGE_TOKEN || 'bridge-test' },
      body: JSON.stringify({ phone: fromPhone, body, message_id: `paycmd-${Date.now()}-${Math.random()}`, created_at: new Date().toISOString(), metadata: {} })
    });
    return (await res.json().catch(() => ({})))?.data?.message || '';
  }
  await pool.query(`DELETE FROM agents WHERE whatsapp = $1`, [NEWBIE]);
  await pool.query(`DELETE FROM outbound_message_queue WHERE user_phone LIKE '%779000244' OR user_phone LIKE '%709402189'`);
  const help = await bridge(RONALD, 'PAYMENT HELP');
  check('Ronald can ask for the commands', /NEW AGENT/.test(help) && /APPROVE/.test(help), help.slice(0, 60));
  const setup = await bridge(RONALD, 'NEW AGENT Grace Nambi 0779 000244');
  check('NEW AGENT creates the pending agent and returns a pay link', /set up as a pending agent/.test(setup) && /\/pay\/MK/.test(setup), setup.slice(0, 140));
  const ga = (await pool.query(`SELECT id, full_name, status FROM agents WHERE whatsapp = $1`, [NEWBIE])).rows[0];
  check('agent record: Grace Nambi, pending', ga?.full_name === 'Grace Nambi' && ga?.status === 'pending', JSON.stringify(ga));
  const toAgent = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE user_phone LIKE '%779000244' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('the agent got the pay link on WhatsApp', /\/pay\/MK/.test(toAgent) && /UGX 50,000/.test(toAgent), toAgent.slice(0, 80));
  const st1 = await bridge(RONALD, 'STATUS 0779000244');
  check('STATUS says not paid yet', /not paid yet/.test(st1), st1.slice(0, 120));
  const early2 = await bridge(RONALD, 'APPROVE 0779000244');
  check("APPROVE refuses before payment", /hasn't paid/.test(early2), early2.slice(0, 80));
  const stranger = await bridge('256779000255', 'STATUS 0779000244');
  check('a non-team number cannot run commands', !/not paid yet|Grace Nambi/.test(stranger), stranger.slice(0, 80));
  const gLinkCode = (setup.match(/\/pay\/(MK[A-Z0-9]{8})/) || [])[1];
  const gGo = await page(`/pay/${gLinkCode}/card`, { method: 'POST' });
  const gOrder = String(gGo.location).split('/').pop();
  await fetch(`${MOCK}/__complete/${gOrder}`, { method: 'POST' });
  await webhook(gOrder);
  const toRonald = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE user_phone LIKE '%709402189' AND payload->>'text' LIKE '%ready to approve%' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('Ronald is WhatsApped that Grace paid, with the APPROVE command', /Grace Nambi/.test(toRonald) && /APPROVE/.test(toRonald), toRonald.slice(0, 120));
  const st2b = await bridge(RONALD, 'STATUS 0779000244');
  check('STATUS now shows paid and ready to approve', /paid until/.test(st2b) && /APPROVE/.test(st2b), st2b.slice(0, 160));
  const ok2 = await bridge(RONALD, 'APPROVE 0779000244');
  const ga2 = (await pool.query(`SELECT status FROM agents WHERE whatsapp = $1`, [NEWBIE])).rows[0];
  check('APPROVE approves her and sends the welcome pack', /is approved/.test(ok2) && ga2.status === 'approved', ok2.slice(0, 160));

  console.log('\n6f. Advertising checks out with a pay link (no Flutterwave)');
  const camp = (await pool.query(`INSERT INTO advertising_campaigns (advertiser_name, campaign_name) VALUES ('Paytest Ads Ltd', 'PAYTEST banner') RETURNING id`)).rows[0];
  const inv = (await pool.query(`INSERT INTO invoices (invoice_number, campaign_id, amount, currency, status) VALUES ($1, $2, 150000, 'UGX', 'issued') RETURNING id`, [`PAYTEST-INV-${Date.now()}`, camp.id])).rows[0];
  const { createHostedPayment } = require('../services/paymentProviderService');
  const dbx = require('../config/database');
  const hosted = await createHostedPayment(dbx, { purpose: 'advertising_campaign', amount: 150000, currency: 'UGX', payer: { name: 'Paytest Ads', phone: '256779000266' }, metadata: { campaign_id: camp.id, invoice_id: inv.id } });
  check('advertising checkout is a makaug pay link', hosted.provider === 'makaug_pay_link' && /\/pay\/MK/.test(hosted.checkoutUrl || ''), hosted.checkoutUrl);
  const adCode = hosted.checkoutUrl.split('/pay/')[1];
  const adPage = await page(`/pay/${adCode}`);
  check('the page shows UGX 150,000', adPage.text.includes('UGX 150,000'));
  const adGo = await page(`/pay/${adCode}/card`, { method: 'POST' });
  const adOrder = String(adGo.location).split('/').pop();
  await fetch(`${MOCK}/__complete/${adOrder}`, { method: 'POST' });
  await webhook(adOrder);
  const campRow = (await pool.query('SELECT payment_status, status FROM advertising_campaigns WHERE id = $1', [camp.id])).rows[0];
  const invRow = (await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])).rows[0];
  const payRow = (await pool.query('SELECT status FROM payments WHERE id = $1', [hosted.payment.id])).rows[0];
  const adEntry = (await pool.query(`SELECT kind, account_key FROM revenue_entries WHERE reference = $1`, [adOrder])).rows[0];
  check('campaign, invoice and payment all marked paid', campRow.payment_status === 'paid' && invRow.status === 'paid' && payRow.status === 'paid', JSON.stringify({ campRow, invRow, payRow }));
  check('ledger entry kind advertising under Revolut', adEntry?.kind === 'advertising' && adEntry?.account_key === 'revolut_whispers', JSON.stringify(adEntry));
  const oldHook = await fetch(`${BASE}/api/monetization/payments/webhook/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { tx_ref: hosted.payment.checkout_reference, status: 'successful' } }) });
  check('the old gateway webhook can no longer mark anything paid', oldHook.status === 401 || oldHook.status >= 400, String(oldHook.status));

  console.log('\n6g. Free by rule: old agents and found-online listings are never charged');
  await pool.query(`DELETE FROM agents WHERE whatsapp = '256779000277'`);
  const oldAgent = (await pool.query(
    `INSERT INTO agents (full_name, phone, whatsapp, status, licence_number, fee_exempt, fee_exempt_reason) VALUES ('Old Timer', '256779000277', '256779000277', 'approved', 'OLD-1', true, 'Approved before the monthly fee started') RETURNING id`)).rows[0];
  const oldLink = await api('POST', '/revenue/pay-links', { purpose: 'agent_subscription', agent_id: oldAgent.id });
  check('no pay link can be made for an agent who joined before the fee', oldLink.status === 409 && /lists for free/.test(oldLink.error || ''), `${oldLink.status} ${oldLink.error}`);
  const oldCmd = await bridge(RONALD, 'PAY LINK 0779000277');
  check('Ronald is told the old agent lists for free', /list for free/.test(oldCmd), oldCmd.slice(0, 100));
  const fo = (await pool.query(
    `INSERT INTO properties (listing_type, title, description, district, area, status, lister_name, lister_phone, source, listed_via, created_at)
     VALUES ('rent', 'PAYTEST found online flat', 'test', 'Kampala', 'Kololo', 'approved', 'TikTok poster', '256779000288', 'found_online_property_source_v1', 'found_online', NOW() - INTERVAL '12 days') RETURNING id`)).rows[0];
  const foLink = await api('POST', '/revenue/pay-links', { purpose: 'listing_fee', property_id: fo.id });
  check('no pay link for a found-online listing', foLink.status === 409 && /Found-online/.test(foLink.error || ''), `${foLink.status} ${foLink.error}`);
  const foMsg = await api('POST', `/revenue/listings/${fo.id}/billing-message`, { kind: 'reminder' });
  check('no fee reminder can be sent for a found-online listing', foMsg.status === 409, String(foMsg.status));
  const foSum = await api('GET', '/revenue/summary');
  check('found-online listings never appear in the fee list', !(foSum.data?.listers || []).some((l) => l.id === fo.id));
  const foCmd = await bridge(RONALD, 'PAY LINK 0779000288');
  check('PAY LINK by phone ignores found-online listings', /Nobody on/.test(foCmd), foCmd.slice(0, 80));

  console.log('\n6h. Free week ends: reminder with link goes by itself, once');
  await api('PUT', '/revenue/settings/lister_fee', { value: { free_days: 7, monthly_ugx: 25000, views_message_day: 3, start_date: '2026-09-01' } });
  const dueP = (await pool.query(
    `INSERT INTO properties (listing_type, title, description, district, area, status, lister_name, lister_phone, created_at, reviewed_at)
     VALUES ('rent', 'PAYTEST due bedsitter', 'test', 'Wakiso', 'Kira', 'approved', 'Due Daisy', '256779000299', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days') RETURNING id`)).rows[0];
  await pool.query(`DELETE FROM outbound_message_queue WHERE user_phone LIKE '%779000299'`);
  // Run the scheduler the way the server does: messages go to the WhatsApp queue.
  process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';
  process.env.WHATSAPP_WEB_BRIDGE_ENABLED = 'true';
  const billing = require('../services/billingOpsService');
  const dbx2 = require('../config/database');
  const run1 = await billing.runListerDueReminders(dbx2);
  const dueMsg = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE user_phone LIKE '%779000299' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('lister whose free week ended gets the reminder with a pay link and UGX 25,000', /free week/.test(dueMsg) && /\/pay\/MK/.test(dueMsg) && /25,000/.test(dueMsg), dueMsg.slice(0, 160));
  await billing.runListerDueReminders(dbx2);
  const dueCount = Number((await pool.query(`SELECT COUNT(*) FROM outbound_message_queue WHERE user_phone LIKE '%779000299'`)).rows[0].count);
  check('it is only sent once', dueCount === 1, String(dueCount));
  check('found-online listing was not reminded', !(run1.sent || []).some((x) => x.id === fo.id));

  console.log('\n6i. Confirmations close the loop');
  const cardTeam = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE payload->>'text' LIKE '%Card payment received%' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('team is told about card payments', /Card payment received/.test(cardTeam), cardTeam.slice(0, 80));
  await pool.query(`DELETE FROM agents WHERE whatsapp = '256779000311'`);
  const mmAgent = (await pool.query(`INSERT INTO agents (full_name, phone, whatsapp, status, licence_number, fee_exempt) VALUES ('Momo Pending', '256779000311', '256779000311', 'pending', 'MM-1', false) RETURNING id`)).rows[0];
  const mmL = await api('POST', '/revenue/pay-links', { purpose: 'agent_subscription', agent_id: mmAgent.id });
  const mmTx = `PAYTESTMM${String(Date.now()).slice(-6)}`;
  await page(`/pay/${mmL.data.link.code}/momo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `reference=${mmTx}` });
  const mmClaim = (await pool.query(`SELECT id FROM payment_claims WHERE reference = $1`, [mmTx])).rows[0];
  await api('POST', `/revenue/claims/${mmClaim.id}/confirm`, { method: 'mtn_momo' });
  const mmMsgs = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE user_phone LIKE '%779000311' ORDER BY created_at`)).rows.map((r) => r.t).join(' || ');
  check('pending agent paying by MoMo is told "finishing your checks", never "live again"', /finishing your checks/.test(mmMsgs) && !/live again/.test(mmMsgs), mmMsgs.slice(-160));
  const stHostMsg = (await pool.query(`SELECT payload->>'text' AS t FROM outbound_message_queue WHERE user_phone LIKE '%779000233' AND payload->>'text' LIKE '%Payment received%' ORDER BY created_at DESC LIMIT 1`)).rows[0]?.t || '';
  check('short-stay host paying by MoMo gets a payment-received message', /Payment received/.test(stHostMsg), stHostMsg.slice(0, 100) || '(none)');

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
