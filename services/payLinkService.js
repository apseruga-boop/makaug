'use strict';

/**
 * Payment links: makaug.com/pay/<code>.
 *
 * One link per thing owed (a private listing's month, an agent's month, or a
 * one-off amount). The person chooses how to pay:
 *   - Card / Apple Pay / Google Pay through Revolut (WHISPERS GLOBAL LTD),
 *     charged in USD at the UGX price. Revolut confirms it, so the payment is
 *     recorded, verified and the listing/agent put live without anyone typing.
 *   - MTN Mobile Money to the usual number, using the link code as the
 *     reference. "I have paid" becomes a payment claim and goes through the
 *     usual three checks (ID read, SMS match, Ronald/Arthur confirm).
 */

const crypto = require('crypto');

const logger = require('../config/logger');
const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');
const { observeJob } = require('../utils/memoryLog');
const revenue = require('./revenueService');
const { LISTING_FEE_UGX, LISTING_TERM_MONTHS } = require('./shortTermService');
const billingOps = require('./billingOpsService');
const revolut = require('./revolutMerchantService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { isDeepStrictEqual } = require('node:util');
const { withPaymentTransaction, assertPaymentTransaction, assertOutsidePaymentTransaction } = require('./paymentTransaction');
const pesapal = require('./pesapalClient');
const paymentNotices = require('./paymentNoticeService');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PURPOSES = new Set(['listing_fee', 'agent_subscription', 'short_term_fee', 'hosted_payment', 'other']);
// What a hosted payment (advertising, boosts…) counts as in the ledger.
const HOSTED_KINDS = { advertising_campaign: 'advertising', listing_boost: 'listing_boost' };

function site() {
  return billingOps.SITE();
}

/**
 * Eight characters, including the MK.
 *
 * It was ten, and ten is too many: this code is the Mobile Money reference,
 * typed by hand on a phone keypad by somebody paying in a shop, and every
 * extra character is another chance to mistype it and another payment nobody
 * can match. The alphabet already leaves out I, O, 0 and 1, which are the
 * characters people actually get wrong.
 *
 * Six random characters is 1.07 billion codes. That is the floor, not a round
 * number: the /pay page is reachable by anyone holding the code, so it has to
 * be too expensive to guess at. Five would be 33 million, which is a weekend's
 * work for a script.
 */
const CODE_LENGTH = 6;

function newCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `MK${out}`;
}

function payUrl(code) {
  return `${site()}/pay/${code}`;
}

function cardSettings(settings = {}) {
  const c = settings.card_payments || {};
  const rate = Number(c.ugx_per_unit || process.env.USD_UGX_RATE || 3700);
  return {
    enabled: c.enabled !== false,
    currency: String(c.currency || 'USD').toUpperCase(),
    rate: rate > 100 ? rate : 3700
  };
}

/** UGX -> card currency cents, always rounded up to the next cent. */
function cardMinorFor(amountUgx, rate) {
  return Math.max(50, Math.ceil((Number(amountUgx) / Number(rate)) * 100));
}

function money(minor, currency) {
  const symbol = { USD: '$', GBP: '£', EUR: '€' }[currency] || `${currency} `;
  return `${symbol}${(Number(minor) / 100).toFixed(2)}`;
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

async function loadLink(db, code) {
  const clean = String(code || '').trim().toUpperCase();
  // Accepts the shorter codes we issue now AND every longer one already in the
  // wild — an old link in somebody's WhatsApp must not stop working.
  if (!/^MK[A-Z0-9]{4,12}$/.test(clean)) return null;
  return (await db.query('SELECT * FROM pay_links WHERE code = $1', [clean])).rows[0] || null;
}

/**
 * Create (or reuse) a pay link. Reuses an open link for the same listing or
 * agent and amount from the last 30 days, so a second reminder sends the same
 * link rather than a new one.
 */
async function createPayLink(db, input = {}, actor = 'admin') {
  return withPaymentTransaction(db, async (tx) => {
    const target = input.property_id || input.agent_id || input.st_listing_id || input.payment_id;
    if (target) await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`pay-link:${target}`]);
    return createPayLinkTx(tx, input, actor);
  });
}

async function createPayLinkTx(db, input, actor) {
  const purpose = PURPOSES.has(input.purpose)
    ? input.purpose
    : (input.property_id ? 'listing_fee' : (input.agent_id ? 'agent_subscription' : (input.st_listing_id ? 'short_term_fee' : 'other')));
  const settings = await billingOps.getSettings(db, { fresh: true });
  let amountUgx = Math.round(Number(String(input.amount_ugx ?? '').replace(/[^\d.]/g, '')) || 0);
  let description = String(input.description || '').trim().slice(0, 200);
  let payerName = String(input.payer_name || '').trim().slice(0, 120) || null;
  let payerPhone = digits(input.payer_phone) || null;
  let propertyId = null;
  let agentId = null;
  let stListingId = null;
  let paymentId = null;

  if (purpose === 'listing_fee') {
    const property = (await db.query(
      `SELECT id, title, lister_name, lister_phone, agent_id, ${foundOnlinePropertySql('properties')} AS found_online FROM properties WHERE id = $1::uuid`,
      [input.property_id]
    )).rows[0];
    if (!property) throw revenue.httpError(404, 'Listing not found');
    // Free by rule: found-online listings and agents' listings (agents pay their own monthly fee).
    if (property.found_online) throw revenue.httpError(409, 'Found-online listings are free — nobody is charged for them');
    if (property.agent_id) throw revenue.httpError(409, "This is an agent's listing — it is covered by the agent's monthly fee");
    propertyId = property.id;
    amountUgx = amountUgx || Number(settings.lister_fee?.monthly_ugx || 20000);
    description = description || `makaug listing — 1 month: ${property.title || 'your property'}`.slice(0, 200);
    payerName = payerName || property.lister_name || null;
    payerPhone = payerPhone || digits(property.lister_phone) || null;
  } else if (purpose === 'agent_subscription') {
    const agent = (await db.query('SELECT id, full_name, phone, whatsapp, monthly_fee_ugx, fee_exempt, approved_at, status FROM agents WHERE id = $1::uuid', [input.agent_id])).rows[0];
    if (!agent) throw revenue.httpError(404, 'Agent not found');
    // Agents approved before the fee started list for free, for good — so a
    // link is never created for one by accident.
    //
    // But some of them have said they are happy to pay anyway, and refusing
    // their money is its own kind of silly. allow_exempt is how staff say they
    // meant it: the link is created, and the exemption is left exactly as it
    // was. Paying does not end it, and not paying costs them nothing.
    if (agent.fee_exempt && input.allow_exempt !== true) {
      throw revenue.httpError(409, `${agent.full_name} joined before the monthly fee and lists for free — no payment needed`);
    }
    agentId = agent.id;
    amountUgx = amountUgx || Number(settings.agent_fee?.monthly_ugx || agent.monthly_fee_ugx || revenue.feeConfig().feeUgx);
    // The description is public: it is on the /pay page the agent opens and in
    // the message they receive. So it says what they are paying for and
    // nothing else. That an exempt agent is paying by choice is OUR business,
    // not theirs to read on their own invoice — the team note carries it, and
    // the dashboard reads it off the agent's own fee_exempt flag.
    description = description || `makaug agent subscription — 1 month (${agent.full_name})`.slice(0, 200);
    payerName = payerName || agent.full_name || null;
    payerPhone = payerPhone || digits(agent.whatsapp || agent.phone) || null;
  } else if (purpose === 'short_term_fee') {
    const st = (await db.query(
      `SELECT id, reference, title, host_name, host_phone, listing_fee_ugx, listing_term_months, listing_fee_status FROM st_listing WHERE id = $1::uuid`,
      [input.st_listing_id]
    )).rows[0];
    if (!st) throw revenue.httpError(404, 'Short-stay listing not found');
    if (['paid', 'waived'].includes(String(st.listing_fee_status))) throw revenue.httpError(409, `This listing's fee is already ${st.listing_fee_status}`);
    if (Number(st.listing_fee_ugx) === 0) throw revenue.httpError(409, 'Short stays are included in the agent plan — no separate fee');
    stListingId = st.id;
    // Current tariff, not a historical amount stored on an older row.
    amountUgx = amountUgx || LISTING_FEE_UGX;
    const months = LISTING_TERM_MONTHS;
    const monthWord = months === 1 ? 'month' : 'months';
    description = description || `makaug short stay — ${months} ${monthWord}: ${st.title || st.reference}`.slice(0, 200);
    payerName = payerName || st.host_name || null;
    payerPhone = payerPhone || digits(st.host_phone) || null;
  } else if (purpose === 'hosted_payment') {
    const pay = (await db.query('SELECT id, purpose, amount, currency, payer_name, payer_phone FROM payments WHERE id = $1::uuid', [input.payment_id])).rows[0];
    if (!pay) throw revenue.httpError(404, 'Payment not found');
    paymentId = pay.id;
    amountUgx = amountUgx || Math.round(Number(pay.amount));
    description = description || `makaug ${String(pay.purpose || 'payment').replace(/_/g, ' ')}`;
    payerName = payerName || pay.payer_name || null;
    payerPhone = payerPhone || digits(pay.payer_phone) || null;
  } else {
    if (!(amountUgx >= 1000)) throw revenue.httpError(400, 'Enter the amount in UGX (at least 1,000).');
    description = description || 'makaug.com payment';
  }
  if (!(amountUgx > 0)) throw revenue.httpError(400, 'No amount to charge');

  if (propertyId || agentId || stListingId || paymentId) {
    const existing = (await db.query(
      `SELECT * FROM pay_links
        WHERE status = 'open' AND amount_ugx = $3
          AND (($1::uuid IS NOT NULL AND property_id = $1::uuid) OR ($2::uuid IS NOT NULL AND agent_id = $2::uuid)
               OR ($4::uuid IS NOT NULL AND st_listing_id = $4::uuid)
               OR ($5::uuid IS NOT NULL AND payment_id = $5::uuid))
          AND (NOT $6::boolean OR voluntary_payment)
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC LIMIT 1`,
      [propertyId, agentId, amountUgx, stListingId, paymentId, input.allow_exempt === true]
    )).rows[0];
    if (existing) return { link: existing, url: payUrl(existing.code), reused: true };
  }

  if (purpose === 'short_term_fee' && stListingId) {
    await db.query(
      `UPDATE pay_links
          SET status = 'cancelled', updated_at = NOW()
        WHERE st_listing_id = $1::uuid
          AND purpose = 'short_term_fee'
          AND status = 'open'
          AND amount_ugx <> $2`,
      [stListingId, amountUgx]
    );
  }

  const card = cardSettings(settings);
  const minor = cardMinorFor(amountUgx, card.rate);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const link = (await db.query(
        `INSERT INTO pay_links (code, purpose, property_id, agent_id, st_listing_id, payment_id, description, amount_ugx, card_currency, card_amount_minor, fx_rate_ugx,
                                payer_name, payer_phone, created_by, voluntary_payment)
         VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (code) DO NOTHING RETURNING *`,
        [newCode(), purpose, propertyId, agentId, stListingId, paymentId, description, amountUgx, card.currency, minor, card.rate, payerName, payerPhone, actor, purpose === 'agent_subscription' && input.allow_exempt === true]
      )).rows[0];
      if (!link) continue;
      return { link, url: payUrl(link.code), reused: false };
    } catch (error) {
      if (String(error.code) !== '23505') throw error;
    }
  }
  throw revenue.httpError(500, 'Could not create a payment link');
}

