'use strict';

/**
 * Fees run by people, remembered by the machine.
 *
 * Nothing here takes anyone down on its own. Admins press the buttons: send a
 * reminder, send the final reminder (after 7 days overdue), take the listings
 * down. What the machine does is remember: which reminders went, what was
 * hidden, and put everything back exactly as it was the moment they pay.
 *
 * "I have paid" messages become payment claims that go through three checks
 * before any money counts: the transaction ID is read (typed, or read by AI
 * from the screenshot), the wallet's own SMS shows the same ID, and Ronald or
 * Arthur confirms it.
 */

const logger = require('../config/logger');
const revenue = require('./revenueService');
const { agentGreetingName } = require('./agentNameService');

const SITE = () => String(process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
let settingsCache = { at: 0, value: null };

async function getSettings(db, { fresh = false } = {}) {
  if (!fresh && settingsCache.value && Date.now() - settingsCache.at < 60_000) return settingsCache.value;
  const rows = (await db.query('SELECT key, value FROM billing_settings')).rows;
  const value = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  settingsCache = { at: Date.now(), value };
  return value;
}

async function setSetting(db, key, value, actor = 'admin') {
  const allowed = new Set(['pay_to', 'confirmers', 'agent_fee', 'lister_fee', 'lister_views_message', 'card_payments']);
  if (!allowed.has(key)) throw revenue.httpError(400, 'Unknown setting');
  await db.query(
    `INSERT INTO billing_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, JSON.stringify(value), actor]
  );
  settingsCache = { at: 0, value: null };
}

/** "MTN Mobile Money 0780 863394 (MAKAUG ONLINE REAL ESTATE LTD)", or '' until it is set. */
function payToLine(settings = {}) {
  const p = settings.pay_to || {};
  const number = String(p.number || '').trim();
  const name = String(p.name || '').trim();
  if (!number || !name) return '';
  return `${String(p.method || 'MTN Mobile Money').trim()} *${number}* (${name})`;
}

function ugx(n) {
  return `UGX ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
}

function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(`${revenue.isoDay(iso)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function helpContact() {
  const name = String(process.env.AGENT_HELP_CONTACT_NAME || 'Ronald').trim();
  const digits = String(process.env.AGENT_HELP_CONTACT_PHONE || '+256709402189').replace(/\D+/g, '');
  const pretty = digits.length === 12 && digits.startsWith('256') ? `+256 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}` : `+${digits}`;
  return { name, digits, pretty };
}

// --- Agent messages ---------------------------------------------------------

const AGENT_MESSAGE_KINDS = ['pre_due', 'due_today', 'reminder', 'final_reminder', 'taken_down', 'reinstated'];

function payLinkLine(payLink) {
  return payLink ? `💳 Pay by card, Apple Pay, Google Pay or MoMo here: ${payLink}` : '';
}

const PAY_LINK_KINDS = new Set(['pre_due', 'due_today', 'reminder', 'final_reminder', 'taken_down', 'views']);

/** A pay link for this reminder, or '' if one cannot be made right now. */
async function payLinkFor(db, input) {
  try {
    const { createPayLink } = require('./payLinkService');
    const { url } = await createPayLink(db, input, 'billing');
    return url;
  } catch (error) {
    logger.warn('Could not attach a pay link', { error: error.message });
    return '';
  }
}

function buildAgentBillingMessage(kind, { agent = {}, settings = {}, payLink = '' } = {}) {
  const name = agentGreetingName(agent, 'there');
  const fee = Number(settings.agent_fee?.monthly_ugx || agent.monthly_fee_ugx || 50000);
  const pay = payToLine(settings);
  const due = agent.paid_until ? prettyDate(agent.paid_until) : '';
  const help = helpContact();
  const howToPay = [
    pay ? `Pay ${ugx(fee)} to ${pay}, then reply here with the *transaction ID* (or a screenshot of the payment).` : '',
    payLinkLine(payLink)
  ].filter(Boolean).join('\n');
  switch (kind) {
    case 'pre_due':
      return [`Hi ${name} 👋`, '', (due ? `Your makaug agent subscription renews on *${due}*.` : `Your makaug agent subscription (${ugx(fee)} a month) is due.`), howToPay, '', 'Your profile and listings stay live without a break. Thank you for being with makaug!'].filter((l) => l !== '').join('\n');
    case 'due_today':
      return [`Hi ${name} 👋`, '', `Your makaug agent subscription (${ugx(fee)} a month) is due *today*.`, howToPay, '', 'Thank you!'].filter((l) => l !== '').join('\n');
    case 'reminder':
      return [`Hi ${name},`, '', (due ? `A reminder that your makaug subscription was due on *${due}* and we have not received it yet.` : `A reminder that your makaug subscription (${ugx(fee)} a month) is due and we have not received it yet.`), howToPay, '', `Already paid? Just send the transaction ID here and we will check it. Questions: ${help.name} on ${help.pretty}.`].filter((l) => l !== '').join('\n');
    case 'final_reminder':
      return [`Hi ${name},`, '', (due ? `*Final reminder* — your makaug subscription was due on *${due}*.` : '*Final reminder* — your makaug subscription has not been paid yet.'), howToPay, '', 'If we do not receive it, your listings will be taken off makaug. Nothing is deleted — the moment you pay, everything comes back exactly as it was.', '', `Need to talk? ${help.name}: ${help.pretty}.`].filter((l) => l !== '').join('\n');
    case 'taken_down':
      return [`Hi ${name},`, '', 'Your makaug profile and listings are *paused* because the monthly subscription has not been paid.', '', 'Nothing has been deleted. As soon as you pay, everything goes back live exactly as it was.', howToPay, '', `Please call or WhatsApp *${help.name}* on *${help.pretty}* and we will help you.`].filter((l) => l !== '').join('\n');
    case 'reinstated':
      return [`✅ *Payment received — thank you, ${name}!*`, '', `Your makaug profile and all your listings are live again${agent.paid_until ? `, paid until *${prettyDate(agent.paid_until)}*` : ''}.`, '', 'Send new properties here any time, the same way as before.'].join('\n');
    default:
      return '';
  }
}

async function deliver(to, body, kind, nonce) {
  const handoff = require('./leadHandoffService');
  return handoff.deliverWhatsapp({ to, body, kind, leadId: null, nonce });
}

async function loadAgent(db, agentId) {
  return (await db.query(
    `SELECT id, full_name, greeting_name, phone, whatsapp, status, paid_until, fee_exempt, monthly_fee_ugx,
            billing_reminder_log, billing_suspended_at, billing_snapshot, removed_at
       FROM agents WHERE id = $1::uuid`,
    [agentId]
  )).rows[0];
}

function daysOverdue(agent, today = revenue.kampalaDate()) {
  if (!agent?.paid_until) return 0;
  const paid = revenue.isoDay(agent.paid_until);
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${paid}T00:00:00Z`)) / 86400000;
  return Math.max(0, Math.floor(diff));
}

