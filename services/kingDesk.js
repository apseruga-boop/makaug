'use strict';

/**
 * King desk (Arthur, 21 Nov 2026): the numbers behind King's sidebar pages.
 * Overview: money and paid agents this month, team calls this week vs last
 * week, live-notes coverage, the pipeline, what needs King, and staff today.
 * Payments & MoMo: money in (recorded payments and forwarded MoMo SMS).
 * Read-only. Phone numbers leave here masked to the last 3 digits.
 */
const db = require('../config/database');
const calling = require('./callingScreen');
const rules = require('./callingRules');
const removals = require('./agentRemovalRequestService');
const planner = require('./callingPlanner');
const kingReview = require('./kingReview');

const TZ_OFFSET_H = 3; // Kampala, no DST
async function rows(sql, params = []) { try { return (await db.query(sql, params)).rows || []; } catch (_) { return []; } }
const num = (v) => Number(v || 0);
const mask = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 3 ? `•••${d.slice(-3)}` : ''; };
// Names from MoMo SMS can carry a number: keep the words, mask the digits.
const maskText = (v) => String(v || '').replace(/\+?\d[\d\s-]{5,}\d/g, (m) => mask(m)).slice(0, 80);

/** Kampala calendar helpers (pure, tested). */
function kampalaParts(now = new Date()) {
  const k = new Date(now.getTime() + TZ_OFFSET_H * 3600000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth(), d: k.getUTCDate(), dow: k.getUTCDay() };
}
const isoDay = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** Midnight Kampala of a YYYY-MM-DD, as an instant. */
const startOf = (day) => new Date(`${day}T00:00:00+03:00`);
function ranges(now = new Date()) {
  const p = kampalaParts(now);
  const today = isoDay(p.y, p.m, p.d);
  const mondayOffset = (p.dow + 6) % 7;
  const weekStart = isoDay(p.y, p.m, p.d - mondayOffset);
  const lastWeekStart = isoDay(p.y, p.m, p.d - mondayOffset - 7);
  const monthStart = isoDay(p.y, p.m, 1);
  const lastMonthStart = isoDay(p.y, p.m - 1, 1);
  const sameDayLastMonth = isoDay(p.y, p.m - 1, p.d + 1); // exclusive end: month-to-date vs the same days last month
  return { today, weekStart, lastWeekStart, monthStart, lastMonthStart, sameDayLastMonth, tomorrow: isoDay(p.y, p.m, p.d + 1), yesterday: isoDay(p.y, p.m, p.d - 1), elapsedWeekDays: mondayOffset + 1 };
}
const pctChange = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

/** Calls per weekday (Mon..Sun) for a week starting at `from`. A call = tapped, saved, not "no answer". */
function weekSeries(list = [], from) {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const t0 = startOf(from).getTime();
  for (const r of list) {
    const i = Math.floor((new Date(r.at).getTime() - t0) / 86400000);
    if (i >= 0 && i < 7) out[i] += 1;
  }
  return out;
}

