'use strict';

/**
 * Staff commission (Arthur, 16 Nov 2026).
 *
 * Mass WhatsApp sends got the number blocked, so Staff Performance is now
 * judged on agents closed. The person who first pitched an agent earns a
 * percentage (20% by default) of that agent's confirmed subscription payment,
 * but only when the agent has BOTH paid AND has a genuinely new property live.
 * First payment only by default; commission_settings.pays_on = 'every_payment'
 * makes renewals earn too. Commission is paid on the 25th; anything whose
 * 7-day hold ends after the 23rd waits for the next 25th.
 *
 * Nothing here is typed in by hand: who pitched, who signed up, who paid and
 * what is listed all come from agent_prospects, agents, revenue_entries and
 * properties. The only hand steps are the payout batch (create, review, mark
 * paid) and adding a commission-only recruit, and each is audited.
 *
 * The guards (each has a test in tests/staff-commission.test.js):
 *   G1  pitch before account: no commission if the agent existed before the pitch
 *   G2  same person, other account: no commission if an agent with the same
 *       phone (any format), email, NIN or ID document joined before the pitch;
 *       a second account made after the pitch is not paid again; same name = review
 *   G3  first valid pitch wins; a later pitch by someone else is flagged as a dispute
 *   G4  no self-referral: the agent's phone, payer phone or account is not staff's own
 *   G5  real payment: an agent_subscription in revenue_entries, verified against the
 *       MoMo SMS / statement, not voided, at least UGX 50,000, on or after the start
 *   G6  genuinely new listing: approved and live, posted after the pitch, not
 *       found-online, not a copy (same ref, same photo file, near-identical photo
 *       hash, or same area + price within 5% + similar title)
 *   G7  hold: 7 days after qualifying before it can be paid; a refund, a void or
 *       the listing going down during the hold stops it; a refund after payout is
 *       clawed back from the next payout
 *   G8  suspicious patterns (held for admin review): one phone paying for several
 *       agents, several agents registered from one phone in a day, one ID on two
 *       agents, a burst of sign-ups for one person in an hour
 *   G9  one agent / one phone / one payment is paid once (code and unique indexes)
 *   G10 a payout batch must be reviewed by an admin before it can be marked paid,
 *       and every step is written to commission_audit
 */

const db = require('../config/database');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { prospectPhoneKey, maskPhoneLast3, senderBucket, knownOutreachSenders } = require('./outreachSenderName');

const TZ = 'Africa/Kampala';
const DAY_MS = 86400000;

const DEFAULT_SETTINGS = Object.freeze({
  default_rate_pct: 20,
  pays_on: 'first_payment',
  min_payment_ugx: 50000,
  hold_days: 7,
  cutoff_day: 23,
  payday_day: 25,
  scheme_starts_on: '2026-11-16'
});

const STATUS_LABELS = Object.freeze({
  contacted: 'Contacted',
  signed_up: 'Signed up',
  pending: 'Pending',
  needs_review: 'Needs review',
  on_hold: 'On hold',
  eligible: 'Eligible',
  in_batch: 'In payout batch',
  paid_out: 'Paid out',
  clawback_due: 'Clawback due',
  not_eligible: 'No commission'
});

const DUP_PHOTO_HAMMING = 6;
const TITLE_SIMILARITY = 0.7;
const PRICE_TOLERANCE = 0.05;
const BURST_COUNT = 5;
const BURST_MINUTES = 60;
const SAME_REGISTRAR_COUNT = 3;

// ---------------------------------------------------------------- helpers ---