function payLinkMessage(link) {
  const name = String(link.payer_name || '').trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${name} 👋`,
    '',
    `Here is your makaug payment link for *${link.description}*:`,
    `*${billingOps.ugx(link.amount_ugx)}*`,
    '',
    payUrl(link.code),
    '',
    'Pay by card, Apple Pay or Google Pay, or by MTN Mobile Money — whichever is easier. You get a confirmation here as soon as it is paid.'
  ].join('\n');
}

async function sendPayLink(db, { code, to, actor = 'admin' }) {
  const link = await loadLink(db, code);
  if (!link) throw revenue.httpError(404, 'Payment link not found');
  if (link.status !== 'open') throw revenue.httpError(409, `This link is already ${link.status}`);
  const recipient = digits(to || link.payer_phone);
  if (recipient.length < 9) throw revenue.httpError(400, 'No WhatsApp number to send it to');
  const handoff = require('./leadHandoffService');
  const delivery = await handoff.deliverWhatsapp({ to: recipient, body: payLinkMessage(link), kind: 'pay_link', leadId: null, nonce: `${link.code}:${Date.now()}` });
  await db.query('UPDATE pay_links SET sent_to = $2, sent_at = NOW(), sent_status = $3, updated_at = NOW() WHERE id = $1', [link.id, recipient, delivery.status || 'unknown']);
  logger.info('Pay link sent', { code: link.code, to: recipient, status: delivery.status, by: actor });
  return { code: link.code, url: payUrl(link.code), to: recipient, status: delivery.status, reason: delivery.reason || null };
}

/**
 * Everything the public page needs. Never includes anything private.
 *
 * `track` is why this has options at all. Opening the page stamps opened_at,
 * which is how we tell "they have seen the bill and not paid" from "it never
 * reached them". But the code that composes the WhatsApp message also calls
 * this, to find out whether the page can offer card payments — and it was
 * stamping opened_at before the message had even been sent. Every link was
 * born already opened, so that signal was worthless on every link we have.
 *
 * Only a real human request may set it. Everything server-side passes
 * track: false.
 */
async function pageData(db, code, { track = true } = {}) {
  const link = await loadLink(db, code);
  if (!link) return null;
  if (track && !link.opened_at) db.query('UPDATE pay_links SET opened_at = NOW() WHERE id = $1 AND opened_at IS NULL', [link.id]).catch(() => {});
  const settings = await billingOps.getSettings(db);
  const card = cardSettings(settings);
  const readiness = pesapal.readiness();
  let pesapalAvailable = readiness.ready;
  if (pesapalAvailable) {
    try { await assertPesapalDatabase(db, readiness.environment); } catch { pesapalAvailable = false; }
  }
  const attempt = readiness.environment && readiness.countryCode === 'UG' ? await latestPesapalAttempt(db, link.id) : null;
  return {
    code: link.code,
    status: link.status,
    description: link.description,
    amount_ugx: Number(link.amount_ugx),
    amount_ugx_text: billingOps.ugx(link.amount_ugx),
    card_text: money(link.card_amount_minor, link.card_currency),
    card_available: card.enabled && revolut.isConfigured(),
    pesapal_available: pesapalAvailable && link.status === 'open',
    pesapal_needs_contact: !digits(link.payer_phone),
    pesapal_state: checkoutState(attempt),
    pesapal_can_resume: Boolean(pesapalAvailable && link.status === 'open' && attempt &&
      (attempt.creation_state === 'reserved' || attempt.creation_state === 'tracked' && attempt.redirect_url) &&
      !attempt.review_reason && !attempt.reversed_at && attempt.provider_status_code !== 2),
    pesapal_review: Boolean(attempt?.review_reason || attempt?.reversed_at),
    pesapal_readiness: readiness,
    pay_to: settings.pay_to || {},
    pay_to_ready: Boolean(billingOps.payToLine(settings)),
    paid_method: link.paid_method,
    paid_at: link.paid_at,
    payer_first_name: String(link.payer_name || '').trim().split(/\s+/)[0] || ''
  };
}

/** Start (or resume) the Revolut checkout for this link; returns its URL. */
async function startCardCheckout(db, code) {
  const link = await loadLink(db, code);
  if (!link) throw revenue.httpError(404, 'Payment link not found');
  if (link.status === 'paid') return { already_paid: true, redirect: `${payUrl(link.code)}?paid=1` };
  if (link.status !== 'open') throw revenue.httpError(409, 'This payment link is no longer open');
  if (link.provider_order_id) {
    const existing = await revolut.getOrder(link.provider_order_id).catch(() => null);
    if (existing && revolut.orderIsPaid(existing)) {
      await settleFromOrder(db, link, existing);
      return { already_paid: true, redirect: `${payUrl(link.code)}?paid=1` };
    }
    const state = String(existing?.state || '').toLowerCase();
    if (existing && ['pending', 'processing', 'authorised'].includes(state) && existing.checkout_url) {
      return { redirect: existing.checkout_url };
    }
  }
  const order = await revolut.createOrder({
    amountMinor: link.card_amount_minor,
    currency: link.card_currency,
    description: `${link.description} (${billingOps.ugx(link.amount_ugx)})`,
    reference: link.code,
    redirectUrl: `${payUrl(link.code)}/return`,
    customerPhone: link.payer_phone || undefined,
    customerName: link.payer_name || undefined
  });
  await db.query(
    `UPDATE pay_links SET provider_order_id = $2, provider_checkout_url = $3, provider_state = $4, updated_at = NOW() WHERE id = $1`,
    [link.id, order.id, order.checkout_url, order.state || 'pending']
  );
  return { redirect: order.checkout_url };
}

function cardPaymentFor(link, order) {
  const paidMinor = Number(order.amount || link.card_amount_minor);
  return {
    method: 'revolut_card',
    account_key: 'revolut_whispers',
    amount_original: paidMinor / 100,
    fx_rate_ugx: Number(link.fx_rate_ugx),
    reference: String(order.id),
    payer_name: link.payer_name || undefined,
    payer_phone: link.payer_phone || undefined,
    paid_at: order.completed_at || order.updated_at || new Date().toISOString(),
    note: `Card via Revolut · pay link ${link.code} · ${money(paidMinor, String(order.currency || link.card_currency).toUpperCase())}`
  };
}

/** A short-stay fee is paid: one month at the current tariff runs from today, or is added to time still left. */
async function markShortTermPaidTx(db, { stListingId, method, reference, amountUgx, actor, entryId }) {
  assertPaymentTransaction(db);
  if (!stListingId) throw revenue.httpError(404, 'Short-stay listing not found');
  const target = (await db.query('SELECT id FROM st_listing WHERE id = $1::uuid FOR UPDATE', [stListingId])).rows[0];
  if (!target) throw revenue.httpError(404, 'Short-stay listing not found');
  if (entryId) {
    const prior = (await db.query('SELECT id FROM st_listing_payment WHERE revenue_entry_id = $1', [entryId])).rows[0];
    if (prior) throw revenue.httpError(409, 'This short-stay receipt has already been applied');
  }
  const stMethod = { revolut_card: 'card', mtn_momo: 'mtn_mobile_money', airtel_money: 'airtel_money', bank_transfer: 'bank_transfer', absa_ugx: 'bank_transfer', absa_usd: 'bank_transfer', cash: 'cash' }[method] || 'other';
  const months = LISTING_TERM_MONTHS;
  const updated = (await db.query(
    `UPDATE st_listing
        SET listing_fee_status = 'paid',
            listing_fee_ugx = CASE WHEN listing_fee_status = 'paid' THEN listing_fee_ugx ELSE $2 END,
            listing_term_months = CASE WHEN listing_fee_status = 'paid' THEN listing_term_months ELSE $3 END,
            -- First payment: one month at the current tariff runs from today.
            -- A listing that is already paid keeps the term it was sold under.
            expires_at = CASE
              WHEN listing_fee_status = 'paid'
                THEN GREATEST(COALESCE(expires_at, NOW()), NOW()) + (listing_term_months || ' months')::interval
              ELSE NOW() + ($3 || ' months')::interval
            END
      WHERE id = $1::uuid
      RETURNING id, expires_at, listing_term_months`,
    [stListingId, LISTING_FEE_UGX, months]
  )).rows[0];
  if (!updated) throw revenue.httpError(404, 'Short-stay listing not found');
  await db.query(
    `INSERT INTO st_listing_payment (listing_id, amount_ugx, method, provider_reference, status, covers_from, covers_to, recorded_by, revenue_entry_id)
     VALUES ($1::uuid, $2, $3, $4, 'paid', CURRENT_DATE, $5::date, $6, $7)`,
    [stListingId, amountUgx, stMethod, reference || null, updated.expires_at, actor || 'payment', entryId || null]
  );
  return updated;
}

/** Advertising, boosts…: record the money, then switch on what was bought. */
async function recordHostedPayment(db, { paymentId, payment, actor }) {
  assertOutsidePaymentTransaction(db);
  const prepared = await revenue.prepareReceipt(payment);
  const result = await withPaymentTransaction(db, (tx) => recordHostedPaymentTx(tx, { paymentId, payment: prepared, actor }));
  if (result.completed) require('./paymentProviderService').paymentEvents.emit('payment.succeeded', result.completed);
  return result;
}

async function recordHostedPaymentTx(db, { paymentId, payment, actor }) {
  assertPaymentTransaction(db);
  const pay = (await db.query('SELECT id, purpose FROM payments WHERE id = $1::uuid', [paymentId])).rows[0];
  const kind = HOSTED_KINDS[pay?.purpose] || 'other_income';
  if (!pay) throw revenue.httpError(404, 'Payment not found');
  const entry = await revenue.recordEntryTx(db, { ...payment, direction: 'in', kind, note: [payment.note, `for ${pay.purpose.replace(/_/g, ' ')}`].join(' · ') }, actor);
  const completed = await require('./paymentProviderService').completeHostedPaymentTx(db, paymentId, { reference: payment.reference, method: payment.method });
  if (!completed) throw revenue.httpError(409, 'This purchase was already fulfilled without this payment-link receipt');
  return { entry, completed };
}

/** Record a short-stay fee in the ledger and mark the listing paid. */
async function recordShortTermPayment(db, { stListingId, payment, actor }) {
  assertOutsidePaymentTransaction(db);
  const prepared = await revenue.prepareReceipt(payment);
  return withPaymentTransaction(db, (tx) => recordShortTermPaymentTx(tx, { stListingId, payment: prepared, actor }));
}

async function recordShortTermPaymentTx(db, { stListingId, payment, actor }) {
  assertPaymentTransaction(db);
  const entry = await revenue.recordEntryTx(db, { ...payment, direction: 'in', kind: 'short_term_fee' }, actor);
  await db.query('UPDATE revenue_entries SET st_listing_id = $2::uuid WHERE id = $1', [entry.id, stListingId]);
  const listing = await markShortTermPaidTx(db, { stListingId, method: payment.method, reference: payment.reference, amountUgx: entry.amount_ugx, actor, entryId: entry.id });
  return { entry, listing };
}

/**
 * A pending agent (not yet approved) has paid. Approval still needs the team's
 * checks, so: thank the agent, and tell the team they are ready to approve.
 */
async function pendingAgentPaid(db, agent, { how = 'card', amountUgx } = {}) {
  if (!agent || String(agent.status || '').toLowerCase() !== 'pending') return { pending: false };
  await db.query('UPDATE agents SET paid_awaiting_approval_at = NOW() WHERE id = $1::uuid', [agent.id]);
  const handoff = require('./leadHandoffService');
  const help = billingOps.helpContact();
  const to = digits(agent.whatsapp || agent.phone);
  const first = String(agent.full_name || '').trim().split(/\s+/)[0] || 'there';
  if (to.length >= 9) {
    await handoff.deliverWhatsapp({
      to,
      body: [`✅ *Payment received — thank you, ${first}!*`, '', `Your first month (${billingOps.ugx(amountUgx)}) is paid.`, `${help.name} is finishing your checks now — as soon as you are approved you'll get your welcome pack and a short guide to posting here on WhatsApp.`].join('\n'),
      kind: 'agent_paid_pending', leadId: null, nonce: `${agent.id}:paid_pending`
    }).catch(() => null);
  }
  try {
    const desk = require('./leadDeskService');
    const alertBody = [
        `💳 *New agent has PAID — ready to approve*`,
        `${agent.full_name || 'Agent'} (+${to}) paid ${billingOps.ugx(amountUgx)} by ${how}.`,
        `Finish their checks, then reply *APPROVE +${to}* here (or approve in Admin › Agents). The payment is already recorded.`
      ].join('\n');
    if (typeof desk.sendToTeam === 'function') await desk.sendToTeam(db, alertBody, 'agent_paid_pending');
    // The people who confirm payments (Ronald, Arthur) always hear, even if not on the alert list.
    const onList = new Set((typeof desk.alertRecipients === 'function' ? desk.alertRecipients() : []).map((p) => digits(p).slice(-9)));
    const settings = await billingOps.getSettings(db).catch(() => ({}));
    for (const c of Array.isArray(settings.confirmers) ? settings.confirmers : []) {
      const num = digits(c?.phone);
      if (num.length >= 9 && !onList.has(num.slice(-9))) {
        await handoff.deliverWhatsapp({ to: num, body: alertBody, kind: 'agent_paid_pending_confirmer', leadId: null, nonce: `${agent.id}:${num}` }).catch(() => null);
      }
    }
  } catch (error) {
    logger.warn('Team alert for a paid pending agent failed', { agentId: agent.id, error: error.message });
  }
  return { pending: true };
}

