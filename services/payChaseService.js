'use strict';

/**
 * King › Sales & Revenue › "Asked for money" (17 Nov 2026).
 *
 * One person per row, whatever number of links they were sent. Every number on
 * the card is counted from the same rows the list shows, so the tiles, the
 * charts and the list cannot disagree:
 *   - a link sent twice to the same agent is one person, owing one amount;
 *   - a test link (pay_links.is_test) is shown as Test and counted nowhere;
 *   - an agent who lists free (fee_exempt) is shown as Exempt and not chased;
 *   - an agent still inside a free period is "Not due yet" until the date;
 *   - money recorded for the person after we asked (a paid link, or a ledger
 *     entry for that agent) makes them Paid, even if the link itself is open;
 *   - "opened" means a person opened the page: a fetch within three minutes of
 *     something we sent (the link going out, a reminder) is WhatsApp drawing
 *     the preview (see payLinkService.openedByAPerson).
 * Phones leave the server as the last three digits only.
 */

const crypto = require('crypto');
const { openedByAPerson, payUrl } = require('./payLinkService');

const DAY = 86400000;
const KAMPALA_MS = 3 * 3600000;
const AGE_BUCKETS = [
  { key: '0-7', label: '0–7 days', min: 0, max: 7 },
  { key: '8-14', label: '8–14 days', min: 8, max: 14 },
  { key: '15-30', label: '15–30 days', min: 15, max: 30 },
  { key: '30+', label: 'Over 30 days', min: 31, max: Infinity }
];
const CHASE_AFTER_DAYS = 3;