/** Active staff logins with no targets set for today yet (King sets them each morning). */
async function targetsUnset(day) {
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM users u
      WHERE u.role = 'moderator' AND u.status = 'active' AND u.profile_data ? 'person_key' AND u.profile_data ? 'staff_scope'
        AND COALESCE(u.profile_data->>'sandbox', 'false') <> 'true'
        AND NOT EXISTS (SELECT 1 FROM call_targets t WHERE t.person_key = u.profile_data->>'person_key' AND t.effective_from = $1::date)`, [day]).catch(() => ({ rows: [{ n: 0 }] }));
  return Number((r.rows[0] || {}).n || 0);
}

async function overview({ now = new Date() } = {}) {
  const r = ranges(now);
  const [moneyNow, moneyPrev, paidNow, paidPrev, callRows, notesRow, pipe, unmatched, noTx, perf, openReq, reqCount] = await Promise.all([
    rows(`SELECT COALESCE(SUM(amount_ugx),0)::bigint AS v FROM revenue_entries WHERE direction='in' AND voided_at IS NULL AND paid_at >= $1 AND paid_at < $2`, [startOf(r.monthStart), startOf(r.tomorrow)]),
    rows(`SELECT COALESCE(SUM(amount_ugx),0)::bigint AS v FROM revenue_entries WHERE direction='in' AND voided_at IS NULL AND paid_at >= $1 AND paid_at < $2`, [startOf(r.lastMonthStart), startOf(r.sameDayLastMonth)]),
    rows(`SELECT COUNT(DISTINCT COALESCE(agent_id::text, payer_phone, id::text))::int AS v FROM revenue_entries WHERE direction='in' AND kind='agent_subscription' AND voided_at IS NULL AND paid_at >= $1`, [startOf(r.monthStart)]),
    rows(`SELECT COUNT(DISTINCT COALESCE(agent_id::text, payer_phone, id::text))::int AS v FROM revenue_entries WHERE direction='in' AND kind='agent_subscription' AND voided_at IS NULL AND paid_at >= $1 AND paid_at < $2`, [startOf(r.lastMonthStart), startOf(r.sameDayLastMonth)]),
    rows(`SELECT tapped_at AS at FROM call_attempts WHERE tapped_at >= $1 AND tapped_at < $2 AND status='done' AND COALESCE(outcome,'') <> 'no_answer'`, [startOf(r.lastWeekStart), startOf(r.tomorrow)]),
    rows(`SELECT COUNT(*) FILTER (WHERE spoke)::int AS spoke,
                 COUNT(*) FILTER (WHERE spoke AND LENGTH(TRIM(COALESCE(transcript->>'text',''))) >= 3)::int AS with_notes,
                 COUNT(*) FILTER (WHERE 'no_transcript' = ANY(flags))::int AS flagged
            FROM call_attempts WHERE tapped_at >= $1 AND status='done'`, [startOf(r.weekStart)]),
    // A true funnel (Arthur, 21 Nov 2026): every step counts only the people who passed the step before it,
    // so no step can be bigger than the one above. Sign-ups that did not come from a call are counted apart.
    rows(`WITH called AS (
            SELECT phone_key,
                   BOOL_OR(outcome IN ('signed_up','promised') OR (outcome IN ('interested','will_list') AND ${rules.textSentSql('call_attempts')})) AS interested,
                   BOOL_OR((checklist->>'asked_hello') IN ('true','auto','manual')) AS said_hi
              FROM call_attempts WHERE tapped_at >= $1 AND status='done' AND phone_key IS NOT NULL GROUP BY phone_key),
          ag AS (
            SELECT a.id, right(regexp_replace(COALESCE(a.phone,''), '\\D', '', 'g'), 9) AS k, a.approved_at,
                   EXISTS (SELECT 1 FROM revenue_entries e WHERE e.agent_id = a.id AND e.direction='in' AND e.kind='agent_subscription' AND e.voided_at IS NULL AND e.paid_at >= $1) AS paid
              FROM agents a WHERE a.created_at >= $1 AND NOT (a.status = 'pending' AND COALESCE(a.agent_application_channel, '') = 'calling_interested')),
          j AS (SELECT ag.*, c.phone_key IS NOT NULL AND c.interested AND c.said_hi AS from_call FROM ag LEFT JOIN called c ON c.phone_key = ag.k AND length(ag.k) = 9)
          SELECT (SELECT COUNT(*) FROM called)::int AS contacted,
                 (SELECT COUNT(*) FROM called WHERE interested)::int AS interested,
                 (SELECT COUNT(*) FROM called WHERE interested AND said_hi)::int AS said_hi,
                 (SELECT COUNT(*) FROM j WHERE from_call)::int AS submitted,
                 (SELECT COUNT(*) FROM j WHERE from_call AND approved_at IS NOT NULL)::int AS approved,
                 (SELECT COUNT(*) FROM j WHERE from_call AND approved_at IS NOT NULL AND paid)::int AS paid_funnel,
                 (SELECT COUNT(*) FROM j WHERE NOT from_call)::int AS other_submitted,
                 (SELECT COUNT(*) FROM j WHERE NOT from_call AND approved_at IS NOT NULL)::int AS other_approved,
                 (SELECT COUNT(*) FROM called WHERE said_hi AND NOT interested)::int AS said_hi_not_interested`, [startOf(r.monthStart)]),
    rows(`SELECT id, received_at, amount_ugx, counterparty FROM money_sms_inbox WHERE direction='in' AND matched_entry_id IS NULL AND received_at > NOW() - INTERVAL '14 days' ORDER BY received_at DESC LIMIT 5`),
    rows(`SELECT COUNT(*)::int AS v FROM call_attempts WHERE 'no_transcript' = ANY(flags) AND tapped_at >= $1 AND tapped_at < $2`, [startOf(r.yesterday), startOf(r.today)]),
    calling.performance({ now }).catch(() => ({ people: [] })),
    removals.listRequests({ status: 'open', limit: 5 }).catch(() => []),
    removals.countOpen().catch(() => 0)
  ]);
  const thisWeek = weekSeries(callRows, r.weekStart);
  const lastWeek = weekSeries(callRows, r.lastWeekStart);
  const sumTo = (a, n) => a.slice(0, n).reduce((t, v) => t + v, 0);
  const callsWeek = sumTo(thisWeek, 7);
  const callsLastWeekSoFar = sumTo(lastWeek, r.elapsedWeekDays);
  const n = notesRow[0] || {};
  const p = pipe[0] || {};
  const needs = [];
  for (const q of openReq) needs.push({ kind: 'removal', id: q.id, text: `${q.agent_name || 'Agent'} · “${q.note}” · asked by ${q.requested_by_name || 'staff'}`, at: q.created_at, open: 'k-removals' });
  for (const s of unmatched) needs.push({ kind: 'momo', id: s.id, text: `UGX ${num(s.amount_ugx).toLocaleString('en-GB')} from “${maskText(s.counterparty) || 'unknown'}” · no matching payment`, at: s.received_at, open: 'k-payments' });
  const noTxN = num(noTx[0]?.v);
  if (noTxN) needs.push({ kind: 'flag', text: `${noTxN} call${noTxN === 1 ? '' : 's'} yesterday had no live-notes transcript`, open: 'performance' });
  // Behind (Arthur, 21 Nov 2026): anyone who worked today and is under 70% of the calls their day plan expects by now.
  const nowMin = planner.kampalaMinutes(now);
  const worked = (perf.people || []).filter((x) => x.work && x.work.open_ms > 0);
  const behind = [];
  for (const x of worked) {
    const pl = await planner.dayPlan(x.person_key, { now }).catch(() => null);
    const pc = pl ? planner.pace(pl, nowMin) : null;
    if (pc && pc.behind) behind.push({ person_key: x.person_key, name: x.name, ...pc });
  }
  // Low list (Arthur, 22 Nov 2026): a caller with fewer than 100 fresh numbers left.
  const callers = await rows(`SELECT profile_data->>'person_key' AS key, first_name AS name FROM users
      WHERE role = 'moderator' AND status = 'active' AND profile_data->>'staff_scope' = 'caller' AND COALESCE(profile_data->>'sandbox', 'false') <> 'true'`).catch(() => []);
  for (const c of callers.filter((x) => x.key)) {
    const left = await calling.freshLeft(c.key, { now }).catch(() => null);
    if (left && left.low) needs.push({ kind: 'low_list', person_key: c.key, text: `${c.name || c.key} has ${left.fresh} fresh numbers left (under ${left.threshold}). Upload the next list.`, open: 'k-staff' });
  }
  // Unpaid 30+ days: King decides. Flag only, nothing is removed automatically.
  const owing = await require('./staffPipeline').owes('').catch(() => ({ items: [] }));
  for (const o of (owing.items || []).filter((x) => x.remove_flag).slice(0, 10)) needs.push({ kind: 'remove', id: o.id, text: `Remove? ${o.name || 'Agent'} ${o.phone} unpaid ${o.unpaid_days} days`, open: 'k-removals' });
  for (const b of behind) needs.push({ kind: 'behind', person_key: b.person_key, text: `${b.name} is behind: ${b.done} calls, ${b.expected} expected by now (${b.short_by} short)`, open: 'k-team' });
  const trackedFrom = await calling.trackingSince().catch(() => null);
  return {
    day: r.today,
    tracking_since: trackedFrom,
    last_week_tracked: Boolean(trackedFrom && trackedFrom <= r.lastWeekStart),
    money_month: { ugx: num(moneyNow[0]?.v), prev_ugx: num(moneyPrev[0]?.v), change_ugx: num(moneyNow[0]?.v) - num(moneyPrev[0]?.v) },
    paid_agents_month: { n: num(paidNow[0]?.v), prev: num(paidPrev[0]?.v) },
    calls_week: { n: callsWeek, last_week_same_days: callsLastWeekSoFar, change_pct: pctChange(callsWeek, callsLastWeekSoFar), this_week: thisWeek, last_week: lastWeek },
    live_notes: { spoke: num(n.spoke), with_notes: num(n.with_notes), pct: n.spoke ? Math.round((100 * num(n.with_notes)) / num(n.spoke)) : null, flagged: num(n.flagged) },
    pipeline: { contacted: num(p.contacted), interested: num(p.interested), said_hi: num(p.said_hi), submitted: num(p.submitted), approved: num(p.approved), paid: num(p.paid_funnel), paid_all: num(paidNow[0]?.v), other_submitted: num(p.other_submitted), other_approved: num(p.other_approved), said_hi_not_interested: num(p.said_hi_not_interested) },
    needs_you: needs,
    counts: { removal_requests: num(reqCount), momo_unmatched: unmatched.length, behind: behind.length, targets_unset: await targetsUnset(r.today), lessons_waiting: await require('./teamLearnings').waitingCount().catch(() => 0), ...(await kingReview.counts().catch(() => ({}))) },
    staff_today: (perf.people || []).map((x) => {
      const spoke = num(x.connected); const noTxP = num((x.flags || {}).no_transcript);
      return { person_key: x.person_key, name: x.name, calls: num(x.calls), target_calls: num(x.targets?.calls_per_day), paid: num(x.closes), target_paid: num(x.targets?.closes_per_day), notes_pct: spoke ? Math.round((100 * (spoke - noTxP)) / spoke) : null, live: x.live || null,
        away_min: x.work ? Math.round(num(x.work.away_ms) / 60000) : 0, away_on_call_min: x.work ? Math.round(num(x.work.oncall_hidden_ms) / 60000) : 0, exits: x.work ? num(x.work.exits) : 0 };
    })
  };
}

async function payments({ days = 30, now = new Date() } = {}) {
  const r = ranges(now);
  const d = Math.max(1, Math.min(120, Number(days) || 30));
  const [entries, sms, totals, last] = await Promise.all([
    rows(`SELECT e.id, e.paid_at, e.amount_ugx, e.kind, e.method, e.account_key, e.payer_name, e.payer_phone, e.verified_status, e.verification_source, e.sms_id, e.recorded_by, a.full_name AS agent_name
            FROM revenue_entries e LEFT JOIN agents a ON a.id = e.agent_id
           WHERE e.direction='in' AND e.voided_at IS NULL AND e.paid_at > NOW() - ($1 || ' days')::interval
           ORDER BY e.paid_at DESC LIMIT 200`, [String(d)]),
    rows(`SELECT id, received_at, amount_ugx, counterparty, account_key, matched_entry_id IS NOT NULL AS matched
            FROM money_sms_inbox WHERE direction='in' AND received_at > NOW() - ($1 || ' days')::interval
           ORDER BY received_at DESC LIMIT 200`, [String(d)]),
    rows(`SELECT COALESCE(SUM(amount_ugx) FILTER (WHERE paid_at >= $1),0)::bigint AS today,
                 COALESCE(SUM(amount_ugx) FILTER (WHERE paid_at >= $2),0)::bigint AS week,
                 COALESCE(SUM(amount_ugx) FILTER (WHERE paid_at >= $3),0)::bigint AS month
            FROM revenue_entries WHERE direction='in' AND voided_at IS NULL AND paid_at >= LEAST($1,$2,$3)`, [startOf(r.today), startOf(r.weekStart), startOf(r.monthStart)]),
    rows(`SELECT MAX(received_at) AS at FROM money_sms_inbox WHERE direction='in'`)
  ]);
  const t = totals[0] || {};
  return {
    totals: { today: num(t.today), week: num(t.week), month: num(t.month) },
    forwarder_last_seen: last[0]?.at || null,
    token_configured: String(process.env.MONEY_SMS_WEBHOOK_TOKEN || '').trim().length >= 16,
    entries: entries.map((e) => ({ id: e.id, at: e.paid_at, amount_ugx: num(e.amount_ugx), kind: e.kind, method: e.method, account: e.account_key, who: e.agent_name || maskText(e.payer_name) || '', phone: mask(e.payer_phone), verified: e.verified_status, from_sms: Boolean(e.sms_id) || e.verification_source === 'sms_match', by: e.recorded_by || '' })),
    sms: sms.map((s) => ({ id: s.id, at: s.received_at, amount_ugx: num(s.amount_ugx), from: maskText(s.counterparty), account: s.account_key, matched: Boolean(s.matched) })),
    unmatched: sms.filter((s) => !s.matched).length
  };
}

module.exports = { overview, payments, ranges, weekSeries, pctChange, mask, maskText, kampalaParts };