async function notifyPaid(db, link, recorded) {
  const to = digits(link.payer_phone);
  if (to.length < 9) return null;
  try {
    if (link.purpose === 'listing_fee' && link.property_id) {
      return await billingOps.sendListerBillingMessage(db, { propertyId: link.property_id, kind: 'reinstated', actor: 'revolut' });
    }
    if (link.purpose === 'agent_subscription' && link.agent_id) {
      return await billingOps.sendAgentBillingMessage(db, { agentId: link.agent_id, kind: 'reinstated', actor: 'revolut', force: true });
    }
    const handoff = require('./leadHandoffService');
    const until = recorded?.listing?.expires_at ? billingOps.prettyDate(new Date(recorded.listing.expires_at).toISOString()) : '';
    const body = [`✅ *Payment received — thank you!*`, '', `${link.description}: ${billingOps.ugx(link.amount_ugx)}`, until ? `Your short stay is listed until *${until}*.` : '', `Reference ${link.code}`].filter(Boolean).join('\n');
    return await handoff.deliverWhatsapp({ to, body, kind: 'pay_link_paid', leadId: null, nonce: link.code });
  } catch (error) {
    logger.warn('Paid confirmation message failed', { code: link.code, error: error.message });
    return null;
  }
}

/**
 * Verify a completed Revolut order and accept it through the shared debt lock.
 */
async function settleFromOrder(db, link, order) {
  if (!revolut.orderIsPaid(order)) {
    await db.query('UPDATE pay_links SET provider_state = $2, updated_at = NOW() WHERE id = $1', [link.id, order.state || null]);
    return { paid: false, state: order.state || null };
  }
  const result = await withPaymentTransaction(db, async (tx) => {
    const current = (await tx.query('SELECT * FROM pay_links WHERE id = $1 FOR UPDATE', [link.id])).rows[0];
    if (!current) throw revenue.httpError(404, 'Payment link not found');
    const reference = order.merchant_order_data?.reference || order.merchant_order_ext_ref || order.reference;
    if (String(order.id) !== current.provider_order_id || reference !== current.code ||
        !Number.isSafeInteger(Number(order.amount)) || Number(order.amount) !== Number(current.card_amount_minor) ||
        String(order.currency || '').toUpperCase() !== current.card_currency) {
      throw paymentError('revolut_facts_mismatch', 409);
    }
    const recorded = await acceptCollectionTx(tx, current, {
      provider: 'revolut', payment: cardPaymentFor(current, order), actor: 'revolut',
      paidMethod: 'card', verification: 'revolut_order'
    });
    await tx.query('UPDATE pay_links SET provider_state = $2, updated_at = NOW() WHERE id = $1', [current.id, order.state]);
    return recorded;
  });
  paymentNotices.kickPaymentNotices(db);
  return result;
}

/** Ask Revolut how the order behind this link stands, and record it if paid. */
async function refreshLink(db, code) {
  const link = await loadLink(db, code);
  if (!link) throw revenue.httpError(404, 'Payment link not found');
  const checks = [];
  if (link.provider_order_id) checks.push(async () => settleFromOrder(db, link, await revolut.getOrder(link.provider_order_id)));
  const ready = pesapal.readiness();
  if (ready.environment && ready.credentialsConfigured && ready.countryCode === 'UG') {
    const attempt = await latestPesapalAttempt(db, link.id);
    if (attempt?.tracking_id) checks.push(() => observePesapalPayment(db, { trackingId: attempt.tracking_id, reference: attempt.merchant_reference, source: 'admin' }));
  }
  const results = await Promise.allSettled(checks.map((check) => check()));
  const current = await loadLink(db, link.code);
  const completed = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (checks.length && !completed.length && current.status !== 'paid') throw results[0].reason;
  return { paid: current.status === 'paid', state: current.status === 'paid' ? 'paid' : (completed.find((r) => r.state)?.state || null),
    review: completed.some((r) => r.review), errors: results.filter((r) => r.status === 'rejected').map((r) => safePaymentCode(r.reason)) };
}