const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; };
const kampalaDay = (t) => new Date(t + KAMPALA_MS).toISOString().slice(0, 10);
// A DATE column arrives as a Date at local midnight (node-postgres) or as 'YYYY-MM-DD'.
const toDay = (v) => {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const last3 = (v) => { const d = String(v || '').replace(/\D+/g, ''); return d.length >= 3 ? d.slice(-3) : ''; };
const prettyDay = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

function reminderTimes(log) {
  if (!log || typeof log !== 'object') return [];
  return Object.values(log).map((v) => (v && typeof v === 'object' ? v.at : null)).filter(Boolean);
}

function personKey(l) {
  if (l.agent_id) return `agent:${l.agent_id}`;
  if (l.property_id) return `listing:${l.property_id}`;
  if (l.st_listing_id) return `stay:${l.st_listing_id}`;
  const p = String(l.payer_phone || l.sent_to || '').replace(/\D+/g, '');
  // Grouped by number, but the key never carries it (it reaches the browser).
  if (p.length >= 9) return `phone:${crypto.createHash('sha256').update(p.slice(-9)).digest('hex').slice(0, 12)}`;
  return `link:${l.code}`;
}

/** What one link says on its own. */
function linkState(l, now) {
  const today = kampalaDay(now);
  const sent = ms(l.sent_at);
  const lastPay = l.last_payment_on ? ms(`${toDay(l.last_payment_on)}T12:00:00Z`) : null;
  const paidAt = ms(l.paid_at) || (l.status === 'open' ? (ms(l.paid_elsewhere_at) || lastPay) : null);
  const opened = openedByAPerson(l, reminderTimes(l.billing_reminder_log));
  const freeUntil = l.fee_offer_mode === 'free_period' ? toDay(l.fee_offer_until) : '';
  let status;
  if (l.is_test) status = 'test';
  else if (l.status === 'paid' || (paidAt && (!sent || paidAt >= sent - DAY))) status = 'paid';
  else if (l.fee_exempt) status = 'exempt';
  else if (freeUntil && freeUntil >= today) status = 'not_due';
  else status = opened ? 'opened' : 'never_opened';
  return { status, opened, sent, paidAt: status === 'paid' ? (paidAt || ms(l.paid_at)) : null, freeUntil };
}

function nextStep(g) {
  const d = g.days_waiting;
  switch (g.status) {
    case 'test': return { text: 'Test link, not a real request. Counted nowhere.', action: 'none' };
    case 'exempt': return { text: 'Lists free (fee exempt). No chase.', action: 'none' };
    case 'paid': return { text: g.stale_open_links ? 'Paid (in the ledger). Their link still reads open: no need to chase.' : 'Paid. Nothing to do.', action: 'none' };
    case 'not_due': return { text: `Free period until ${prettyDay(g.free_until)}. Chase from then.`, action: 'none' };
    case 'opened': return { text: `Opened the page, not paid (${d} day${d === 1 ? '' : 's'}). Ask what is stopping them.`, action: 'send_again' };
    default:
      if (d < CHASE_AFTER_DAYS) return { text: `Sent ${d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}. Give it ${CHASE_AFTER_DAYS} days before chasing.`, action: 'copy' };
      return { text: `Never opened (${d} days). Check the number, then send again.`, action: 'send_again' };
  }
}

/** Group the links into people and count everything from those groups. */
function buildPayChase(links = [], { now = Date.now(), money = {} } = {}) {
  const groups = new Map();
  for (const l of links) {
    if (l.status === 'cancelled') continue;
    if (!l.sent_at && l.status !== 'paid') continue; // made but never sent: nobody was asked
    const st = linkState(l, now);
    const key = personKey(l);
    const g = groups.get(key) || { key, links: [] };
    g.links.push({ ...l, _st: st });
    groups.set(key, g);
  }
  const people = [];
  for (const g of groups.values()) {
    g.links.sort((a, b) => (a._st.sent || 0) - (b._st.sent || 0));
    const latest = g.links[g.links.length - 1];
    const paid = g.links.filter((l) => l._st.status === 'paid');
    const open = g.links.filter((l) => l.status === 'open' && l._st.status !== 'paid');
    // One state for the person: paid wins, test/exempt are about the person, else the latest link.
    let status = paid.length ? 'paid' : latest._st.status;
    if (!paid.length && g.links.some((l) => l._st.status === 'test')) status = 'test';
    const firstAsked = Math.min(...g.links.map((l) => l._st.sent || ms(l.created_at) || now));
    const waitingFrom = open.length ? Math.min(...open.map((l) => l._st.sent || now)) : firstAsked;
    const daysWaiting = Math.max(0, Math.floor((now - waitingFrom) / DAY));
    const opened = g.links.some((l) => l._st.opened);
    const staleOpen = paid.length ? g.links.filter((l) => l.status === 'open').length : 0;
    const person = {
      key: g.key,
      name: latest.agent_name || latest.payer_name || latest.property_title || latest.description || latest.code,
      kind: latest.agent_id ? 'agent' : (latest.property_id || latest.st_listing_id ? 'owner' : 'other'),
      agent_status: latest.agent_status || null,
      phone_last3: last3(latest.sent_to || latest.payer_phone),
      status,
      opened,
      asks: g.links.length,
      open_links: open.length,
      stale_open_links: staleOpen,
      amount_ugx: Number(latest.amount_ugx || 0),
      outstanding_ugx: ['opened', 'never_opened'].includes(status) ? Number((open[open.length - 1] || latest).amount_ugx || 0) : 0,
      first_asked_at: new Date(firstAsked).toISOString(),
      last_sent_at: latest.sent_at || null,
      paid_at: paid.length ? new Date(Math.max(...paid.map((l) => l._st.paidAt || 0))).toISOString() : null,
      days_waiting: status === 'opened' || status === 'never_opened' ? daysWaiting : 0,
      free_until: latest._st.freeUntil || null,
      exempt_reason: latest.fee_exempt ? (latest.fee_exempt_reason || 'Lists free') : null,
      code: (open[open.length - 1] || latest).code,
      url: payUrl((open[open.length - 1] || latest).code),
      codes: g.links.map((l) => l.code)
    };
    const step = nextStep(person);
    person.next_step = step.text;
    person.next_action = step.action;
    people.push(person);
  }
  // Waiting first (longest wait first), then the rest.
  const order = { opened: 0, never_opened: 0, not_due: 1, paid: 2, exempt: 3, test: 4 };
  people.sort((a, b) => (order[a.status] - order[b.status]) || (b.days_waiting - a.days_waiting) || a.name.localeCompare(b.name));

  const real = people.filter((p) => p.status !== 'test');
  const waiting = real.filter((p) => p.status === 'opened' || p.status === 'never_opened');
  const chargeable = real.filter((p) => p.status !== 'exempt' && p.status !== 'not_due');
  const paidPeople = real.filter((p) => p.status === 'paid');
  const tiles = {
    requested: real.length,
    paid: paidPeople.length,
    waiting: waiting.length,
    never_opened: waiting.filter((p) => p.status === 'never_opened').length,
    opened_not_paid: waiting.filter((p) => p.status === 'opened').length,
    not_due: real.filter((p) => p.status === 'not_due').length,
    exempt: real.filter((p) => p.status === 'exempt').length,
    tests: people.length - real.length,
    outstanding_ugx: waiting.reduce((s, p) => s + p.outstanding_ugx, 0),
    conversion_pct: chargeable.length ? Math.round((paidPeople.length / chargeable.length) * 100) : 0,
    duplicate_people: real.filter((p) => p.asks > 1).length,
    since: real.length ? real.reduce((m, p) => (p.first_asked_at < m ? p.first_asked_at : m), real[0].first_asked_at) : null
  };
  const ageing = AGE_BUCKETS.map((b) => {
    const inB = waiting.filter((p) => p.days_waiting >= b.min && p.days_waiting <= b.max);
    return { key: b.key, label: b.label, people: inB.length, ugx: inB.reduce((s, p) => s + p.outstanding_ugx, 0) };
  });

  // Requests (links sent, tests left out) and payments over time, by Kampala day.
  const asks = [];
  const pays = [];
  for (const g of groups.values()) {
    for (const l of g.links) {
      if (l._st.status === 'test') continue;
      if (l._st.sent) asks.push({ t: l._st.sent, ugx: Number(l.amount_ugx || 0) });
    }
  }
  for (const p of paidPeople) if (p.paid_at) pays.push({ t: ms(p.paid_at), ugx: p.amount_ugx });
  const series = { day: buckets('day', now, asks, pays), week: buckets('week', now, asks, pays), month: buckets('month', now, asks, pays) };

  return { tiles, ageing, series, people, money: moneyChecks(money, tiles), chase_after_days: CHASE_AFTER_DAYS };
}

function bucketStart(kind, t) {
  const d = new Date(t + KAMPALA_MS);
  d.setUTCHours(0, 0, 0, 0);
  if (kind === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (kind === 'month') d.setUTCDate(1);
  return d;
}

function buckets(kind, now, asks, pays) {
  const n = kind === 'day' ? 30 : 12;
  const out = [];
  let cur = bucketStart(kind, now);
  for (let i = 0; i < n; i++) {
    out.unshift({ start: cur.toISOString().slice(0, 10), asked: 0, paid: 0, asked_ugx: 0, paid_ugx: 0 });
    const prev = new Date(cur);
    if (kind === 'day') prev.setUTCDate(prev.getUTCDate() - 1);
    else if (kind === 'week') prev.setUTCDate(prev.getUTCDate() - 7);
    else prev.setUTCMonth(prev.getUTCMonth() - 1);
    cur = prev;
  }
  const idx = (t) => {
    const s = bucketStart(kind, t).toISOString().slice(0, 10);
    return out.findIndex((b) => b.start === s);
  };
  for (const a of asks) { const i = idx(a.t); if (i >= 0) { out[i].asked++; out[i].asked_ugx += a.ugx; } }
  for (const p of pays) { const i = idx(p.t); if (i >= 0) { out[i].paid++; out[i].paid_ugx += p.ugx; } }
  return out;
}

/** "Is it connected?": where a payment would show up, and whether anything has. */
function moneyChecks(m = {}, tiles = {}) {
  const items = [];
  const n = (v) => Number(v || 0);
  items.push({ ok: n(m.entries_30d) > 0, text: n(m.entries_30d) ? `${n(m.entries_30d)} payment${n(m.entries_30d) === 1 ? '' : 's'} recorded in the last 30 days (UGX ${n(m.entries_30d_ugx).toLocaleString('en-US')}), the same ledger as King's totals` : 'No payment recorded in the ledger in the last 30 days, so King\'s totals read UGX 0 too. If money came in, it has not been recorded: add it under "Record a payment".' });
  items.push({ ok: Boolean(m.sms_last_at), text: m.sms_last_at ? `Last MoMo SMS received ${prettyDay(m.sms_last_at)} (${n(m.sms_30d)} in 30 days)` : 'No MoMo merchant SMS has ever reached the site, so MoMo payments cannot be matched automatically. Check the SMS forwarder on the merchant phone.' });
  items.push({ ok: true, text: n(m.card_paid) ? `${n(m.card_paid)} card payment${n(m.card_paid) === 1 ? '' : 's'} confirmed by Revolut` : 'No card payment yet (Revolut confirms these on its own)' });
  items.push({ ok: !n(m.claims_pending), text: n(m.claims_pending) ? `${n(m.claims_pending)} "I have paid" waiting for a confirm` : 'No "I have paid" waiting for a confirm' });
  items.push({ ok: !n(m.paid_links_without_entry), text: n(m.paid_links_without_entry) ? `${n(m.paid_links_without_entry)} paid link${n(m.paid_links_without_entry) === 1 ? '' : 's'} with no ledger entry: totals are short` : 'Every paid link has its ledger entry' });
  items.push({ ok: !n(m.paid_but_link_open), text: n(m.paid_but_link_open) ? `${n(m.paid_but_link_open)} paid by another route but their link is still open (shown as Paid here)` : 'Nobody who paid is still shown as waiting' });
  if (tiles.duplicate_people) items.push({ ok: true, text: `${tiles.duplicate_people} ${tiles.duplicate_people === 1 ? 'person was' : 'people were'} sent more than one link: shown once, owing one amount` });
  return { ...m, items };
}

async function payChaseOverview(db, { now = Date.now() } = {}) {
  const links = (await db.query(
    `SELECT l.code, l.purpose, l.status, l.description, l.amount_ugx, l.payer_name, l.payer_phone, l.sent_to,
            l.sent_at, l.opened_at, l.paid_at, l.paid_method, l.entry_id, l.created_at, COALESCE(l.is_test, FALSE) AS is_test,
            l.agent_id, l.property_id, l.st_listing_id,
            a.full_name AS agent_name, a.status AS agent_status, a.fee_exempt, a.fee_exempt_reason,
            a.fee_offer_mode, a.fee_offer_until, a.billing_reminder_log, a.last_payment_on,
            p.title AS property_title,
            (SELECT MIN(e.paid_at) FROM revenue_entries e
              WHERE l.agent_id IS NOT NULL AND e.agent_id = l.agent_id AND e.direction = 'in' AND e.voided_at IS NULL
                AND e.paid_at >= COALESCE(l.sent_at, l.created_at) - INTERVAL '1 day') AS paid_elsewhere_at
       FROM pay_links l
       LEFT JOIN agents a ON a.id = l.agent_id
       LEFT JOIN properties p ON p.id = l.property_id
      WHERE l.status <> 'cancelled'
      ORDER BY l.created_at`
  )).rows;
  const money = (await db.query(
    `SELECT (SELECT COUNT(*) FROM revenue_entries WHERE direction = 'in' AND voided_at IS NULL AND paid_at > NOW() - INTERVAL '30 days')::int AS entries_30d,
            (SELECT COALESCE(SUM(amount_ugx), 0) FROM revenue_entries WHERE direction = 'in' AND voided_at IS NULL AND paid_at > NOW() - INTERVAL '30 days')::bigint AS entries_30d_ugx,
            (SELECT MAX(received_at) FROM money_sms_inbox) AS sms_last_at,
            (SELECT COUNT(*) FROM money_sms_inbox WHERE received_at > NOW() - INTERVAL '30 days')::int AS sms_30d,
            (SELECT COUNT(*) FROM pay_links WHERE status = 'paid' AND paid_method = 'card')::int AS card_paid,
            (SELECT COUNT(*) FROM payment_claims WHERE status = 'pending')::int AS claims_pending,
            (SELECT COUNT(*) FROM pay_links l WHERE l.status = 'paid' AND (l.entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM revenue_entries e WHERE e.id = l.entry_id AND e.voided_at IS NULL)))::int AS paid_links_without_entry`
  )).rows[0] || {};
  money.paid_but_link_open = links.filter((l) => l.status === 'open' && !l.is_test && linkState(l, now).status === 'paid').length;
  return buildPayChase(links, { now, money });
}

module.exports = { buildPayChase, payChaseOverview, personKey, linkState, AGE_BUCKETS };