/** Send one of the agent billing messages, and remember that it went. */
async function sendAgentBillingMessage(db, { agentId, kind, actor = 'admin', force = false }) {
  if (!AGENT_MESSAGE_KINDS.includes(kind)) throw revenue.httpError(400, 'Unknown message');
  const agent = await loadAgent(db, agentId);
  if (!agent) throw revenue.httpError(404, 'Agent not found');
  const settings = await getSettings(db, { fresh: true });
  if (['pre_due', 'due_today', 'reminder', 'final_reminder'].includes(kind) && !payToLine(settings)) {
    throw revenue.httpError(409, 'Set the pay-to number and registered name first (Sales & Revenue › Settings). Reminders tell agents where to pay.');
  }
  const settingsFee = settings.agent_fee || {};
  if (kind === 'final_reminder' && !force && daysOverdue(agent) < Number(settingsFee.final_after_days_overdue || 7)) {
    throw revenue.httpError(409, `The final reminder unlocks ${Number(settingsFee.final_after_days_overdue || 7)} days after the due date (this agent is ${daysOverdue(agent)} day(s) overdue).`);
  }
  const to = String(agent.whatsapp || agent.phone || '').replace(/\D+/g, '');
  if (to.length < 9) throw revenue.httpError(400, 'This agent has no WhatsApp number');
  const payLink = PAY_LINK_KINDS.has(kind) ? await payLinkFor(db, { purpose: 'agent_subscription', agent_id: agent.id }) : '';
  const body = buildAgentBillingMessage(kind, { agent, settings, payLink });
  const periodKey = `${kind}:${agent.paid_until ? revenue.isoDay(agent.paid_until) : 'none'}`;
  const delivery = await deliver(to, body, `agent_billing_${kind}`, `${agent.id}:${periodKey}:${force ? Date.now() : ''}`);
  await db.query(
    `UPDATE agents SET billing_reminder_log = COALESCE(billing_reminder_log, '{}'::jsonb) || jsonb_build_object($2::text, jsonb_build_object('at', NOW()::text, 'by', $3::text, 'status', $4::text))
      WHERE id = $1::uuid`,
    [agent.id, periodKey, actor, delivery.status || 'unknown']
  );
  return { kind, to, status: delivery.status, text: body };
}