/** Webhook: never trusted on its own — we fetch the order from Revolut. */
async function handleRevolutEvent(db, event = {}) {
  const orderId = String(event.order_id || event.orderId || event.id || '').trim();
  if (!orderId) return { ignored: 'no_order_id' };
  const link = (await db.query('SELECT * FROM pay_links WHERE provider_order_id = $1', [orderId])).rows[0];
  if (!link) return { ignored: 'unknown_order' };
  const order = await revolut.getOrder(orderId);
  return settleFromOrder(db, link, order);
}

const TRACKING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MERCHANT_REFERENCE = /^[A-Za-z0-9_.:-]{1,50}$/;
let configuredPesapal = null;
let configuredPesapalKey = '';

function paymentError(code, status = 409) {
  return Object.assign(new Error(`Payment could not be processed (${code}).`), { code, status });
}

function safePaymentCode(error) {
  const code = String(error?.code || 'payment_failed');
  return /^[A-Za-z0-9_:-]{1,60}$/.test(code) ? code : 'payment_failed';
}

function pesapalClient() {
  const env = process.env;
  if (String(env.COUNTRY_CODE || 'UG').trim().toUpperCase() !== 'UG') throw paymentError('wrong_tenant', 403);
  const key = JSON.stringify([env.PESAPAL_ENV, env.PESAPAL_CONSUMER_KEY, env.PESAPAL_CONSUMER_SECRET,
    env.PESAPAL_IPN_ID, env.PESAPAL_MERCHANT_PROFILE, env.NODE_ENV, env.PESAPAL_TEST_BASE_URL]);
  if (!configuredPesapal || key !== configuredPesapalKey) {
    configuredPesapal = pesapal.fromEnvironment(env, env.NODE_ENV === 'test' && env.PESAPAL_TEST_BASE_URL
      ? { testBaseUrl: env.PESAPAL_TEST_BASE_URL } : {});
    configuredPesapalKey = key;
  }
  return configuredPesapal;
}

async function assertPesapalDatabase(db, environment) {
  if (environment !== 'sandbox' && !process.env.PESAPAL_TEST_BASE_URL) return;
  if (process.env.NODE_ENV !== 'test' || !TRACKING_ID.test(process.env.PESAPAL_TEST_SENTINEL || '')) {
    throw paymentError('sandbox_database_required', 503);
  }
  const identity = (await db.query(
    `SELECT current_database() AS name, current_user AS role, host(inet_server_addr()) AS address,
            r.rolsuper FROM pg_roles r WHERE r.rolname = current_user`
  )).rows[0];
  if (!identity || !/^makaug_pesapal_test(?:_[a-f0-9]+)?$/.test(identity.name) ||
      !/^(?:pesapal_test|pesapal_app_[a-f0-9]+)$/.test(identity.role) || identity.rolsuper ||
      !['127.0.0.1', '::1'].includes(identity.address)) {
    throw paymentError('sandbox_database_required', 503);
  }
  const guard = (await db.query('SELECT sentinel::text FROM pesapal_test_guard')).rows;
  if (guard.length !== 1 || guard[0].sentinel !== process.env.PESAPAL_TEST_SENTINEL) {
    throw paymentError('sandbox_database_required', 503);
  }
}

function purchaseIdentity(link) {
  return {
    purpose: link.purpose, amount_ugx: Number(link.amount_ugx),
    property_id: link.property_id || null, agent_id: link.agent_id || null,
    st_listing_id: link.st_listing_id || null, payment_id: link.payment_id || null,
    voluntary_payment: link.voluntary_payment === true
  };
}

async function inspectPurchase(tx, link) {
  assertPaymentTransaction(tx);
  const snapshot = purchaseIdentity(link);
  let eligible = true;
  let reason = null;
  let target;
  if (link.purpose === 'agent_subscription') {
    target = (await tx.query('SELECT * FROM agents WHERE id = $1::uuid FOR UPDATE', [link.agent_id])).rows[0];
    snapshot.monthly_fee_ugx = revenue.feeConfig().feeUgx;
    if (!target) reason = 'target_missing';
    else if (target.removed_at || !['approved', 'pending', 'suspended'].includes(target.status)) reason = 'agent_not_eligible';
    else if (target.fee_exempt && !link.voluntary_payment) reason = 'agent_fee_exempt';
  } else if (link.purpose === 'listing_fee') {
    target = (await tx.query(
      `SELECT *, ${foundOnlinePropertySql('properties')} AS found_online FROM properties WHERE id = $1::uuid FOR UPDATE`, [link.property_id]
    )).rows[0];
    const settings = await billingOps.getSettings(tx, { fresh: true });
    snapshot.monthly_fee_ugx = Number(settings.lister_fee?.monthly_ugx || 20000);
    if (!target) reason = 'target_missing';
    else if (target.agent_id || target.found_online) reason = 'listing_fee_exempt';
    else if (['rejected', 'deleted', 'removed'].includes(target.status)) reason = 'listing_not_eligible';
  } else if (link.purpose === 'short_term_fee') {
    target = (await tx.query('SELECT * FROM st_listing WHERE id = $1::uuid FOR UPDATE', [link.st_listing_id])).rows[0];
    snapshot.tariff_ugx = LISTING_FEE_UGX;
    snapshot.term_months = LISTING_TERM_MONTHS;
    if (!target) reason = 'target_missing';
    else if (Number(target.listing_fee_ugx) === 0 || target.listing_fee_status === 'waived') reason = 'short_stay_fee_exempt';
  } else if (link.purpose === 'hosted_payment') {
    target = (await tx.query('SELECT * FROM payments WHERE id = $1::uuid FOR UPDATE', [link.payment_id])).rows[0];
    if (!target) reason = 'target_missing';
    else {
      snapshot.hosted = { purpose: target.purpose, amount: String(target.amount), currency: target.currency,
        payer_id: target.payer_id || null, metadata: target.metadata || {} };
      if (target.currency !== 'UGX' || Number(target.amount) !== Number(link.amount_ugx)) reason = 'hosted_amount_mismatch';
      else if (target.status === 'paid') reason = 'hosted_already_paid';
    }
  } else if (link.purpose !== 'other') reason = 'unsupported_purchase';
  eligible = !reason;
  return { snapshot, target, eligible, reason };
}

async function queueReview(tx, link, { attemptId, entryId, reason, provider = 'Pesapal' }) {
  const settings = await billingOps.getSettings(tx, { fresh: true });
  const desk = require('./leadDeskService');
  const recipients = new Set([...(typeof desk.alertRecipients === 'function' ? desk.alertRecipients() : []),
    ...(Array.isArray(settings.confirmers) ? settings.confirmers.map((c) => c.phone) : [])].map(digits).filter((p) => p.length >= 9 && p.length <= 15));
  for (const recipient of recipients) {
    await paymentNotices.enqueueNotice(tx, {
      eventKey: `payment:${entryId || attemptId || link.id}:review:${reason}:${recipient}`,
      payLinkId: link.id, attemptId, entryId, kind: 'payment_review', recipient,
      body: `${provider} payment needs review. Reference ${link.code}. Reason: ${reason}. No additional service was activated.`
    });
  }
}

async function queueCollectionNotices(tx, link, recorded, collection, application, reason) {
  const entry = recorded.entry;
  const to = digits(link.payer_phone || collection.payment.payer_phone);
  const pending = recorded.pendingAgent?.pending === true;
  const body = application === 'applied'
    ? [`Payment received. Thank you!`, `${link.description}: ${billingOps.ugx(entry.amount_ugx)}.`,
      pending ? 'Your payment is recorded. The team still needs to finish your approval checks.' : '',
      recorded.reinstatement?.moderation_preserved ? 'The team will review your account status separately.' : '',
      recorded.period_end ? `Paid until ${recorded.period_end}.` : '', `Reference ${link.code}.`].filter(Boolean).join('\n')
    : `Payment received for reference ${link.code}. The team will review this payment because ${reason}. No additional service was activated.`;
  if (to.length >= 9 && to.length <= 15) await paymentNotices.enqueueNotice(tx, {
    eventKey: `payment:${entry.id}:payer:${to}`, payLinkId: link.id, entryId: entry.id,
    attemptId: collection.attemptId, kind: pending ? 'agent_paid_pending' : 'payment_received', recipient: to, body
  });
  const settings = await billingOps.getSettings(tx, { fresh: true });
  const desk = require('./leadDeskService');
  const recipients = new Set([...(typeof desk.alertRecipients === 'function' ? desk.alertRecipients() : []),
    ...(Array.isArray(settings.confirmers) ? settings.confirmers.map((c) => c.phone) : [])].map(digits).filter((p) => p.length >= 9 && p.length <= 15));
  for (const recipient of recipients) await paymentNotices.enqueueNotice(tx, {
    eventKey: `payment:${entry.id}:team:${recipient}`, payLinkId: link.id, entryId: entry.id,
    attemptId: collection.attemptId, kind: application === 'applied' ? 'payment_recorded' : 'payment_review', recipient,
    body: `${collection.provider} payment recorded: ${billingOps.ugx(entry.amount_ugx)} for ${link.description}. Reference ${link.code}. ${application === 'applied' ? (pending ? 'Paid; finish the agent approval checks.' : 'The purchase was applied.') : `Review needed: ${reason}.`}`
  });
  if (recorded.completed) await paymentNotices.enqueueNotice(tx, {
    eventKey: `payment:${entry.id}:event:succeeded`, payLinkId: link.id, entryId: entry.id,
    attemptId: collection.attemptId, kind: 'payment.succeeded', channel: 'event', recipient: '', body: '', payload: recorded.completed
  });
}

