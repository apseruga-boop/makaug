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
const PRICING = require('../config/pricing');
const { exemptionState, exemptionLabel } = require('./agentFeeExemption');
const revenue = require('./revenueService');
const billingOps = require('./billingOpsService');
const revolut = require('./revolutMerchantService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');

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
// Retired and parked products (config/pricing.js off_sale) can't be paid for.
const OFF_SALE_KEYS = new Set(Object.keys(PRICING.off_sale));
function assertNotOffSale(...keys) {
  if (keys.some((key) => key && OFF_SALE_KEYS.has(String(key)))) {
    throw revenue.httpError(410, 'This product is no longer offered.');
  }
}

async function createPayLink(db, input = {}, actor = 'admin') {
  assertNotOffSale(input.purpose, input.product_key);
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
    amountUgx = amountUgx || PRICING.private_listing.amount_ugx;
    description = description || `makaug listing — 1 month: ${property.title || 'your property'}`.slice(0, 200);
    payerName = payerName || property.lister_name || null;
    payerPhone = payerPhone || digits(property.lister_phone) || null;
  } else if (purpose === 'agent_subscription') {
    const agent = (await db.query('SELECT id, full_name, phone, whatsapp, monthly_fee_ugx, fee_exempt, fee_exempt_until, approved_at, status FROM agents WHERE id = $1::uuid', [input.agent_id])).rows[0];
    if (!agent) throw revenue.httpError(404, 'Agent not found');
    // A still-exempt agent (fee_exempt and before fee_exempt_until) gets no
    // link by accident. Some have said they are happy to pay anyway:
    // allow_exempt is staff's explicit, logged override. The exemption is left
    // exactly as it was. Once the end date arrives they are billable normally.
    if (exemptionState(agent).exempt) {
      if (input.allow_exempt !== true) {
        throw revenue.httpError(409, `${agent.full_name} is ${exemptionLabel(agent)} — no payment needed`);
      }
      logger.info('Pay link for a fee-exempt agent created with the staff override', {
        event: 'pay_link_exempt_override', agentId: agent.id, by: actor, exemption: exemptionLabel(agent)
      });
    }
    agentId = agent.id;
    amountUgx = amountUgx || PRICING.agent_subscription.amount_ugx;
    // The description is public: it is on the /pay page the agent opens and in
    // the message they receive. So it says what they are paying for and
    // nothing else. That an exempt agent is paying by choice is OUR business,
    // not theirs to read on their own invoice — the team note carries it, and
    // the dashboard reads it off the agent's own exemption.
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
    stListingId = st.id;
    amountUgx = amountUgx || Number(st.listing_fee_ugx || PRICING.short_stay_host.amount_ugx);
    description = description || `makaug short stay — ${Number(st.listing_term_months || 3)} months: ${st.title || st.reference}`.slice(0, 200);
    payerName = payerName || st.host_name || null;
    payerPhone = payerPhone || digits(st.host_phone) || null;
  } else if (purpose === 'hosted_payment') {
    const pay = (await db.query('SELECT id, purpose, amount, currency, payer_name, payer_phone, metadata FROM payments WHERE id = $1::uuid', [input.payment_id])).rows[0];
    if (!pay) throw revenue.httpError(404, 'Payment not found');
    assertNotOffSale(pay.purpose, pay.metadata?.product_key);
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

  if (propertyId || agentId || stListingId) {
    const existing = (await db.query(
      `SELECT * FROM pay_links
        WHERE status = 'open' AND amount_ugx = $3
          AND (($1::uuid IS NOT NULL AND property_id = $1::uuid) OR ($2::uuid IS NOT NULL AND agent_id = $2::uuid)
               OR ($4::uuid IS NOT NULL AND st_listing_id = $4::uuid))
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC LIMIT 1`,
      [propertyId, agentId, amountUgx, stListingId]
    )).rows[0];
    if (existing) return { link: existing, url: payUrl(existing.code), reused: true };
  }

  const card = cardSettings(settings);
  const minor = cardMinorFor(amountUgx, card.rate);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const link = (await db.query(
        `INSERT INTO pay_links (code, purpose, property_id, agent_id, st_listing_id, payment_id, description, amount_ugx, card_currency, card_amount_minor, fx_rate_ugx,
                                payer_name, payer_phone, created_by)
         VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [newCode(), purpose, propertyId, agentId, stListingId, paymentId, description, amountUgx, card.currency, minor, card.rate, payerName, payerPhone, actor]
      )).rows[0];
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
  return {
    code: link.code,
    status: link.status,
    description: link.description,
    amount_ugx: Number(link.amount_ugx),
    amount_ugx_text: billingOps.ugx(link.amount_ugx),
    card_text: money(link.card_amount_minor, link.card_currency),
    card_available: card.enabled && revolut.isConfigured(),
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

/** A short-stay fee is paid: the listing's 3 months run from today, recorded on the listing too. */
async function markShortTermPaid(db, { stListingId, method, reference, amountUgx, actor }) {
  if (!stListingId) return null;
  const stMethod = { revolut_card: 'card', mtn_momo: 'mtn_mobile_money', airtel_money: 'airtel_money', bank_transfer: 'bank_transfer', absa_ugx: 'bank_transfer', absa_usd: 'bank_transfer', cash: 'cash' }[method] || 'other';
  const updated = (await db.query(
    `UPDATE st_listing
        SET listing_fee_status = 'paid',
            -- First payment: the paid months run from today. A renewal adds on to what is left.
            expires_at = CASE WHEN listing_fee_status = 'paid' THEN GREATEST(COALESCE(expires_at, NOW()), NOW()) ELSE NOW() END
                         + (listing_term_months || ' months')::interval
      WHERE id = $1::uuid
      RETURNING id, expires_at, listing_term_months`,
    [stListingId]
  )).rows[0];
  if (!updated) return null;
  const existing = (await db.query('SELECT id FROM st_listing_payment WHERE listing_id = $1::uuid ORDER BY created_at DESC LIMIT 1', [stListingId])).rows[0];
  if (existing) {
    await db.query(
      `UPDATE st_listing_payment SET status = 'paid', method = $2, provider_reference = $3, amount_ugx = $4, recorded_by = $5,
              covers_from = CURRENT_DATE, covers_to = $6::date, updated_at = NOW()
        WHERE id = $1`,
      [existing.id, stMethod, reference || null, amountUgx, actor || 'payment', updated.expires_at]
    );
  } else {
    await db.query(
      `INSERT INTO st_listing_payment (listing_id, amount_ugx, method, provider_reference, status, covers_from, covers_to, recorded_by)
       VALUES ($1::uuid, $2, $3, $4, 'paid', CURRENT_DATE, $5::date, $6)`,
      [stListingId, amountUgx, stMethod, reference || null, updated.expires_at, actor || 'payment']
    );
  }
  return updated;
}

/** Advertising, boosts…: record the money, then switch on what was bought. */
async function recordHostedPayment(db, { paymentId, payment, actor }) {
  const pay = (await db.query('SELECT id, purpose FROM payments WHERE id = $1::uuid', [paymentId])).rows[0];
  const kind = HOSTED_KINDS[pay?.purpose] || 'other_income';
  const entry = await revenue.recordEntry(db, { ...payment, direction: 'in', kind, note: [payment.note, pay?.purpose ? `for ${pay.purpose.replace(/_/g, ' ')}` : ''].filter(Boolean).join(' · ') }, actor);
  const completed = await require('./paymentProviderService').completeHostedPayment(db, paymentId, { reference: payment.reference, method: payment.method });
  return { entry, completed };
}

/** Record a short-stay fee in the ledger and mark the listing paid. */
async function recordShortTermPayment(db, { stListingId, payment, actor }) {
  const entry = await revenue.recordEntry(db, { ...payment, direction: 'in', kind: 'short_term_fee' }, actor);
  await db.query('UPDATE revenue_entries SET st_listing_id = $2::uuid WHERE id = $1', [entry.id, stListingId]);
  const listing = await markShortTermPaid(db, { stListingId, method: payment.method, reference: payment.reference, amountUgx: entry.amount_ugx, actor });
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

/** Everyone who watches the money hears about each card payment, like MoMo ones. */
async function notifyTeamCardPayment(db, link, recorded, order) {
  const desk = require('./leadDeskService');
  if (typeof desk.sendToTeam !== 'function') return;
  const body = [
    `💳 *Card payment received* — ${link.payer_name || 'customer'}`,
    `${billingOps.ugx(link.amount_ugx)} (${money(order.amount || link.card_amount_minor, String(order.currency || link.card_currency).toUpperCase())}) · ${link.description}`,
    `Revolut order ${order.id} · link ${link.code}`,
    'Recorded and verified automatically in Sales & Revenue.'
  ].join('\n');
  await desk.sendToTeam(db, body, 'card_payment_received');
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
 * Record a completed Revolut order against its link, exactly once.
 * Claims the link ('settling') so two callbacks cannot record it twice.
 */
async function settleFromOrder(db, link, order) {
  if (!revolut.orderIsPaid(order)) {
    await db.query('UPDATE pay_links SET provider_state = $2, updated_at = NOW() WHERE id = $1', [link.id, order.state || null]);
    return { paid: false, state: order.state || null };
  }
  const claimed = (await db.query(
    `UPDATE pay_links SET status = 'settling', updated_at = NOW() WHERE id = $1 AND status = 'open' RETURNING *`,
    [link.id]
  )).rows[0];
  if (!claimed) return { paid: true, already: true };
  try {
    const payment = cardPaymentFor(claimed, order);
    let recorded;
    if (claimed.purpose === 'listing_fee' && claimed.property_id) {
      recorded = await billingOps.recordListingPayment(db, { propertyId: claimed.property_id, payment, actor: 'revolut' });
    } else if (claimed.purpose === 'agent_subscription' && claimed.agent_id) {
      const agent = (await db.query('SELECT * FROM agents WHERE id = $1::uuid', [claimed.agent_id])).rows[0];
      recorded = await revenue.recordAgentPayment(db, { agent, payment, actor: 'revolut' });
      if (agent?.billing_suspended_at) recorded.reinstatement = await billingOps.reinstateAgentAfterPayment(db, { agentId: agent.id, actor: 'revolut' });
      recorded.pendingAgent = await pendingAgentPaid(db, agent, { how: 'card', amountUgx: claimed.amount_ugx });
    } else if (claimed.purpose === 'short_term_fee' && claimed.st_listing_id) {
      recorded = await recordShortTermPayment(db, { stListingId: claimed.st_listing_id, payment, actor: 'revolut' });
    } else if (claimed.purpose === 'hosted_payment' && claimed.payment_id) {
      recorded = await recordHostedPayment(db, { paymentId: claimed.payment_id, payment, actor: 'revolut' });
    } else {
      recorded = { entry: await revenue.recordEntry(db, { ...payment, direction: 'in', kind: 'other_income' }, 'revolut') };
    }
    await db.query(
      `UPDATE revenue_entries SET verified_status = 'verified', verified_by = 'revolut', verified_at = NOW(), verification_source = 'revolut_order'
        WHERE id = $1`,
      [recorded.entry.id]
    );
    await db.query(
      `UPDATE pay_links SET status = 'paid', paid_method = 'card', paid_at = NOW(), entry_id = $2, provider_state = $3, updated_at = NOW() WHERE id = $1`,
      [claimed.id, recorded.entry.id, order.state]
    );
    logger.info('Card payment recorded', { code: claimed.code, order: order.id, entry: recorded.entry.id });
    notifyTeamCardPayment(db, claimed, recorded, order).catch(() => null);
    if (!recorded.reinstatement?.reinstated && !recorded.pendingAgent?.pending) await notifyPaid(db, claimed, recorded);
    return { paid: true, entry_id: recorded.entry.id };
  } catch (error) {
    // A duplicate means this order was recorded already: keep the link paid.
    if (error.status === 409) {
      await db.query(`UPDATE pay_links SET status = 'paid', paid_method = 'card', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW() WHERE id = $1`, [claimed.id]);
      return { paid: true, already: true };
    }
    await db.query(`UPDATE pay_links SET status = 'open', updated_at = NOW() WHERE id = $1 AND status = 'settling'`, [claimed.id]);
    logger.error('Recording a card payment failed', { code: claimed.code, order: order.id, error: error.message });
    throw error;
  }
}

/** Ask Revolut how the order behind this link stands, and record it if paid. */
async function refreshLink(db, code) {
  const link = await loadLink(db, code);
  if (!link) throw revenue.httpError(404, 'Payment link not found');
  if (link.status === 'paid') return { paid: true };
  if (!link.provider_order_id) return { paid: false, state: null };
  const order = await revolut.getOrder(link.provider_order_id);
  return settleFromOrder(db, link, order);
}

/** Webhook: never trusted on its own — we fetch the order from Revolut. */
async function handleRevolutEvent(db, event = {}) {
  const orderId = String(event.order_id || event.orderId || event.id || '').trim();
  if (!orderId) return { ignored: 'no_order_id' };
  const link = (await db.query('SELECT * FROM pay_links WHERE provider_order_id = $1', [orderId])).rows[0];
  if (!link) return { ignored: 'unknown_order' };
  if (link.status === 'paid') return { paid: true, already: true };
  const order = await revolut.getOrder(orderId);
  return settleFromOrder(db, link, order);
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

/** When a MoMo claim from a pay link is confirmed, close the link too. */
async function closeLinkForClaim(db, claimId, entryId) {
  await db.query(
    `UPDATE pay_links SET status = 'paid', paid_method = 'mtn_momo', paid_at = NOW(), entry_id = COALESCE(entry_id, $2), updated_at = NOW()
      WHERE id = (SELECT pay_link_id FROM payment_claims WHERE id = $1::uuid) AND status = 'open'`,
    [claimId, entryId || null]
  );
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
function startPayLinkScheduler(db) {
  if (sweepTimer || !process.env.DATABASE_URL || process.env.PAY_LINK_SWEEP_ENABLED === 'false') return;
  const tick = () => sweepOpenCardOrders(db).catch((error) => logger.warn('Pay link sweep failed', { error: error.message }));
  sweepTimer = setInterval(tick, 5 * 60_000);
  sweepTimer.unref?.();
  setTimeout(() => {
    ensureRevolutWebhook(db).then((r) => logger.info('Revolut webhook', r)).catch((error) => logger.warn('Revolut webhook setup failed', { error: error.message }));
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
  closeLinkForClaim,
  recordShortTermPayment,
  recordHostedPayment,
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
