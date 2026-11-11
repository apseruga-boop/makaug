'use strict';

/**
 * Mobile Money payments: whose money is this, and one tap to confirm it.
 *
 * Since 10 Nov 2026 people pay makaug with the MoMo merchant code. A merchant
 * payment asks for no reference, so the MK code that used to be "the
 * reference" is gone (Arthur: "all they need to do is fill in their business
 * name and we can always match it back by business name and the phone
 * number"). What we have instead:
 *
 *   - the merchant line's own SMS, forwarded here: amount, the number it came
 *     from, the name on that MoMo account, the transaction ID;
 *   - what we are waiting for: open payment links and "I have paid" claims,
 *     each with an amount, the payer's numbers and their names.
 *
 * A payment is matched by, in order: the transaction ID someone typed; the
 * number it came from and an amount that covers what is owed; the name and the
 * exact amount (or whole months of it). Two equally good answers is no answer:
 * a person decides. And a match is never money on its own — Ronald or Arthur
 * confirm it, in one tap from the WhatsApp alert (a signed link to a confirm
 * page) or by replying CONFIRM and the number.
 */

const crypto = require('crypto');

const logger = require('../config/logger');
const billingOps = require('./billingOpsService');

const CLAIM_WINDOW_DAYS = 21;
const LINK_WINDOW_DAYS = 60;
const SMS_WINDOW_DAYS = 21;
const CONFIRM_LINK_DAYS = 7;