/** Take an overdue agent's listings down. Remembered, so paying puts it all back. */
async function takeDownAgentForBilling(db, { agentId, actor = 'admin' }) {
  const client = await db.getClient();
  let agent;
  let hidden = [];
  try {
    await client.query('BEGIN');
    agent = (await client.query('SELECT id, status, billing_suspended_at, fee_exempt FROM agents WHERE id = $1::uuid FOR UPDATE', [agentId])).rows[0];
    if (!agent) throw revenue.httpError(404, 'Agent not found');
    if (agent.billing_suspended_at) throw revenue.httpError(409, 'Already taken down');
    if (agent.fee_exempt) throw revenue.httpError(409, 'This agent lists for free');
    hidden = (await client.query(
      `UPDATE properties p SET status = 'hidden', updated_at = NOW()
         FROM (SELECT id, status FROM properties WHERE agent_id = $1::uuid AND status IN ('approved', 'pending') FOR UPDATE) old
        WHERE p.id = old.id
        RETURNING p.id, old.status AS previous_status`,
      [agentId]
    )).rows;
    await client.query(
      `UPDATE agents SET billing_suspended_at = NOW(), status = 'suspended',
              billing_snapshot = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [agentId, JSON.stringify({ previous_status: agent.status, listings: hidden, by: actor, at: new Date().toISOString() })]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const notice = await sendAgentBillingMessage(db, { agentId, kind: 'taken_down', actor }).catch((error) => ({ error: error.message }));
  return { listings_hidden: hidden.length, notice };
}

/** Everything back exactly as it was. Called automatically when a payment is recorded. */
async function reinstateAgentAfterPayment(db, { agentId, actor = 'payment' }) {
  const agent = await loadAgent(db, agentId);
  if (!agent?.billing_suspended_at) return { reinstated: false };
  const snap = agent.billing_snapshot || {};
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const item of Array.isArray(snap.listings) ? snap.listings : []) {
      await client.query(`UPDATE properties SET status = $2, updated_at = NOW() WHERE id = $1 AND status = 'hidden'`, [item.id, item.previous_status]);
    }
    await client.query(
      `UPDATE agents SET billing_suspended_at = NULL, billing_snapshot = NULL,
              status = $2, updated_at = NOW() WHERE id = $1::uuid`,
      [agentId, ['approved', 'pending'].includes(snap.previous_status) ? snap.previous_status : 'approved']
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const notice = await sendAgentBillingMessage(db, { agentId, kind: 'reinstated', actor, force: true }).catch((error) => ({ error: error.message }));
  return { reinstated: true, listings_restored: (snap.listings || []).length, notice };
}

/** Daily: remind agents a few days before their month ends, and on the day. */
async function runAgentFeeReminders(db) {
  const settings = await getSettings(db, { fresh: true });
  if (!payToLine(settings)) return { skipped: 'pay_to_not_set' };
  const days = Math.max(1, Number(settings.agent_fee?.remind_days_before || 3));
  const today = revenue.kampalaDate();
  const ahead = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const due = (await db.query(
    `SELECT id, paid_until, billing_reminder_log FROM agents
      WHERE status = 'approved' AND removed_at IS NULL AND billing_suspended_at IS NULL AND NOT fee_exempt
        AND paid_until IN ($1::date, $2::date)`,
    [ahead, today]
  )).rows;
  const sent = [];
  for (const row of due) {
    const paid = revenue.isoDay(row.paid_until);
    const kind = paid === today ? 'due_today' : 'pre_due';
    if (row.billing_reminder_log?.[`${kind}:${paid}`]) continue;
    try {
      const r = await sendAgentBillingMessage(db, { agentId: row.id, kind, actor: 'scheduler' });
      sent.push({ id: row.id, kind, status: r.status });
    } catch (error) {
      logger.warn('Agent fee reminder failed', { agentId: row.id, error: error.message });
    }
  }
  return { sent };
}

// --- Payment claims ---------------------------------------------------------

const PAID_WORDS = /\b(?:paid|i have paid|i've paid|have sent|sent (?:the )?(?:money|payment)|payment|transaction|txn|trans id|tid|momo|mobile money|airtel money|receipt|deposit(?:ed)?|nsasudde|nsindise|nimelipa|nimetuma)\b/i;
const ID_TOKEN = /\b(?=[A-Z0-9.]*\d)[A-Z0-9][A-Z0-9.]{7,30}\b/i;

/** The transaction ID in "Paid. ID 21234567890" or a pasted MoMo SMS, if any. */
function readReferenceFromText(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const parsed = revenue.parseMoneySms(clean, '');
  const looksLikeMoneySms = /\b(?:you have received|you have sent|new balance|financial transaction|transaction id|trans(?:action)? id|tid)\b/i.test(clean);
  if (parsed.reference && looksLikeMoneySms) return { reference: parsed.reference, amount_ugx: parsed.amount_ugx || null, source: 'sms_text' };
  if (!PAID_WORDS.test(clean)) return null;
  const tokens = clean.toUpperCase().match(new RegExp(ID_TOKEN.source, 'gi')) || [];
  // Phone numbers are not transaction IDs.
  const candidate = tokens.find((t) => !/^(?:256|0)?7\d{8}$/.test(t.replace(/\D/g, '')) && t.replace(/\D/g, '').length >= 6);
  if (!candidate) return null;
  const amount = clean.match(/(?:UGX|USH|SHS?)\s*([\d,]+)|([\d,]{5,})\s*(?:UGX|USH|SHS?)/i);
  return { reference: candidate.replace(/\.+$/, ''), amount_ugx: amount ? Number(String(amount[1] || amount[2]).replace(/,/g, '')) : null, source: 'typed' };
}

/** Who is this payment from, and what is it for? */
async function payerContext(db, phone) {
  const key = String(phone || '').replace(/\D+/g, '').slice(-9);
  if (key.length < 9) return {};
  const agent = (await db.query(
    `SELECT id, full_name, greeting_name, status, paid_until, fee_exempt, billing_suspended_at, removed_at
       FROM agents
      WHERE RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1
         OR RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1
      ORDER BY (status = 'approved') DESC, updated_at DESC LIMIT 1`,
    [key]
  )).rows[0];
  if (agent) return { agent, purpose: 'agent_subscription' };
  const property = (await db.query(
    `SELECT id, title, lister_paid_until FROM properties
      WHERE agent_id IS NULL AND RIGHT(REGEXP_REPLACE(COALESCE(lister_phone, ''), '[^0-9]', '', 'g'), 9) = $1
        AND status IN ('approved', 'pending', 'hidden')
      ORDER BY updated_at DESC LIMIT 1`,
    [key]
  )).rows[0];
  if (property) return { property, purpose: 'listing_fee' };
  return {};
}

/** Is this person someone we are waiting on for money? (So their photos are worth reading as receipts.) */
async function expectingPaymentFrom(db, phone) {
  const ctx = await payerContext(db, phone);
  if (ctx.agent) {
    const a = ctx.agent;
    if (a.fee_exempt) return null;
    if (a.billing_suspended_at || a.status === 'pending') return ctx;
    const overdue = daysOverdue(a) > 0;
    const soon = a.paid_until && revenue.isoDay(a.paid_until) <= new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    return overdue || soon ? ctx : null;
  }
  if (ctx.property) return ctx;
  return null;
}

async function createClaim(db, { phone, payerName = null, reference = null, amountUgx = null, receiptUrl = null, message = '', aiReading = null, source = 'whatsapp' }) {
  const ctx = await payerContext(db, phone);
  const claim = (await db.query(
    `INSERT INTO payment_claims (source, payer_phone, payer_name, agent_id, property_id, purpose, reference, amount_ugx, receipt_url, message, ai_reading)
     VALUES ($1,$2,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
    [source, String(phone || '').replace(/\D+/g, '') || null, payerName || ctx.agent?.full_name || null, ctx.agent?.id || null,
      ctx.property?.id || null, ctx.purpose || 'other', reference, amountUgx, receiptUrl, String(message || '').slice(0, 1000),
      aiReading ? JSON.stringify(aiReading) : null]
  )).rows[0];
  await matchClaimToSms(db, claim);
  return { claim, ctx };
}

/** Check 2 of 3: does the wallet's own SMS show this transaction? */
async function matchClaimToSms(db, claim) {
  if (!claim?.reference || claim.sms_id) return claim;
  const sms = (await db.query(
    `SELECT id, amount_ugx FROM money_sms_inbox WHERE LOWER(reference) = LOWER($1) ORDER BY received_at DESC LIMIT 1`,
    [claim.reference]
  )).rows[0];
  if (!sms) return claim;
  return (await db.query(
    `UPDATE payment_claims SET sms_id = $2, sms_matched_at = NOW(), amount_ugx = COALESCE(amount_ugx, $3) WHERE id = $1 RETURNING *`,
    [claim.id, sms.id, sms.amount_ugx]
  )).rows[0];
}

/** When a money SMS arrives, see whether someone already said they paid with that ID. */
async function matchSmsToClaims(db, smsRow) {
  if (!smsRow?.reference) return null;
  return (await db.query(
    `UPDATE payment_claims SET sms_id = $2, sms_matched_at = NOW(), amount_ugx = COALESCE(amount_ugx, $3)
      WHERE LOWER(reference) = LOWER($1) AND sms_id IS NULL AND status = 'pending' RETURNING *`,
    [smsRow.reference, smsRow.id, smsRow.amount_ugx]
  )).rows;
}

/** Check 3 of 3: Ronald or Arthur confirms. Only now does the money count. */
async function confirmClaim(db, { claimId, actor, method, accountKey, amountUgx, amountOriginal, fxRate, note }) {
  const claim = (await db.query('SELECT * FROM payment_claims WHERE id = $1::uuid', [claimId])).rows[0];
  if (!claim) throw revenue.httpError(404, 'Claim not found');
  if (claim.status !== 'pending') throw revenue.httpError(409, `This claim is already ${claim.status}`);
  const payment = {
    amount: amountUgx || claim.amount_ugx,
    amount_original: amountOriginal || undefined,
    fx_rate_ugx: fxRate || undefined,
    method: method || (claim.sms_id ? 'mtn_momo' : ''),
    account_key: accountKey || undefined,
    reference: claim.reference,
    receipt_url: claim.receipt_url,
    note: [note, `Confirmed from a WhatsApp payment claim${claim.sms_id ? ' (matched to the wallet SMS)' : ''}`].filter(Boolean).join(' · '),
    payer_phone: claim.payer_phone,
    payer_name: claim.payer_name
  };
  let result;
  if (claim.purpose === 'agent_subscription' && claim.agent_id) {
    const agent = await loadAgent(db, claim.agent_id);
    result = await revenue.recordAgentPayment(db, { agent, payment, actor });
    if (agent.billing_suspended_at) result.reinstatement = await reinstateAgentAfterPayment(db, { agentId: agent.id, actor });
    else if (String(agent.status || '').toLowerCase() === 'pending') {
      result.pendingAgent = await require('./payLinkService').pendingAgentPaid(db, agent, { how: 'mobile money', amountUgx: payment.amount }).catch(() => null);
    }
  } else if (claim.purpose === 'listing_fee' && claim.property_id) {
    result = await recordListingPayment(db, { propertyId: claim.property_id, payment, actor });
  } else if (claim.purpose === 'short_term_fee' && claim.st_listing_id) {
    result = await require('./payLinkService').recordShortTermPayment(db, { stListingId: claim.st_listing_id, payment, actor });
  } else {
    result = { entry: await revenue.recordEntry(db, { ...payment, direction: 'in', kind: 'other_income' }, actor) };
  }
  // Three checks done: mark the ledger entry verified by the confirmer.
  await db.query(
    `UPDATE revenue_entries SET verified_status = 'verified', verified_by = $2, verified_at = NOW(),
            verification_source = CASE WHEN $3::boolean THEN 'sms_match+confirmed' ELSE 'confirmed' END, claim_id = $4
      WHERE id = $1`,
    [result.entry.id, actor, Boolean(claim.sms_id), claim.id]
  );
  await db.query(
    `UPDATE payment_claims SET status = 'confirmed', decided_by = $2, decided_at = NOW(), decision_note = $3, entry_id = $4 WHERE id = $1`,
    [claim.id, actor, note || null, result.entry.id]
  );
  if (claim.pay_link_id) await require('./payLinkService').closeLinkForClaim(db, claim.id, result.entry.id).catch(() => null);
  return { claim_id: claim.id, ...result };
}

async function rejectClaim(db, { claimId, actor, note }) {
  const updated = (await db.query(
    `UPDATE payment_claims SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_note = $3
      WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
    [claimId, actor, note || null]
  )).rows[0];
  if (!updated) throw revenue.httpError(404, 'No pending claim with that id');
  return updated;
}

// --- Private listers --------------------------------------------------------

async function recordListingPayment(db, { propertyId, payment, actor }) {
  const settings = await getSettings(db);
  const fee = Number(settings.lister_fee?.monthly_ugx || 20000);
  const property = (await db.query('SELECT id, title, lister_paid_until, lister_billing_suspended_at, extra_fields FROM properties WHERE id = $1::uuid', [propertyId])).rows[0];
  if (!property) throw revenue.httpError(404, 'Listing not found');
  const entry = revenue.normalizeEntry(payment);
  const months = Math.max(1, Math.floor(entry.amount_ugx / fee));
  if (entry.amount_ugx < fee) throw revenue.httpError(400, `A month is ${ugx(fee)}; ${ugx(entry.amount_ugx)} is less than that.`);
  const today = revenue.kampalaDate();
  const current = property.lister_paid_until ? revenue.isoDay(property.lister_paid_until) : '';
  const start = current && current >= today ? new Date(Date.parse(`${current}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : today;
  const end = new Date(Date.parse(`${revenue.addMonths(start, months)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const row = (await db.query(
    `INSERT INTO revenue_entries (direction, kind, amount_ugx, account_key, method, reference, paid_at, period_start, period_end,
                                  payer_name, payer_phone, note, receipt_url, recorded_by, property_id,
                                  currency, amount_original, fx_rate_ugx)
     VALUES ('in', 'listing_fee', $1, $2, $3, $4, $5::timestamptz, $6::date, $7::date, $8, $9, $10, $11, $12, $13::uuid, $14, $15, $16) RETURNING *`,
    [entry.amount_ugx, entry.account_key, entry.method, entry.reference, entry.paid_at, start, end,
      entry.payer_name, entry.payer_phone, entry.note, entry.receipt_url, actor, propertyId,
      entry.currency || 'UGX', entry.amount_original ?? null, entry.fx_rate_ugx ?? null]
  ).catch((error) => {
    if (String(error.code) === '23505') throw revenue.httpError(409, `Transaction ID ${entry.reference} has already been recorded. One receipt can only be used once.`);
    throw error;
  })).rows[0];
  await db.query(
    `UPDATE properties
        SET lister_paid_until = $2::date,
            status = CASE WHEN lister_billing_suspended_at IS NOT NULL AND status = 'hidden'
                          THEN COALESCE(NULLIF(extra_fields->>'billing_previous_status', ''), 'approved') ELSE status END,
            lister_billing_suspended_at = NULL,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [propertyId, end]
  );
  return { entry: row, months, period_start: start, period_end: end };
}

// --- Private listers: 7 days free, then a monthly fee -------------------------

async function listingStats(db, propertyId) {
  const r = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE event_name = 'property_open')::int AS views,
            COUNT(DISTINCT client_id) FILTER (WHERE event_name = 'property_open')::int AS visitors,
            COUNT(*) FILTER (WHERE event_name ILIKE '%whatsapp%')::int AS whatsapp_clicks,
            COUNT(*) FILTER (WHERE event_name ILIKE '%share%')::int AS shares
       FROM analytics_events
      WHERE payload->>'property_id' = $1::text`,
    [String(propertyId)]
  ).catch(() => ({ rows: [{}] }))).rows[0] || {};
  return { views: Number(r.views || 0), visitors: Number(r.visitors || 0), whatsapp_clicks: Number(r.whatsapp_clicks || 0), shares: Number(r.shares || 0) };
}

function listerFreeUntil(property = {}, settings = {}) {
  const freeDays = Number(settings.lister_fee?.free_days || 7);
  const start = new Date(property.reviewed_at || property.created_at || Date.now());
  return new Date(start.getTime() + (freeDays - 1) * 86400000 + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function fillTemplate(template = '', values = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_m, key) => (values[key] ?? ''));
}

const LISTER_MESSAGE_KINDS = ['views', 'reminder', 'final_reminder', 'taken_down', 'reinstated'];

async function buildListerMessage(db, kind, property, settings, payLink = '') {
  const name = String(property.lister_name || '').trim().split(/\s+/)[0] || 'there';
  const fee = Number(settings.lister_fee?.monthly_ugx || 20000);
  const pay = payToLine(settings);
  const link = `${SITE()}/property/${property.id}`;
  const title = property.title || 'property';
  const freeUntil = prettyDate(listerFreeUntil(property, settings));
  const paidUntil = property.lister_paid_until ? prettyDate(property.lister_paid_until) : '';
  const help = helpContact();
  const howToPay = [
    pay ? `To keep it live for a month it is ${ugx(fee)} — pay to ${pay}, then send me the *transaction ID* (or a screenshot) here.` : '',
    payLinkLine(payLink)
  ].filter(Boolean).join('\n');
  if (kind === 'views') {
    const stats = await listingStats(db, property.id);
    const template = settings.lister_views_message?.text || '';
    const filled = fillTemplate(template, {
      name,
      property: title,
      views: stats.visitors || stats.views,
      shares_line: stats.whatsapp_clicks ? `, and ${stats.whatsapp_clicks} tapped to WhatsApp you` : '',
      free_until: freeUntil,
      monthly_fee: Number(fee).toLocaleString('en-US'),
      pay_to: pay || '(payment details to follow)',
      link,
      pay_link: payLink
    });
    return payLink && !template.includes('{pay_link}') ? `${filled}\n\n${payLinkLine(payLink)}` : filled;
  }
  if (kind === 'reminder') {
    return [`Hi ${name},`, '', `Your free week for *${title}* on makaug has ended${paidUntil ? '' : ` (it ended on ${freeUntil})`}.`, howToPay, '', `See it: ${link}`].filter((l) => l !== '').join('\n');
  }
  if (kind === 'final_reminder') {
    return [`Hi ${name},`, '', `*Final reminder* — *${title}* will be taken off makaug unless the ${ugx(fee)} monthly fee is paid.`, howToPay, '', 'Nothing is deleted: pay any time and it goes straight back up.', `Questions: ${help.name} on ${help.pretty}.`].filter((l) => l !== '').join('\n');
  }
  if (kind === 'taken_down') {
    return [`Hi ${name},`, '', `*${title}* is now off makaug because the monthly fee was not paid. Nothing has been deleted.`, howToPay, '', `Want it back up? Pay, or call ${help.name} on ${help.pretty}.`].filter((l) => l !== '').join('\n');
  }
  if (kind === 'reinstated') {
    return [`✅ *Payment received — thank you, ${name}!*`, '', `*${title}* is live on makaug${paidUntil ? ` until *${paidUntil}*` : ''}.`, link].join('\n');
  }
  return '';
}

async function sendListerBillingMessage(db, { propertyId, kind, actor = 'admin', textOverride = '' }) {
  if (!LISTER_MESSAGE_KINDS.includes(kind)) throw revenue.httpError(400, 'Unknown message');
  const property = (await db.query(
    `SELECT id, title, lister_name, lister_phone, status, created_at, reviewed_at, lister_paid_until, lister_billing_log, agent_id
       FROM properties WHERE id = $1::uuid`, [propertyId])).rows[0];
  if (!property) throw revenue.httpError(404, 'Listing not found');
  if (property.agent_id) throw revenue.httpError(409, 'This listing belongs to an agent — use the agent fee instead');
  const settings = await getSettings(db, { fresh: true });
  if (['views', 'reminder', 'final_reminder'].includes(kind) && !payToLine(settings)) {
    throw revenue.httpError(409, 'Set the pay-to number and registered name first (Sales & Revenue › Settings).');
  }
  const to = String(property.lister_phone || '').replace(/\D+/g, '');
  if (to.length < 9) throw revenue.httpError(400, 'This listing has no WhatsApp number');
  const payLink = !String(textOverride || '').trim() && PAY_LINK_KINDS.has(kind)
    ? await payLinkFor(db, { purpose: 'listing_fee', property_id: property.id })
    : '';
  const body = String(textOverride || '').trim() || await buildListerMessage(db, kind, property, settings, payLink);
  const delivery = await deliver(to, body, `lister_billing_${kind}`, `${property.id}:${kind}:${Date.now()}`);
  await db.query(
    `UPDATE properties SET lister_billing_log = COALESCE(lister_billing_log, '{}'::jsonb) || jsonb_build_object($2::text, jsonb_build_object('at', NOW()::text, 'by', $3::text, 'status', $4::text))
      WHERE id = $1::uuid`,
    [property.id, kind, actor, delivery.status || 'unknown']
  );
  return { kind, to, status: delivery.status, text: body };
}

async function takeDownListingForBilling(db, { propertyId, actor = 'admin' }) {
  const updated = (await db.query(
    `UPDATE properties
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('billing_previous_status', status, 'billing_taken_down_by', $2::text),
            status = 'hidden', lister_billing_suspended_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND agent_id IS NULL AND status IN ('approved', 'pending') AND lister_billing_suspended_at IS NULL
      RETURNING id`,
    [propertyId, actor]
  )).rows[0];
  if (!updated) throw revenue.httpError(409, 'Not a live private listing (or already taken down)');
  const notice = await sendListerBillingMessage(db, { propertyId, kind: 'taken_down', actor }).catch((error) => ({ error: error.message }));
  return { taken_down: true, notice };
}

/** Private listings that are in their free week, due, paid or taken down. */
async function listerBillingRows(db) {
  const settings = await getSettings(db);
  const start = String(settings.lister_fee?.start_date || '2026-10-05');
  const rows = (await db.query(
    `SELECT id, title, lister_name, lister_phone, status, created_at, reviewed_at, lister_paid_until, lister_billing_log, lister_billing_suspended_at
       FROM properties
      WHERE agent_id IS NULL AND COALESCE(source, '') NOT IN ('found_online_property_source_v1')
        AND COALESCE(listed_via, '') <> 'found_online'
        AND status IN ('approved', 'hidden') AND created_at >= $1::date
        AND (status = 'approved' OR lister_billing_suspended_at IS NOT NULL)
      ORDER BY created_at DESC LIMIT 300`,
    [start]
  )).rows;
  const today = revenue.kampalaDate();
  return rows.map((p) => {
    const freeUntil = listerFreeUntil(p, settings);
    const paid = p.lister_paid_until ? revenue.isoDay(p.lister_paid_until) : '';
    let state;
    if (p.lister_billing_suspended_at) state = 'taken_down';
    else if (paid && paid >= today) state = 'paid';
    else if (!paid && freeUntil >= today) state = 'free_week';
    else state = 'due';
    const until = paid || freeUntil;
    const daysOver = until < today ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${until}T00:00:00Z`)) / 86400000) : 0;
    return { ...p, free_until: freeUntil, lister_paid_until: paid || null, billing_state: state, days_overdue: daysOver };
  });
}

