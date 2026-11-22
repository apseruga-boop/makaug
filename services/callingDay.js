'use strict';

/**
 * Calling screen, the money and the day:
 *  - payments from the screen: send the pay link or the MoMo code, see the
 *    payment land (MoMo SMS matched / confirmed), mark "payment claimed" for
 *    admin to verify (it joins the normal payment_claims queue as pending);
 *  - activity: screen open/close, leaving the tab, idle, breaks, every action,
 *    and King's day / week / month report with flags;
 *  - the morning plan agreed with King, compared with the day's results;
 *  - the 17:00 cash check: balance per company account, signed with initials.
 *
 * Nothing here confirms money. Confirming stays with the existing flow.
 */

const db = require('../config/database');
const calling = require('./callingScreen');
const { REAL_PEOPLE } = require('./callingSandbox');
const { momoMerchantCode, momoMerchantName, momoWhatsappSteps } = require('../config/momoMerchant');

const { kampalaDay, httpError, cleanKey } = calling;
const FEE_UGX = 50000;
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const safeRows = (sql, params = []) => rows(sql, params).catch(() => []);
const key9 = (v) => String(v || '').replace(/\D+/g, '').slice(-9);
const mask = (k) => (k ? `•••${String(k).slice(-3)}` : '');
const ugx = (n) => `UGX ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;

function kampalaHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', hour: '2-digit', hour12: false }).format(now)) % 24;
}
function kampalaHM(at) {
  return at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)) : '';
}
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function weekday(day) { return new Date(`${day}T12:00:00Z`).getUTCDay(); }
/** day | week (Mon–Sun) | month containing `day`. */
function periodRange(period = 'day', day = kampalaDay()) {
  if (period === 'week') { const from = addDays(day, -((weekday(day) + 6) % 7)); return { from, to: addDays(from, 6) }; }
  if (period === 'month') { const from = `${day.slice(0, 7)}-01`; const d = new Date(`${from}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return { from, to: d.toISOString().slice(0, 10) }; }
  return { from: day, to: day };
}
function daysIn({ from, to }) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

// ------------------------------------------------------------- payments --

async function agentFor(phoneKey) {
  return (await safeRows(
    `SELECT id, full_name, status, paid_until::text AS paid_until, fee_exempt FROM agents
      WHERE RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1 OR RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1
      ORDER BY (status = 'approved') DESC LIMIT 1`, [phoneKey]))[0] || null;
}

async function phoneOfAttempt(attemptId) {
  const a = (await rows('SELECT id, phone, phone_key, person_key, session_id FROM call_attempts WHERE id = $1', [attemptId]))[0];
  if (!a) throw httpError(404, 'Call not found.');
  return a;
}

/** What the screen shows about money for one number. */
async function paymentState(phoneKey, { now = new Date() } = {}) {
  const k = key9(phoneKey);
  const agent = await agentFor(k);
  const since = new Date(now.getTime() - 35 * 86400000);
  const ledger = agent ? (await safeRows(
    `SELECT amount_ugx, paid_at FROM revenue_entries WHERE direction = 'in' AND agent_id = $1 AND voided_at IS NULL AND paid_at > $2 ORDER BY paid_at DESC LIMIT 1`,
    [agent.id, since]))[0] : null;
  const claims = await safeRows(
    `SELECT id, status, amount_ugx, sms_id, sms_matched_at, created_at, decided_at, source FROM payment_claims
      WHERE created_at > $2 AND (RIGHT(REGEXP_REPLACE(COALESCE(payer_phone, ''), '[^0-9]', '', 'g'), 9) = $1
         OR RIGHT(REGEXP_REPLACE(COALESCE(paid_from_phone, ''), '[^0-9]', '', 'g'), 9) = $1 OR ($3::uuid IS NOT NULL AND agent_id = $3::uuid))
      ORDER BY created_at DESC LIMIT 5`, [k, since, agent ? agent.id : null]);
  const sms = (await safeRows(
    `SELECT id, amount_ugx, received_at, counterparty, body FROM money_sms_inbox WHERE direction = 'in' AND received_at > $1 ORDER BY received_at DESC LIMIT 300`,
    [new Date(now.getTime() - 3 * 86400000)])).find((s) => {
    const { smsPayer } = require('./paymentMatchService');
    return smsPayer(s).phoneKey === k;
  });
  const actions = await safeRows(
    'SELECT kind, person_key, pay_link_code, amount_ugx, note, delivery, at FROM call_payment_actions WHERE phone_key = $1 ORDER BY at DESC LIMIT 10', [k]);
  const confirmed = claims.find((c) => c.status === 'confirmed');
  const matched = claims.find((c) => c.status === 'pending' && c.sms_id);
  const pending = claims.find((c) => c.status === 'pending');
  let state = 'none'; let label = 'No payment yet';
  if (ledger || confirmed) { state = 'confirmed'; label = `Payment confirmed ✓ ${ugx((ledger || confirmed).amount_ugx || FEE_UGX)} · ${kampalaDay((ledger || {}).paid_at || confirmed.decided_at || confirmed.created_at)}`; }
  else if (matched || sms) { state = 'arrived'; label = `Money arrived on MoMo ✓ ${ugx((matched || sms).amount_ugx)} – admin confirming`; }
  else if (pending) { state = 'claimed'; label = 'Payment claimed – waiting for admin to check MoMo'; }
  else if (actions.some((x) => x.kind === 'link_sent' || x.kind === 'momo_sent')) { const x = actions.find((y) => y.kind !== 'claimed'); state = 'sent'; label = `${x.kind === 'link_sent' ? 'Pay link' : 'MoMo code'} sent ${kampalaDay(x.at)} ${kampalaHM(x.at)} – not paid yet`; }
  return {
    state, label, agent: agent ? { id: agent.id, paid_until: agent.paid_until, fee_exempt: agent.fee_exempt } : null,
    amount_ugx: FEE_UGX, momo_code: momoMerchantCode(), momo_name: momoMerchantName(),
    actions: actions.map((x) => ({ ...x, phone_key: undefined }))
  };
}