async function applyPurchaseTx(tx, link, collection, inspected) {
  const payment = collection.payment;
  const actor = collection.actor;
  if (link.purpose === 'agent_subscription') {
    const result = await revenue.recordAgentPaymentTx(tx, { agentId: link.agent_id, payment, actor });
    if (inspected.target.billing_suspended_at) {
      result.reinstatement = await billingOps.reinstateAgentAfterPaymentTx(tx, { agentId: link.agent_id, actor });
    }
    if (inspected.target.status === 'pending' || (result.reinstatement?.reinstated && inspected.target.billing_snapshot?.previous_status === 'pending')) {
      await tx.query('UPDATE agents SET paid_awaiting_approval_at = NOW() WHERE id = $1::uuid', [link.agent_id]);
      result.pendingAgent = { pending: true };
    }
    return result;
  }
  if (link.purpose === 'listing_fee') return billingOps.recordListingPaymentTx(tx, { propertyId: link.property_id, payment, actor });
  if (link.purpose === 'short_term_fee') return recordShortTermPaymentTx(tx, { stListingId: link.st_listing_id, payment, actor });
  if (link.purpose === 'hosted_payment') return recordHostedPaymentTx(tx, { paymentId: link.payment_id, payment, actor });
  return { entry: await revenue.recordEntryTx(tx, { ...payment, direction: 'in', kind: 'other_income' }, actor) };
}

async function acceptCollectionTx(tx, link, collection) {
  assertPaymentTransaction(tx);
  const normalized = revenue.normalizeEntry(collection.payment);
  const prior = (await tx.query(
    'SELECT * FROM revenue_entries WHERE account_key = $1 AND LOWER(reference) = LOWER($2) ORDER BY recorded_at LIMIT 1',
    [normalized.account_key, normalized.reference]
  )).rows[0];
  if (prior) {
    if (prior.pay_link_id !== link.id || !prior.payment_application ||
        prior.direction !== 'in' || Number(prior.amount_ugx) !== normalized.amount_ugx ||
        prior.currency !== normalized.currency ||
        (prior.amount_original == null ? null : Number(prior.amount_original)) !== normalized.amount_original ||
        (prior.fx_rate_ugx == null ? null : Number(prior.fx_rate_ugx)) !== normalized.fx_rate_ugx ||
        (collection.attemptId && prior.pesapal_attempt_id !== collection.attemptId) ||
        (collection.claimId && prior.claim_id !== collection.claimId) ||
        (prior.payment_application === 'applied' && (link.status !== 'paid' || link.entry_id !== prior.id))) {
      throw paymentError('receipt_conflict');
    }
    return { paid: link.status === 'paid', state: link.status === 'paid' ? 'paid' : 'review', code: link.code,
      entry_id: prior.id, entry: prior, already: true, review: prior.payment_application !== 'applied', durable_notices: true };
  }
  const applied = (await tx.query("SELECT id FROM revenue_entries WHERE pay_link_id = $1 AND payment_application = 'applied'", [link.id])).rows[0];
  const inspected = await inspectPurchase(tx, link);
  let reason = link.status === 'paid' || applied ? 'debt_already_paid' : (link.status !== 'open' ? 'debt_closed' : inspected.reason);
  if (!reason && collection.snapshot && !isDeepStrictEqual(collection.snapshot, inspected.snapshot)) reason = 'purchase_changed';
  let recorded;
  const application = reason ? (link.status === 'paid' || applied ? 'excess' : 'review') : 'applied';
  if (reason) {
    recorded = { entry: await revenue.recordEntryTx(tx, { ...collection.payment, direction: 'in', kind: 'other_income',
      note: `${collection.payment.note || ''} Payment review: ${reason}. Link ${link.code}.` }, collection.actor) };
  } else recorded = await applyPurchaseTx(tx, link, collection, inspected);
  const entry = (await tx.query(
    `UPDATE revenue_entries SET pay_link_id = $2, pesapal_attempt_id = $3, payment_application = $4,
            payment_review_reason = $5, verified_status = 'verified', verified_by = $6, verified_at = NOW(),
            verification_source = $7, claim_id = COALESCE($8::uuid, claim_id)
      WHERE id = $1 RETURNING *`,
    [recorded.entry.id, link.id, collection.attemptId || null, application, reason || null,
      collection.actor, collection.verification, collection.claimId || null]
  )).rows[0];
  if (!entry) throw paymentError('receipt_missing');
  recorded.entry = entry;
  if (application === 'applied') {
    await tx.query(
      `UPDATE pay_links SET status = 'paid', paid_method = $2, paid_at = NOW(), entry_id = $3, updated_at = NOW() WHERE id = $1`,
      [link.id, collection.paidMethod, entry.id]
    );
  }
  if (collection.attemptId) await tx.query(
    `UPDATE pesapal_payment_attempts SET application = $2, ledger_entry_id = $3, recorded_at = NOW(), closed_at = NOW(),
            review_reason = $4, next_check_at = NOW() + INTERVAL '1 day' WHERE id = $1`,
    [collection.attemptId, application === 'applied' ? 'applied' : 'unapplied_collection', entry.id, reason]
  );
  if (collection.claimId) await tx.query(
    `UPDATE payment_claims SET status = 'confirmed', decided_by = $2, decided_at = NOW(), decision_note = $3, entry_id = $4
      WHERE id = $1`, [collection.claimId, collection.actor, collection.decisionNote || null, entry.id]
  );
  await queueCollectionNotices(tx, link, recorded, collection, application, reason);
  return { ...recorded, paid: application === 'applied' || link.status === 'paid', state: application === 'applied' || link.status === 'paid' ? 'paid' : 'review',
    code: link.code, entry_id: entry.id, review: Boolean(reason), excess: application === 'excess', durable_notices: true };
}

async function settleConfirmedClaim(db, { claimId, actor, method, accountKey, amountUgx, amountOriginal, fxRate, note }) {
  const initial = (await db.query('SELECT * FROM payment_claims WHERE id = $1::uuid', [claimId])).rows[0];
  if (!initial?.pay_link_id) throw revenue.httpError(404, 'Linked payment claim not found');
  const prepared = await revenue.prepareReceipt({ receipt_url: initial.receipt_url });
  const result = await withPaymentTransaction(db, async (tx) => {
    const link = (await tx.query('SELECT * FROM pay_links WHERE id = $1 FOR UPDATE', [initial.pay_link_id])).rows[0];
    if (!link) throw revenue.httpError(404, 'Payment link not found');
    const claim = (await tx.query('SELECT * FROM payment_claims WHERE id = $1::uuid FOR UPDATE', [claimId])).rows[0];
    if (!claim || claim.pay_link_id !== link.id) throw paymentError('claim_changed');
    if (claim.status === 'confirmed') return { claim_id: claim.id, paid: link.status === 'paid', state: link.status === 'paid' ? 'paid' : 'review',
      entry_id: claim.entry_id, already: true, durable_notices: true };
    if (claim.status !== 'pending') throw revenue.httpError(409, `This claim is already ${claim.status}`);
    if (claim.receipt_url !== initial.receipt_url) throw paymentError('claim_receipt_changed');
    const recorded = await acceptCollectionTx(tx, link, {
      provider: 'Mobile Money', actor, paidMethod: method || 'mtn_momo', claimId: claim.id,
      decisionNote: note, verification: claim.sms_id ? 'sms_match+confirmed' : 'confirmed',
      payment: { amount: amountUgx || claim.amount_ugx, amount_original: amountOriginal || undefined, fx_rate_ugx: fxRate || undefined,
        method: method || (claim.sms_id ? 'mtn_momo' : ''), account_key: accountKey || undefined, reference: claim.reference,
        receipt_url: prepared.receipt_url, payer_name: claim.payer_name, payer_phone: claim.payer_phone,
        note: [note, `Confirmed payment claim ${claim.id}`].filter(Boolean).join(' · ') }
    });
    return { claim_id: claim.id, ...recorded };
  });
  paymentNotices.kickPaymentNotices(db);
  return result;
}

