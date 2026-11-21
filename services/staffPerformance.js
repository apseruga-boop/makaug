'use strict';

/**
 * Staff Performance: Road to 1000 (15 Nov 2026).
 *
 * Arthur: 1,000 paying agents by 31 Dec 2026, tracked from Monday 16 Nov.
 * Each person (Arthur, Ronald, Sharon and anyone added to Agent 007 in King)
 * has a daily target of joining films; a missed target is carried to the next
 * day as "owed". The desk shows what came back from each film, not only that
 * it went: replies, calls, sign-ups and payments.
 *
 * What is automatic and what is tapped:
 *   sent       the Outreach list (agent_prospects), as today
 *   replied    an inbound WhatsApp after the film, or an outcome tapped
 *   spoke      an outcome tapped after the Call button (or Called on Outreach)
 *   signed up  an agent with the same number, created after the film
 *   paid       a subscription payment on the books for that agent or number
 * Sign-ups and payments are credited to whoever sent the film.
 *
 * The pure functions at the top are the maths; they are what the tests check.
 * Phones are only ever shown as the last three digits.
 */

const { parseCompanionCsv } = require('../utils/companionCsv');
const db = require('../config/database');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const {
  prospectPhoneKey,
  maskPhoneLast3,
  senderBucket,
  staffSenderChoices,
  knownOutreachSenders,
  resolveOutreachSenderName
} = require('./outreachSenderName');

const CAMPAIGN_KEY = 'road_to_1000';
const TZ = 'Africa/Kampala';

const DEFAULT_CAMPAIGN = Object.freeze({
  key: CAMPAIGN_KEY,
  name: 'Road to 1000',
  goal_paying_agents: 1000,
  starts_on: '2026-11-16',
  ends_on: '2026-12-31',
  assumed_paid_rate: 0.5,
  points: { send: 1, reply: 3, signed_up: 10, paid: 25 }
});

const OUTCOMES = Object.freeze({
  no_answer: 'No answer',
  replied: 'Replied / chatting',
  interested: 'Interested',
  signed_up: 'Signed up',
  paid: 'Paid',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number'
});

// When to try again if nobody picks a date. null = the loop is closed.
const DEFAULT_FOLLOW_UP_DAYS = Object.freeze({
  no_answer: 1, replied: 1, interested: 1, signed_up: 2, paid: null, not_interested: null, wrong_number: null
});

const SPOKE_OUTCOMES = new Set(['replied', 'interested', 'signed_up', 'paid', 'not_interested']);
const REPLIED_OUTCOMES = new Set(['replied', 'interested', 'signed_up', 'paid', 'not_interested']);
const CLOSED_OUTCOMES = new Set(['paid', 'not_interested', 'wrong_number']);

const REFUSED_LABELS = Object.freeze({
  duplicate_sent: 'Already sent a film',
  duplicate_list: 'Already on someone’s list',
  existing_agent: 'Already an agent',
  do_not_contact: 'Do not contact',
  invalid: 'Not a phone number'
});

// ---------------------------------------------------------------- dates ----

function kampalaDay(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function dayToUtc(day) {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(day, n) {
  return new Date(dayToUtc(day) + n * 86400000).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / 86400000);
}

function listDays(from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

function weekStart(day) {
  const dow = new Date(dayToUtc(day)).getUTCDay(); // 0 Sunday
  return addDays(day, -((dow + 6) % 7));
}

function toDay(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return kampalaDay(value);
}

// ---------------------------------------------------------------- maths ----

function ratio(num, den) {
  return den > 0 ? num / den : 0;
}

/**
 * The rates the plan runs on. Send → sign-up is measured. Sign-up → paid is
 * measured once at least `minSignups` sign-ups exist and one has paid;
 * until then the campaign's assumed rate is used, and the answer says so.
 */
function conversionRates({ sent = 0, signedUp = 0, paid = 0 } = {}, { assumedPaidRate = 0.5, minSignups = 10 } = {}) {
  const sendToSignup = ratio(signedUp, sent);
  const measuredPaid = ratio(paid, signedUp);
  const useMeasured = signedUp >= minSignups && paid > 0;
  const signupToPaid = useMeasured ? measuredPaid : Number(assumedPaidRate) || 0;
  return {
    send_to_signup: sendToSignup,
    signup_to_paid: signupToPaid,
    signup_to_paid_source: useMeasured ? 'measured' : 'assumed',
    send_to_paid: sendToSignup * signupToPaid
  };
}

/**
 * Where Road to 1000 stands and the pace it needs. daysLeft counts today.
 */
function roadTo1000({
  goal = 1000,
  payingNow = 0,
  payingAtStart = 0,
  today,
  startsOn,
  endsOn,
  sendToPaid = 0,
  filmsSinceStart = 0
} = {}) {
  const started = today >= startsOn;
  const daysLeft = Math.max(0, daysBetween(today, endsOn) + 1);
  const daysTotal = daysBetween(startsOn, endsOn) + 1;
  const daysGone = started ? Math.min(daysTotal, daysBetween(startsOn, today) + 1) : 0;
  const remaining = Math.max(0, goal - payingNow);
  const filmsNeeded = sendToPaid > 0 ? Math.ceil(remaining / sendToPaid) : null;
  return {
    goal,
    paying_now: payingNow,
    remaining,
    percent: Math.min(100, Math.round(ratio(payingNow, goal) * 1000) / 10),
    days_left: daysLeft,
    days_total: daysTotal,
    days_gone: daysGone,
    required_paying_per_day: daysLeft > 0 ? Math.round((remaining / daysLeft) * 10) / 10 : remaining,
    actual_paying_per_day: daysGone > 0 ? Math.round(((payingNow - payingAtStart) / daysGone) * 10) / 10 : 0,
    films_needed: filmsNeeded,
    required_films_per_day: filmsNeeded == null ? null : (daysLeft > 0 ? Math.ceil(filmsNeeded / daysLeft) : filmsNeeded),
    actual_films_per_day: daysGone > 0 ? Math.round((filmsSinceStart / daysGone) * 10) / 10 : 0
  };
}

/** Split a team's daily films between people by share; whole films that add up. */
function splitTargets(totalPerDay, shares = {}) {
  const keys = Object.keys(shares);
  const sum = keys.reduce((acc, k) => acc + (Number(shares[k]) || 0), 0) || 1;
  const raw = keys.map((k) => ({ k, v: (Number(totalPerDay) || 0) * (Number(shares[k]) || 0) / sum }));
  const out = Object.fromEntries(raw.map(({ k, v }) => [k, Math.floor(v)]));
  let left = Math.round(Number(totalPerDay) || 0) - Object.values(out).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b.v % 1) - (a.v % 1));
  for (let i = 0; left > 0 && raw.length; i = (i + 1) % raw.length, left -= 1) out[raw[i].k] += 1;
  return out;
}