function kampalaDay(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const ms = (v) => (v ? new Date(v).getTime() : NaN);
const key9 = (v) => {
  const k = prospectPhoneKey(v);
  return k.length === 9 ? k : '';
};
const normEmail = (v) => String(v || '').trim().toLowerCase();
const normId = (v) => String(v || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const normName = (v) => String(v || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const normPlace = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function imageKey(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  try {
    const u = new URL(text);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch (_) {
    return text.split('?')[0].toLowerCase();
  }
}

const STOP = new Set(['for', 'and', 'the', 'with', 'in', 'at', 'on', 'of', 'to', 'a', 'sale', 'rent', 'house', 'kampala', 'uganda']);
function titleTokens(title) {
  return new Set(String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  return both / (a.size + b.size - both);
}

function hamming(a = '', b = '') {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

function commissionFor(amountUgx, ratePct) {
  return Math.round((Number(amountUgx) || 0) * (Number(ratePct) || 0) / 100);
}

// ------------------------------------------------------------- paydays ------

function ymd(day) {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}
function dayOf(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
}

/** The payday that a day falls into: this month's if on/before the cut-off, else next month's. */
function paydayForDay(day, settings = DEFAULT_SETTINGS) {
  const { y, m, d } = ymd(day);
  if (d <= settings.cutoff_day) return dayOf(y, m, settings.payday_day);
  return dayOf(y, m + 1, settings.payday_day);
}

/** The next payday on or after today (Kampala). */
function nextPayday(now = new Date(), settings = DEFAULT_SETTINGS) {
  const { y, m, d } = ymd(kampalaDay(now));
  return d <= settings.payday_day ? dayOf(y, m, settings.payday_day) : dayOf(y, m + 1, settings.payday_day);
}

function cutoffFor(payday, settings = DEFAULT_SETTINGS) {
  const { y, m } = ymd(payday);
  return dayOf(y, m, settings.cutoff_day);
}

/** 09:00 Kampala (06:00 UTC) on payday, for the countdown. */
function paydayAt(payday) {
  return `${payday}T06:00:00.000Z`;
}

function countdown(now, payday) {
  const left = Math.max(0, ms(paydayAt(payday)) - ms(now));
  return { days: Math.floor(left / DAY_MS), hours: Math.floor((left % DAY_MS) / 3600000), ms: left };
}

// ---------------------------------------------------------- the rules -------

/**
 * Is this payment a real, confirmed agent payment? (G5) Returns '' when it
 * counts, or the reason it does not.
 */
function paymentProblem(p, settings, refunds = []) {
  if (p.direction && p.direction !== 'in') return 'not money in';
  if (p.kind && p.kind !== 'agent_subscription') return 'not an agent plan payment';
  if (p.voided_at) return 'payment was voided';
  if (String(p.verified_status || '') !== 'verified') return 'payment not yet matched to the MoMo SMS or statement';
  if (!(Number(p.amount_ugx) >= settings.min_payment_ugx)) return `payment below UGX ${settings.min_payment_ugx.toLocaleString('en-GB')}`;
  if (refunds.some((r) => !r.voided_at && ms(r.paid_at) >= ms(p.paid_at))) return 'payment was refunded';
  return '';
}

/**
 * Is this listing a copy of an earlier one? (G6) Returns { reason, of } or null.
 */
function duplicateOf(listing, corpus, imagesByProperty, hashesByProperty) {
  const myImages = new Set((imagesByProperty.get(String(listing.id)) || []).map(imageKey).filter(Boolean));
  const myHashes = hashesByProperty.get(String(listing.id)) || [];
  const myTokens = titleTokens(listing.title);
  const myArea = normPlace(listing.area) || normPlace(listing.district);
  const myRef = String(listing.inquiry_reference || '').trim().toUpperCase();
  const at = ms(listing.created_at);
  for (const other of corpus) {
    if (String(other.id) === String(listing.id)) continue;
    if (other.agent_id && listing.agent_id && String(other.agent_id) === String(listing.agent_id)) continue;
    if (!(ms(other.created_at) < at)) continue;
    const ref = other.inquiry_reference || other.id;
    const found = other.found_online ? ' (a found-online listing)' : '';
    if (myRef && String(other.inquiry_reference || '').trim().toUpperCase() === myRef) return { reason: `same reference as ${ref}${found}`, of: ref, found_online: !!other.found_online };
    const theirImages = imagesByProperty.get(String(other.id)) || [];
    if (myImages.size && theirImages.some((u) => myImages.has(imageKey(u)))) return { reason: `same photo as ${ref}${found}`, of: ref, found_online: !!other.found_online };
    const theirHashes = hashesByProperty.get(String(other.id)) || [];
    if (myHashes.some((h) => theirHashes.some((t) => hamming(h, t) <= DUP_PHOTO_HAMMING))) return { reason: `near-identical photo to ${ref}${found}`, of: ref, found_online: !!other.found_online };
    const area = normPlace(other.area) || normPlace(other.district);
    const p1 = Number(listing.price) || 0;
    const p2 = Number(other.price) || 0;
    if (myArea && area === myArea && p1 > 0 && p2 > 0 && Math.abs(p1 - p2) / Math.max(p1, p2) <= PRICE_TOLERANCE
      && jaccard(myTokens, titleTokens(other.title)) >= TITLE_SIMILARITY) {
      return { reason: `same area, price and title as ${ref}${found}`, of: ref, found_online: !!other.found_online };
    }
  }
  return null;
}

function listingProblem(l, firstPitchAt) {
  if (l.found_online) return 'a found-online listing, not the agent’s own';
  if (String(l.status) !== 'approved') return l.status === 'pending' ? 'listing waiting for approval' : `listing is ${l.status || 'not live'}`;
  if (ms(l.created_at) < firstPitchAt) return 'listing was posted before the pitch';
  return '';
}

/**
 * Which staff member each phone belongs to, from the staff numbers we know
 * (King's Agent 007 list, the help line) and commission_staff.phone_key.
 */
function staffPhoneMap(staff = [], known = {}) {
  const map = new Map();
  for (const [k, name] of Object.entries(known || {})) {
    const person = senderBucket(name);
    if (k.length === 9 && person && person !== 'other') map.set(k, person);
  }
  for (const s of staff) if (s.phone_key) map.set(String(s.phone_key), s.person_key);
  return map;
}

/**
 * The whole calculation. Pure: give it the rows, it gives back every agent's
 * status, every payable line, and the totals.
 */
function evaluateCommission({
  settings: rawSettings = {},
  staff = [],
  sends = [],
  agents = [],
  payments = [],
  listings = [],
  corpus = null,
  images = [],
  hashes = [],
  items = [],
  claims = [],
  staffPhones = new Map(),
  referralCodes = null,
  now = new Date()
} = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  settings.cutoff_day = Number(settings.cutoff_day);
  settings.payday_day = Number(settings.payday_day);
  settings.hold_days = Number(settings.hold_days);
  settings.min_payment_ugx = Number(settings.min_payment_ugx);
  const nowMs = ms(now);
  const today = kampalaDay(now);
  const upcoming = nextPayday(now, settings);
  const schemeStart = ms(`${settings.scheme_starts_on}T00:00:00+03:00`);
  const staffByKey = new Map(staff.map((s) => [s.person_key, s]));
  const allCorpus = corpus || listings;
  const referral = require('./referralTracking');
  const codes = Array.isArray(referralCodes) && referralCodes.length
    ? referralCodes.slice()
    : staff.filter((s) => s.person_key).map((s) => ({ code: s.person_key, person_key: s.person_key, label: s.name, kind: 'staff', active: true }));
  if (!codes.some((c) => c.code === 'owner-share')) {
    codes.push({ code: 'owner-share', person_key: null, label: 'Owner WhatsApp share', kind: 'system', active: true });
  }

  const imagesByProperty = new Map();
  for (const im of images) {
    const k = String(im.property_id);
    imagesByProperty.set(k, [...(imagesByProperty.get(k) || []), im.url]);
  }
  const hashesByProperty = new Map();
  for (const h of hashes) {
    if (!h.dhash) continue;
    const k = String(h.property_id);
    hashesByProperty.set(k, [...(hashesByProperty.get(k) || []), h.dhash]);
  }

  // Sends by phone (last nine digits), oldest first.
  const sendsByKey = new Map();
  for (const s of sends) {
    const k = s.phone_key || key9(s.phone);
    if (!k) continue;
    sendsByKey.set(k, [...(sendsByKey.get(k) || []), s]);
  }
  for (const list of sendsByKey.values()) list.sort((a, b) => ms(a.pitched_at) - ms(b.pitched_at));

  const agentKeys = (a) => [...new Set([key9(a.phone), key9(a.whatsapp)].filter(Boolean))];
  const identities = (a) => [
    ...agentKeys(a).map((k) => `phone:${k}`),
    normEmail(a.email) ? `email:${normEmail(a.email)}` : '',
    normId(a.nin).length >= 8 ? `nin:${normId(a.nin)}` : '',
    a.identity_document_url ? `doc:${String(a.identity_document_url).trim()}` : ''
  ].filter(Boolean);

  const byIdentity = new Map();
  for (const a of agents) {
    for (const id of identities(a)) byIdentity.set(id, [...(byIdentity.get(id) || []), a]);
  }
  const sortedAgents = agents.slice().sort((a, b) => ms(a.created_at) - ms(b.created_at));

  const paysByAgent = new Map();
  const refundsByAgent = new Map();
  for (const p of payments) {
    if (!p.agent_id) continue;
    const k = String(p.agent_id);
    if (p.direction === 'out') refundsByAgent.set(k, [...(refundsByAgent.get(k) || []), p]);
    else if (!p.kind || p.kind === 'agent_subscription') paysByAgent.set(k, [...(paysByAgent.get(k) || []), p]);
  }
  const paymentById = new Map(payments.map((p) => [String(p.id), p]));

  const listingsByAgent = new Map();
  for (const l of listings) {
    if (!l.agent_id) continue;
    const k = String(l.agent_id);
    listingsByAgent.set(k, [...(listingsByAgent.get(k) || []), l]);
  }

  const liveItems = items.filter((i) => !i.voided_at && i.batch_status !== 'cancelled');
  const itemsByPayment = new Map();
  const firstItemByAgent = new Map();
  const firstItemByPhone = new Map();
  const clawbackByPayment = new Map();
  for (const i of liveItems) {
    if (i.kind === 'clawback') { clawbackByPayment.set(String(i.payment_entry_id), i); continue; }
    if (i.payment_entry_id) itemsByPayment.set(String(i.payment_entry_id), i);
    if (i.is_first !== false) {
      firstItemByAgent.set(String(i.agent_id), i);
      if (i.phone_key) firstItemByPhone.set(String(i.phone_key), i);
    }
  }

  // G8 suspicious patterns, worked out across all agents first.
  const payerAgents = new Map();
  for (const p of payments) {
    const k = key9(p.payer_phone);
    if (!k || !p.agent_id || p.direction === 'out') continue;
    payerAgents.set(k, new Set([...(payerAgents.get(k) || []), String(p.agent_id)]));
  }
  const registrar = new Map();
  for (const a of agents) {
    const k = key9(a.registered_by_phone);
    if (k) registrar.set(k, [...(registrar.get(k) || []), a]);
  }

  const rows = [];
  const seenAgents = new Set();
  for (const a of sortedAgents) {
    const keys = agentKeys(a);
    const pitches = keys.flatMap((k) => sendsByKey.get(k) || []).sort((x, y) => ms(x.pitched_at) - ms(y.pitched_at));
    if (!pitches.length) continue;
    seenAgents.add(String(a.id));
    const created = ms(a.created_at);
    const valid = pitches.filter((p) => ms(p.pitched_at) <= created);
    const first = valid[0] || pitches[0];
    const person = first.person_key || 'other';
    const s = staffByKey.get(person);
    const row = {
      agent_id: a.id,
      name: a.full_name || 'Unnamed agent',
      phone_key: keys[0],
      phone_masked: maskPhoneLast3(keys[0]),
      person_key: person,
      person_name: s ? s.name : (first.sender_name || 'Someone else'),
      pitched_at: first.pitched_at,
      signed_up_at: a.created_at,
      paid: false,
      listed: false,
      status: 'signed_up',
      reasons: [],
      flags: [],
      lines: [],
      commission_ugx: 0,
      payment: null,
      listing: null
    };
    rows.push(row);
    referral.attachFirstTouchEvidence(row, a, codes);
    const stop = (reason) => { row.status = 'not_eligible'; row.reasons.push(reason); };

    // G1
    if (!valid.length) { stop('Was already an agent before the first pitch'); continue; }
    // G3
    // Other people's claims on the number before the sign-up: a second film,
    // the number on their list, or a call they logged.
    const otherClaims = claims.filter((x) => keys.includes(x.phone_key) && x.person_key && x.person_key !== person && x.person_key !== 'other' && ms(x.at) <= created)
      .map((x) => (staffByKey.get(x.person_key) || {}).name || x.person_key);
    const rivals = [...new Set([...valid.filter((p) => (p.person_key || 'other') !== person).map((p) => p.sender_name || p.person_key), ...otherClaims])];
    if (rivals.length) row.flags.push(`Also pitched by ${rivals.join(', ')} — first pitch (${row.person_name}) wins`);
    // G2
    const twins = new Map();
    for (const id of identities(a)) for (const b of byIdentity.get(id) || []) if (String(b.id) !== String(a.id)) twins.set(String(b.id), { b, on: id.split(':')[0] });
    const before = [...twins.values()].find(({ b }) => ms(b.created_at) < ms(first.pitched_at));
    if (before) { stop(`Already an agent under another account (same ${before.on === 'doc' ? 'ID document' : before.on === 'nin' ? 'NIN' : before.on})`); continue; }
    const olderTwin = [...twins.values()].find(({ b }) => ms(b.created_at) < created);
    if (olderTwin) { stop(`Second account of an agent who already signed up (same ${olderTwin.on === 'doc' ? 'ID document' : olderTwin.on === 'nin' ? 'NIN' : olderTwin.on})`); continue; }
    if (keys.some((k) => firstItemByPhone.has(k) && String(firstItemByPhone.get(k).agent_id) !== String(a.id))) { stop('This phone has already earned a commission on another account'); continue; }
    const nm = normName(a.full_name);
    if (nm.split(' ').length >= 2 && agents.some((b) => String(b.id) !== String(a.id) && normName(b.full_name) === nm && ms(b.created_at) < ms(first.pitched_at))) {
      row.flags.push('Same name as an agent who joined before the pitch — check it is not the same person');
    }
    if (twins.size && [...twins.values()].some(({ on }) => on === 'doc' || on === 'nin')) row.flags.push('Same ID as another agent account');
    // G4
    const pays = (paysByAgent.get(String(a.id)) || []).slice().sort((x, y) => ms(x.paid_at) - ms(y.paid_at));
    const staffOwn = (k) => staffPhones.get(k);
    if (keys.some((k) => staffOwn(k)) || (s && s.user_id && a.user_id && String(s.user_id) === String(a.user_id))) { stop('Self-referral: the agent is a staff member'); continue; }
    if (pays.some((p) => staffOwn(key9(p.payer_phone)) === person)) { stop(`Self-referral: paid from ${row.person_name}’s own phone`); continue; }
    if (a.removed_at) { stop('Agent was removed'); continue; }
    if (a.fee_exempt) { stop('Fee-exempt agent (never pays)'); continue; }
    if (!s || !s.active || !(Number(s.rate_pct) > 0)) { stop(`${row.person_name} is not on commission`); }

    // G8
    for (const p of pays) {
      const k = key9(p.payer_phone);
      // Accounts that are this phone's own count as one person (G2 handles them).
      const paidFor = k ? [...(payerAgents.get(k) || [])] : [];
      const own = paidFor.filter((aid) => { const b = agents.find((x) => String(x.id) === aid); return b && agentKeys(b).includes(k); });
      const n = paidFor.length - own.length + (own.length ? 1 : 0);
      if (n >= 2) { row.flags.push(`One phone (${maskPhoneLast3(k)}) paid for ${n} agents`); break; }
    }
    const reg = key9(a.registered_by_phone);
    if (reg && !staffOwn(reg)) {
      const near = (registrar.get(reg) || []).filter((b) => Math.abs(ms(b.created_at) - created) <= DAY_MS);
      if (near.length >= SAME_REGISTRAR_COUNT) row.flags.push(`${near.length} agents registered from one phone (${maskPhoneLast3(reg)}) within a day`);
    }

    // G5
    const refunds = refundsByAgent.get(String(a.id)) || [];
    const realPays = pays.filter((p) => !paymentProblem(p, settings, refunds));
    const firstEver = realPays[0] || null;
    if (!firstEver) {
      const why = pays.map((p) => paymentProblem(p, settings, refunds)).filter(Boolean);
      row.reasons.push(why.length ? `Not paid yet: ${[...new Set(why)].join('; ')}` : 'Not paid yet');
    } else {
      row.paid = true;
      row.payment = { id: firstEver.id, amount_ugx: Number(firstEver.amount_ugx), paid_at: firstEver.paid_at };
    }
    // Clawback: a payment we already paid commission on was refunded or voided.
    for (const p of pays) {
      const item = itemsByPayment.get(String(p.id));
      const problem = item && item.batch_status === 'paid' ? paymentProblem(p, settings, refunds) : '';
      if (!problem) continue;
      // The commission that went out stays on the record; the clawback offsets it.
      row.lines.push({ payment_entry_id: p.id, is_first: item.is_first !== false, amount_ugx: Number(item.amount_ugx), status: 'paid_out', payout_id: item.payout_id, due_payday: item.payday, reason: '' });
      const claw = clawbackByPayment.get(String(p.id));
      row.lines.push({
        payment_entry_id: p.id, kind: 'clawback', is_first: false, amount_ugx: claw ? Number(claw.amount_ugx) : -Math.abs(Number(item.amount_ugx)),
        status: claw ? (claw.batch_status === 'paid' ? 'clawed_back' : 'clawback_in_batch') : 'clawback_due',
        payout_id: claw ? claw.payout_id : null, reason: `Clawback: ${problem} after commission was paid`, due_payday: claw ? claw.payday : upcoming
      });
    }
    const clawLine = row.lines.find((l) => l.kind === 'clawback');

    // G6
    const mine = (listingsByAgent.get(String(a.id)) || []).slice().sort((x, y) => ms(x.approved_at || x.created_at) - ms(y.approved_at || y.created_at));
    const listingWhy = [];
    let good = null;
    for (const l of mine) {
      const problem = listingProblem(l, ms(first.pitched_at));
      if (problem) { listingWhy.push(problem); continue; }
      const dup = duplicateOf(l, allCorpus, imagesByProperty, hashesByProperty);
      if (dup) { listingWhy.push(dup.found_online ? `copied from a found-online listing (${dup.of})` : `duplicate: ${dup.reason}`); continue; }
      good = l;
      break;
    }
    if (good) {
      row.listed = true;
      row.listing = { id: good.id, ref: good.inquiry_reference || '', approved_at: good.approved_at || good.created_at };
    } else {
      row.reasons.push(listingWhy.length ? `No qualifying listing: ${[...new Set(listingWhy)].join('; ')}` : 'No property listed yet');
    }

    if (clawLine) {
      row.status = clawLine.status === 'clawed_back' ? 'not_eligible' : 'clawback_due';
      row.reasons.unshift(clawLine.reason);
      continue;
    }
    if (row.status === 'not_eligible') continue;
    if (!row.paid || !row.listed) { row.status = 'pending'; continue; }

    if (settings.pays_on !== 'every_payment' && ms(firstEver.paid_at) < schemeStart) {
      stop(`First payment was before the scheme started (${settings.scheme_starts_on})`);
      continue;
    }
    const payable = settings.pays_on === 'every_payment'
      ? realPays.filter((p) => ms(p.paid_at) >= schemeStart)
      : [firstEver];
    const listedAt = ms(row.listing.approved_at);
    for (const p of payable) {
      const isFirst = String(p.id) === String(firstEver.id);
      const qualifiedAt = Math.max(ms(p.paid_at), listedAt);
      const holdUntil = new Date(qualifiedAt + settings.hold_days * DAY_MS);
      const holdDay = kampalaDay(holdUntil);
      const due = [paydayForDay(holdDay, settings), upcoming].sort().pop();
      const line = {
        payment_entry_id: p.id,
        is_first: isFirst,
        payment_ugx: Number(p.amount_ugx),
        rate_pct: Number(s.rate_pct),
        amount_ugx: commissionFor(p.amount_ugx, s.rate_pct),
        qualified_at: new Date(qualifiedAt).toISOString(),
        hold_until: holdUntil.toISOString(),
        due_payday: due,
        status: 'eligible',
        reason: ''
      };
      const item = itemsByPayment.get(String(p.id)) || (isFirst ? firstItemByAgent.get(String(a.id)) : null);
      if (item) {
        line.status = item.batch_status === 'paid' ? 'paid_out' : 'in_batch';
        line.amount_ugx = Number(item.amount_ugx);
        line.payout_id = item.payout_id;
        line.due_payday = item.payday || due;
      } else if (row.flags.length) {
        line.status = holdUntil.getTime() > nowMs ? 'on_hold' : 'needs_review';
        line.reason = 'Held for admin review';
      } else if (holdUntil.getTime() > nowMs) {
        line.status = 'on_hold';
        line.reason = `In the ${settings.hold_days}-day hold until ${holdDay}`;
      }
      row.lines.push(line);
    }
    const firstLine = row.lines.find((l) => l.is_first && l.kind !== 'clawback') || row.lines[0];
    row.status = firstLine ? firstLine.status : 'pending';
    row.commission_ugx = row.lines.filter((l) => l.kind !== 'clawback').reduce((t, l) => t + l.amount_ugx, 0);
    if (row.status === 'on_hold' && firstLine.reason) row.reasons.push(firstLine.reason);
    if (row.status === 'needs_review') row.reasons.push('Held for admin review');
  }

  // G8 burst: many sign-ups for one person within an hour.
  const byPerson = new Map();
  for (const r of rows) byPerson.set(r.person_key, [...(byPerson.get(r.person_key) || []), r]);
  for (const list of byPerson.values()) {
    for (const r of list) {
      const t = ms(r.signed_up_at);
      const near = list.filter((o) => Math.abs(ms(o.signed_up_at) - t) <= BURST_MINUTES * 60000).length;
      if (near >= BURST_COUNT) {
        r.flags.push(`${near} sign-ups within ${BURST_MINUTES} minutes`);
        for (const l of r.lines) if (l.status === 'eligible') { l.status = 'needs_review'; l.reason = 'Held for admin review'; }
        if (r.status === 'eligible') { r.status = 'needs_review'; r.reasons.push('Held for admin review'); }
      }
    }
  }

  // Contacted only: sends with no agent account.
  const agentPhoneKeys = new Set(agents.flatMap(agentKeys));
  const contacted = [];
  for (const [k, list] of sendsByKey) {
    if (agentPhoneKeys.has(k)) continue;
    const f = list[0];
    contacted.push({ phone_key: k, phone_masked: maskPhoneLast3(k), name: f.full_name || 'Unnamed', person_key: f.person_key || 'other', person_name: (staffByKey.get(f.person_key) || {}).name || f.sender_name || 'Someone else', pitched_at: f.pitched_at, status: 'contacted' });
  }

  return { settings, today, next_payday: upcoming, rows, contacted, totals: totalsFor(rows, contacted, sends, staff, upcoming, schemeStart) };
}

function totalsFor(rows, contacted, sends, staff, upcoming, schemeStart) {
  const blank = () => ({
    contacted: 0, contacted_since_start: 0, signed_up: 0, paid: 0, listed: 0, eligible: 0,
    on_hold: 0, needs_review: 0, paid_out_agents: 0,
    earned_ugx: 0, due_next_payday_ugx: 0, pending_ugx: 0, paid_to_date_ugx: 0, clawback_ugx: 0
  });
  const team = blank();
  const people = new Map(staff.map((s) => [s.person_key, blank()]));
  const of = (k) => { if (!people.has(k)) people.set(k, blank()); return people.get(k); };
  const firstSendByKey = new Map();
  for (const s of sends) {
    const k = s.phone_key;
    if (!k) continue;
    const prev = firstSendByKey.get(k);
    if (!prev || ms(s.pitched_at) < ms(prev.pitched_at)) firstSendByKey.set(k, s);
  }
  for (const s of firstSendByKey.values()) {
    for (const t of [team, of(s.person_key || 'other')]) {
      t.contacted += 1;
      if (ms(s.pitched_at) >= schemeStart) t.contacted_since_start += 1;
    }
  }
  for (const r of rows) {
    for (const t of [team, of(r.person_key)]) {
      if (r.status === 'not_eligible' && /before the first pitch|another account|Second account|already earned/.test(r.reasons[0] || '')) continue;
      t.signed_up += 1;
      if (r.paid) t.paid += 1;
      if (r.listed) t.listed += 1;
      if (['eligible', 'in_batch', 'paid_out'].includes(r.status)) t.eligible += 1;
      if (r.status === 'on_hold') t.on_hold += 1;
      if (r.status === 'needs_review') t.needs_review += 1;
      if (r.status === 'paid_out') t.paid_out_agents += 1;
      for (const l of r.lines) {
        if (l.kind === 'clawback') {
          t.clawback_ugx += l.amount_ugx;
          if (l.status !== 'clawed_back') t.due_next_payday_ugx += l.amount_ugx;
          else t.paid_to_date_ugx += l.amount_ugx;
          continue;
        }
        if (['eligible', 'in_batch', 'paid_out'].includes(l.status)) t.earned_ugx += l.amount_ugx;
        if (l.status === 'paid_out') t.paid_to_date_ugx += l.amount_ugx;
        if ((l.status === 'eligible' || l.status === 'in_batch') && l.due_payday <= upcoming) t.due_next_payday_ugx += l.amount_ugx;
        if (l.status === 'on_hold' || l.status === 'needs_review' || ((l.status === 'eligible') && l.due_payday > upcoming)) t.pending_ugx += l.amount_ugx;
      }
    }
  }
  return { team, people: Object.fromEntries(people) };
}

/**
 * What goes into a payout for this payday: every eligible line due by then,
 * flagged lines only if an admin accepted them (with a note), and clawbacks.
 */
function selectForPayout(evaluation, payday, accepted = new Map()) {
  const lines = [];
  for (const r of evaluation.rows) {
    for (const l of r.lines) {
      const base = { agent_id: r.agent_id, phone_key: r.phone_key, person_key: r.person_key, listing_id: r.listing ? r.listing.id : null, ...l };
      if (l.kind === 'clawback') { if (l.status === 'clawback_due') lines.push({ ...base, kind: 'clawback', flags: [] }); continue; }
      else if (l.status === 'eligible' && l.due_payday <= payday) lines.push({ ...base, kind: 'commission', flags: [] });
      else if (l.status === 'needs_review' && accepted.has(String(r.agent_id))) {
        lines.push({ ...base, kind: 'commission', flags: r.flags, override_note: accepted.get(String(r.agent_id)) });
      }
    }
  }
  // G9: never the same payment, the same agent's first payment, or the same phone twice.
  const seen = new Set();
  return lines.filter((l) => {
    const keys = l.kind === 'clawback' ? [`c:${l.payment_entry_id}`] : [`p:${l.payment_entry_id}`, ...(l.is_first ? [`a:${l.agent_id}`, `k:${l.phone_key}`] : [])];
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

// --------------------------------------------------------- data access ------

async function rowsOf(client, sql, params = []) {
  try {
    return (await client.query(sql, params)).rows || [];
  } catch (_) {
    return [];
  }
}

async function loadSettings(client = db) {
  const row = (await rowsOf(client, `SELECT default_rate_pct, pays_on, min_payment_ugx, hold_days, cutoff_day, payday_day, scheme_starts_on::text AS scheme_starts_on FROM commission_settings WHERE key = 'default'`))[0] || {};
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) out[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? Number(v) : v;
  return out;
}

async function loadStaff(client = db) {
  return (await rowsOf(client, 'SELECT person_key, name, role, rate_pct, active, phone_key, user_id, added_by, added_at FROM commission_staff ORDER BY added_at'))
    .map((s) => ({ ...s, rate_pct: Number(s.rate_pct) }));
}

/** Sends credited to commission recruits by name when the desk filed them as "other". */
function attributeSends(sends = [], staff = []) {
  const byFirstName = new Map(staff.map((s) => [normName(s.name).split(' ')[0], s.person_key]));
  return sends.map((s) => {
    if (s.person_key && s.person_key !== 'other') return s;
    const first = normName(s.sender_name || s.pitched_by_name).split(' ')[0];
    return byFirstName.has(first) ? { ...s, person_key: byFirstName.get(first) } : s;
  });
}

async function loadInputs({ client = db, sends = [] } = {}) {
  const [settings, staff, items] = await Promise.all([
    loadSettings(client),
    loadStaff(client),
    rowsOf(client, `SELECT i.id, i.payout_id, i.agent_id, i.phone_key, i.person_key, i.kind, i.amount_ugx, i.is_first, i.payment_entry_id, i.voided_at, o.status AS batch_status, o.payday::text AS payday
                      FROM commission_payout_items i JOIN commission_payouts o ON o.id = i.payout_id`)
  ]);
  const credited = attributeSends(sends, staff);
  const keys = [...new Set(credited.map((s) => s.phone_key).filter(Boolean))];
  const agents = await rowsOf(client,
    `SELECT id, full_name, phone, whatsapp, email, nin, identity_document_url, user_id, registered_by_phone, created_at, status, removed_at, fee_exempt, referral_code FROM agents`);
  const pitched = agents.filter((a) => [key9(a.phone), key9(a.whatsapp)].some((k) => k && keys.includes(k))).map((a) => a.id);
  const [payments, listings, corpus] = await Promise.all([
    rowsOf(client, `SELECT id, direction, kind, agent_id, amount_ugx, paid_at, payer_phone, verified_status, verification_source, method, voided_at
                      FROM revenue_entries WHERE kind IN ('agent_subscription', 'refund')`),
    rowsOf(client, `SELECT p.id, p.agent_id, p.status, p.title, p.district, p.area, p.price, p.inquiry_reference, p.created_at, p.approved_at,
                           ${foundOnlinePropertySql('p')} AS found_online
                      FROM properties p WHERE p.agent_id = ANY($1::uuid[])`, [pitched]),
    rowsOf(client, `SELECT p.id, p.agent_id, p.title, p.district, p.area, p.price, p.inquiry_reference, p.created_at, ${foundOnlinePropertySql('p')} AS found_online
                      FROM properties p`)
  ]);
  const claims = [
    ...(await rowsOf(client, `SELECT phone_key, person_key, added_at AS at FROM outreach_list_numbers WHERE accepted IS TRUE AND phone_key = ANY($1::text[])`, [keys])),
    ...(await rowsOf(client, `SELECT phone_key, person_key, created_at AS at FROM outreach_events WHERE kind IN ('call_started', 'outcome') AND phone_key = ANY($1::text[])`, [keys]))
  ];
  const ids = listings.map((l) => l.id);
  const [images, hashes] = await Promise.all([
    rowsOf(client, `SELECT i.property_id, i.url FROM property_images i
                     WHERE i.property_id = ANY($1::uuid[])
                        OR LOWER(REGEXP_REPLACE(i.url, '[?#].*$', '')) IN (SELECT LOWER(REGEXP_REPLACE(x.url, '[?#].*$', '')) FROM property_images x WHERE x.property_id = ANY($1::uuid[]))`, [ids]),
    rowsOf(client, 'SELECT property_id, dhash FROM commission_photo_hashes WHERE dhash IS NOT NULL')
  ]);
  let referralCodes = staff.filter((s) => s.person_key).map((s) => ({ code: s.person_key, person_key: s.person_key, label: s.name, kind: 'staff', active: true }));
  try {
    referralCodes = await require('./referralTracking').listCodes({ client });
  } catch (_error) { /* table may not exist in a test world */ }
  return { settings, staff, sends: credited, agents, payments, listings, corpus, images, hashes, items, claims, referralCodes, staffPhones: staffPhoneMap(staff, knownOutreachSenders()) };
}

async function evaluate({ client = db, sends = [], now = new Date() } = {}) {
  return evaluateCommission({ ...(await loadInputs({ client, sends })), now });
}

/** The part of the Staff Performance payload about commission. Phones masked. */
async function summary({ sends = [], now = new Date(), roadPayingNow = 0, goal = 1000 } = {}) {
  const [inputs, payouts, audit] = await Promise.all([
    loadInputs({ sends }),
    rowsOf(db, `SELECT id, payday::text AS payday, status, total_ugx, created_by, created_at, reviewed_by, reviewed_at, review_note, paid_by, paid_at, paid_reference,
                       (SELECT COUNT(*) FROM commission_payout_items i WHERE i.payout_id = o.id AND i.voided_at IS NULL)::int AS items
                  FROM commission_payouts o ORDER BY payday DESC, created_at DESC LIMIT 24`),
    rowsOf(db, 'SELECT action, actor, payout_id, person_key, details, created_at FROM commission_audit ORDER BY created_at DESC LIMIT 40')
  ]);
  const ev = evaluateCommission({ ...inputs, now });
  return {
    settings: ev.settings,
    next_payday: ev.next_payday,
    next_payday_at: paydayAt(ev.next_payday),
    cutoff: cutoffFor(ev.next_payday, ev.settings),
    countdown: countdown(now, ev.next_payday),
    staff: inputs.staff.map(({ phone_key, user_id, ...s }) => ({ ...s, has_phone: !!phone_key })),
    totals: ev.totals,
    road: { goal, paying_now: roadPayingNow },
    agents: ev.rows.map(({ phone_key, ...r }) => ({ ...r, status_label: STATUS_LABELS[r.status] })),
    contacted: ev.contacted.slice(0, 300).map(({ phone_key, ...c }) => c),
    payouts,
    audit: audit.map((a) => ({ ...a, details: a.details || {} }))
  };
}

// -------------------------------------------------------------- actions -----

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function writeCommissionAudit(client, { action, actor = '', actorId = '', payoutId = null, personKey = null, agentId = null, details = {} }) {
  await client.query(
    `INSERT INTO commission_audit (action, actor, actor_id, payout_id, person_key, agent_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [action, actor, String(actorId || ''), payoutId, personKey, agentId, JSON.stringify(details || {})]
  );
}

async function withTx(fn) {
  const client = typeof db.getClient === 'function' ? await db.getClient() : (db.pool ? await db.pool.connect() : null);
  if (!client) return fn(db);
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Photo fingerprints for the qualifying listings about to be paid, and for the
 * other listings in the same districts, so a copied photo is caught (G6).
 * Bounded: at most `limit` new images fetched per call.
 */
async function refreshPhotoHashes(listingIds = [], { limit = 80, hasher } = {}) {
  if (!listingIds.length) return { hashed: 0 };
  const hash = hasher || require('./propertyHarvestDedupService').primaryImageDHash;
  const todo = await rowsOf(db,
    `SELECT DISTINCT ON (i.url) i.property_id, i.url FROM property_images i JOIN properties p ON p.id = i.property_id
      WHERE (p.id = ANY($1::uuid[]) OR p.district IN (SELECT district FROM properties WHERE id = ANY($1::uuid[])))
        AND NOT EXISTS (SELECT 1 FROM commission_photo_hashes h WHERE h.url = i.url)
      ORDER BY i.url, (p.id = ANY($1::uuid[])) DESC
      LIMIT $2`, [listingIds, limit]);
  let hashed = 0;
  for (const t of todo) {
    const r = await hash(t.url).catch((e) => ({ hash: '', reason: e.message }));
    const value = typeof r === 'string' ? r : (r && (r.dhash || r.hash)) || '';
    await db.query(`INSERT INTO commission_photo_hashes (url, property_id, dhash, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (url) DO NOTHING`,
      [t.url, t.property_id, value || null, value ? null : String((r && r.reason) || 'no hash').slice(0, 120)]);
    if (value) hashed += 1;
  }
  return { hashed, tried: todo.length };
}

/** Admin: build a draft payout batch for a payday. Flagged agents only with a note. */
async function createPayout({ payday = '', accept = [], sends = [], actor = '', actorId = '', now = new Date(), hasher } = {}) {
  const settings = await loadSettings();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(payday)) ? String(payday) : nextPayday(now, settings);
  if (Number(day.slice(8, 10)) !== settings.payday_day) throw httpError(400, `A payout is for a payday (the ${settings.payday_day}th).`);
  const accepted = new Map();
  for (const a of Array.isArray(accept) ? accept : []) {
    const note = String(a?.note || '').trim();
    if (!a?.agent_id) continue;
    if (note.length < 5) throw httpError(400, 'Say why each flagged agent is fine to pay.');
    accepted.set(String(a.agent_id), note.slice(0, 300));
  }
  let ev = await evaluate({ sends, now });
  const candidateListings = ev.rows.filter((r) => r.listing && r.lines.some((l) => ['eligible', 'needs_review'].includes(l.status))).map((r) => r.listing.id);
  await refreshPhotoHashes(candidateListings, { hasher }).catch(() => null);
  ev = await evaluate({ sends, now });
  const lines = selectForPayout(ev, day, accepted);
  return withTx(async (client) => {
    const open = await client.query(`SELECT id FROM commission_payouts WHERE payday = $1 AND status IN ('draft', 'reviewed')`, [day]);
    if (open.rows.length) throw httpError(409, 'There is already an open payout for that payday. Finish or cancel it first.');
    if (!lines.length) throw httpError(400, 'Nobody is due commission for that payday yet.');
    const total = lines.reduce((t, l) => t + l.amount_ugx, 0);
    const payout = (await client.query(
      `INSERT INTO commission_payouts (payday, status, total_ugx, created_by) VALUES ($1, 'draft', $2, $3) RETURNING id, payday::text AS payday, status, total_ugx`,
      [day, total, actor])).rows[0];
    for (const l of lines) {
      await client.query(
        `INSERT INTO commission_payout_items (payout_id, agent_id, phone_key, person_key, kind, amount_ugx, rate_pct, payment_ugx, is_first, payment_entry_id, listing_id, flags, override_note, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb)`,
        [payout.id, l.agent_id, l.phone_key, l.person_key, l.kind, l.amount_ugx, l.rate_pct ?? null, l.payment_ugx ?? null, l.is_first !== false, l.payment_entry_id, l.listing_id,
          JSON.stringify(l.flags || []), l.override_note || null, JSON.stringify({ qualified_at: l.qualified_at, hold_until: l.hold_until, reason: l.reason })]
      );
    }
    await writeCommissionAudit(client, { action: 'payout_created', actor, actorId, payoutId: payout.id, details: { payday: day, total_ugx: total, agents: lines.map((l) => ({ agent_id: l.agent_id, person: l.person_key, kind: l.kind, amount_ugx: l.amount_ugx, flags: l.flags, note: l.override_note || null })) } });
    return { ...payout, items: lines.length };
  });
}

/** Admin: review a draft. Re-checks every line now; a line no longer good is dropped. */
async function reviewPayout(id, { note = '', sends = [], actor = '', actorId = '', now = new Date() } = {}) {
  const ev = await evaluate({ sends, now });
  const still = new Map();
  for (const r of ev.rows) for (const l of r.lines) still.set(`${l.kind === 'clawback' ? 'clawback' : 'commission'}:${l.payment_entry_id}`, { row: r, line: l });
  return withTx(async (client) => {
    const p = (await client.query('SELECT id, status FROM commission_payouts WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!p) throw httpError(404, 'Payout not found.');
    if (p.status !== 'draft') throw httpError(409, `This payout is ${p.status}; only a draft can be reviewed.`);
    const items = (await client.query('SELECT id, agent_id, payment_entry_id, kind, amount_ugx FROM commission_payout_items WHERE payout_id = $1 AND voided_at IS NULL', [id])).rows;
    const dropped = [];
    for (const it of items) {
      const now2 = still.get(`${it.kind}:${it.payment_entry_id}`);
      const ok = it.kind === 'clawback' ? now2 && now2.line.status === 'clawback_in_batch' : now2 && now2.line.status === 'in_batch';
      if (!ok) {
        const reason = now2 ? (now2.row.reasons[0] || now2.line.status) : 'no longer qualifies';
        await client.query('UPDATE commission_payout_items SET voided_at = NOW(), void_reason = $2 WHERE id = $1', [it.id, `Dropped at review: ${reason}`]);
        dropped.push({ agent_id: it.agent_id, reason });
      }
    }
    const total = (await client.query('SELECT COALESCE(SUM(amount_ugx), 0)::bigint AS t FROM commission_payout_items WHERE payout_id = $1 AND voided_at IS NULL', [id])).rows[0].t;
    await client.query(`UPDATE commission_payouts SET status = 'reviewed', reviewed_by = $2, reviewed_at = NOW(), review_note = $3, total_ugx = $4 WHERE id = $1`, [id, actor, String(note || '').slice(0, 500), total]);
    await writeCommissionAudit(client, { action: 'payout_reviewed', actor, actorId, payoutId: id, details: { note, dropped, total_ugx: Number(total) } });
    return { id, status: 'reviewed', total_ugx: Number(total), dropped };
  });
}

/** Admin: the money has gone. Only a reviewed batch. */
async function markPayoutPaid(id, { reference = '', actor = '', actorId = '' } = {}) {
  const ref = String(reference || '').trim();
  if (ref.length < 3) throw httpError(400, 'Give the MoMo or bank reference for the payment.');
  return withTx(async (client) => {
    const p = (await client.query('SELECT id, status, total_ugx FROM commission_payouts WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!p) throw httpError(404, 'Payout not found.');
    if (p.status !== 'reviewed') throw httpError(409, p.status === 'paid' ? 'Already marked paid.' : 'An admin has to review the payout before it is marked paid.');
    const items = (await client.query('SELECT agent_id, person_key, kind, amount_ugx FROM commission_payout_items WHERE payout_id = $1 AND voided_at IS NULL', [id])).rows;
    await client.query(`UPDATE commission_payouts SET status = 'paid', paid_by = $2, paid_at = NOW(), paid_reference = $3 WHERE id = $1`, [id, actor, ref.slice(0, 120)]);
    await writeCommissionAudit(client, { action: 'payout_paid', actor, actorId, payoutId: id, details: { reference: ref, total_ugx: Number(p.total_ugx), agents: items } });
    return { id, status: 'paid', total_ugx: Number(p.total_ugx), items: items.length };
  });
}

async function cancelPayout(id, { reason = '', actor = '', actorId = '' } = {}) {
  return withTx(async (client) => {
    const p = (await client.query('SELECT id, status FROM commission_payouts WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!p) throw httpError(404, 'Payout not found.');
    if (p.status === 'paid') throw httpError(409, 'A paid payout cannot be cancelled. A refund is clawed back on the next one.');
    if (p.status === 'cancelled') return { id, status: 'cancelled' };
    await client.query(`UPDATE commission_payout_items SET voided_at = NOW(), void_reason = 'Payout cancelled' WHERE payout_id = $1 AND voided_at IS NULL`, [id]);
    await client.query(`UPDATE commission_payouts SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW(), cancel_reason = $3 WHERE id = $1`, [id, actor, String(reason || '').slice(0, 300)]);
    await writeCommissionAudit(client, { action: 'payout_cancelled', actor, actorId, payoutId: id, details: { reason } });
    return { id, status: 'cancelled' };
  });
}

/** Admin: a commission-only recruit. Earns like Ronald from the next pitch. */
async function addRecruit({ name = '', ratePct, phone = '', actor = '', actorId = '' } = {}) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const key = normName(clean).split(' ')[0].replace(/[^a-z0-9]/g, '').slice(0, 40);
  if (!key) throw httpError(400, 'Give the recruit’s name.');
  const settings = await loadSettings();
  const rate = ratePct === undefined || ratePct === null || ratePct === '' ? settings.default_rate_pct : Number(ratePct);
  if (!(rate >= 0 && rate <= 100)) throw httpError(400, 'The rate is a percent between 0 and 100.');
  const phoneKey = phone ? key9(phone) : '';
  if (phone && !phoneKey) throw httpError(400, 'That is not a phone number.');
  return withTx(async (client) => {
    const exists = (await client.query('SELECT person_key FROM commission_staff WHERE person_key = $1', [key])).rows[0];
    if (exists) throw httpError(409, `${clean.split(' ')[0]} is already on the list. Use a different first name.`);
    if (phoneKey) {
      const agent = (await client.query(`SELECT id FROM agents WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1 OR RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1 LIMIT 1`, [phoneKey])).rows[0];
      if (agent) throw httpError(409, 'That phone belongs to an agent, so it cannot also earn commission.');
    }
    const row = (await client.query(
      `INSERT INTO commission_staff (person_key, name, role, rate_pct, active, phone_key, added_by) VALUES ($1, $2, 'commission_only', $3, TRUE, $4, $5)
       RETURNING person_key, name, role, rate_pct, active`, [key, clean, rate, phoneKey || null, actor])).rows[0];
    await writeCommissionAudit(client, { action: 'recruit_added', actor, actorId, personKey: key, details: { name: clean, rate_pct: rate, phone: phoneKey ? maskPhoneLast3(phoneKey) : null } });
    return { ...row, rate_pct: Number(row.rate_pct) };
  });
}

/** Admin: change the rules or a person's rate / active. */
async function saveCommissionSettings({ paysOn, holdDays, cutoffDay, defaultRatePct, staff = [], actor = '', actorId = '' } = {}) {
  return withTx(async (client) => {
    const sets = [];
    const params = [];
    const add = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (paysOn !== undefined) {
      if (!['first_payment', 'every_payment'].includes(paysOn)) throw httpError(400, 'Pays on is first_payment or every_payment.');
      add('pays_on', paysOn);
    }
    if (holdDays !== undefined) add('hold_days', Number(holdDays));
    if (cutoffDay !== undefined) add('cutoff_day', Number(cutoffDay));
    if (defaultRatePct !== undefined) add('default_rate_pct', Number(defaultRatePct));
    if (sets.length) {
      add('updated_by', actor);
      await client.query(`UPDATE commission_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE key = 'default'`, params);
    }
    for (const s of Array.isArray(staff) ? staff : []) {
      const rate = Number(s.rate_pct);
      if (!s.person_key || !(rate >= 0 && rate <= 100)) throw httpError(400, 'Each rate is a percent between 0 and 100.');
      await client.query('UPDATE commission_staff SET rate_pct = $2, active = $3, updated_by = $4, updated_at = NOW() WHERE person_key = $1', [s.person_key, rate, s.active !== false, actor]);
    }
    await writeCommissionAudit(client, { action: 'settings_saved', actor, actorId, details: { pays_on: paysOn, hold_days: holdDays, cutoff_day: cutoffDay, default_rate_pct: defaultRatePct, staff } });
    return loadSettings(client);
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  STATUS_LABELS,
  kampalaDay,
  nextPayday,
  paydayForDay,
  cutoffFor,
  countdown,
  commissionFor,
  hamming,
  imageKey,
  paymentProblem,
  duplicateOf,
  staffPhoneMap,
  attributeSends,
  evaluateCommission,
  selectForPayout,
  loadSettings,
  summary,
  evaluate,
  refreshPhotoHashes,
  createPayout,
  reviewPayout,
  markPayoutPaid,
  cancelPayout,
  addRecruit,
  saveCommissionSettings
};