function checkoutCustomer(link, input, inspected) {
  const storedPhone = digits(link.payer_phone);
  const storedEmail = inspected?.target?.payer_email || '';
  const hasStoredContact = Boolean(storedPhone || storedEmail);
  const suppliedPhone = hasStoredContact ? '' : String(input.phone || '');
  const suppliedEmail = hasStoredContact ? '' : String(input.email || '');
  if (suppliedPhone.length > 40 || suppliedEmail.length > 254) throw paymentError('payment_contact_required', 400);
  const phone = storedPhone || digits(suppliedPhone);
  const email = String(storedEmail || suppliedEmail).trim();
  if ((!phone && !email) || (phone && !/^[0-9]{7,15}$/.test(phone)) ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw paymentError('payment_contact_required', 400);
  const names = String(link.payer_name || '').trim().split(/\s+/).filter(Boolean);
  return { ...(phone ? { phone } : {}), ...(email ? { email } : {}),
    ...(names[0] ? { firstName: names[0].slice(0, 80) } : {}),
    ...(names.length > 1 ? { lastName: names.slice(1).join(' ').slice(0, 80) } : {}) };
}

function checkoutState(attempt) {
  if (!attempt) return null;
  if (attempt.reversed_at) return 'reversed';
  if (attempt.application === 'applied') return 'paid';
  if (attempt.application === 'unapplied_collection' || attempt.review_reason && !['creation_unknown'].includes(attempt.review_reason)) return 'review';
  if (attempt.creation_state === 'rejected' || attempt.provider_status_code === 2) return 'failed';
  if (attempt.provider_status_code === 0) return 'pending';
  return attempt.creation_state;
}

function startResult(link, attempt) {
  if (link.status === 'paid') return { kind: 'paid', paid: true, already_paid: true, code: link.code, state: 'paid' };
  const state = checkoutState(attempt);
  if (attempt?.creation_state === 'tracked' && attempt.redirect_url && !attempt.reversed_at && !attempt.review_reason && attempt.provider_status_code !== 2) {
    return { kind: 'redirect', url: attempt.redirect_url, redirect: attempt.redirect_url, code: link.code, attemptId: attempt.id, state: 'tracked' };
  }
  return { kind: 'pending', pending: true, code: link.code, attemptId: attempt?.id, state: state || 'reserved', review: Boolean(attempt?.review_reason || attempt?.reversed_at) };
}

async function startPesapalCheckout(db, input = {}) {
  const ready = pesapal.readiness();
  if (!ready.ready) return { kind: 'unavailable', state: 'unavailable', reason: ready.reasons[0] || 'unavailable' };
  await assertPesapalDatabase(db, ready.environment);
  const client = pesapalClient();
  const reservation = await withPaymentTransaction(db, async (tx) => {
    const link = (await tx.query('SELECT * FROM pay_links WHERE code = $1 FOR UPDATE', [String(input.code || '').trim().toUpperCase()])).rows[0];
    if (!link) throw revenue.httpError(404, 'Payment link not found');
    if (link.status === 'paid') return { link, attempt: null };
    if (link.status !== 'open') throw paymentError('debt_closed');
    const inspected = await inspectPurchase(tx, link);
    if (!inspected.eligible) throw paymentError(inspected.reason);
    let attempt = (await tx.query(
      `SELECT * FROM pesapal_payment_attempts WHERE pay_link_id = $1 AND environment = $2
        AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [link.id, ready.environment]
    )).rows[0];
    if (attempt) {
      if (attempt.merchant_profile !== ready.merchantProfile) throw paymentError('merchant_profile_changed');
      if (!isDeepStrictEqual(attempt.purchase_snapshot.purchase, inspected.snapshot)) throw paymentError('purchase_changed');
      return { link, attempt };
    }
    const customer = checkoutCustomer(link, input, inspected);
    attempt = (await tx.query(
      `INSERT INTO pesapal_payment_attempts
        (pay_link_id, environment, merchant_profile, merchant_reference, amount_ugx, currency, purchase_snapshot)
       VALUES ($1, $2, $3, $4, $5, 'UGX', $6::jsonb) RETURNING *`,
      [link.id, ready.environment, ready.merchantProfile, `MK-${crypto.randomUUID()}`, pesapal.parseWholeUgx(link.amount_ugx),
        JSON.stringify({ purchase: inspected.snapshot, customer, description: String(link.description).slice(0, 100) })]
    )).rows[0];
    return { link, attempt };
  });
  const { link, attempt } = reservation;
  if (!attempt || attempt.creation_state !== 'reserved') return startResult(link, attempt);
  const claimId = crypto.randomUUID();
  const sending = (await db.query(
    `UPDATE pesapal_payment_attempts SET creation_state = 'sending', submit_started_at = NOW(), submit_claim_id = $2,
            last_error_code = NULL WHERE id = $1 AND creation_state = 'reserved' AND tracking_id IS NULL RETURNING *`,
    [attempt.id, claimId]
  )).rows[0];
  if (!sending) {
    const current = (await db.query('SELECT * FROM pesapal_payment_attempts WHERE id = $1', [attempt.id])).rows[0];
    return startResult(link, current);
  }
  let submitted;
  try {
    submitted = await client.submit({ reference: sending.merchant_reference, amountUgx: Number(sending.amount_ugx),
      description: sending.purchase_snapshot.description || `makaug payment ${link.code}`, customer: sending.purchase_snapshot.customer,
      callbackUrl: `${ready.publicOrigin}/pay/${encodeURIComponent(link.code)}/pesapal-return`, notificationId: client.notificationId });
  } catch (error) {
    const unknown = error.outcome === 'unknown';
    const rejected = error.outcome === 'rejected';
    await db.query(
      `UPDATE pesapal_payment_attempts SET creation_state = $3, last_error_code = $4,
              review_reason = CASE WHEN $3 = 'unknown' THEN 'creation_unknown' ELSE NULL END,
              closed_at = CASE WHEN $3 = 'rejected' THEN NOW() ELSE NULL END,
              submit_started_at = CASE WHEN $3 = 'reserved' THEN NULL ELSE submit_started_at END,
              next_check_at = NOW() + INTERVAL '1 minute'
        WHERE id = $1 AND submit_claim_id = $2 AND creation_state = 'sending' AND tracking_id IS NULL`,
      [attempt.id, claimId, unknown ? 'unknown' : (rejected ? 'rejected' : 'reserved'), safePaymentCode(error)]
    );
    const current = (await db.query('SELECT * FROM pesapal_payment_attempts WHERE id = $1', [attempt.id])).rows[0];
    const currentLink = await loadLink(db, link.code);
    return startResult(currentLink, current);
  }
  return withPaymentTransaction(db, async (tx) => {
    const currentLink = (await tx.query('SELECT * FROM pay_links WHERE id = $1 FOR UPDATE', [link.id])).rows[0];
    const current = (await tx.query('SELECT * FROM pesapal_payment_attempts WHERE id = $1 FOR UPDATE', [attempt.id])).rows[0];
    if (submitted.reference !== current.merchant_reference || current.tracking_id && current.tracking_id !== submitted.trackingId) {
      throw paymentError('tracking_binding_conflict');
    }
    const tracked = (await tx.query(
      `UPDATE pesapal_payment_attempts SET tracking_id = $2, redirect_url = COALESCE(redirect_url, $3), creation_state = 'tracked',
              last_error_code = NULL, review_reason = CASE WHEN review_reason = 'creation_unknown' THEN NULL ELSE review_reason END
        WHERE id = $1 RETURNING *`, [attempt.id, submitted.trackingId, submitted.checkoutUrl]
    )).rows[0];
    return startResult(currentLink, tracked);
  });
}

async function latestPesapalAttempt(db, linkId) {
  return (await db.query('SELECT * FROM pesapal_payment_attempts WHERE pay_link_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [linkId])).rows[0] || null;
}

async function observePesapalPayment(db, { trackingId, reference, source = 'ipn', expectedCode = null } = {}) {
  if (!TRACKING_ID.test(trackingId || '') || !MERCHANT_REFERENCE.test(reference || '') ||
      !['ipn', 'return', 'recovery', 'reconcile', 'admin'].includes(source)) throw paymentError('invalid_notification', 400);
  trackingId = trackingId.toLowerCase();
  const client = pesapalClient();
  await assertPesapalDatabase(db, client.environment);
  const initial = (await db.query(
    `SELECT a.*, l.code FROM pesapal_payment_attempts a JOIN pay_links l ON l.id = a.pay_link_id
      WHERE a.environment = $1 AND a.merchant_profile = $2 AND a.merchant_reference = $3`,
    [client.environment, client.merchantProfile, reference]
  )).rows[0];
  if (!initial) throw paymentError('unknown_reference', 404);
  if (expectedCode && String(expectedCode).toUpperCase() !== initial.code) throw paymentError('wrong_callback_code', 400);
  if (initial.tracking_id && initial.tracking_id !== trackingId) throw paymentError('wrong_tracking_id', 400);
  if (!initial.tracking_id && !['sending', 'unknown'].includes(initial.creation_state)) throw paymentError('tracking_not_bound', 409);
  const started = new Date().toISOString();
  let observed;
  try {
    observed = await client.status(trackingId);
  } catch (error) {
    await db.query(
      `UPDATE pesapal_payment_attempts SET last_error_code = $2, next_check_at = NOW() + INTERVAL '1 minute',
              check_claim_until = NULL WHERE id = $1`, [initial.id, safePaymentCode(error)]
    );
    throw error;
  }
  if (observed.requestedTrackingId !== trackingId || observed.reference !== initial.merchant_reference ||
      observed.amountUgx !== Number(initial.amount_ugx) || observed.currency !== initial.currency) {
    await db.query(`UPDATE pesapal_payment_attempts SET review_reason = 'provider_facts_mismatch', last_error_code = 'provider_facts_mismatch',
      next_check_at = NOW() + INTERVAL '1 hour', check_claim_until = NULL WHERE id = $1`, [initial.id]);
    throw paymentError('provider_facts_mismatch');
  }
  let result;
  try {
    result = await withPaymentTransaction(db, async (tx) => {
      const link = (await tx.query('SELECT * FROM pay_links WHERE id = $1 FOR UPDATE', [initial.pay_link_id])).rows[0];
      const attempt = (await tx.query('SELECT * FROM pesapal_payment_attempts WHERE id = $1 FOR UPDATE', [initial.id])).rows[0];
      if (!link || !attempt || attempt.environment !== client.environment || attempt.merchant_profile !== client.merchantProfile ||
          attempt.merchant_reference !== observed.reference || attempt.tracking_id && attempt.tracking_id !== trackingId ||
          Number(attempt.amount_ugx) !== observed.amountUgx || attempt.currency !== observed.currency) throw paymentError('provider_facts_mismatch');
      await tx.query(
        `UPDATE pesapal_payment_attempts SET tracking_id = $2, creation_state = 'tracked', provider_status_code = $3,
                provider_method = $4, provider_confirmation_code = $5, observed_at = NOW(), observation_started_at = $6::timestamptz,
                check_count = check_count + 1, check_claim_until = NULL, last_error_code = NULL,
                next_check_at = NOW() + CASE WHEN application = 'not_applied' THEN INTERVAL '5 minutes' ELSE INTERVAL '1 day' END,
                review_reason = CASE WHEN review_reason = 'creation_unknown' THEN NULL ELSE review_reason END
          WHERE id = $1`, [attempt.id, trackingId, observed.statusCode, observed.method, observed.confirmationCode, started]
      );
      if (observed.statusCode === 3 || attempt.reversed_at) {
        await tx.query(`UPDATE pesapal_payment_attempts SET reversed_at = COALESCE(reversed_at, NOW()), review_reason = 'reversed',
          closed_at = COALESCE(closed_at, NOW()), next_check_at = NOW() + INTERVAL '1 day' WHERE id = $1`, [attempt.id]);
        if (attempt.ledger_entry_id) await tx.query(
          "UPDATE revenue_entries SET payment_review_reason = 'reversed' WHERE id = $1 AND pesapal_attempt_id = $2",
          [attempt.ledger_entry_id, attempt.id]
        );
        await queueReview(tx, link, { attemptId: attempt.id, entryId: attempt.ledger_entry_id, reason: 'reversed' });
        return { paid: link.status === 'paid', state: 'reversed', review: true, code: link.code, durable_notices: true };
      }
      if (observed.statusCode !== 1) {
        if (observed.statusCode === 2) await tx.query('UPDATE pesapal_payment_attempts SET closed_at = COALESCE(closed_at, NOW()) WHERE id = $1', [attempt.id]);
        return { paid: link.status === 'paid', state: observed.statusCode === 2 ? 'failed' : 'pending', code: link.code };
      }
      return acceptCollectionTx(tx, link, {
        provider: 'Pesapal', actor: 'pesapal', paidMethod: 'pesapal', verification: 'pesapal_transaction', attemptId: attempt.id,
        snapshot: attempt.purchase_snapshot.purchase,
        payment: { method: 'pesapal', account_key: 'pesapal_ugx', amount_ugx: observed.amountUgx, reference: trackingId,
          paid_at: observed.paidAt || undefined, payer_name: link.payer_name,
          payer_phone: link.payer_phone || attempt.purchase_snapshot.customer?.phone,
          note: `Pesapal ${observed.method || 'payment'}; reference ${link.code}; ${observed.confirmationCode || ''}` }
      });
    });
  } catch (error) {
    await db.query(`UPDATE pesapal_payment_attempts SET last_error_code = $2,
      review_reason = CASE WHEN $2 = 'receipt_conflict' THEN 'receipt_conflict'
                          WHEN $2 = 'payment_fulfillment_error' THEN 'fulfillment_requires_review' ELSE review_reason END,
      next_check_at = NOW() + INTERVAL '1 minute', check_claim_until = NULL WHERE id = $1`, [initial.id, safePaymentCode(error)]);
    throw error;
  }
  paymentNotices.kickPaymentNotices(db);
  return result;
}

async function recoverPesapalAttempt(db, { attemptId, trackingId, actor } = {}) {
  if (!TRACKING_ID.test(attemptId || '') || !TRACKING_ID.test(trackingId || '') || !actor) throw paymentError('invalid_recovery', 400);
  const attempt = (await db.query('SELECT * FROM pesapal_payment_attempts WHERE id = $1', [attemptId])).rows[0];
  if (!attempt) throw paymentError('unknown_attempt', 404);
  return observePesapalPayment(db, { trackingId, reference: attempt.merchant_reference, source: 'recovery' });
}

async function reconcilePesapalPayments(db, { limit = 25 } = {}) {
  const ready = pesapal.readiness();
  if (!ready.environment || !ready.credentialsConfigured || ready.countryCode !== 'UG') return { checked: 0, skipped: 'not_configured' };
  const client = pesapalClient();
  await assertPesapalDatabase(db, client.environment);
  await db.query(`UPDATE pesapal_payment_attempts SET creation_state = 'unknown', review_reason = 'creation_unknown',
      last_error_code = 'submission_interrupted' WHERE environment = $1 AND merchant_profile = $2
      AND creation_state = 'sending' AND tracking_id IS NULL AND submit_started_at < NOW() - INTERVAL '2 minutes'`,
  [client.environment, client.merchantProfile]);
  const count = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 25)));
  const rows = (await db.query(
    `WITH due AS (
       SELECT id FROM pesapal_payment_attempts WHERE environment = $1 AND merchant_profile = $2 AND tracking_id IS NOT NULL
         AND next_check_at <= NOW() AND (check_claim_until IS NULL OR check_claim_until < NOW())
       ORDER BY next_check_at, id LIMIT $3 FOR UPDATE SKIP LOCKED
     ) UPDATE pesapal_payment_attempts a SET check_claim_until = NOW() + INTERVAL '90 seconds'
       FROM due WHERE a.id = due.id RETURNING a.*`, [client.environment, client.merchantProfile, count]
  )).rows;
  const results = { checked: rows.length, paid: 0, review: 0, failed: 0 };
  for (const row of rows) {
    try {
      const result = await observePesapalPayment(db, { trackingId: row.tracking_id, reference: row.merchant_reference, source: 'reconcile' });
      if (result.paid && !result.already) results.paid += 1;
      if (result.review) results.review += 1;
    } catch (error) {
      results.failed += 1;
      logger.warn('Pesapal reconciliation needs retry', { attemptId: row.id, code: safePaymentCode(error) });
    }
  }
  return results;
}

async function listPesapalAttempts(db, { limit = 100 } = {}) {
  return (await db.query(
    `SELECT a.id, a.pay_link_id, l.code, l.description, a.environment, a.merchant_profile, a.merchant_reference,
            a.amount_ugx, a.currency, a.creation_state, a.tracking_id, a.provider_status_code, a.provider_method,
            a.reversed_at, a.review_reason, a.application, a.ledger_entry_id, a.next_check_at, a.check_count,
            a.last_error_code, a.created_at, a.updated_at FROM pesapal_payment_attempts a
       JOIN pay_links l ON l.id = a.pay_link_id ORDER BY a.created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(300, Math.trunc(Number(limit) || 100)))]
  )).rows.map((row) => ({ ...row, amount_ugx: Number(row.amount_ugx), state: checkoutState(row) }));
}

/** Mobile money: "I have paid" from the pay page becomes a normal payment claim. */
async function createMomoClaim(db, code, { reference, phone, name } = {}) {
  const link = await loadLink(db, code);
  if (!link) throw revenue.httpError(404, 'Payment link not found');
  if (link.status === 'paid') throw revenue.httpError(409, 'This has already been paid — thank you!');
  const txid = String(reference || '').replace(/\s+/g, '').slice(0, 60);
  if (txid.length < 5) throw revenue.httpError(400, 'Enter the transaction ID from your MoMo message.');
  const existing = (await db.query(
    `SELECT id FROM payment_claims WHERE pay_link_id = $1 AND LOWER(reference) = LOWER($2) LIMIT 1`, [link.id, txid])).rows[0];
  if (existing) return { claim_id: existing.id, duplicate: true };
  const claim = (await db.query(
    `INSERT INTO payment_claims (source, payer_phone, payer_name, agent_id, property_id, st_listing_id, purpose, reference, amount_ugx, method, message, pay_link_id)
     VALUES ('pay_link', $1, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, 'mtn_momo', $9, $10) RETURNING *`,
    [digits(phone) || link.payer_phone, String(name || '').trim().slice(0, 120) || link.payer_name, link.agent_id, link.property_id, link.st_listing_id,
      link.purpose, txid, link.amount_ugx, `Paid by MoMo from pay link ${link.code}`, link.id]
  )).rows[0];
  await db.query('UPDATE pay_links SET claim_id = $2, updated_at = NOW() WHERE id = $1', [link.id, claim.id]);
  const matched = await billingOps.matchClaimToSms(db, claim).catch(() => null);

  // Somebody has just told us they paid, and nothing used to say so out loud.
  // A claim is only money once a human confirms it — matching the wallet SMS
  // deliberately does not auto-confirm — so a claim nobody is told about sits in
  // the admin queue until somebody happens to open it. The WhatsApp receipt path
  // has always alerted the team; this one, the button on the payment page, did
  // not.
  try {
    const desk = require('./leadDeskService');
    const handoff = require('./leadHandoffService');
    const who = [claim.payer_name, claim.payer_phone ? `+${digits(claim.payer_phone)}` : '']
      .filter(Boolean).join(' ') || 'Someone';
    const forWhat = link.agent_name ? `${link.agent_name}'s subscription` : (link.description || link.purpose || 'a payment');
    const body = [
      '🧾 *Payment claim to check*',
      `${who} says they have paid ${billingOps.ugx(link.amount_ugx)} for ${forWhat}.`,
      `Transaction ID: ${txid}`,
      matched?.sms_id ? 'It matches a wallet SMS we received.' : 'No matching wallet SMS yet.',
      '',
      'It is NOT counted until someone confirms it in Admin › Sales & Revenue.'
    ].join('\n');
    if (typeof desk.sendToTeam === 'function') await desk.sendToTeam(db, body, 'payment_claim_to_check');
    const onList = new Set((typeof desk.alertRecipients === 'function' ? desk.alertRecipients() : []).map((p) => digits(p).slice(-9)));
    const settings = await billingOps.getSettings(db).catch(() => ({}));
    for (const confirmer of Array.isArray(settings.confirmers) ? settings.confirmers : []) {
      const num = digits(confirmer?.phone);
      if (num.length >= 9 && !onList.has(num.slice(-9))) {
        await handoff.deliverWhatsapp({ to: num, body, kind: 'payment_claim_confirmer', leadId: null, nonce: `${claim.id}:${num}` }).catch(() => null);
      }
    }
  } catch (error) {
    logger.warn('Team alert for a pay-link payment claim failed', { claimId: claim.id, error: error.message });
  }
  return { claim_id: claim.id };
}

/**
 * A link has left the building.
 *
 * sendPayLink stamps this itself, but it sends through leadHandoffService. The
 * WhatsApp staff flow queues on the live bridge instead, and if it did not
 * stamp the row the link would look as though it had never been sent — which
 * is precisely the state payLinksAwaitingPayment below is trying to find.
 */
async function recordPayLinkSent(db, { code, to, status = 'queued' } = {}) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return (await db.query(
    `UPDATE pay_links
        SET sent_to = COALESCE(NULLIF($2, ''), sent_to),
            sent_at = NOW(),
            sent_status = $3,
            updated_at = NOW()
      WHERE code = $1
      RETURNING *`,
    [clean, digits(to), String(status || 'queued').slice(0, 40)]
  )).rows[0] || null;
}