/** The daily target in force on a day: the latest one set on or before it. */
function targetForDay(rows = [], personKey, day) {
  let best = null;
  for (const row of rows) {
    if (row.person_key !== personKey) continue;
    const from = toDay(row.effective_from);
    if (from <= day && (!best || from > toDay(best.effective_from))) best = row;
  }
  return best ? Number(best.daily_target) || 0 : 0;
}

/**
 * Missed films are owed the next day. Due = today's target + what is owed;
 * sending more than is due pays the debt off but is not banked for later.
 */
function carryOver(days = [], targetOn = () => 0, sentOn = () => 0) {
  let owed = 0;
  return days.map((day) => {
    const target = Number(targetOn(day)) || 0;
    const sent = Number(sentOn(day)) || 0;
    const owedBefore = owed;
    const due = target + owedBefore;
    owed = Math.max(0, due - sent);
    return { day, target, sent, owed_before: owedBefore, due, owed_after: owed, hit: target > 0 && sent >= target };
  });
}

/** Days in a row the daily target was hit, counting back from today (today only counts once it is hit). */
function streak(ledger = []) {
  let count = 0;
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    const row = ledger[i];
    if (i === ledger.length - 1 && !row.hit) continue;
    if (!row.hit) break;
    count += 1;
  }
  return count;
}

function pointsFor(counts = {}, points = DEFAULT_CAMPAIGN.points) {
  const p = { ...DEFAULT_CAMPAIGN.points, ...(points || {}) };
  return (counts.sent || 0) * (Number(p.send) || 0)
    + (counts.replied || 0) * (Number(p.reply) || 0)
    + (counts.signed_up || 0) * (Number(p.signed_up) || 0)
    + (counts.paid || 0) * (Number(p.paid) || 0);
}

/**
 * Which agent and payment belong to each film, by the last nine digits of the
 * number. A sign-up only counts if the agent was created after the film, so
 * nobody is credited for someone who was already with us.
 */
function matchSends(sends = [], agents = [], payments = []) {
  const agentsByKey = new Map();
  for (const agent of agents) {
    for (const key of [prospectPhoneKey(agent.phone), prospectPhoneKey(agent.whatsapp)]) {
      if (key.length !== 9) continue;
      const list = agentsByKey.get(key) || [];
      if (!list.includes(agent)) list.push(agent);
      agentsByKey.set(key, list);
    }
  }
  const payByAgent = new Map();
  const payByKey = new Map();
  for (const pay of payments) {
    if (pay.agent_id) payByAgent.set(String(pay.agent_id), [...(payByAgent.get(String(pay.agent_id)) || []), pay]);
    const key = prospectPhoneKey(pay.payer_phone);
    if (key.length === 9) payByKey.set(key, [...(payByKey.get(key) || []), pay]);
  }
  return sends.map((send) => {
    const key = send.phone_key || prospectPhoneKey(send.phone);
    const pitchedAt = new Date(send.pitched_at).getTime();
    const candidates = (agentsByKey.get(key) || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const agent = candidates.find((a) => new Date(a.created_at).getTime() >= pitchedAt) || null;
    const already = !agent && candidates.length > 0;
    const pays = [
      ...(agent ? payByAgent.get(String(agent.id)) || [] : []),
      ...(payByKey.get(key) || [])
    ].filter((p) => new Date(p.paid_at).getTime() >= pitchedAt);
    const firstPay = pays.sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))[0] || null;
    return {
      ...send,
      phone_key: key,
      agent_id: agent ? agent.id : null,
      signed_up_at: agent ? agent.created_at : null,
      already_agent_before_film: already,
      paid_at: (agent || !already) && firstPay ? firstPay.paid_at : null
    };
  });
}

/**
 * Funnel counts and rates. Each send carries booleans; rates are per film sent
 * except "paid of sign-ups".
 */
function funnel(sends = []) {
  const c = { sent: 0, replied: 0, spoke: 0, signed_up: 0, paid: 0, paid_claimed: 0 };
  for (const s of sends) {
    c.sent += 1;
    if (s.replied) c.replied += 1;
    if (s.spoke) c.spoke += 1;
    if (s.signed_up) c.signed_up += 1;
    if (s.paid) c.paid += 1;
    else if (s.paid_claimed) c.paid_claimed += 1;
  }
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  return {
    ...c,
    reply_rate: pct(c.replied, c.sent),
    spoke_rate: pct(c.spoke, c.sent),
    signup_rate: pct(c.signed_up, c.sent),
    paid_rate: pct(c.paid, c.signed_up),
    send_to_paid_rate: pct(c.paid, c.sent)
  };
}

/**
 * What happened to one film, from the matched sign-up/payment, the inbound
 * replies and the events logged against it.
 */