// 0772 123456, +256 772 123 456, 256772123456 — a Ugandan mobile number.
const UG_PHONE = /(?:\+?256|\b0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/;

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function phoneKey(value) {
  const d = digits(value);
  return d.length >= 9 ? d.slice(-9) : '';
}

function prettyPhone(value) {
  const key = phoneKey(value);
  return key ? `0${key.slice(0, 3)} ${key.slice(3, 6)} ${key.slice(6)}` : '';
}

function ugx(n) {
  return billingOps.ugx(n);
}

/** The ledger method for money that arrived on this account. */
function methodForAccount(accountKey) {
  if (accountKey === 'mtn_momopay') return 'mtn_momopay';
  if (accountKey === 'airtel_money') return 'airtel_money';
  return 'mtn_momo';
}

/** The number and the name a money SMS came from. */
function smsPayer(sms = {}) {
  const counterparty = String(sms.counterparty || '');
  const phone = counterparty.match(UG_PHONE) || String(sms.body || '').match(UG_PHONE);
  const name = counterparty.replace(new RegExp(UG_PHONE.source, 'g'), ' ').replace(/[^A-Za-z .'-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { phoneKey: phone ? phoneKey(phone[0]) : '', name };
}

// Words that say nothing about who someone is: "Kato Real Estate Ltd" and
// "Mukasa Real Estate Ltd" must not match on "real estate ltd".
const NAME_NOISE = new Set([
  'ltd', 'limited', 'company', 'the', 'and', 'for', 'enterprises', 'enterprise', 'services', 'service', 'group',
  'investments', 'investment', 'real', 'estate', 'estates', 'properties', 'property', 'agency', 'agencies',
  'agent', 'agents', 'broker', 'brokers', 'independent', 'uganda', 'mrs', 'hon', 'homes', 'home', 'makaug'
]);

function nameTokens(value) {
  return new Set(String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && !NAME_NOISE.has(t)));
}

/**
 * "GEORGE WANYAMA" and "George Wanyama", or "Wanyama Estates" and "GEORGE
 * WANYAMA". One shared word is enough only when one side has a single word and
 * it is not a short, common one ("John", "Kato").
 */
function namesMatch(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  const shared = [...ta].filter((t) => tb.has(t));
  if (shared.length >= 2) return true;
  return shared.length === 1 && (ta.size === 1 || tb.size === 1) && shared[0].length >= 5;
}

/**
 * Does this much money fit what is owed? From the payer's own number, anything
 * that covers it (they may pay two months). On a name alone, the exact amount
 * or whole months of it, up to a year.
 */
function amountFits(paid, expected, how) {
  const p = Number(paid) || 0;
  const e = Number(expected) || 0;
  if (!(p > 0)) return false;
  if (!(e > 0)) return how === 'phone';
  if (how === 'phone') return p >= e;
  return p === e || (p % e === 0 && p / e <= 12);
}

function judge({ phones = [], names = [], expected = 0 } = {}, payer = {}, amount = 0) {
  if (payer.phoneKey && phones.includes(payer.phoneKey) && amountFits(amount, expected, 'phone')) return 'phone';
  if (payer.name && names.some((n) => namesMatch(n, payer.name)) && amountFits(amount, expected, 'name')) return 'name';
  return null;
}

/** One answer or none: two equally good candidates go to a person. */
function pickOne(judged = []) {
  const byPhone = judged.filter((j) => j.how === 'phone');
  if (byPhone.length === 1) return byPhone[0];
  if (byPhone.length > 1) return null;
  const byName = judged.filter((j) => j.how === 'name');
  return byName.length === 1 ? byName[0] : null;
}

// A claim with everything that says who it is from and what it is for.
const CLAIM_CONTEXT_SQL = `
  SELECT c.*, a.full_name AS agent_name, a.company_name AS agent_company, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
         p.lister_name, p.lister_phone, p.title AS property_title,
         st.host_name, st.host_phone, st.title AS stay_title,
         l.code AS link_code, l.payer_phone AS link_payer_phone, l.sent_to AS link_sent_to, l.payer_name AS link_payer_name,
         l.description AS link_description, l.amount_ugx AS link_amount_ugx,
         s.reference AS sms_reference, s.amount_ugx AS sms_amount_ugx, s.account_key AS sms_account_key,
         s.counterparty AS sms_counterparty, s.received_at AS sms_received_at
    FROM payment_claims c
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN properties p ON p.id = c.property_id
    LEFT JOIN st_listing st ON st.id = c.st_listing_id
    LEFT JOIN pay_links l ON l.id = c.pay_link_id
    LEFT JOIN money_sms_inbox s ON s.id = c.sms_id`;

function claimPhones(c = {}) {
  return [c.paid_from_phone, c.payer_phone, c.agent_phone, c.agent_whatsapp, c.lister_phone, c.host_phone, c.link_payer_phone, c.link_sent_to]
    .map(phoneKey).filter(Boolean);
}

function claimNames(c = {}) {
  return [c.business_name, c.payer_name, c.agent_name, c.agent_company, c.lister_name, c.host_name, c.link_payer_name].filter(Boolean);
}

function expectedFor(row = {}, settings = {}) {
  const fromRow = Number(row.link_amount_ugx || row.amount_ugx || 0);
  if (fromRow > 0) return fromRow;
  if (row.purpose === 'listing_fee') return Number(settings.lister_fee?.monthly_ugx || 20000);
  if (row.purpose === 'agent_subscription') return Number(settings.agent_fee?.monthly_ugx || 50000);
  return 0;
}

/** "George Wanyama — agent subscription", in the words the team uses. */
function whoAndWhat(row = {}) {
  if (row.agent_name || row.purpose === 'agent_subscription') {
    return `${row.agent_name || row.link_payer_name || row.payer_name || 'Agent'} — agent subscription`;
  }
  if (row.property_title || row.purpose === 'listing_fee') {
    return `${row.lister_name || row.payer_name || 'Private lister'} — listing: ${row.property_title || 'their property'}`;
  }
  if (row.stay_title || row.host_name || row.purpose === 'short_term_fee') {
    return `${row.host_name || row.payer_name || 'Host'} — short stay${row.stay_title ? `: ${row.stay_title}` : ''}`;
  }
  return row.link_description || row.description || `${row.payer_name || 'Payment'}`;
}

// --- Matching ---------------------------------------------------------------

/** A money SMS has arrived: is it the payment somebody already told us about? */
async function matchSmsToWaitingClaims(db, sms) {
  if (!sms?.id || sms.direction !== 'in' || !(Number(sms.amount_ugx) > 0)) return null;
  const payer = smsPayer(sms);
  if (!payer.phoneKey && !payer.name) return null;
  const settings = await billingOps.getSettings(db).catch(() => ({}));
  const rows = (await db.query(
    `${CLAIM_CONTEXT_SQL}
      WHERE c.status = 'pending' AND c.sms_id IS NULL AND c.created_at > NOW() - ($1 || ' days')::interval
      ORDER BY c.created_at DESC LIMIT 200`,
    [String(CLAIM_WINDOW_DAYS)]
  )).rows;
  const judged = rows
    .map((c) => ({ c, how: judge({ phones: claimPhones(c), names: claimNames(c), expected: expectedFor(c, settings) }, payer, sms.amount_ugx) }))
    .filter((j) => j.how);
  const pick = pickOne(judged);
  if (!pick) return null;
  const updated = (await db.query(
    `UPDATE payment_claims
        SET sms_id = $2, sms_matched_at = NOW(), amount_ugx = COALESCE($3, amount_ugx), reference = COALESCE(reference, $4), match_how = $5
      WHERE id = $1 AND sms_id IS NULL AND status = 'pending' RETURNING *`,
    [pick.c.id, sms.id, sms.amount_ugx, sms.reference || null, pick.how]
  )).rows[0];
  return updated ? { claim: { ...pick.c, ...updated, sms_reference: sms.reference, sms_amount_ugx: sms.amount_ugx, sms_account_key: sms.account_key, sms_counterparty: sms.counterparty }, how: pick.how, created: false } : null;
}

/**
 * A money SMS nobody has claimed: whose is it? An open payment link first
 * (it knows the amount, the number it went to and the name on it); then an
 * agent or private lister on the number it came from. A match becomes a claim
 * with the SMS already attached, waiting for a confirm.
 */
async function claimFromSms(db, sms) {
  if (!sms?.id || sms.direction !== 'in' || !(Number(sms.amount_ugx) > 0)) return null;
  const taken = (await db.query('SELECT id FROM payment_claims WHERE sms_id = $1 LIMIT 1', [sms.id])).rows[0];
  if (taken) return null;
  const payer = smsPayer(sms);
  if (!payer.phoneKey && !payer.name) return null;
  const settings = await billingOps.getSettings(db).catch(() => ({}));
  const links = (await db.query(
    `SELECT l.*, a.full_name AS agent_name, a.company_name AS agent_company, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
            p.lister_name, p.lister_phone, p.title AS property_title, st.host_name, st.host_phone, st.title AS stay_title
       FROM pay_links l
       LEFT JOIN agents a ON a.id = l.agent_id
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN st_listing st ON st.id = l.st_listing_id
      WHERE l.status = 'open' AND l.created_at > NOW() - ($1 || ' days')::interval
      ORDER BY COALESCE(l.sent_at, l.created_at) DESC LIMIT 300`,
    [String(LINK_WINDOW_DAYS)]
  )).rows;
  // One per thing owed: the newest link stands for the agent, listing or stay.
  const seen = new Set();
  const judged = [];
  for (const l of links) {
    const owner = l.agent_id || l.property_id || l.st_listing_id || l.payment_id || l.code;
    if (seen.has(owner)) continue;
    seen.add(owner);
    const how = judge({
      phones: [l.payer_phone, l.sent_to, l.agent_phone, l.agent_whatsapp, l.lister_phone, l.host_phone].map(phoneKey).filter(Boolean),
      names: [l.payer_name, l.agent_name, l.agent_company, l.lister_name, l.host_name].filter(Boolean),
      expected: l.amount_ugx
    }, payer, sms.amount_ugx);
    if (how) judged.push({ l, how });
  }
  const pick = pickOne(judged);
  let row = null;
  let how = null;
  if (pick) {
    row = {
      purpose: pick.l.purpose, agent_id: pick.l.agent_id, property_id: pick.l.property_id, st_listing_id: pick.l.st_listing_id,
      pay_link_id: pick.l.id, link_code: pick.l.code, link_description: pick.l.description, link_amount_ugx: pick.l.amount_ugx,
      agent_name: pick.l.agent_name, lister_name: pick.l.lister_name, property_title: pick.l.property_title,
      host_name: pick.l.host_name, stay_title: pick.l.stay_title, payer_name: pick.l.payer_name,
      notify_phone: pick.l.agent_whatsapp || pick.l.agent_phone || pick.l.lister_phone || pick.l.host_phone || pick.l.sent_to || pick.l.payer_phone
    };
    how = pick.how;
  } else if (payer.phoneKey) {
    // No link: an agent or a private lister on the number it came from.
    const ctx = await billingOps.payerContext(db, payer.phoneKey).catch(() => ({}));
    if (ctx.agent && !ctx.agent.removed_at) {
      const fee = Number(settings.agent_fee?.monthly_ugx || 50000);
      if (amountFits(sms.amount_ugx, fee, 'phone')) {
        row = { purpose: 'agent_subscription', agent_id: ctx.agent.id, agent_name: ctx.agent.full_name, link_amount_ugx: fee, notify_phone: payer.phoneKey };
        how = 'phone';
      }
    } else if (ctx.property) {
      const fee = Number(settings.lister_fee?.monthly_ugx || 20000);
      if (amountFits(sms.amount_ugx, fee, 'phone')) {
        row = { purpose: 'listing_fee', property_id: ctx.property.id, property_title: ctx.property.title, link_amount_ugx: fee, notify_phone: payer.phoneKey };
        how = 'phone';
      }
    }
  }
  if (!row) return null;
  const claim = (await db.query(
    `INSERT INTO payment_claims (source, payer_phone, payer_name, paid_from_phone, agent_id, property_id, st_listing_id, purpose,
                                 reference, amount_ugx, method, message, pay_link_id, sms_id, sms_matched_at, match_how)
     VALUES ('momo_sms', $1, $2, $1, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11::uuid, $12, NOW(), $13) RETURNING *`,
    [payer.phoneKey ? `256${payer.phoneKey}` : null, payer.name || null, row.agent_id || null, row.property_id || null, row.st_listing_id || null,
      row.purpose || 'other', sms.reference || null, sms.amount_ugx, methodForAccount(sms.account_key),
      `MoMo SMS: ${ugx(sms.amount_ugx)} from ${[payer.name, prettyPhone(payer.phoneKey)].filter(Boolean).join(' ')}`.slice(0, 1000),
      row.pay_link_id || null, sms.id, how]
  )).rows[0];
  if (row.pay_link_id) {
    await db.query('UPDATE pay_links SET claim_id = $2, updated_at = NOW() WHERE id = $1 AND claim_id IS NULL', [row.pay_link_id, claim.id]).catch(() => null);
  }
  return {
    claim: { ...row, ...claim, sms_reference: sms.reference, sms_amount_ugx: sms.amount_ugx, sms_account_key: sms.account_key, sms_counterparty: sms.counterparty },
    how,
    created: true,
    notify_phone: how === 'phone' ? row.notify_phone : null
  };
}

/** Somebody says they have paid: is the money already in the merchant line's SMS? */
async function matchClaimToRecentSms(db, claim) {
  if (!claim?.id || claim.sms_id) return null;
  const full = (await db.query(`${CLAIM_CONTEXT_SQL} WHERE c.id = $1::uuid`, [claim.id])).rows[0] || claim;
  const settings = await billingOps.getSettings(db).catch(() => ({}));
  const expected = expectedFor(full, settings);
  const phones = claimPhones(full);
  const names = claimNames(full);
  const smsRows = (await db.query(
    `SELECT s.* FROM money_sms_inbox s
      WHERE s.direction = 'in' AND s.amount_ugx IS NOT NULL AND s.matched_entry_id IS NULL
        AND s.received_at > NOW() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM payment_claims c WHERE c.sms_id = s.id)
      ORDER BY s.received_at DESC LIMIT 200`,
    [String(SMS_WINDOW_DAYS)]
  )).rows;
  const judged = smsRows
    .map((s) => ({ s, how: judge({ phones, names, expected }, smsPayer(s), s.amount_ugx) }))
    .filter((j) => j.how);
  const pick = pickOne(judged);
  if (!pick) return null;
  const updated = (await db.query(
    `UPDATE payment_claims
        SET sms_id = $2, sms_matched_at = NOW(), amount_ugx = COALESCE($3, amount_ugx), reference = COALESCE(reference, $4), match_how = $5
      WHERE id = $1 AND sms_id IS NULL RETURNING *`,
    [full.id, pick.s.id, pick.s.amount_ugx, pick.s.reference || null, pick.how]
  )).rows[0];
  return updated || null;
}

// --- One tap to confirm -----------------------------------------------------

function confirmSecret() {
  return String(process.env.PAYMENT_CONFIRM_SECRET || process.env.JWT_SECRET || process.env.AGENT_REPORT_CARD_SECRET || process.env.WHATSAPP_WEB_BRIDGE_TOKEN || '');
}

function signConfirm(claimId, confirmerKey, exp) {
  return crypto.createHmac('sha256', confirmSecret()).update(`payment-confirm:${claimId}:${confirmerKey}:${exp}`).digest('hex').slice(0, 32);
}

/** A link that lets one confirmer confirm one claim, for a week. */
function confirmToken(claimId, confirmerKey, { now = Date.now(), days = CONFIRM_LINK_DAYS } = {}) {
  if (!confirmSecret() || !/^[0-9a-f-]{36}$/i.test(String(claimId || '')) || !/^\d{9}$/.test(String(confirmerKey || ''))) return '';
  const exp = Math.floor(now / 1000 + days * 86400).toString(36);
  return `${claimId}.${confirmerKey}.${exp}.${signConfirm(claimId, confirmerKey, exp)}`;
}

function readConfirmToken(token, { now = Date.now() } = {}) {
  const [claimId, confirmerKey, exp, sig] = String(token || '').split('.');
  if (!/^[0-9a-f-]{36}$/i.test(claimId || '') || !/^\d{9}$/.test(confirmerKey || '') || !/^[0-9a-z]{1,10}$/.test(exp || '') || !/^[0-9a-f]{32}$/.test(sig || '')) return null;
  if (!confirmSecret()) return null;
  const expected = signConfirm(claimId, confirmerKey, exp);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (parseInt(exp, 36) * 1000 < now) return { claimId, confirmerKey, expired: true };
  return { claimId, confirmerKey, expired: false };
}

function confirmUrl(claimId, confirmerKey) {
  const token = confirmToken(claimId, confirmerKey);
  return token ? `${billingOps.SITE()}/pay/confirm/${token}` : '';
}

async function confirmers(db) {
  const settings = await billingOps.getSettings(db).catch(() => ({}));
  return (Array.isArray(settings.confirmers) ? settings.confirmers : [])
    .map((c) => ({ name: String(c?.name || '').trim(), key: phoneKey(c?.phone), to: digits(c?.phone) }))
    .filter((c) => c.key);
}

async function confirmerFor(db, phone) {
  const key = phoneKey(phone);
  if (!key) return null;
  return (await confirmers(db)).find((c) => c.key === key) || null;
}

async function loadClaim(db, claimId) {
  return (await db.query(`${CLAIM_CONTEXT_SQL} WHERE c.id = $1::uuid`, [claimId])).rows[0] || null;
}

/**
 * A confirmer says yes. Only for a claim the merchant line's SMS backs up: the
 * SMS is the proof the money arrived, and its transaction ID and amount are
 * what get recorded. A claim with no SMS is confirmed in King, by someone who
 * has seen the money.
 */
async function confirmByConfirmer(db, { claimId, confirmerKey, via = 'link' } = {}) {
  const confirmer = (await confirmers(db)).find((c) => c.key === confirmerKey) || null;
  if (!confirmer) throw Object.assign(new Error('Only the payment confirmers (Ronald and Arthur) can confirm payments.'), { status: 403 });
  const claim = await loadClaim(db, claimId);
  if (!claim) throw Object.assign(new Error('Payment not found'), { status: 404 });
  if (claim.status !== 'pending') return { already: claim.status, claim };
  if (!claim.sms_id) {
    throw Object.assign(new Error('No MoMo SMS matches this payment yet, so it cannot be confirmed from WhatsApp. Check the merchant phone, then confirm it in King › Sales & Revenue.'), { status: 409 });
  }
  const actor = `whatsapp:${confirmer.name || confirmer.key}`;
  const result = await billingOps.confirmClaim(db, {
    claimId: claim.id,
    actor,
    method: methodForAccount(claim.sms_account_key),
    amountUgx: claim.sms_amount_ugx || claim.amount_ugx,
    note: via === 'link' ? 'Confirmed in one tap from WhatsApp' : 'Confirmed by a WhatsApp reply'
  });
  const after = await billingOps.afterClaimConfirmed(db, { claimId: claim.id, result, actor, audit: true });
  return { claim, result, after, confirmer };
}

function confirmedLine({ claim = {}, result = {}, after = {} } = {}) {
  const entry = result.entry || {};
  const until = result.period_end ? billingOps.prettyDate(result.period_end) : '';
  return [
    `✅ *Recorded* — ${ugx(entry.amount_ugx || claim.sms_amount_ugx || claim.amount_ugx)} · ${whoAndWhat(claim)}`,
    entry.reference ? `Transaction ID: ${entry.reference}` : '',
    until ? `Paid until ${until}.` : '',
    after.receipt_sent ? 'Their receipt has gone to them on WhatsApp.' : ''
  ].filter(Boolean).join('\n');
}

// --- Telling the team -------------------------------------------------------

/**
 * One alert per person. Ronald and Arthur get it with their own confirm link;
 * anyone else on the team alert list gets it without one.
 */
async function alertMoneyTeam(db, { kind, nonce, build }) {
  const desk = require('./leadDeskService');
  const handoff = require('./leadHandoffService');
  const list = await confirmers(db);
  const confirmerKeys = new Set(list.map((c) => c.key));
  const others = (typeof desk.alertRecipients === 'function' ? desk.alertRecipients() : [])
    .map((to) => ({ to: digits(to), key: phoneKey(to) }))
    .filter((r, i, all) => r.key && !confirmerKeys.has(r.key) && all.findIndex((x) => x.key === r.key) === i);
  const sent = [];
  for (const person of [...list.map((c) => ({ ...c, confirmer: true })), ...others.map((r) => ({ ...r, confirmer: false }))]) {
    const body = build(person.confirmer ? person : null);
    if (!body) continue;
    const delivery = await handoff.deliverWhatsapp({ to: person.to, body, kind, leadId: null, nonce: `${nonce}:${person.key}` })
      .catch((error) => ({ status: 'failed', reason: error.message }));
    sent.push({ to: person.key, confirmer: person.confirmer, status: delivery?.status || 'unknown' });
  }
  return sent;
}

function howLine(how) {
  if (how === 'phone') return 'Matched by: the number it came from, and the amount';
  if (how === 'name') return 'Matched by: the name on the MoMo account and the exact amount — check it is them';
  if (how === 'reference') return 'Matched by: the transaction ID they sent';
  return '';
}

function confirmLines(claim, confirmer) {
  if (!confirmer) return ['Ronald or Arthur will confirm it.'];
  const url = confirmUrl(claim.id, confirmer.key);
  const phone = prettyPhone(claim.paid_from_phone || claim.payer_phone || claim.agent_whatsapp || claim.agent_phone || claim.lister_phone).replace(/\s+/g, '');
  return [
    url ? `👉 Tap to confirm: ${url}` : '',
    phone ? `(or reply *CONFIRM ${phone}*)` : '',
    'It is NOT counted until you confirm it.'
  ].filter(Boolean);
}

/** The money has arrived and we know whose it is: one tap for Ronald or Arthur. */
function smsMatchedAlert(claim, how, confirmer) {
  const payer = smsPayer({ counterparty: claim.sms_counterparty });
  const facts = [
    `💰 *MoMo payment in: ${ugx(claim.sms_amount_ugx || claim.amount_ugx)}*`,
    `From ${[payer.name, prettyPhone(payer.phoneKey)].filter(Boolean).join(' · ') || 'unknown'}`,
    (claim.sms_reference || claim.reference) ? `Transaction ID: ${claim.sms_reference || claim.reference}` : '',
    `For: ${whoAndWhat(claim)}${claim.link_code ? ` (link ${claim.link_code})` : ''}`,
    claim.business_name ? `They said they paid as *${claim.business_name}*` : '',
    howLine(how)
  ].filter(Boolean);
  return [...facts, '', ...confirmLines(claim, confirmer)].join('\n');
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** Somebody says they have paid (page or WhatsApp). */
function claimAlert(claim, { amountUgx = null } = {}, confirmer = null) {
  const name = claim.payer_name || claim.agent_name || claim.lister_name || claim.host_name || 'Someone';
  const who = claim.business_name && !sameName(claim.business_name, name) ? `${name} (${claim.business_name})` : (claim.business_name || name);
  const amount = amountUgx || claim.link_amount_ugx || claim.amount_ugx;
  const facts = [
    '🧾 *Payment claim to check*',
    `${who} says they have paid${amount ? ` *${ugx(amount)}*` : ''}.`,
    `For: ${whoAndWhat(claim)}${claim.link_code ? ` (link ${claim.link_code})` : ''}`,
    (claim.paid_from_phone || claim.payer_phone) ? `Paid from: ${prettyPhone(claim.paid_from_phone || claim.payer_phone)}` : '',
    claim.reference ? `Transaction ID: ${claim.reference}` : 'Transaction ID: not given — we match it by their number and name'
  ].filter(Boolean);
  if (claim.sms_id) {
    return [...facts, `✅ It matches a wallet SMS: ${ugx(claim.sms_amount_ugx || claim.amount_ugx)}${claim.sms_reference ? `, transaction ${claim.sms_reference}` : ''}`, '', ...confirmLines(claim, confirmer)].join('\n');
  }
  return [...facts, '⏳ No matching wallet SMS yet — check the merchant phone.', '', 'It is NOT counted until someone confirms it in Admin › Sales & Revenue.'].join('\n');
}

function unmatchedSmsAlert(sms) {
  const payer = smsPayer(sms);
  return [
    `📲 *MoMo payment in — not matched*`,
    `${ugx(sms.amount_ugx)} from ${[payer.name, prettyPhone(payer.phoneKey)].filter(Boolean).join(' · ') || 'unknown'}`,
    sms.reference ? `Transaction ID: ${sms.reference}` : '',
    'Nobody we are waiting on paid from this number or under this name. If you know who it is, record it in Admin › Sales & Revenue (it is under "MoMo SMS not recorded").'
  ].filter(Boolean).join('\n');
}

async function alertClaim(db, claim, opts = {}) {
  const full = (claim?.id ? await loadClaim(db, claim.id).catch(() => null) : null) || claim;
  return alertMoneyTeam(db, { kind: full.sms_id ? 'payment_claim_matched' : 'payment_claim_to_check', nonce: `claim:${full.id}:${full.sms_id || 'nosms'}`, build: (c) => claimAlert(full, opts, c) });
}

/** After a money SMS is stored: tell the right people, the right way. */
async function afterMoneySms(db, { sms, claimsMatched = [], autoClaim = null, matchedEntry = null } = {}) {
  if (!sms || sms.direction !== 'in' || !(Number(sms.amount_ugx) > 0) || matchedEntry) return { alerted: false };
  const handoff = require('./leadHandoffService');
  const matched = (claimsMatched || [])[0] || null;
  if (matched || autoClaim) {
    const claim = matched ? (await loadClaim(db, matched.id).catch(() => null)) || matched : autoClaim.claim;
    const how = matched ? (matched.match_how || 'reference') : autoClaim.how;
    await alertMoneyTeam(db, { kind: 'momo_payment_matched', nonce: `sms:${sms.id}`, build: (c) => smsMatchedAlert(claim, how, c) });
    // The payer hears straight away that we have it — only when it came from
    // their own number, so a name match never messages the wrong person.
    if (autoClaim?.notify_phone && autoClaim.how === 'phone') {
      const first = String(claim.agent_name || claim.lister_name || claim.host_name || claim.payer_name || '').trim().split(/\s+/)[0];
      await handoff.deliverWhatsapp({
        to: digits(autoClaim.notify_phone).length === 9 ? `256${digits(autoClaim.notify_phone)}` : autoClaim.notify_phone,
        body: [`🧾 Thank you${first ? `, ${first}` : ''} — we can see your MoMo payment of ${ugx(sms.amount_ugx)}.`, 'Our team is confirming it now, and your receipt follows here shortly.'].join('\n'),
        kind: 'momo_payment_seen',
        leadId: null,
        nonce: `seen:${sms.id}`
      }).catch(() => null);
    }
    return { alerted: true, claim_id: claim.id, how };
  }
  await alertMoneyTeam(db, { kind: 'money_sms_unrecorded', nonce: `sms:${sms.id}`, build: () => unmatchedSmsAlert(sms) });
  return { alerted: true, unmatched: true };
}

// --- CONFIRM from WhatsApp ----------------------------------------------------

/** Pending claims a confirmer could mean by a number or a transaction ID. */
async function waitingClaimsFor(db, { phone = '', txn = '' } = {}) {
  const key = phoneKey(phone);
  const ref = String(txn || '').trim().toLowerCase();
  if (!key && !ref) return [];
  const rows = (await db.query(
    `${CLAIM_CONTEXT_SQL}
      WHERE c.status = 'pending' AND c.created_at > NOW() - INTERVAL '45 days'
      ORDER BY c.created_at DESC LIMIT 300`
  )).rows;
  return rows.filter((c) => (ref && [c.reference, c.sms_reference].some((r) => String(r || '').toLowerCase() === ref))
    || (key && claimPhones(c).includes(key)));
}

module.exports = {
  CLAIM_WINDOW_DAYS,
  CONFIRM_LINK_DAYS,
  UG_PHONE,
  phoneKey,
  prettyPhone,
  methodForAccount,
  smsPayer,
  nameTokens,
  namesMatch,
  amountFits,
  judge,
  pickOne,
  whoAndWhat,
  matchSmsToWaitingClaims,
  claimFromSms,
  matchClaimToRecentSms,
  confirmToken,
  readConfirmToken,
  confirmUrl,
  confirmers,
  confirmerFor,
  loadClaim,
  confirmByConfirmer,
  confirmedLine,
  alertMoneyTeam,
  smsMatchedAlert,
  claimAlert,
  unmatchedSmsAlert,
  alertClaim,
  afterMoneySms,
  waitingClaimsFor
};