function momoText(amountUgx = FEE_UGX) {
  return `Hello from makaug 👋 ${momoWhatsappSteps({ amountUgx })} The name shown is ${momoMerchantName()}. When you have paid, reply "paid" with your business name. Thank you!`;
}

/**
 * The pay link or the MoMo code for the number on screen. Calls send texts
 * only (Arthur, 22 Nov 2026): nothing goes out on WhatsApp; the text comes
 * back as an SMS link for the caller to send from the phone.
 */
async function practiceGuard(a, personKey, what) {
  const sbx = require('./callingSandbox');
  if (sbx.isTestKey(a.phone_key) || await sbx.isSandbox(a.person_key) || await sbx.isSandbox(cleanKey(personKey))) throw httpError(409, `${sbx.PRACTICE_MSG} ${what}.`);
}

async function sendPayment(attemptId, { how = 'link', personKey = '', actor = 'calling' } = {}) {
  const a = await phoneOfAttempt(attemptId);
  await practiceGuard(a, personKey, how === 'momo' ? 'texts the MoMo code' : 'texts the pay link');
  const person = cleanKey(personKey) || a.person_key;
  const agent = await agentFor(a.phone_key);
  const payLinks = require('./payLinkService');
  let code = null; let text = ''; let url = null;
  if (how === 'link') {
    // Reuses their open link if there is one (createPayLink does that).
    const { link } = await payLinks.createPayLink(db, agent ? { purpose: 'agent_subscription', agent_id: agent.id, payer_phone: a.phone } : { purpose: 'other', amount_ugx: FEE_UGX, payer_phone: a.phone, description: 'makaug agent subscription — 1 month' }, `calling:${person}`);
    code = link.code; url = payLinks.payUrl(link.code);
    text = payLinks.payLinkMessage(link, {});
  } else {
    text = momoText();
  }
  await db.query(
    `INSERT INTO call_payment_actions (phone_key, attempt_id, person_key, kind, pay_link_code, amount_ugx, delivery, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.phone_key, a.id, person, how === 'link' ? 'link_sent' : 'momo_sent', code, FEE_UGX, 'sms_by_caller', null]);
  const smsUrl = `sms:${String(a.phone || '').replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}`;
  return { sent: false, delivery: 'sms_by_caller', reason: 'Text it from the phone (SMS).', text, url, sms_url: smsUrl, state: await paymentState(a.phone_key) };
}

/** "They say they paid": a pending claim for admin to verify against MoMo. */
async function markClaimed(attemptId, { personKey = '', note = '', txid = '' } = {}) {
  const a = await phoneOfAttempt(attemptId);
  await practiceGuard(a, personKey, 'makes a payment claim for King to confirm');
  const person = cleanKey(personKey) || a.person_key;
  const billing = require('./billingOpsService');
  const ref = String(txid || '').replace(/\s+/g, '').slice(0, 60) || null;
  const r = await billing.createClaim(db, {
    phone: a.phone, reference: ref, amountUgx: FEE_UGX, source: 'calling_screen',
    message: `Claimed on the calling screen by ${person}${note ? `: ${String(note).slice(0, 200)}` : ''}`
  });
  await db.query(
    `INSERT INTO call_payment_actions (phone_key, attempt_id, person_key, kind, claim_id, amount_ugx, note) VALUES ($1,$2,$3,'claimed',$4,$5,$6)`,
    [a.phone_key, a.id, person, r.claim.id, FEE_UGX, String(note || '').slice(0, 300) || null]);
  return { claim_id: r.claim.id, matched: Boolean(r.claim.sms_id), state: await paymentState(a.phone_key) };
}

// ------------------------------------------------------------- activity --

const LONG_IDLE_MS = 10 * 60000;
const LONG_AWAY_MS = 5 * 60000;

async function activity({ period = 'day', day = kampalaDay(), personKey = '' } = {}) {
  const range = periodRange(period, day);
  const start = `${range.from}T00:00:00+03:00`; const end = `${addDays(range.to, 1)}T00:00:00+03:00`;
  const who = cleanKey(personKey);
  const sessions = await rows(
    `SELECT id, person_key, started_at, ended_at, last_heartbeat_at, open_ms, focus_ms, away_ms, break_ms, exit_count, break_count
       FROM call_sessions WHERE started_at >= $1 AND started_at < $2 AND ($3 = '' OR person_key = $3) AND ($3 <> '' OR ${REAL_PEOPLE()}) ORDER BY started_at`, [start, end, who]);
  const ids = sessions.map((s) => s.id);
  const events = ids.length ? await rows('SELECT session_id, kind, detail, at FROM call_session_events WHERE session_id = ANY($1::uuid[]) ORDER BY at', [ids]) : [];
  const attempts = await rows(
    `SELECT person_key, status, tapped_at, wrapped_at, shown_at, talk_s, is_close, outcome, task_key, direction FROM call_attempts
      WHERE COALESCE(tapped_at, shown_at) >= $1 AND COALESCE(tapped_at, shown_at) < $2 AND ($3 = '' OR person_key = $3) AND ($3 <> '' OR ${REAL_PEOPLE()})`, [start, end, who]);
  const pays = await rows(
    `SELECT p.person_key, p.kind, p.at, c.status AS claim_status FROM call_payment_actions p LEFT JOIN payment_claims c ON c.id = p.claim_id
      WHERE p.at >= $1 AND p.at < $2 AND ($3 = '' OR p.person_key = $3)`, [start, end, who]);
  const callers = await calling.loadCallers();
  const sOf = new Map(sessions.map((s) => [s.id, s]));
  const people = new Map();
  const cell = (pk, d) => {
    if (!people.has(pk)) people.set(pk, new Map());
    const m = people.get(pk);
    if (!m.has(d)) m.set(d, { day: d, sessions: 0, first_open: null, last_close: null, on_screen_ms: 0, focus_ms: 0, away_ms: 0, break_ms: 0, breaks: 0, lunch: [], work_ms: 0, down_ms: 0, segments: [], login_at: null, work_switches: 0, left_screen: 0, left: [], idle_ms: 0, idles: [], actions: 0, calls: 0, not_answered: 0, outbound: 0, inbound: 0, talk_s: 0, closes: 0, skips: 0, pay_sent: 0, pay_claimed: 0, pay_confirmed: 0, payments: 0, commission_ugx: 0, flags: [] });
    return m.get(d);
  };
  for (const s of sessions) {
    const c = cell(s.person_key, kampalaDay(s.started_at));
    c.sessions += 1;
    if (!c.first_open || s.started_at < c.first_open) c.first_open = s.started_at;
    const close = s.ended_at || s.last_heartbeat_at;
    if (!c.last_close || close > c.last_close) c.last_close = close;
    c.on_screen_ms += Number(s.open_ms || 0); c.focus_ms += Number(s.focus_ms || 0); c.away_ms += Number(s.away_ms || 0); c.break_ms += Number(s.break_ms || 0);
  }
  // The day's timeline per session: logged in → work mode on/off, breaks, downtime.
  const evBy = new Map();
  for (const e of events) { if (!evBy.has(e.session_id)) evBy.set(e.session_id, []); evBy.get(e.session_id).push(e); }
  for (const s of sessions) {
    const c = cell(s.person_key, kampalaDay(s.started_at));
    const end = new Date(s.ended_at || s.last_heartbeat_at || s.started_at).getTime();
    let t = new Date(s.started_at).getTime(); let work = false; let onBreak = false;
    const list = evBy.get(s.id) || [];
    // Sessions from before work mode existed count as work.
    if (!list.some((e) => e.kind === 'work_on' || e.kind === 'work_off')) work = true;
    const push = (to) => {
      if (to <= t) return;
      const kind = onBreak ? 'break' : (work ? 'work' : 'down');
      const last = c.segments[c.segments.length - 1];
      if (last && last.kind === kind && last.to === t) last.to = to; else c.segments.push({ kind, from: t, to });
      if (kind === 'work') c.work_ms += to - t; else if (kind === 'down') c.down_ms += to - t;
      t = to;
    };
    for (const e of list) {
      const at = Math.min(end, new Date(e.at).getTime());
      if (['work_on', 'work_off', 'break_start', 'break_end', 'end', 'screen_close'].includes(e.kind)) push(at);
      if (e.kind === 'work_on') { work = true; c.work_switches += 1; }
      if (e.kind === 'work_off') { work = false; c.work_switches += 1; }
      if (e.kind === 'break_start') onBreak = true;
      if (e.kind === 'break_end') onBreak = false;
    }
    push(end);
  }
  const logins = await safeRows(
    `SELECT COALESCE(NULLIF(u.profile_data->>'person_key', ''), cs.person_key) AS person_key, u.last_login_at
       FROM users u LEFT JOIN commission_staff cs ON cs.user_id = u.id
      WHERE u.last_login_at >= $1 AND u.last_login_at < $2 AND (u.profile_data ? 'person_key' OR cs.person_key IS NOT NULL)`, [start, end]);
  const sbKeys = who ? new Set() : await require('./callingSandbox').sandboxKeys();
  for (const l of logins) { if (l.person_key && !sbKeys.has(l.person_key) && (!who || l.person_key === who)) { const c = cell(l.person_key, kampalaDay(l.last_login_at)); c.login_at = l.last_login_at; } }
  const openAt = new Map();
  for (const e of events) {
    const s = sOf.get(e.session_id); if (!s) continue;
    const c = cell(s.person_key, kampalaDay(e.at));
    const t = new Date(e.at).getTime();
    // In the team meeting (Meet pop-up open) is work: not "left the screen".
    if ((e.kind === 'hidden' || e.kind === 'fs_exit') && e.detail === 'in meeting') continue;
    if (e.kind === 'hidden' || e.kind === 'fs_exit') { c.left_screen += 1; openAt.set(`${e.session_id}:away`, t); }
    if ((e.kind === 'visible' || e.kind === 'fs_enter') && openAt.has(`${e.session_id}:away`)) {
      const ms = t - openAt.get(`${e.session_id}:away`); openAt.delete(`${e.session_id}:away`);
      if (ms >= 60000) c.left.push({ at: new Date(t - ms).toISOString(), minutes: Math.round(ms / 60000) });
    }
    if (e.kind === 'break_start') { c.breaks += 1; openAt.set(`${e.session_id}:brk`, { t, detail: e.detail || '' }); }
    if (e.kind === 'break_end' && openAt.has(`${e.session_id}:brk`)) {
      const b = openAt.get(`${e.session_id}:brk`); openAt.delete(`${e.session_id}:brk`);
      const plan = Number((String(b.detail).match(/(\d+)/) || [])[1] || 0); const mins = Math.round((t - b.t) / 60000);
      c.lunch.push({ kind: /lunch/.test(b.detail) ? 'lunch' : 'break', at: new Date(b.t).toISOString(), planned_min: plan || null, minutes: mins, over_min: plan && mins > plan ? mins - plan : 0 });
    }
    if (e.kind === 'idle_end') { const ms = Number(e.detail) || 0; c.idle_ms += ms; if (ms >= LONG_IDLE_MS) c.idles.push({ at: new Date(t - ms).toISOString(), minutes: Math.round(ms / 60000) }); }
    if (e.kind === 'action') c.actions += 1;
  }
  const rateOf = new Map(callers.map((p) => [p.key, Number(p.rate_pct || 0)]));
  for (const a of attempts) {
    const c = cell(a.person_key, kampalaDay(a.tapped_at || a.shown_at));
    // A "No answer" is shown separately and never counts as a call (see callingScreen.countsAsCall).
    if (a.tapped_at && a.status === 'done' && a.outcome === 'no_answer') { c.not_answered += 1; c.actions += 1; }
    else if (a.tapped_at) { c.calls += 1; c.actions += 1; c[a.direction === 'inbound' ? 'inbound' : 'outbound'] += 1; }
    if (a.status === 'skipped') c.skips += 1;
    c.talk_s += Number(a.talk_s || 0);
    // Closed = paid (money received), never "signed up".
    if (calling.closedPaid(a)) { c.closes += 1; c.payments += 1; }
  }
  for (const p of pays) {
    const c = cell(p.person_key, kampalaDay(p.at)); c.actions += 1;
    if (p.kind === 'claimed') { c.pay_claimed += 1; if (p.claim_status === 'confirmed') c.pay_confirmed += 1; } else c.pay_sent += 1;
  }
  const firstDay = new Map((await safeRows('SELECT person_key, MIN(started_at) AS first FROM call_sessions GROUP BY person_key')).map((r) => [r.person_key, kampalaDay(r.first)]));
  const out = [];
  for (const [pk, days] of people) {
    const person = callers.find((p) => p.key === pk) || { key: pk, name: pk };
    const list = [...days.values()].sort((x, y) => x.day.localeCompare(y.day));
    for (const c of list) {
      c.commission_ugx = Math.round(FEE_UGX * (rateOf.get(pk) || 0) / 100) * Math.max(c.payments, c.pay_confirmed);
      if (c.first_open && kampalaHour(new Date(c.first_open)) >= 10) c.flags.push(`Late start (${kampalaHM(c.first_open)})`);
      if (c.left.some((l) => l.minutes * 60000 >= LONG_AWAY_MS) || c.away_ms > 20 * 60000) c.flags.push(`Left the screen ${c.left_screen}× (${Math.round(c.away_ms / 60000)} min away)`);
      if (c.idles.length) c.flags.push(`Long idle ${c.idles.length}× (${c.idles.map((i) => `${i.minutes} min at ${kampalaHM(i.at)}`).join(', ')})`);
      if (c.lunch.some((l) => l.over_min > 10)) c.flags.push('Break ran over');
      c.first_open_hm = kampalaHM(c.first_open); c.last_close_hm = kampalaHM(c.last_close); c.login_hm = kampalaHM(c.login_at);
      if (c.down_ms > 30 * 60000) c.flags.push(`Downtime ${Math.round(c.down_ms / 60000)} min`);
      c.segments = c.segments.map((g) => ({ kind: g.kind, from: new Date(g.from).toISOString(), to: new Date(g.to).toISOString(), from_hm: kampalaHM(g.from), to_hm: kampalaHM(g.to), minutes: Math.round((g.to - g.from) / 60000) }));
    }
    // A working day (Mon–Sat, up to today) with no screen at all.
    const today = kampalaDay();
    // Only from the first day they ever opened the screen.
    const firstEver = firstDay.get(pk) || '9999-12-31';
    const missed = daysIn(range).filter((d) => d <= today && d >= firstEver && weekday(d) !== 0 && !days.has(d));
    const sum = (k) => list.reduce((n, c) => n + (Number(c[k]) || 0), 0);
    out.push({
      person_key: pk, name: person.name, days: list, missed_days: missed,
      totals: { days_worked: list.filter((c) => c.sessions).length, work_ms: sum('work_ms'), down_ms: sum('down_ms'), on_screen_ms: sum('on_screen_ms'), focus_ms: sum('focus_ms'), away_ms: sum('away_ms'), break_ms: sum('break_ms'), breaks: sum('breaks'), left_screen: sum('left_screen'), idle_ms: sum('idle_ms'), long_idles: list.reduce((n, c) => n + c.idles.length, 0), calls: sum('calls'), not_answered: sum('not_answered'), outbound: sum('outbound'), inbound: sum('inbound'), talk_s: sum('talk_s'), closes: sum('closes'), payments: sum('payments'), pay_sent: sum('pay_sent'), pay_claimed: sum('pay_claimed'), pay_confirmed: sum('pay_confirmed'), commission_ugx: sum('commission_ugx'), actions: sum('actions') },
      flags: list.reduce((n, c) => n + c.flags.length, 0) + missed.length
    });
  }
  return { period, ...range, people: out.sort((x, y) => x.name.localeCompare(y.name)) };
}

// ----------------------------------------------------------- day plan --

async function getPlan(personKey, day = kampalaDay()) {
  const pk = cleanKey(personKey);
  const saved = (await rows('SELECT * FROM call_day_plans WHERE person_key = $1 AND day = $2', [pk, day]))[0];
  if (saved) return { ...saved, day, saved: true };
  const t = await calling.targetsFor(pk, day);
  const counts = await calling.queueCounts(pk).catch(() => ({}));
  const due = (await safeRows(
    `SELECT COUNT(*)::int AS n FROM call_attempts WHERE person_key = $1 AND callback_at >= $2 AND callback_at < $3 AND status = 'done'`,
    [pk, `${day}T00:00:00+03:00`, `${addDays(day, 1)}T00:00:00+03:00`]))[0];
  const best = Object.entries(counts).sort((a, b) => (a[0] === 'payments' ? -1 : 0) - (b[0] === 'payments' ? -1 : 0))[0];
  return {
    person_key: pk, day, calls_target: t.calls_per_day, closes_target: t.closes_per_day, payments_target: Math.min(3, counts.payments || 0),
    focus: `${due ? `${due.n} callbacks booked for today first, then ` : ''}${best ? `${best[0].replace('_', ' ')} (${best[1]} waiting)` : 'the queue'}`,
    goal: '', numbers: [], saved: false, counts
  };
}

async function savePlan(personKey, { day = kampalaDay(), calls_target, closes_target, payments_target, focus = '', goal = '', numbers = [], agreedBy = '', initials = '' } = {}) {
  const pk = cleanKey(personKey);
  if (!pk) throw httpError(400, 'Pick who the plan is for.');
  const n = (v, d) => Math.max(0, Math.min(500, Math.round(Number(v ?? d) || 0)));
  const keys = (Array.isArray(numbers) ? numbers : String(numbers || '').split(/[\s,]+/)).map(key9).filter((k) => k.length === 9).slice(0, 200);
  const ini = String(initials || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
  const r = (await rows(
    `INSERT INTO call_day_plans (person_key, day, calls_target, closes_target, payments_target, focus, goal, numbers, agreed_by, caller_initials, agreed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULLIF($9,''),NULLIF($10,''),CASE WHEN $9 <> '' OR $10 <> '' THEN NOW() END,NOW())
     ON CONFLICT (person_key, day) DO UPDATE SET calls_target = EXCLUDED.calls_target, closes_target = EXCLUDED.closes_target, payments_target = EXCLUDED.payments_target,
       focus = EXCLUDED.focus, goal = EXCLUDED.goal, numbers = EXCLUDED.numbers,
       agreed_by = COALESCE(EXCLUDED.agreed_by, call_day_plans.agreed_by), caller_initials = COALESCE(EXCLUDED.caller_initials, call_day_plans.caller_initials),
       agreed_at = COALESCE(EXCLUDED.agreed_at, call_day_plans.agreed_at), updated_at = NOW()
     RETURNING *`,
    [pk, day, n(calls_target, 40), n(closes_target, 2), n(payments_target, 0), String(focus).slice(0, 400), String(goal).slice(0, 600), JSON.stringify(keys), String(agreedBy).slice(0, 60), ini]))[0];
  return r;
}

/** Plan against what happened: targets, the agreed numbers reached, the goal. */
async function planResult(personKey, day = kampalaDay(), { save = false } = {}) {
  const pk = cleanKey(personKey);
  const plan = await getPlan(pk, day);
  const act = (await activity({ period: 'day', day, personKey: pk })).people[0];
  const d = act ? act.days.find((x) => x.day === day) || {} : {};
  const called = new Set((await rows(`SELECT phone_key FROM call_attempts WHERE person_key = $1 AND tapped_at >= $2 AND tapped_at < $3 AND NOT (status = 'done' AND outcome = 'no_answer')`,
    [pk, `${day}T00:00:00+03:00`, `${addDays(day, 1)}T00:00:00+03:00`])).map((r) => r.phone_key));
  const nums = Array.isArray(plan.numbers) ? plan.numbers : [];
  const result = {
    calls: d.calls || 0, not_answered: d.not_answered || 0, closes: d.closes || 0, payments: Math.max(d.payments || 0, d.pay_confirmed || 0), pay_claimed: d.pay_claimed || 0,
    numbers_planned: nums.length, numbers_reached: nums.filter((k) => called.has(k)).length, numbers_missed: nums.filter((k) => !called.has(k)).map(mask),
    calls_hit: (d.calls || 0) >= plan.calls_target, closes_hit: (d.closes || 0) >= plan.closes_target, payments_hit: Math.max(d.payments || 0, d.pay_confirmed || 0) >= (plan.payments_target || 0)
  };
  if (save && plan.saved) await db.query('UPDATE call_day_plans SET result = $3::jsonb, result_at = NOW() WHERE person_key = $1 AND day = $2', [pk, day, JSON.stringify(result)]);
  return { plan: { ...plan, numbers: nums.map(mask) }, result };
}

async function plans({ period = 'week', day = kampalaDay() } = {}) {
  const range = periodRange(period, day);
  const list = await rows(`SELECT * FROM call_day_plans WHERE day BETWEEN $1 AND $2 AND ${REAL_PEOPLE()} ORDER BY day DESC, person_key`, [range.from, range.to]);
  return { ...range, plans: list.map((p) => ({ ...p, day: String(kampalaDay(p.day) || p.day).slice(0, 10), numbers: (p.numbers || []).map(mask) })) };
}

// ----------------------------------------------------------- cash check --

// Only the accounts the caller can see. Absa is never on it (no access).
// CASH_CHECK_ACCOUNTS=key,key overrides the list; CASH_CHECK_MAIN_ACCOUNT names
// the main bank (optional: if it isn't on the caller's list he isn't asked for it).
function mainAccountKey(accounts) {
  const want = String(process.env.CASH_CHECK_MAIN_ACCOUNT || '').trim();
  return want && accounts.some((a) => a.key === want) ? want : null;
}

// An account that is no longer on the cash check (e.g. the Absa accounts) still
// shows by its name, never its key (no raw codes on King).
function plainAccount(key) {
  const words = { absa: 'Absa', mtn: 'MTN', momo: 'MoMo', momopay: 'MoMo merchant', ugx: 'UGX', usd: 'USD', airtel: 'Airtel', money: 'Money', revolut: 'Revolut', bank: 'Bank', cash: 'Cash' };
  return String(key || 'Account').split(/[_\s]+/).filter(Boolean).map((w) => words[w.toLowerCase()] || (w[0].toUpperCase() + w.slice(1))).join(' ');
}
async function cashAccounts() {
  const pick = String(process.env.CASH_CHECK_ACCOUNTS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const all = await safeRows("SELECT key, name, kind FROM money_accounts WHERE active AND kind IN ('mobile_money', 'bank') ORDER BY kind DESC, name");
  const list = all.filter((a) => (pick.length ? pick.includes(a.key) : a.kind === 'mobile_money') && !/absa/i.test(`${a.key} ${a.name}`));
  const main = mainAccountKey(list);
  return list.map((a) => ({ ...a, main: a.key === main, currency: /usd/i.test(`${a.key} ${a.name}`) ? 'USD' : 'UGX' }));
}

async function cashStatus(day = kampalaDay()) {
  const accounts = await cashAccounts();
  const done = await rows('SELECT account_key, balance_ugx, transferred_ugx, initials, person_key, signed_at FROM cash_checks WHERE day = $1', [day]);
  const last = await safeRows(
    `SELECT DISTINCT ON (account_key) account_key, balance_ugx, day::text AS day FROM cash_checks WHERE day < $1 ORDER BY account_key, day DESC`, [day]);
  const lastOf = new Map(last.map((r) => [r.account_key, r]));
  return {
    day, required: true, done: accounts.length > 0 && accounts.every((a) => done.some((d) => d.account_key === a.key)),
    accounts: accounts.map((a) => ({ ...a, signed: done.find((d) => d.account_key === a.key) || null, last: lastOf.get(a.key) || null }))
  };
}

/** Sign the day's cash check: every account, initials required. Signed rows can't be changed. */
async function saveCash({ day = kampalaDay(), personKey = '', initials = '', entries = [] } = {}) {
  if (await require('./callingSandbox').isSandbox(cleanKey(personKey))) throw httpError(409, `${require('./callingSandbox').PRACTICE_MSG} signs the real 17:00 cash check.`);
  const ini = String(initials || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (ini.length < 2 || ini.length > 4) throw httpError(400, 'Type your initials (2–4 letters) to sign.');
  const status = await cashStatus(day);
  const byKey = new Map((Array.isArray(entries) ? entries : []).map((e) => [String(e.account_key || ''), e]));
  const todo = status.accounts.filter((a) => !a.signed);
  const clean = [];
  for (const a of todo) {
    const e = byKey.get(a.key);
    const bal = Math.round(Number(String(e?.balance_ugx ?? '').replace(/[^\d.-]/g, '')));
    if (!e || String(e.balance_ugx ?? '').trim() === '' || !Number.isFinite(bal)) throw httpError(400, `Enter the balance for ${a.name}.`);
    const bdate = String(e.balance_date || day).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bdate)) throw httpError(400, `Pick the balance date for ${a.name}.`);
    const moved = a.main ? 0 : Math.max(0, Math.round(Number(String(e.transferred_ugx ?? 0).replace(/[^\d.]/g, '')) || 0));
    clean.push({ a, bal, bdate, moved, note: String(e.note || '').slice(0, 300) });
  }
  for (const c of clean) {
    const prev = c.a.last ? Number(c.a.last.balance_ugx) : null;
    await db.query(
      `INSERT INTO cash_checks (day, account_key, balance_ugx, balance_date, transferred_ugx, previous_balance_ugx, change_ugx, person_key, initials, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,'')) ON CONFLICT (day, account_key) DO NOTHING`,
      [day, c.a.key, c.bal, c.bdate, c.moved, prev, prev == null ? null : c.bal - prev, cleanKey(personKey), ini, c.note]);
  }
  return cashStatus(day);
}

/** King's cash log: per day per account, with missed days and odd changes flagged. */
async function cashLog({ period = 'week', day = kampalaDay() } = {}) {
  const range = periodRange(period, day);
  const accounts = await cashAccounts();
  const allNames = new Map((await safeRows('SELECT key, name FROM money_accounts')).map((x) => [x.key, x.name]));
  const list = await rows(
    `SELECT day::text AS day, account_key, balance_ugx, balance_date::text AS balance_date, transferred_ugx, previous_balance_ugx, change_ugx, person_key, initials, note, signed_at
       FROM cash_checks WHERE day BETWEEN $1 AND $2 ORDER BY day DESC, account_key`, [range.from, range.to]);
  const today = kampalaDay();
  const days = daysIn(range).filter((d) => d <= today && weekday(d) !== 0).reverse().map((d) => {
    const items = list.filter((r) => r.day === d).map((r) => {
      const a = accounts.find((x) => x.key === r.account_key) || { name: allNames.get(r.account_key) || plainAccount(r.account_key) };
      const flags = [];
      const change = r.change_ugx == null ? null : Number(r.change_ugx);
      // Expected moves are not flags: a wallet down by what went to the bank, the bank up by it.
      // A wallet that dropped by more than was moved to the bank: money left some other way.
      if (!a.main && change != null && -change > Number(r.transferred_ugx || 0) + 1000) flags.push(`Down ${ugx(-change - Number(r.transferred_ugx || 0))} more than the transfer`);
      if (r.balance_date !== d) flags.push(`Balance dated ${r.balance_date}`);
      return { ...r, name: a.name, main: Boolean(a.main), flags };
    });
    const missing = accounts.filter((a) => !items.some((i) => i.account_key === a.key)).map((a) => a.name);
    const moved = items.filter((i) => !i.main).reduce((n, i) => n + Number(i.transferred_ugx || 0), 0);
    const bank = items.find((i) => i.main);
    if (bank && moved > 0 && bank.change_ugx != null && Number(bank.change_ugx) < moved - 1000) bank.flags.push(`Bank up ${ugx(bank.change_ugx)} but ${ugx(moved)} was moved in`);
    return { day: d, missed: items.length === 0, missing: d < today || items.length ? missing : [], items, moved_ugx: moved, signed_by: items[0] ? `${items[0].initials} (${items[0].person_key})` : null, flags: (items.length ? 0 : 1) + items.reduce((n, i) => n + i.flags.length, 0) };
  });
  return { period, ...range, accounts, days, missed_days: days.filter((d) => d.missed && d.day < today).map((d) => d.day) };
}

/** The caller's own commission, from the same numbers as King's Staff Performance. */
async function myMoney(personKey) {
  const pk = cleanKey(personKey);
  const perf = require('./staffPerformance');
  const sends = await perf.loadSends().catch(() => []);
  const s = await require('./staffCommission').summary({ sends });
  const t = (s.totals && s.totals.people && s.totals.people[pk]) || {};
  const me = (s.staff || []).find((x) => x.person_key === pk) || {};
  return {
    person_key: pk, rate_pct: Number(me.rate_pct || s.settings?.default_rate_pct || 0), on_commission: me.active !== false && Number(me.rate_pct || 0) > 0,
    earned_ugx: t.earned_ugx || 0, on_hold_ugx: t.pending_ugx || 0, due_next_payday_ugx: t.due_next_payday_ugx || 0, paid_to_date_ugx: t.paid_to_date_ugx || 0, clawback_ugx: t.clawback_ugx || 0,
    hold_days: s.settings?.hold_days, next_payday: s.next_payday, next_payday_at: s.next_payday_at, cutoff: s.cutoff, countdown: s.countdown,
    counts: { contacted: t.contacted || 0, signed_up: t.signed_up || 0, paid: t.paid || 0, on_hold: t.on_hold || 0, eligible: t.eligible || 0 },
    agents: (s.agents || []).filter((a) => a.person_key === pk).slice(0, 100).map((a) => ({ name: a.name || 'Agent', phone: a.phone_masked || '', status: a.status, status_label: a.status_label, amount_ugx: (a.lines || []).reduce((n, l) => n + (/clawback/i.test(`${l.status} ${l.reason}`) ? 0 : Number(l.amount_ugx || 0)), 0), due_payday: (a.lines || [])[0]?.due_payday || null, reason: (a.reasons || [])[0] || '' }))
  };
}

module.exports = {
  myMoney,
  FEE_UGX, kampalaHour, periodRange, paymentState, momoText, sendPayment, markClaimed,
  activity, getPlan, savePlan, planResult, plans, cashAccounts, cashStatus, saveCash, cashLog, plainAccount
};