function sendState(send = {}, events = [], firstReplyAt = null) {
  const outcomes = events.filter((e) => e.kind === 'outcome').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const latest = outcomes[outcomes.length - 1] || null;
  const tapped = new Set(outcomes.map((e) => e.outcome));
  const replyEvent = events.find((e) => e.kind === 'replied');
  const signedUp = !!send.signed_up_at || tapped.has('signed_up') || tapped.has('paid');
  const paid = !!send.paid_at;
  const replied = !!firstReplyAt || !!replyEvent || [...tapped].some((o) => REPLIED_OUTCOMES.has(o)) || signedUp
    || ['interested', 'declined'].includes(String(send.status || ''));
  const spoke = [...tapped].some((o) => SPOKE_OUTCOMES.has(o)) || !!send.called_at;
  return {
    replied,
    replied_at: firstReplyAt || (replyEvent && replyEvent.created_at) || null,
    spoke,
    signed_up: signedUp,
    signed_up_auto: !!send.signed_up_at,
    paid,
    paid_claimed: !paid && tapped.has('paid'),
    // A "No answer" is not a call (17 Nov 2026): kept in the history, not counted.
    calls: Math.max(0, events.filter((e) => e.kind === 'call_started').length - events.filter((e) => e.kind === 'outcome' && e.outcome === 'no_answer').length),
    not_answered: events.filter((e) => e.kind === 'outcome' && e.outcome === 'no_answer').length,
    last_outcome: latest ? latest.outcome : null,
    last_outcome_at: latest ? latest.created_at : null,
    follow_up_on: latest ? toDay(latest.follow_up_on) || null : null
  };
}

/**
 * Ronald's follow-ups for today, oldest due first. A film comes due when the
 * tapped follow-up date arrives, when they wrote back and nobody has logged
 * a conversation since, or when two days pass with no reply and no call.
 */
function followUpsDue(sends = [], today) {
  const out = [];
  for (const s of sends) {
    if (s.do_not_contact || s.paid || s.status === 'declined') continue;
    if (s.last_outcome && CLOSED_OUTCOMES.has(s.last_outcome)) continue;
    let due = null;
    let reason = '';
    if (s.last_outcome && s.follow_up_on) {
      due = s.follow_up_on;
      reason = `Follow-up after “${OUTCOMES[s.last_outcome] || s.last_outcome}”`;
    } else if (s.last_outcome && DEFAULT_FOLLOW_UP_DAYS[s.last_outcome] == null) {
      continue;
    } else if (s.signed_up && !s.paid && !s.last_outcome) {
      due = addDays(toDay(s.signed_up_at || s.pitched_at), 1);
      reason = 'Signed up, not paid yet — collect the UGX 50,000 (MoMo merchant code 27248497)';
    } else if (s.replied_at && (!s.last_outcome_at || new Date(s.last_outcome_at) < new Date(s.replied_at))) {
      due = toDay(s.replied_at);
      reason = 'Wrote back on WhatsApp — reply or call';
    } else if (!s.last_outcome && !s.replied && !s.signed_up) {
      due = addDays(toDay(s.pitched_at), 2);
      reason = 'No reply 2 days after the film — call';
    } else if (s.last_outcome) {
      due = addDays(toDay(s.last_outcome_at), DEFAULT_FOLLOW_UP_DAYS[s.last_outcome]);
      reason = `Follow-up after “${OUTCOMES[s.last_outcome] || s.last_outcome}”`;
    }
    if (!due || due > today) continue;
    out.push({ ...s, due_on: due, overdue_days: daysBetween(due, today), reason });
  }
  return out.sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : 0)
    || (b.replied_at ? 1 : 0) - (a.replied_at ? 1 : 0));
}

/**
 * Sort a pasted list into numbers we can send to and numbers we must not:
 * already sent a film, already on someone's list, already an agent, a
 * found-online lister, or not a phone number. Repeats within the paste count
 * once. `known` holds Sets of phone keys (and who has each listed number).
 */
function dedupeList(lines = [], known = {}) {
  const seen = new Set();
  return lines.map((line, i) => {
    const name = String(line.name || '').trim().slice(0, 120);
    const digits = String(line.phone || '').replace(/\D/g, '');
    const key = prospectPhoneKey(digits);
    const base = { name, phone: digits, phone_key: key, what_they_posted: String(line.what_they_posted || '').slice(0, 500), list_source: String(line.source || '').slice(0, 60), list_order: i + 1 };
    if (key.length !== 9 || digits.length > 15) return { ...base, accepted: false, refused_reason: 'invalid' };
    if (seen.has(key)) return { ...base, accepted: false, refused_reason: 'duplicate_list', refused_detail: 'twice in this paste' };
    seen.add(key);
    if (known.doNotContact && known.doNotContact.has(key)) return { ...base, accepted: false, refused_reason: 'do_not_contact' };
    if (known.agents && known.agents.has(key)) return { ...base, accepted: false, refused_reason: 'existing_agent' };
    if (known.sent && known.sent.has(key)) return { ...base, accepted: false, refused_reason: 'duplicate_sent', refused_detail: known.sent.get ? known.sent.get(key) || '' : '' };
    if (known.listed && known.listed.has(key)) return { ...base, accepted: false, refused_reason: 'duplicate_list', refused_detail: known.listed.get ? known.listed.get(key) || '' : '' };
    // Found-online listers may be sent the film since 15 Nov 2026; tagged.
    return { ...base, accepted: true, lead_source: known.foundOnline && known.foundOnline.has(key) ? 'found_online' : null };
  });
}

/** "Name, 0772…" / "0772… Name" / one number a line. */
function parsePastedList(text = '') {
  return String(text || '').split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean).slice(0, 2000).map((raw) => {
    const match = raw.match(/\+?\d[\d\s().-]{7,}\d/);
    const phone = match ? match[0] : '';
    const name = (match ? raw.replace(match[0], ' ') : raw).replace(/[,;\t|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { name, phone };
  });
}

// ---------------------------------------------------------- data access ----

async function safeRows(sql, params = []) {
  try {
    return (await db.query(sql, params)).rows || [];
  } catch (_) {
    return [];
  }
}

async function loadCampaign() {
  const rows = await safeRows('SELECT key, name, goal_paying_agents, starts_on::text AS starts_on, ends_on::text AS ends_on, assumed_paid_rate, points FROM staff_performance_campaigns WHERE key = $1', [CAMPAIGN_KEY]);
  const row = rows[0] || {};
  return {
    ...DEFAULT_CAMPAIGN,
    ...row,
    starts_on: toDay(row.starts_on) || DEFAULT_CAMPAIGN.starts_on,
    ends_on: toDay(row.ends_on) || DEFAULT_CAMPAIGN.ends_on,
    assumed_paid_rate: Number(row.assumed_paid_rate || DEFAULT_CAMPAIGN.assumed_paid_rate),
    points: { ...DEFAULT_CAMPAIGN.points, ...(row.points && typeof row.points === 'object' ? row.points : {}) }
  };
}

async function loadPeople(targets = []) {
  await require('./billingOpsService').loadAgent007Staff(db).catch(() => null);
  const people = staffSenderChoices();
  for (const t of targets) {
    if (!people.some((p) => p.key === t.person_key)) people.push({ key: t.person_key, name: t.person_name || t.person_key });
  }
  return people;
}

function personKeyFor(value, people) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return people.some((p) => p.key === key) ? key : '';
}