/**
 * Closing the loop.
 *
 * Sending a payment link is the easy half. The half that was missing is
 * knowing, days later, which of them nobody ever paid — because an open link
 * makes no noise. This is the worklist: every link that went out, is still
 * open, and has been sitting there longer than `afterDays`, oldest first, with
 * whether the person has even opened the page.
 *
 * Opened-but-unpaid and never-opened are different problems (one needs a
 * nudge about paying, the other needs a nudge about the link arriving at all),
 * so the caller is given both rather than a single "unpaid" count.
 */
async function payLinksAwaitingPayment(db, { afterDays = 3, limit = 100 } = {}) {
  const days = Math.max(0, Math.min(365, Number(afterDays) || 0));
  return (await db.query(
    `SELECT l.code, l.purpose, l.description, l.amount_ugx, l.payer_name, l.payer_phone,
            l.sent_to, l.sent_at, l.opened_at, l.created_by, l.created_at,
            a.id AS agent_id, a.full_name AS agent_name, a.status AS agent_status, a.fee_exempt,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - l.sent_at)) / 86400)::int AS days_waiting
       FROM pay_links l
       LEFT JOIN agents a ON a.id = l.agent_id
      WHERE l.status = 'open'
        AND l.sent_at IS NOT NULL
        AND l.sent_at < NOW() - ($1 || ' days')::interval
      ORDER BY l.sent_at ASC
      LIMIT $2`,
    [String(days), Math.min(300, Math.max(1, Number(limit) || 100))]
  )).rows.map((row) => ({
    ...row,
    url: payUrl(row.code),
    // The two different problems, named, so a worklist reads as a worklist.
    next_step: row.opened_at
      ? `Opened the page ${row.days_waiting} day${row.days_waiting === 1 ? '' : 's'} ago and has not paid — ask what is stopping them`
      : `Sent ${row.days_waiting} day${row.days_waiting === 1 ? '' : 's'} ago, never opened — check the number and send it again`
  }));
}