/** Daily: the day-3 "this many people saw your property" message. */
async function runListerViewsMessages(db) {
  const settings = await getSettings(db, { fresh: true });
  if (!payToLine(settings)) return { skipped: 'pay_to_not_set' };
  const day = Math.max(1, Number(settings.lister_fee?.views_message_day || 3));
  const rows = await listerBillingRows(db);
  const sent = [];
  for (const p of rows) {
    if (p.billing_state !== 'free_week' || p.lister_billing_log?.views) continue;
    const ageDays = Math.floor((Date.now() - new Date(p.reviewed_at || p.created_at).getTime()) / 86400000);
    if (ageDays < day - 1) continue;
    try {
      const r = await sendListerBillingMessage(db, { propertyId: p.id, kind: 'views', actor: 'scheduler' });
      sent.push({ id: p.id, status: r.status });
    } catch (error) {
      logger.warn('Lister views message failed', { propertyId: p.id, error: error.message });
    }
  }
  return { sent };
}

let billingTimer = null;
let lastBillingRunDay = '';
function startBillingScheduler(db) {
  if (billingTimer || !process.env.DATABASE_URL || process.env.BILLING_SCHEDULER_ENABLED === 'false') return;
  const tick = async () => {
    const now = new Date(Date.now() + 3 * 3600 * 1000);
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < 9 || lastBillingRunDay === day) return;
    lastBillingRunDay = day;
    try {
      const agents = await runAgentFeeReminders(db);
      const listers = await runListerViewsMessages(db);
      logger.info('Billing reminders run', { agents, listers });
    } catch (error) {
      logger.warn('Billing reminders failed', { error: error.message });
    }
  };
  billingTimer = setInterval(tick, 20 * 60_000);
  billingTimer.unref?.();
  setTimeout(tick, 60_000).unref?.();
}

module.exports = {
  AGENT_MESSAGE_KINDS,
  getSettings,
  setSetting,
  payToLine,
  buildAgentBillingMessage,
  sendAgentBillingMessage,
  takeDownAgentForBilling,
  reinstateAgentAfterPayment,
  runAgentFeeReminders,
  daysOverdue,
  helpContact,
  readReferenceFromText,
  payerContext,
  expectingPaymentFrom,
  createClaim,
  matchClaimToSms,
  matchSmsToClaims,
  confirmClaim,
  rejectClaim,
  recordListingPayment,
  listingStats,
  listerFreeUntil,
  fillTemplate,
  LISTER_MESSAGE_KINDS,
  buildListerMessage,
  sendListerBillingMessage,
  takeDownListingForBilling,
  listerBillingRows,
  runListerViewsMessages,
  startBillingScheduler,
  ugx,
  prettyDate,
  SITE
};