async function loadSends() {
  const known = knownOutreachSenders();
  const rows = await safeRows(
    `SELECT p.id, p.full_name, p.phone_key, p.status, p.video_kind, p.pitched_at, p.pitched_by, p.pitched_by_name,
            p.do_not_contact, p.called_at, p.logged_manually, p.metadata->>'lead_source' AS lead_source
       FROM agent_prospects p
      WHERE COALESCE(p.video_kind, 'agent') = 'agent'
      ORDER BY p.pitched_at DESC
      LIMIT 20000`
  );
  const found = await foundOnlineKeys(rows.map((r) => r.phone_key));
  return rows.map((row) => {
    const name = resolveOutreachSenderName(row, known);
    return { ...row, sender_name: name, person_key: senderBucket(name), found_online: row.lead_source === 'found_online' || found.has(row.phone_key) };
  });
}

/** Which of these numbers are on a found-online listing (last nine digits). */
async function foundOnlineKeys(keys = []) {
  const list = [...new Set(keys.filter((k) => String(k || '').length === 9))];
  if (!list.length) return new Set();
  const rows = await safeRows(
    `SELECT DISTINCT k FROM (
        SELECT RIGHT(REGEXP_REPLACE(COALESCE(p.lister_phone, ''), '[^0-9]', '', 'g'), 9) AS k
          FROM properties p WHERE ${foundOnlinePropertySql('p')}
        UNION
        SELECT RIGHT(REGEXP_REPLACE(COALESCE(p.extra_fields->>'lister_phone', p.extra_fields->>'phone', p.extra_fields->>'whatsapp', ''), '[^0-9]', '', 'g'), 9)
          FROM properties p WHERE ${foundOnlinePropertySql('p')}
      ) x WHERE k = ANY($1::text[])`,
    [list]
  );
  return new Set(rows.map((r) => r.k));
}

async function loadAgentsAndPayments() {
  const [agents, payments] = await Promise.all([
    safeRows('SELECT id, phone, whatsapp, created_at, status FROM agents'),
    safeRows(
      `SELECT agent_id, payer_phone, paid_at FROM revenue_entries
        WHERE kind = 'agent_subscription' AND direction = 'in' AND voided_at IS NULL
       UNION ALL
       SELECT agent_id, payer_phone, COALESCE(decided_at, created_at) AS paid_at FROM payment_claims
        WHERE status = 'confirmed' AND purpose = 'agent_subscription'`
    )
  ]);
  return { agents, payments };
}

async function loadFirstReplies() {
  const rows = await safeRows(
    // Normalise each recent inbound number once, then hash-join (live: ~1 s down to ~40 ms, 21 Nov 2026).
    `WITH m AS MATERIALIZED (
       SELECT RIGHT(REGEXP_REPLACE(COALESCE(user_phone, ''), '[^0-9]', '', 'g'), 9) AS k, created_at
         FROM whatsapp_messages
        WHERE direction = 'inbound' AND created_at >= NOW() - INTERVAL '120 days')
     SELECT p.id, MIN(m.created_at) AS first_reply_at
       FROM agent_prospects p
       JOIN m ON m.k = p.phone_key AND m.created_at > p.pitched_at
      WHERE COALESCE(p.video_kind, 'agent') = 'agent'
      GROUP BY p.id`
  );
  return new Map(rows.map((r) => [String(r.id), r.first_reply_at]));
}

async function payingAgents(today, startsOn) {
  const rows = await safeRows(
    `SELECT
        COUNT(DISTINCT a.id) FILTER (WHERE a.paid_until >= $1::date) AS now,
        COUNT(DISTINCT a.id) FILTER (WHERE r.first_paid < $2::date AND a.paid_until >= $2::date) AS at_start
       FROM agents a
       JOIN LATERAL (
         SELECT MIN(paid_at) AS first_paid FROM revenue_entries r
          WHERE r.agent_id = a.id AND r.kind = 'agent_subscription' AND r.direction = 'in' AND r.voided_at IS NULL
       ) r ON r.first_paid IS NOT NULL
      WHERE a.removed_at IS NULL AND a.status = 'approved' AND COALESCE(a.fee_exempt, false) = false`,
    [today, startsOn]
  );
  return { now: Number(rows[0]?.now || 0), atStart: Number(rows[0]?.at_start || 0) };
}

function maskedSend(s) {
  return {
    id: s.id,
    full_name: s.full_name || 'Unnamed',
    phone_masked: maskPhoneLast3(s.phone_key),
    sender_name: s.sender_name,
    person_key: s.person_key,
    pitched_at: s.pitched_at,
    replied_at: s.replied_at || null,
    signed_up: !!s.signed_up,
    paid: !!s.paid,
    calls: s.calls || 0,
    last_outcome: s.last_outcome,
    last_outcome_label: s.last_outcome ? OUTCOMES[s.last_outcome] : '',
    last_outcome_at: s.last_outcome_at,
    follow_up_on: s.follow_up_on,
    due_on: s.due_on,
    overdue_days: s.overdue_days,
    reason: s.reason
  };
}

/**
 * Everything the Staff Performance tab draws, in one call.
 */