/** How the sending is going, in the four numbers anybody actually asks for. */
async function payLinkSendStats(db, { sinceDays = 30 } = {}) {
  const days = Math.max(1, Math.min(365, Number(sinceDays) || 30));
  const row = (await db.query(
    `SELECT COUNT(*)::int AS created,
            COUNT(sent_at)::int AS sent,
            COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
            COUNT(*) FILTER (WHERE status = 'open' AND sent_at IS NOT NULL)::int AS awaiting_payment,
            COUNT(*) FILTER (WHERE status = 'open' AND sent_at IS NOT NULL AND opened_at IS NULL)::int AS never_opened
       FROM pay_links
      WHERE created_at > NOW() - ($1 || ' days')::interval`,
    [String(days)]
  )).rows[0] || {};
  return {
    since_days: days,
    created: Number(row.created || 0),
    sent: Number(row.sent || 0),
    paid: Number(row.paid || 0),
    awaiting_payment: Number(row.awaiting_payment || 0),
    never_opened: Number(row.never_opened || 0)
  };
}

async function listPayLinks(db, { limit = 100 } = {}) {
  return (await db.query(
    `SELECT l.*, COALESCE(p.title, st.title) AS property_title, a.full_name AS agent_name
       FROM pay_links l
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN st_listing st ON st.id = l.st_listing_id
       LEFT JOIN agents a ON a.id = l.agent_id
      ORDER BY l.created_at DESC LIMIT $1`,
    [Math.min(300, Math.max(1, Number(limit) || 100))]
  )).rows.map((l) => ({ ...l, url: payUrl(l.code), card_text: money(l.card_amount_minor, l.card_currency) }));
}

async function cancelPayLink(db, code, actor = 'admin') {
  const row = (await db.query(
    `UPDATE pay_links SET status = 'cancelled', updated_at = NOW(), created_by = COALESCE(created_by, $2) WHERE code = $1 AND status = 'open' RETURNING *`,
    [String(code || '').toUpperCase(), actor]
  )).rows[0];
  if (!row) throw revenue.httpError(409, 'Only an open link can be cancelled');
  return row;
}

/** Make sure Revolut sends order events to us, and keep the signing secret. */
async function ensureRevolutWebhook(db) {
  if (!revolut.isConfigured()) return { configured: false };
  const url = `${site()}/api/pay/webhooks/revolut`;
  const hooks = await revolut.listWebhooks();
  let hook = (Array.isArray(hooks) ? hooks : []).find((h) => h.url === url);
  if (!hook) hook = await revolut.createWebhook(url);
  let secret = hook.signing_secret;
  if (!secret && hook.id) secret = (await revolut.getWebhook(hook.id).catch(() => ({}))).signing_secret;
  if (secret) {
    await db.query(
      `INSERT INTO billing_settings (key, value, updated_by, updated_at) VALUES ('revolut_webhook', $1::jsonb, 'system', NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ id: hook.id, url, signing_secret: secret })]
    );
  }
  return { configured: true, id: hook.id, url, events: hook.events || [] };
}

async function webhookSecret(db) {
  if (process.env.REVOLUT_WEBHOOK_SIGNING_SECRET) return process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;
  const row = (await db.query(`SELECT value FROM billing_settings WHERE key = 'revolut_webhook'`).catch(() => ({ rows: [] }))).rows[0];
  return row?.value?.signing_secret || '';
}

/** Every few minutes: any card checkout still open gets checked with Revolut. */
async function sweepOpenCardOrders(db) {
  if (!revolut.isConfigured()) return { skipped: 'not_configured' };
  const rows = (await db.query(
    `SELECT * FROM pay_links WHERE status = 'open' AND provider_order_id IS NOT NULL AND updated_at > NOW() - INTERVAL '7 days'
      ORDER BY updated_at DESC LIMIT 50`
  )).rows;
  let paid = 0;
  for (const link of rows) {
    try {
      const order = await revolut.getOrder(link.provider_order_id);
      const r = await settleFromOrder(db, link, order);
      if (r.paid && !r.already) paid += 1;
    } catch (error) {
      logger.warn('Card order check failed', { code: link.code, error: error.message });
    }
  }
  return { checked: rows.length, paid };
}

let sweepTimer = null;
let payLinkRunning = false;
function startPayLinkScheduler(db) {
  const sweepEnabled = process.env.PAY_LINK_SWEEP_ENABLED !== 'false';
  const noticesEnabled = process.env.PAYMENT_NOTICE_DISPATCH_ENABLED !== 'false';
  if (sweepTimer || !process.env.DATABASE_URL || !sweepEnabled && !noticesEnabled) return;
  const tick = async () => {
    if (payLinkRunning) return { skipped: true, reason: 'already_running' };
    payLinkRunning = true;
    try {
      const results = await Promise.allSettled([
        sweepEnabled ? sweepOpenCardOrders(db) : Promise.resolve({ skipped: 'disabled' }),
        sweepEnabled ? reconcilePesapalPayments(db) : Promise.resolve({ skipped: 'disabled' }),
        noticesEnabled ? paymentNotices.drainPaymentNotices(db) : Promise.resolve({ skipped: 'disabled' })
      ]);
      return Object.fromEntries(results.map((result, index) => [ ['revolut', 'pesapal', 'notices'][index],
        result.status === 'fulfilled' ? result.value : { error: safePaymentCode(result.reason) }]));
    } catch (error) {
      logger.warn('Pay link sweep failed', { error: error.message });
      return { error: error.message };
    } finally {
      payLinkRunning = false;
    }
  };
  sweepTimer = setInterval(() => { observeJob('pay_link', tick).catch(() => {}); }, 5 * 60_000);
  sweepTimer.unref?.();
  setTimeout(() => { observeJob('pay_link', tick).catch(() => {}); }, BOOT_DELAY_MS.pay_link).unref?.();
  setTimeout(() => {
    if (sweepEnabled) ensureRevolutWebhook(db).then((r) => logger.info('Revolut webhook', r)).catch((error) => logger.warn('Revolut webhook setup failed', { error: error.message }));
  }, 30_000).unref?.();
}

module.exports = {
  newCode,
  payUrl,
  cardSettings,
  cardMinorFor,
  money,
  loadLink,
  createPayLink,
  payLinkMessage,
  sendPayLink,
  pageData,
  startCardCheckout,
  settleFromOrder,
  refreshLink,
  handleRevolutEvent,
  createMomoClaim,
  recordShortTermPayment,
  recordShortTermPaymentTx,
  recordHostedPayment,
  recordHostedPaymentTx,
  startPesapalCheckout,
  observePesapalPayment,
  recoverPesapalAttempt,
  reconcilePesapalPayments,
  listPesapalAttempts,
  settleConfirmedClaim,
  notifyPaid,
  pendingAgentPaid,
  listPayLinks,
  recordPayLinkSent,
  payLinksAwaitingPayment,
  payLinkSendStats,
  cancelPayLink,
  ensureRevolutWebhook,
  webhookSecret,
  sweepOpenCardOrders,
  startPayLinkScheduler
};