async function getDashboard({ now = new Date() } = {}) {
  const today = kampalaDay(now);
  const campaign = await loadCampaign();
  const targets = await safeRows(
    `SELECT person_key, person_name, daily_target, effective_from::text AS effective_from, set_by, set_at
       FROM staff_performance_targets WHERE campaign_key = $1 ORDER BY effective_from`,
    [CAMPAIGN_KEY]
  );
  const people = await loadPeople(targets);
  const [rawSends, { agents, payments }, replies, events, lists, paying] = await Promise.all([
    loadSends(),
    loadAgentsAndPayments(),
    loadFirstReplies(),
    safeRows(`SELECT id, prospect_id, phone_key, kind, outcome, block_code, note, follow_up_on::text AS follow_up_on, person_key, actor_account, source, created_at
                FROM outreach_events ORDER BY created_at LIMIT 50000`),
    safeRows(`SELECT id, person_key, list_day::text AS list_day, full_name, phone_key, accepted, lead_source, refused_reason, refused_detail, added_by, added_at
                FROM outreach_list_numbers WHERE campaign_key = $1 ORDER BY added_at LIMIT 50000`, [CAMPAIGN_KEY]),
    payingAgents(today, campaign.starts_on)
  ]);

  const eventsByProspect = new Map();
  for (const e of events) {
    if (!e.prospect_id) continue;
    const k = String(e.prospect_id);
    eventsByProspect.set(k, [...(eventsByProspect.get(k) || []), e]);
  }
  const sends = matchSends(rawSends, agents, payments).map((s) => {
    const state = sendState(s, eventsByProspect.get(String(s.id)) || [], replies.get(String(s.id)) || null);
    return { ...s, ...state, day: kampalaDay(s.pitched_at) };
  });

  const campaignSends = sends.filter((s) => s.day >= campaign.starts_on && s.day <= campaign.ends_on);
  const allTime = funnel(sends);
  const rates = conversionRates(
    { sent: allTime.sent, signedUp: allTime.signed_up, paid: allTime.paid },
    { assumedPaidRate: campaign.assumed_paid_rate }
  );
  const road = roadTo1000({
    goal: Number(campaign.goal_paying_agents) || 1000,
    payingNow: paying.now,
    payingAtStart: paying.atStart,
    today,
    startsOn: campaign.starts_on,
    endsOn: campaign.ends_on,
    sendToPaid: rates.send_to_paid,
    filmsSinceStart: campaignSends.length
  });

  const ledgerEnd = today < campaign.ends_on ? today : campaign.ends_on;
  const ledgerDays = listDays(campaign.starts_on, ledgerEnd);
  const week0 = weekStart(today);
  const blocked = events.filter((e) => e.kind === 'blocked');
  const listedByKey = new Map(lists.filter((l) => l.accepted).map((l) => [l.phone_key, l]));
  const sentKeys = new Map(sends.map((s) => [s.phone_key, s]));

  const perPerson = people.map((person) => {
    const mine = sends.filter((s) => s.person_key === person.key);
    const mineCampaign = mine.filter((s) => s.day >= campaign.starts_on);
    const countOn = (day) => mine.filter((s) => s.day === day).length;
    const ledger = carryOver(ledgerDays, (day) => targetForDay(targets, person.key, day), countOn);
    const todayRow = ledger.find((r) => r.day === today) || {
      day: today, target: targetForDay(targets, person.key, today), sent: countOn(today), owed_before: 0,
      due: targetForDay(targets, person.key, today), owed_after: 0, hit: false
    };
    const dayCounts = (list) => ({
      sent: list.length,
      replied: list.filter((s) => s.replied).length,
      signed_up: list.filter((s) => s.signed_up).length,
      paid: list.filter((s) => s.paid).length
    });
    const todayList = mine.filter((s) => s.day === today);
    const myList = lists.filter((l) => l.person_key === person.key);
    const myAccepted = myList.filter((l) => l.accepted);
    const stream = myAccepted.map((l) => {
      const sent = sentKeys.get(l.phone_key);
      let status = 'assigned';
      if (sent) {
        status = sent.paid ? 'paid' : sent.signed_up ? 'signed_up' : sent.replied ? 'replied' : 'sent';
      }
      return {
        id: l.id,
        full_name: l.full_name || '',
        phone_masked: maskPhoneLast3(l.phone_key),
        list_day: toDay(l.list_day),
        carried_days: status === 'assigned' ? Math.max(0, daysBetween(toDay(l.list_day), today)) : 0,
        status,
        found_online: l.lead_source === 'found_online',
        sent_by: sent ? sent.sender_name : ''
      };
    });
    const myBlocked = blocked.filter((e) => e.person_key === person.key);
    const refusedOnPaste = myList.filter((l) => !l.accepted);
    return {
      key: person.key,
      name: person.name,
      target_today: todayRow.target,
      owed: todayRow.owed_before,
      due_today: todayRow.due,
      sent_today: todayRow.sent,
      behind: todayRow.sent < todayRow.due,
      sent_week: mine.filter((s) => s.day >= week0 && s.day <= today).length,
      sent_campaign: mineCampaign.length,
      sent_all_time: mine.length,
      streak: streak(ledger),
      points_today: pointsFor(dayCounts(todayList), campaign.points),
      points_campaign: pointsFor(dayCounts(mineCampaign), campaign.points),
      funnel_campaign: funnel(mineCampaign),
      funnel_all_time: funnel(mine),
      ledger: ledger.slice(-14),
      wasted: {
        // Blocked under the old rule (before 15 Nov 2026); nothing is blocked for this now.
        found_online_old_rule: myBlocked.filter((e) => e.block_code === 'found_online').length,
        do_not_contact: myBlocked.filter((e) => e.block_code === 'do_not_contact').length + refusedOnPaste.filter((l) => l.refused_reason === 'do_not_contact').length,
        duplicate: myBlocked.filter((e) => e.block_code === 'already_sent').length + refusedOnPaste.filter((l) => ['duplicate_sent', 'duplicate_list'].includes(l.refused_reason)).length,
        existing_agent: refusedOnPaste.filter((l) => l.refused_reason === 'existing_agent').length,
        invalid: refusedOnPaste.filter((l) => l.refused_reason === 'invalid').length
      },
      stream: {
        waiting: stream.filter((s) => s.status === 'assigned').length,
        carried: stream.filter((s) => s.status === 'assigned' && s.carried_days > 0).length,
        done: stream.filter((s) => s.status !== 'assigned').length,
        refused: refusedOnPaste.length,
        items: stream.sort((a, b) => (a.status === 'assigned' ? 0 : 1) - (b.status === 'assigned' ? 0 : 1) || (a.list_day < b.list_day ? -1 : 1)).slice(0, 300)
      }
    };
  });

  const topToday = perPerson.filter((p) => p.points_today > 0).sort((a, b) => b.points_today - a.points_today)[0] || null;

  // Who did what, per person per day (last 14 days).
  const activityDays = listDays(addDays(today, -13), today);
  const activity = activityDays.map((day) => ({
    day,
    people: people.map((person) => {
      const ev = events.filter((e) => e.person_key === person.key && kampalaDay(e.created_at) === day);
      const sentList = sends.filter((s) => s.person_key === person.key && s.day === day);
      return {
        key: person.key,
        sent: sentList.length,
        calls: Math.max(0, ev.filter((e) => e.kind === 'call_started').length - ev.filter((e) => e.kind === 'outcome' && e.outcome === 'no_answer').length),
        not_answered: ev.filter((e) => e.kind === 'outcome' && e.outcome === 'no_answer').length,
        outcomes: ev.filter((e) => e.kind === 'outcome').length,
        spoke: ev.filter((e) => e.kind === 'outcome' && SPOKE_OUTCOMES.has(e.outcome)).length,
        signed_up: sends.filter((s) => s.person_key === person.key && s.signed_up_at && kampalaDay(s.signed_up_at) === day).length,
        paid: sends.filter((s) => s.person_key === person.key && s.paid_at && kampalaDay(s.paid_at) === day).length,
        numbers_added: lists.filter((l) => l.person_key === person.key && l.accepted && kampalaDay(l.added_at) === day).length,
        blocked: ev.filter((e) => e.kind === 'blocked').length
      };
    })
  })).reverse();

  const recentLog = events.slice(-60).reverse().map((e) => ({
    at: e.created_at,
    person_key: e.person_key,
    kind: e.kind,
    outcome: e.outcome,
    outcome_label: e.outcome ? OUTCOMES[e.outcome] : '',
    block_code: e.block_code,
    note: String(e.note || '').slice(0, 140),
    phone_masked: maskPhoneLast3(e.phone_key),
    by_account: e.actor_account || '',
    source: e.source
  }));

  // Since 16 Nov 2026 the tab is judged on commission (agents closed); films
  // and targets above stay as secondary information.
  const commission = await require('./staffCommission').summary({
    sends: rawSends, now, roadPayingNow: paying.now, goal: Number(campaign.goal_paying_agents) || 1000
  }).catch((error) => ({ error: error.message }));

  return {
    today,
    commission,
    campaign: {
      key: campaign.key,
      name: campaign.name,
      goal: Number(campaign.goal_paying_agents) || 1000,
      starts_on: campaign.starts_on,
      ends_on: campaign.ends_on,
      assumed_paid_rate: campaign.assumed_paid_rate,
      points: campaign.points,
      started: today >= campaign.starts_on
    },
    road,
    rates: {
      ...rates,
      measured_from: { sent: allTime.sent, signed_up: allTime.signed_up, paid: allTime.paid }
    },
    team_target_today: perPerson.reduce((a, p) => a + p.target_today, 0),
    people: perPerson,
    top_today: topToday ? { key: topToday.key, name: topToday.name, points: topToday.points_today } : null,
    funnel_campaign: funnel(campaignSends),
    funnel_all_time: allTime,
    // Films to found-online listers (allowed from 15 Nov 2026), reported apart.
    funnel_found_online_campaign: funnel(campaignSends.filter((s) => s.found_online)),
    funnel_found_online_all_time: funnel(sends.filter((s) => s.found_online)),
    follow_ups: followUpsDue(sends, today).slice(0, 150).map(maskedSend),
    activity,
    log: recentLog,
    outcomes: OUTCOMES,
    targets_history: targets.slice(-30).map((t) => ({ ...t, effective_from: toDay(t.effective_from) }))
  };
}

// --------------------------------------------------------------- writes ----

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function insertEvent(e) {
  const row = (await db.query(
    `INSERT INTO outreach_events (prospect_id, phone_key, kind, outcome, block_code, note, follow_up_on, person_key, actor_account, actor_user_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, kind, outcome, follow_up_on::text AS follow_up_on, person_key, created_at`,
    [e.prospectId || null, e.phoneKey || null, e.kind, e.outcome || null, e.blockCode || null,
      e.note ? String(e.note).slice(0, 500) : null, e.followUpOn || null, e.personKey || null,
      e.actorAccount || null, e.actorUserId ? String(e.actorUserId) : null, e.source || 'desk']
  )).rows[0];
  return row;
}

async function prospectForEvent(id) {
  const row = (await db.query('SELECT id, phone, phone_key, full_name, do_not_contact FROM agent_prospects WHERE id = $1', [id])).rows[0];
  if (!row) throw httpError(404, 'That send was not found.');
  return row;
}

/** Log that a call started and hand back the number to dial (the only place a full number leaves the server). */
async function startCall(prospectId, { personKey = '', actorAccount = '', actorUserId = '' } = {}) {
  const prospect = await prospectForEvent(prospectId);
  if (prospect.do_not_contact) throw httpError(409, 'This person asked not to be contacted again.');
  const people = await loadPeople([]);
  const event = await insertEvent({
    prospectId: prospect.id, phoneKey: prospect.phone_key, kind: 'call_started',
    personKey: personKeyFor(personKey, people), actorAccount, actorUserId
  });
  const digits = String(prospect.phone || '').replace(/\D/g, '');
  const dial = digits.startsWith('0') ? `+256${digits.slice(1)}` : digits.length === 9 ? `+256${digits}` : `+${digits}`;
  return { event, tel: dial };
}

async function logOutcome(prospectId, { outcome = '', note = '', followUpOn = '', personKey = '', actorAccount = '', actorUserId = '' } = {}) {
  if (!OUTCOMES[outcome]) throw httpError(400, 'Pick what happened.');
  const prospect = await prospectForEvent(prospectId);
  let follow = /^\d{4}-\d{2}-\d{2}$/.test(String(followUpOn || '')) ? String(followUpOn) : null;
  if (!follow && DEFAULT_FOLLOW_UP_DAYS[outcome] != null) follow = addDays(kampalaDay(), DEFAULT_FOLLOW_UP_DAYS[outcome]);
  if (CLOSED_OUTCOMES.has(outcome)) follow = null;
  const people = await loadPeople([]);
  return insertEvent({
    prospectId: prospect.id, phoneKey: prospect.phone_key, kind: 'outcome', outcome, note,
    followUpOn: follow, personKey: personKeyFor(personKey, people), actorAccount, actorUserId
  });
}

/** A send the desk refused (found-online, do-not-contact, already sent): counted as a wasted number for that person. */
async function recordBlockedSend({ phone = '', personKey = '', personName = '', blockCode = '', prospectId = null, actorAccount = '', source = 'desk' } = {}) {
  const key = prospectPhoneKey(phone);
  if (key.length !== 9 || !blockCode) return null;
  const pk = String(personKey || senderBucket(personName) || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  try {
    return await insertEvent({ prospectId, phoneKey: key, kind: 'blocked', blockCode: String(blockCode).slice(0, 40), personKey: pk || null, actorAccount, source });
  } catch (_) {
    return null;
  }
}

/** Latest tapped outcome per send, for the Outreach rows. */
async function latestOutcomes(ids = []) {
  const list = ids.filter(Boolean).map(String);
  if (!list.length) return new Map();
  const rows = await safeRows(
    `SELECT DISTINCT ON (prospect_id) prospect_id, outcome, follow_up_on::text AS follow_up_on, person_key, created_at
       FROM outreach_events WHERE kind = 'outcome' AND prospect_id = ANY($1::uuid[])
      ORDER BY prospect_id, created_at DESC`,
    [list]
  );
  return new Map(rows.map((r) => [String(r.prospect_id), {
    outcome: r.outcome, label: OUTCOMES[r.outcome] || r.outcome, follow_up_on: toDay(r.follow_up_on) || null, person_key: r.person_key, at: r.created_at
  }]));
}

async function knownKeysFor(keys) {
  const list = [...new Set(keys.filter((k) => k.length === 9))];
  if (!list.length) return {};
  const [sent, agents, listed, found] = await Promise.all([
    db.query(`SELECT phone_key, pitched_by_name, pitched_at, do_not_contact FROM agent_prospects WHERE phone_key = ANY($1::text[])`, [list]),
    db.query(`SELECT k FROM (
                SELECT RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) AS k FROM agents
                UNION SELECT RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) FROM agents
              ) x WHERE k = ANY($1::text[])`, [list]),
    db.query(`SELECT phone_key, person_key, list_day::text AS list_day FROM outreach_list_numbers WHERE accepted IS TRUE AND phone_key = ANY($1::text[])`, [list]),
    db.query(`SELECT DISTINCT k FROM (
                SELECT RIGHT(REGEXP_REPLACE(COALESCE(p.lister_phone, ''), '[^0-9]', '', 'g'), 9) AS k
                  FROM properties p WHERE ${foundOnlinePropertySql('p')}
                UNION
                SELECT RIGHT(REGEXP_REPLACE(COALESCE(p.extra_fields->>'lister_phone', p.extra_fields->>'phone', p.extra_fields->>'whatsapp', ''), '[^0-9]', '', 'g'), 9)
                  FROM properties p WHERE ${foundOnlinePropertySql('p')}
              ) x WHERE k = ANY($1::text[])`, [list]).catch(() => ({ rows: [] }))
  ]);
  return {
    sent: new Map(sent.rows.filter((r) => !r.do_not_contact).map((r) => [r.phone_key, `film sent ${kampalaDay(r.pitched_at)}${r.pitched_by_name ? ` by ${r.pitched_by_name}` : ''}`])),
    doNotContact: new Set(sent.rows.filter((r) => r.do_not_contact).map((r) => r.phone_key)),
    agents: new Set(agents.rows.map((r) => r.k)),
    listed: new Map(listed.rows.map((r) => [r.phone_key, `on ${r.person_key}'s list from ${toDay(r.list_day)}`])),
    foundOnline: new Set(found.rows.map((r) => r.k))
  };
}

/**
 * Add a day's numbers to one person's stream. Every line is kept; the ones
 * that must not be sent are kept as refused, with the reason.
 */
async function addListNumbers({ personKey = '', text = '', csv = '', listDay = '', addedBy = '', addedByPerson = '' } = {}) {
  const people = await loadPeople([]);
  const person = personKeyFor(personKey, people);
  if (!person) throw httpError(400, 'Pick whose list this is.');
  let lines;
  if (csv) {
    const parsed = parseCompanionCsv(csv);
    if (parsed.error) throw httpError(400, parsed.error);
    lines = parsed.lines;
    if (!lines.length) throw httpError(400, 'The CSV has a header row but no numbers.');
  } else {
    lines = parsePastedList(text);
    if (!lines.length) throw httpError(400, 'Paste at least one number, one a line.');
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(listDay || '')) ? String(listDay) : kampalaDay();
  const keys = lines.map((l) => prospectPhoneKey(l.phone));
  const known = await knownKeysFor(keys);
  const sorted = dedupeList(lines, known);
  const saved = [];
  for (const line of sorted) {
    try {
      const row = (await db.query(
        `INSERT INTO outreach_list_numbers (campaign_key, person_key, list_day, full_name, phone, phone_key, accepted, refused_reason, refused_detail, added_by, added_by_person, lead_source, what_they_posted, list_source, list_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, accepted, refused_reason`,
        [CAMPAIGN_KEY, person, day, line.name || null, line.phone || '', line.phone_key || '', line.accepted,
          line.refused_reason || null, line.refused_detail || null, addedBy || null, addedByPerson || null, line.lead_source || null,
          line.what_they_posted || null, line.list_source || null, line.list_order || null]
      )).rows[0];
      saved.push({ ...line, id: row.id });
    } catch (error) {
      // Someone else's list took the number a moment ago: keep it as refused.
      if (line.accepted && String(error.code) === '23505') {
        await db.query(
          `INSERT INTO outreach_list_numbers (campaign_key, person_key, list_day, full_name, phone, phone_key, accepted, refused_reason, refused_detail, added_by, added_by_person, what_they_posted, list_source, list_order)
           VALUES ($1, $2, $3, $4, $5, $6, false, 'duplicate_list', 'added to another list at the same time', $7, $8, $9, $10, $11)`,
          [CAMPAIGN_KEY, person, day, line.name || null, line.phone, line.phone_key, addedBy || null, addedByPerson || null,
            line.what_they_posted || null, line.list_source || null, line.list_order || null]
        );
        saved.push({ ...line, accepted: false, refused_reason: 'duplicate_list' });
      } else {
        throw error;
      }
    }
  }
  const summary = { rows: saved.length, from: csv ? 'csv' : 'paste', accepted: 0, refused: {}, invalid: 0 };
  for (const s of saved) {
    if (s.accepted) summary.accepted += 1;
    else summary.refused[s.refused_reason] = (summary.refused[s.refused_reason] || 0) + 1;
    if (!s.accepted && s.refused_reason === 'invalid') summary.invalid += 1;
  }
  return {
    person_key: person,
    list_day: day,
    summary,
    lines: saved.map((s) => ({
      name: s.name,
      phone_masked: maskPhoneLast3(s.phone_key),
      accepted: s.accepted,
      found_online: s.lead_source === 'found_online',
      what_they_posted: s.what_they_posted || '',
      source: s.list_source || '',
      refused: s.accepted ? '' : (REFUSED_LABELS[s.refused_reason] || s.refused_reason) + (s.refused_detail ? ` (${s.refused_detail})` : '')
    }))
  };
}

/** The full number for one stream item, for the WhatsApp/Call button (logged like a call). */
async function listNumberToDial(id) {
  const row = (await db.query('SELECT phone FROM outreach_list_numbers WHERE id = $1 AND accepted IS TRUE', [id])).rows[0];
  if (!row) throw httpError(404, 'That number was not found.');
  const digits = String(row.phone || '').replace(/\D/g, '');
  return digits.startsWith('0') ? `256${digits.slice(1)}` : digits.length === 9 ? `256${digits}` : digits;
}

/** King only: targets, the assumed paid rate and the points. A change applies from today; past days keep theirs. */
async function saveSettings({ targets = [], assumedPaidRate, points, actor = '' } = {}) {
  const campaign = await loadCampaign();
  const today = kampalaDay();
  const from = today < campaign.starts_on ? campaign.starts_on : today;
  const people = await loadPeople([]);
  for (const t of Array.isArray(targets) ? targets : []) {
    const key = String(t.person_key || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const value = Math.round(Number(t.daily_target));
    if (!/^[a-z0-9]{1,40}$/.test(key) || !Number.isFinite(value) || value < 0 || value > 5000) {
      throw httpError(400, `A daily target must be a whole number from 0 to 5000${key ? ` (${key})` : ''}.`);
    }
    const name = (people.find((p) => p.key === key) || {}).name || String(t.person_name || key).slice(0, 60);
    await db.query(
      `INSERT INTO staff_performance_targets (campaign_key, person_key, person_name, daily_target, effective_from, set_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (campaign_key, person_key, effective_from)
       DO UPDATE SET daily_target = EXCLUDED.daily_target, person_name = EXCLUDED.person_name, set_by = EXCLUDED.set_by, set_at = NOW()`,
      [CAMPAIGN_KEY, key, name, value, from, actor || null]
    );
  }
  const sets = [];
  const values = [CAMPAIGN_KEY, actor || null];
  if (assumedPaidRate != null && assumedPaidRate !== '') {
    const rate = Number(assumedPaidRate);
    if (!(rate > 0 && rate <= 1)) throw httpError(400, 'The paid rate must be between 1% and 100%.');
    values.push(rate);
    sets.push(`assumed_paid_rate = $${values.length}`);
  }
  if (points && typeof points === 'object') {
    const clean = {};
    for (const k of ['send', 'reply', 'signed_up', 'paid']) {
      const v = Math.round(Number(points[k]));
      if (!Number.isFinite(v) || v < 0 || v > 1000) throw httpError(400, 'Points must be whole numbers from 0 to 1000.');
      clean[k] = v;
    }
    values.push(JSON.stringify(clean));
    sets.push(`points = $${values.length}::jsonb`);
  }
  if (sets.length) {
    await db.query(`UPDATE staff_performance_campaigns SET ${sets.join(', ')}, updated_by = $2, updated_at = NOW() WHERE key = $1`, values);
  }
  return { effective_from: from };
}

module.exports = {
  CAMPAIGN_KEY,
  OUTCOMES,
  REFUSED_LABELS,
  DEFAULT_CAMPAIGN,
  kampalaDay,
  addDays,
  daysBetween,
  listDays,
  loadCampaign,
  payingAgents,
  weekStart,
  conversionRates,
  roadTo1000,
  splitTargets,
  targetForDay,
  carryOver,
  streak,
  pointsFor,
  matchSends,
  funnel,
  sendState,
  followUpsDue,
  dedupeList,
  parsePastedList,
  getDashboard,
  loadSends,
  startCall,
  logOutcome,
  recordBlockedSend,
  latestOutcomes,
  addListNumbers,
  parseCompanionCsv,
  listNumberToDial,
  saveSettings
};
