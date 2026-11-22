'use strict';

/**
 * Calling screen (16 Nov 2026).
 *
 * Arthur: Ronald works from a full-screen session. He picks a task, one number
 * comes up at a time, he taps to call from the company phone, and a call only
 * counts once he has picked an outcome and written a note. Nobody is rung twice:
 * numbers are de-duplicated on phone_key across everyone, do-not-contact and
 * earlier outcomes are respected, and a callback comes back only when it is due.
 * Every number shown, tap, call length, outcome, note and gap between calls is
 * kept so King can check the work (Staff Performance → Calling).
 *
 * Tasks are rows in call_tasks: each names a queue builder (new_agents,
 * payments, retention), its steps, its outcomes and its settings. A new task
 * that reuses a builder is one row; a new kind of queue is one function below.
 *
 * Pure functions first (the tests check them), then the database work.
 * Phones leave this module masked (last three digits) except the one number on
 * the caller's own open attempt, which the focus screen needs to dial.
 */

const db = require('../config/database');
const scripts = require('./callingScripts');
const callRoutes = require('./callingRoutes');
const CALLBACK_MIN_HOURS = 24;
const perf = require('./staffPerformance');
const { staffSenderChoices, maskPhoneLast3 } = require('./outreachSenderName');
const sandbox = require('./callingSandbox');
const rules = require('./callingRules');
const followThrough = require('./callingFollowThrough');
const { phoneKey9, canonicalUgPhone, isUgandanPhone } = require('../utils/ugPhone');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');

const TZ = 'Africa/Kampala';
const DEFAULT_TARGETS = Object.freeze({ calls_per_day: 40, closes_per_day: 2 });
// "No answer" is not a call (Arthur, 17 Nov 2026): it is kept in the number's history and in
// Evidence, but never counts toward calls, targets, streaks, leaderboards or King's totals.
// The number goes back into its queue and comes back 24 hours later.
const NO_ANSWER = 'no_answer';
const NO_ANSWER_RETRY_MS = 24 * 3600 * 1000;
const isNoAnswer = (a) => a && a.status === 'done' && a.outcome === NO_ANSWER;
const countsAsCall = (a) => a && a.status === 'done' && a.outcome !== NO_ANSWER;
const COUNTED_SQL = (t = '') => `${t}status = 'done' AND ${t}outcome IS DISTINCT FROM '${NO_ANSWER}'`;
const SHORT_SPOKE_S = 10;
const RAPID_TAP_S = 15;
const SHOWN_EXPIRE_MIN = 30;
const CALLING_EXPIRE_MIN = 180;
const DROPPED_AFTER_MS = 3 * 60 * 1000;
const CALLBACK_EARLY_MIN = 15;
const MILESTONES = [5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200];
const FLAG_LABELS = Object.freeze({
  short_spoke: 'Under 10 s but marked as a conversation',
  rapid_tap: 'Tapped under 15 s after the last call',
  no_tap: 'Outcome without tapping to call',
  no_follow_up: 'Interested with no follow-up date',
  no_end: 'Wrapped up without ending the call',
  no_transcript: 'Spoke but no live-notes transcript'
});

// Closed means paid: money received (Arthur, 21 Nov 2026). "Signed up" is
// interest, not a close. Only these outcomes can ever count as a close, even
// if a task's outcome list is edited to say otherwise.
const PAID_OUTCOMES = Object.freeze(new Set(['paid', 'renewed']));
function closedPaid(a = {}) { return Boolean(a.is_close) && PAID_OUTCOMES.has(String(a.outcome || '')); }

// Call now is locked until the screen has passed its mic + live-notes check
// (and the phone link / audio device is still there). Old cached screens that
// don't send the check are refused, so they must reload.
const NOTES_CHECK_MAX_AGE_MS = 12 * 3600 * 1000;
function notesCheckOk(check, now = new Date()) {
  if (!check || typeof check !== 'object') return false;
  if (check.notes !== 'ok' || check.link === 'down') return false;
  const at = new Date(check.at || 0).getTime();
  if (!Number.isFinite(at) || at <= 0) return false;
  const age = now.getTime() - at;
  return age >= -5 * 60000 && age <= NOTES_CHECK_MAX_AGE_MS;
}

const kampalaDay = perf.kampalaDay;
const addDays = perf.addDays;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function cleanKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

function seconds(from, to) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
}

function outcomeDef(task, key) {
  return (Array.isArray(task?.outcomes) ? task.outcomes : []).find((o) => o.key === key) || null;
}

// ------------------------------------------------------------------ rules --

/**
 * Discrepancy flags for one wrapped-up call.
 * attempt: tapped_at, ended_at, wrapped_at, callback_at; def: the outcome;
 * prevTapAt: this caller's previous tap (any task), if any.
 */
function flagsFor(attempt = {}, def = {}, prevTapAt = null, transcript = null) {
  const flags = [];
  const talk = seconds(attempt.tapped_at, attempt.ended_at || attempt.wrapped_at);
  if (!attempt.tapped_at) flags.push('no_tap');
  if (attempt.tapped_at && !attempt.ended_at) flags.push('no_end');
  if (def.spoke && attempt.tapped_at && talk != null && talk < SHORT_SPOKE_S) flags.push('short_spoke');
  if (attempt.tapped_at && prevTapAt) {
    const gap = seconds(prevTapAt, attempt.tapped_at);
    if (gap != null && gap < RAPID_TAP_S) flags.push('rapid_tap');
  }
  if (['interested', 'will_list', 'needs_help'].includes(def.key) && !attempt.callback_at) flags.push('no_follow_up');
  // They spoke but live notes caught nothing: King sees it on the evidence.
  const heard = transcript && typeof transcript.text === 'string' ? transcript.text.trim() : '';
  if (def.spoke && attempt.tapped_at && heard.length < 3) flags.push('no_transcript');
  return flags;
}

/**
 * Can this number be shown now for this task? history: every attempt for the
 * phone_key (any task, any caller), newest first. Returns { ok, why, kind }.
 * kind: 'fresh' | 'callback' | 'retry'.
 */
function eligibility(history = [], task = {}, { now = new Date(), tasks = [] } = {}) {
  const today = kampalaDay(now);
  const done = history.filter((a) => a.status === 'done');
  const open = history.find((a) => a.status === 'shown' || a.status === 'calling');
  if (open) return { ok: false, why: 'open_elsewhere' };
  const defOf = (a) => outcomeDef(tasks.find((t) => t.key === a.task_key) || task, a.outcome) || {};
  // "Do not contact" lives in call_blocks (King can lift it); a wrong number stays out.
  if (done.some((a) => a.outcome === 'wrong_number')) return { ok: false, why: 'do_not_contact' };
  // Skips: the reason decides what happens next. Wrong number never again;
  // already an agent / not interested leave the new-agents queue; any skip
  // keeps the number off everyone's screen for the rest of the day.
  const skips = history.filter((a) => a.status === 'skipped');
  const skipCode = (a) => skipCodeOf(a.skip_reason);
  if (skips.some((a) => skipCode(a) === 'wrong_number')) return { ok: false, why: 'do_not_contact' };
  if (task.queue_kind === 'new_agents' && skips.some((a) => ['already_agent', 'not_interested'].includes(skipCode(a)))) return { ok: false, why: 'closed' };
  if (skips.some((a) => kampalaDay(a.wrapped_at || a.shown_at) === today)) return { ok: false, why: 'skipped_today' };
  // A no-answer holds the number for 24 hours (any task), then it is back in its queue.
  const lastMiss = done.find(isNoAnswer);
  if (lastMiss && now.getTime() - new Date(lastMiss.wrapped_at || lastMiss.shown_at).getTime() < NO_ANSWER_RETRY_MS) return { ok: false, why: 'no_answer_24h' };
  if (done.some((a) => !isNoAnswer(a) && kampalaDay(a.wrapped_at || a.shown_at) === today)) {
    const latestToday = done.find((a) => !isNoAnswer(a));
    const due = latestToday?.callback_at && new Date(latestToday.callback_at).getTime() <= now.getTime() + CALLBACK_EARLY_MIN * 60000;
    if (!due) return { ok: false, why: 'called_today' };
  }
  const mine = done.filter((a) => a.task_key === task.key);
  const last = done[0];
  if (!last) return { ok: true, kind: 'fresh' };
  // A callback is the latest word on the number, whichever task set it.
  if (last.callback_at) {
    const due = new Date(last.callback_at).getTime() <= now.getTime() + CALLBACK_EARLY_MIN * 60000;
    if (!due) return { ok: false, why: 'callback_later' };
    if (last.task_key !== task.key) return { ok: false, why: 'callback_other_task' };
    return { ok: true, kind: 'callback' };
  }
  const lastDef = defOf(last);
  if (lastDef.terminal && last.task_key === task.key) return { ok: false, why: 'closed' };
  const cfg = task.config || {};
  if (last.outcome === 'no_answer' && last.task_key === task.key) {
    const misses = [];
    for (const a of mine) { if (a.outcome !== 'no_answer') break; misses.push(a); }
    // No answer 3 times in a row: park the number for 7 days, then try again.
    if (misses.length >= Number(cfg.max_no_answer || 3)) {
      const parkDays = Number(cfg.park_days || 7);
      if (addDays(kampalaDay(misses[0].wrapped_at || misses[0].shown_at), parkDays) > today) return { ok: false, why: 'parked_no_answer' };
    }
    return { ok: true, kind: 'retry' };
  }
  const cooldown = cfg.cooldown_days;
  if (cooldown == null) {
    // New agents: once someone has spoken to them, never again without a callback.
    if (mine.some((a) => defOf(a).spoke)) return { ok: false, why: 'already_spoken' };
    if (last.task_key === task.key) return { ok: false, why: 'already_called' };
    return { ok: true, kind: 'fresh' };
  }
  const lastMine = mine[0];
  if (lastMine && addDays(kampalaDay(lastMine.wrapped_at || lastMine.shown_at), Number(cooldown)) > today) return { ok: false, why: 'cooldown' };
  return { ok: true, kind: lastMine ? 'retry' : 'fresh' };
}

// One-tap skip reasons. Stored as the label (plus a note for "Other").
const SKIP_REASONS = Object.freeze([
  ['wrong_number', 'Wrong number'],
  ['no_answer', 'No answer'],
  ['busy', 'Busy'],
  ['already_agent', 'Already an agent'],
  ['not_interested', 'Not interested'],
  ['do_not_contact', 'Do not contact (asked us to stop)'],
  ['other', 'Other']
]);
function skipCodeOf(reason = '') {
  const r = String(reason || '').toLowerCase();
  const hit = SKIP_REASONS.find(([, label]) => r === label.toLowerCase() || r.startsWith(`${label.toLowerCase()}:`));
  return hit ? hit[0] : 'other';
}

/**
 * How likely this number is to turn into money, for the queue order.
 * Payments: unpaid sign-ups first, then overdue renewals. Retention: renewals
 * due soon, then lapsed, then idle. New agents: fresh leads and WhatsApp first,
 * then people we already pitched, then found-online listers, then the list.
 */
function moneyScore(c = {}) {
  const r = String(c.reason || '');
  if (c.source_kind === 'agent') {
    if (/^Signed up/.test(r)) return 90 + Math.min(9, Number((r.match(/(\d+) live/) || [])[1] || 0));
    if (/^Renewal overdue/.test(r)) return 80;
    if (/^Renews/.test(r)) return 70;
    if (/^Payment lapsed/.test(r)) return 50;
    return 40;
  }
  if (c.source_kind === 'own') return 88;
  if (c.source_kind === 'lead' || c.source_kind === 'whatsapp') return 85;
  if (c.source_kind === 'listing') return c.found_online ? 66 : 72;
  if (c.source_kind === 'prospect') return c.prospect_pitched ? 75 : 60;
  if (c.source_kind === 'list') return 70; // the Companion's daily list: one score, so list day and upload order decide
  if (c.found_online) return 65;
  return 50;
}

function variantFor(task = {}, candidate = {}, history = []) {
  const allowed = Array.isArray(task.script_variants) && task.script_variants.length ? task.script_variants : ['cold_call'];
  if (allowed.length === 1) return allowed[0];
  const pick = (v) => (allowed.includes(v) ? v : allowed[0]);
  if (history.some((a) => a.status === 'done') || candidate.prospect_pitched) return pick('existing_contact');
  if (candidate.found_online) return pick('found_online');
  return pick('cold_call');
}

function nextMilestone(calls = 0, closes = 0, targets = DEFAULT_TARGETS) {
  if (closes < targets.closes_per_day && calls >= targets.calls_per_day) return `${targets.closes_per_day - closes} close${targets.closes_per_day - closes === 1 ? '' : 's'} to hit your close target`;
  const m = MILESTONES.find((x) => x > calls);
  if (calls < targets.calls_per_day) return `${targets.calls_per_day - calls} calls to your target of ${targets.calls_per_day}`;
  if (m) return `Target hit! ${m - calls} more for ${m} calls today`;
  return 'Target hit — great day';
}

/** Days in a row (ending today or yesterday) that hit the calls target. */
function streakDays(byDay = {}, today, target = DEFAULT_TARGETS.calls_per_day) {
  let day = (byDay[today] || 0) >= target ? today : addDays(today, -1);
  let n = 0;
  while ((byDay[day] || 0) >= target && n < 366) { n += 1; day = addDays(day, -1); }
  return n;
}

function summarize(attempts = [], tasks = []) {
  const all = attempts.filter((a) => a.status === 'done');
  const done = all.filter(countsAsCall);
  const out = {
    shown: attempts.length,
    tapped: attempts.filter((a) => a.tapped_at).length,
    calls: done.length,
    not_answered: all.length - done.length,
    connected: done.filter((a) => a.spoke).length,
    closes: done.filter(closedPaid).length,
    skipped: attempts.filter((a) => a.status === 'skipped').length,
    skip_reasons: attempts.filter((a) => a.status === 'skipped').reduce((m, a) => { const k = skipCodeOf(a.skip_reason); m[k] = (m[k] || 0) + 1; return m; }, {}),
    abandoned: attempts.filter((a) => a.status === 'abandoned').length,
    talk_s: done.reduce((s, a) => s + (Number(a.talk_s) || 0), 0),
    wrapup_s: done.reduce((s, a) => s + (Number(a.wrapup_s) || 0), 0),
    callbacks_booked: done.filter((a) => a.callback_at).length,
    follow_ups_done: done.filter((a) => a.source_kind === 'callback').length,
    flags: {},
    flagged_calls: 0,
    outcomes: {},
    by_task: {},
    by_hour: {}
  };
  out.avg_talk_s = out.calls ? Math.round(out.talk_s / out.calls) : 0;
  const gaps = done.map((a) => Number(a.gap_s)).filter((g) => Number.isFinite(g)).sort((a, b) => a - b);
  out.median_gap_s = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  for (const t of tasks) out.by_task[t.key] = { name: t.name, calls: 0, closes: 0, connected: 0 };
  for (const a of all) if (isNoAnswer(a)) out.outcomes[a.outcome] = (out.outcomes[a.outcome] || 0) + 1;
  for (const a of done) {
    out.outcomes[a.outcome] = (out.outcomes[a.outcome] || 0) + 1;
    const bt = out.by_task[a.task_key] || (out.by_task[a.task_key] = { name: a.task_key, calls: 0, closes: 0, connected: 0 });
    bt.calls += 1; if (closedPaid(a)) bt.closes += 1; if (a.spoke) bt.connected += 1;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(new Date(a.tapped_at || a.wrapped_at))) % 24;
    out.by_hour[hour] = (out.by_hour[hour] || 0) + 1;
    const fl = Array.isArray(a.flags) ? a.flags : [];
    if (fl.length) out.flagged_calls += 1;
    for (const f of fl) out.flags[f] = (out.flags[f] || 0) + 1;
  }
  return out;
}

function maskName(name = '') { return String(name || '').trim().slice(0, 60); }

function maskedAttempt(a = {}) {
  return {
    id: a.id,
    task_key: a.task_key,
    person_key: a.person_key,
    name: maskName(a.full_name),
    phone: maskPhoneLast3(a.phone),
    source_kind: a.source_kind,
    direction: a.direction || 'outbound',
    source_label: a.source_label,
    reason: a.reason,
    status: a.status,
    shown_at: a.shown_at,
    tapped_at: a.tapped_at,
    ended_at: a.ended_at,
    wrapped_at: a.wrapped_at,
    talk_s: a.talk_s,
    wrapup_s: a.wrapup_s,
    gap_s: a.gap_s,
    outcome: a.outcome,
    is_close: a.is_close,
    note: a.note,
    callback_at: a.callback_at,
    next_step: a.next_step || null,
    transcript_summary: a.transcript ? a.transcript.summary || '' : null,
    skip_reason: a.skip_reason,
    checklist: a.checklist,
    flags: a.flags || [],
    login: a.actor_account || '',
    session_id: a.session_id
  };
}

// ---------------------------------------------------------------- loading --

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows || [];
}

async function safeRows(sql, params = []) {
  try { return await rows(sql, params); } catch (_) { return []; }
}

/** House rules on top of the stored outcomes: an interested outcome always needs a follow-up date. */
function withRules(t) {
  if (t && Array.isArray(t.outcomes)) t.outcomes = t.outcomes.map((o) => (o && rules.INTERESTED_OUTCOMES.includes(o.key) ? { ...o, date: 'required' } : o));
  // "Looking for a place" on an agents call ends as "Seeker, text sent" (the seeker form logs the lead and the text).
  if (t && t.key === 'new_agents' && Array.isArray(t.outcomes) && !t.outcomes.some((o) => o && o.key === rules.SEEKER_OUTCOME.key)) {
    const at = t.outcomes.findIndex((o) => o && o.key === 'do_not_contact');
    t.outcomes.splice(at < 0 ? t.outcomes.length : at, 0, { ...rules.SEEKER_OUTCOME });
  }
  return t;
}

async function loadTasks({ all = false } = {}) {
  return (await rows(`SELECT key, name, description, queue_kind, sort_order, active, script_variants, checklist, outcomes, config
                 FROM call_tasks ${all ? '' : 'WHERE active'} ORDER BY sort_order, key`)).map(withRules);
}

async function loadTask(key) {
  const t = (await rows('SELECT key, name, description, queue_kind, sort_order, active, script_variants, checklist, outcomes, config FROM call_tasks WHERE key = $1', [key]))[0];
  if (!t || !t.active) throw httpError(400, 'Pick a task.');
  return withRules(t);
}

/** Everyone who can call: Arthur, Ronald, staff added to Agent 007, commission staff, and anyone with a target or calls. */
async function loadCallers() {
  await require('./billingOpsService').loadAgent007Staff(db).catch(() => null);
  const people = new Map();
  const add = (key, name, extra = {}) => {
    const k = cleanKey(key);
    if (!k) return;
    people.set(k, { key: k, name: name || people.get(k)?.name || k, ...people.get(k), ...extra, key: k, name: people.get(k)?.name || name || k });
  };
  for (const p of staffSenderChoices()) add(p.key, p.name);
  for (const r of await safeRows('SELECT person_key, name, role, active, rate_pct, user_id::text AS user_id FROM commission_staff')) add(r.person_key, r.name, { role: r.role, commission_active: r.active, rate_pct: Number(r.rate_pct || 0), user_id: r.user_id || null });
  // Anyone given a calling login gets their own queue and the default targets straight away.
  for (const r of await safeRows("SELECT id::text AS user_id, profile_data->>'person_key' AS person_key, TRIM(CONCAT(first_name, ' ', last_name)) AS full_name, COALESCE(profile_data->>'sandbox', 'false') = 'true' AS sandbox FROM users WHERE role = 'moderator' AND status = 'active' AND COALESCE(profile_data->>'person_key', '') <> ''")) {
    // A practice login is known by its user id; a real person keeps their commission_staff link.
    add(r.person_key, r.full_name, r.sandbox ? { user_id: r.user_id, sandbox: true } : {});
    const cur = people.get(cleanKey(r.person_key)); if (cur && !cur.user_id) cur.user_id = r.user_id;
  }
  for (const r of await safeRows('SELECT DISTINCT person_key FROM call_targets')) add(r.person_key, null);
  for (const r of await safeRows("SELECT DISTINCT person_key FROM call_sessions WHERE started_at > NOW() - INTERVAL '60 days'")) add(r.person_key, null);
  // Removed by King on the Staff page: off the desk and the reports' people list (their history stays).
  for (const r of await safeRows("SELECT profile_data->>'person_key' AS person_key FROM users WHERE role = 'moderator' AND status <> 'active' AND profile_data ? 'removed_at'")) people.delete(cleanKey(r.person_key));
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function targetsFor(personKey, day = kampalaDay()) {
  const r = (await safeRows(
    'SELECT calls_per_day, closes_per_day FROM call_targets WHERE person_key = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1',
    [personKey, day]
  ))[0];
  return r ? { calls_per_day: Number(r.calls_per_day), closes_per_day: Number(r.closes_per_day) } : { ...DEFAULT_TARGETS };
}

async function saveTargets({ targets = [], actor = '', day = kampalaDay() } = {}) {
  const saved = [];
  for (const t of Array.isArray(targets) ? targets : []) {
    const key = cleanKey(t.person_key);
    const calls = Math.round(Number(t.calls_per_day));
    const closes = Math.round(Number(t.closes_per_day));
    if (!key || !Number.isFinite(calls) || !Number.isFinite(closes) || calls < 0 || calls > 1000 || closes < 0 || closes > 200) throw httpError(400, 'Targets must be whole numbers (calls 0–1000, closes 0–200).');
    await db.query(
      `INSERT INTO call_targets (person_key, calls_per_day, closes_per_day, effective_from, set_by)
       VALUES ($1, $2, $3, $4::date, $5)
       ON CONFLICT (person_key, effective_from) DO UPDATE SET calls_per_day = EXCLUDED.calls_per_day, closes_per_day = EXCLUDED.closes_per_day, set_by = EXCLUDED.set_by, set_at = NOW()`,
      [key, calls, closes, day, actor || 'King']
    );
    saved.push({ person_key: key, calls_per_day: calls, closes_per_day: closes, effective_from: day });
  }
  return saved;
}

// --------------------------------------------------------------- sessions --

async function tidy(now = new Date()) {
  // Numbers left on screen too long go back to the pool; calls never wrapped up are marked.
  await db.query(`UPDATE call_attempts SET status = 'released' WHERE status = 'shown' AND tapped_at IS NULL AND shown_at < $1::timestamptz - INTERVAL '${SHOWN_EXPIRE_MIN} minutes'`, [now]);
  await db.query(`UPDATE call_attempts SET status = 'abandoned', flags = array_append(flags, 'no_outcome') WHERE status IN ('shown', 'calling') AND COALESCE(tapped_at, shown_at) < $1::timestamptz - INTERVAL '${CALLING_EXPIRE_MIN} minutes'`, [now]);
  const stale = await rows(`SELECT id, person_key FROM call_sessions WHERE ended_at IS NULL AND last_heartbeat_at < $1::timestamptz - ($2 || ' milliseconds')::interval`, [now, String(DROPPED_AFTER_MS)]);
  for (const s of stale) await closeSession(s.id, 'dropped', { at: null });
}

async function closeSession(id, reason, { at = new Date() } = {}) {
  const s = (await rows(
    `UPDATE call_sessions SET ended_at = COALESCE($3::timestamptz, last_heartbeat_at), end_reason = $2
      WHERE id = $1 AND ended_at IS NULL RETURNING id, person_key, ended_at`,
    [id, reason, at]
  ))[0];
  if (!s) return null;
  await db.query(`INSERT INTO call_session_events (session_id, kind, detail, at) VALUES ($1, 'end', $2, $3)`, [id, reason, s.ended_at]);
  await db.query(`UPDATE call_attempts SET status = 'released' WHERE session_id = $1 AND status = 'shown' AND tapped_at IS NULL`, [id]);
  await saveReport(s.person_key, kampalaDay(s.ended_at)).catch(() => null);
  return s;
}

async function startSession({ personKey, taskKey, device = '', actorAccount = '', actorUserId = '', isKing = false, now = new Date() } = {}) {
  const callers = await loadCallers();
  const person = callers.find((p) => p.key === cleanKey(personKey));
  if (!person) throw httpError(400, 'Pick who is calling.');
  if (!isKing) {
    // A caller's own login only calls as them; the practice account is only for its own login (or King),
    // so real calls from a shared login can never land on "Arthur (test)" and go uncounted.
    const me = callers.find((p) => p.user_id && actorUserId && String(p.user_id) === String(actorUserId));
    if (me && me.key !== person.key) throw httpError(403, `You are signed in as ${me.name}. Calls from this login go to ${me.name}.`);
    if (!me && person.sandbox) throw httpError(403, `${person.name} is the practice account: its calls are not counted. Pick your own name, or better, sign in with your own login.`);
  }
  const task = await loadTask(taskKey);
  await tidy(now);
  // Every dialled call ends with an outcome (Arthur, 21 Nov 2026): calls left without one
  // (screen closed, connection lost) get it before the person's next session starts.
  // King starting a session for someone is not blocked: the outcome is theirs to give.
  const owedCalls = isKing ? [] : await rows(
    `SELECT id FROM call_attempts WHERE person_key = $1 AND tapped_at IS NOT NULL AND outcome IS NULL AND status IN ('calling', 'abandoned')
        AND tapped_at > $2::timestamptz - INTERVAL '14 days' AND COALESCE(direction, 'outbound') = 'outbound'`, [person.key, now]);
  if (owedCalls.length) {
    const e = httpError(409, `${owedCalls.length === 1 ? 'One call needs' : `${owedCalls.length} calls need`} an outcome first.`);
    e.code = 'outcome_owed'; e.data = { owed: owedCalls.length };
    throw e;
  }
  for (const s of await rows('SELECT id FROM call_sessions WHERE person_key = $1 AND ended_at IS NULL', [person.key])) await closeSession(s.id, 'replaced', { at: now });
  const s = (await rows(
    `INSERT INTO call_sessions (person_key, task_key, actor_account, actor_user_id, device, started_at, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
    [person.key, task.key, String(actorAccount).slice(0, 120), String(actorUserId).slice(0, 80), String(device).slice(0, 20), now]
  ))[0];
  await db.query(`INSERT INTO call_session_events (session_id, kind, detail, at) VALUES ($1, 'start', $2, $3)`, [s.id, task.key, now]);
  return { session: s, person, task };
}

async function openSession(id) {
  const s = (await rows('SELECT * FROM call_sessions WHERE id = $1', [id]))[0];
  if (!s) throw httpError(404, 'Session not found.');
  if (s.ended_at) throw httpError(409, 'This session has ended. Start calling again.');
  return s;
}

// Everything the screen reports: leaving it, breaks (lunch:45 = a 45-minute lunch),
// idle (idle_end detail = idle ms), open/close and every button pressed.
const IN_MEETING = 'in meeting';
const EVENT_KINDS = new Set(['inbound_start', 'fs_exit', 'fs_enter', 'hidden', 'visible', 'break_start', 'break_end', 'kit_send', 'screen_open', 'screen_close', 'idle_start', 'idle_end', 'action', 'work_on', 'work_off', 'meeting_join', 'meeting_end', 'notes_start', 'notes_stop', 'notes_declined', 'notes_error', 'notes_check_passed', 'notes_check_failed', 'link_drop', 'link_back', 'wa_share', 'housekeeping_on', 'housekeeping_off', 'auto_fallback', 'route', 'work_off']);

/**
 * Heartbeat from the screen: running totals (ms) and the events since the last
 * beat. Totals only ever go up, and open time can't exceed the wall clock.
 */
async function heartbeat(id, { totals = {}, events = [], now = new Date() } = {}) {
  const s = await openSession(id);
  const wall = Math.max(0, now.getTime() - new Date(s.started_at).getTime()) + 5000;
  const n = (v) => Math.max(0, Math.min(wall, Math.round(Number(v) || 0)));
  // Unknown kinds are kept as an 'action' (kind:detail) so nothing the screen reports is lost silently.
  const list = (Array.isArray(events) ? events : []).slice(0, 300).filter((e) => e && e.kind)
    .map((e) => (EVENT_KINDS.has(e.kind) ? e : { ...e, kind: 'action', detail: `${String(e.kind).slice(0, 40)}:${String(e.detail || '')}` }));
  for (const e of list) {
    const at = e.at && !Number.isNaN(new Date(e.at).getTime()) ? new Date(Math.min(now.getTime(), Math.max(new Date(s.started_at).getTime(), new Date(e.at).getTime()))) : now;
    await db.query('INSERT INTO call_session_events (session_id, kind, detail, at) VALUES ($1, $2, $3, $4)', [id, e.kind, String(e.detail || '').slice(0, 200), at]);
  }
  // Switching to the Meet pop-up during a team meeting is work, not leaving the screen.
  const exits = list.filter((e) => (e.kind === 'fs_exit' || e.kind === 'hidden') && e.detail !== IN_MEETING).length;
  const breaks = list.filter((e) => e.kind === 'break_start').length;
  const out = (await rows(
    `UPDATE call_sessions SET last_heartbeat_at = $2,
        open_ms = GREATEST(open_ms, $3), focus_ms = GREATEST(focus_ms, $4), away_ms = GREATEST(away_ms, $5),
        break_ms = GREATEST(break_ms, $6), oncall_hidden_ms = GREATEST(oncall_hidden_ms, $7),
        exit_count = exit_count + $8, break_count = break_count + $9
      WHERE id = $1 RETURNING *`,
    [id, now, n(totals.open_ms), n(totals.focus_ms), n(totals.away_ms), n(totals.break_ms), n(totals.oncall_hidden_ms), exits, breaks]
  ))[0];
  return out;
}

async function switchTask(id, taskKey) {
  const s = await openSession(id);
  const task = await loadTask(taskKey);
  const open = (await rows("SELECT id FROM call_attempts WHERE session_id = $1 AND status = 'calling'", [id]))[0];
  if (open) throw httpError(409, 'Finish the wrap-up for this call first.');
  await db.query("UPDATE call_attempts SET status = 'released' WHERE session_id = $1 AND status = 'shown'", [id]);
  await db.query('UPDATE call_sessions SET task_key = $2 WHERE id = $1', [id, task.key]);
  await db.query("INSERT INTO call_session_events (session_id, kind, detail) VALUES ($1, 'task_switch', $2)", [id, task.key]);
  return { ...s, task_key: task.key };
}

async function endSession(id, { now = new Date() } = {}) {
  const open = (await rows("SELECT id FROM call_attempts WHERE session_id = $1 AND status = 'calling'", [id]))[0];
  if (open) throw httpError(409, 'Finish the wrap-up for this call first, then exit.');
  return closeSession(id, 'exited', { at: now });
}

// ------------------------------------------------------------------ queue --

async function attemptsFor(keys = []) {
  if (!keys.length) return new Map();
  const map = new Map();
  const grouped = await rows(
    `SELECT phone_key, json_agg(json_build_object('id', id, 'task_key', task_key, 'person_key', person_key, 'status', status,
        'outcome', outcome, 'callback_at', callback_at, 'shown_at', shown_at, 'wrapped_at', wrapped_at, 'spoke', spoke, 'note', note, 'skip_reason', skip_reason)
        ORDER BY COALESCE(wrapped_at, shown_at) DESC) AS h
       FROM call_attempts WHERE phone_key = ANY($1::text[]) AND status IN ('shown', 'calling', 'done', 'skipped') GROUP BY phone_key`,
    [keys]
  );
  for (const g of grouped) map.set(g.phone_key, g.h || []);
  return map;
}

async function blockedKeys(keys = []) {
  if (!keys.length) return new Set();
  const dnc = await safeRows('SELECT phone_key FROM agent_prospects WHERE phone_key = ANY($1::text[]) AND do_not_contact IS TRUE', [keys]);
  const blocks = await safeRows('SELECT phone_key FROM call_blocks WHERE phone_key = ANY($1::text[]) AND removed_at IS NULL', [keys]);
  return new Set([...dnc, ...blocks].map((r) => r.phone_key));
}

async function agentKeys(keys = []) {
  if (!keys.length) return new Set();
  const list = await safeRows(
    `SELECT RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) AS k1, RIGHT(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 9) AS k2
       FROM agents WHERE removed_at IS NULL`
  );
  const set = new Set();
  for (const r of list) { if (r.k1) set.add(r.k1); if (r.k2) set.add(r.k2); }
  return set;
}

/**
 * Candidates in queue order for one task and caller. Each: phone, phone_key, name, source.
 * International numbers (not Ugandan) are never offered to call: they are WhatsApp only
 * and listed for King separately (internationalNumbers). A practice login's own test phone is the one exception.
 */
async function candidatesFor(task, personKey, opts = {}) {
  if (await sandbox.isSandbox(personKey)) return practiceCandidates(task, personKey);
  return (await rawCandidates(task, personKey, opts)).filter((c) => isUgandanPhone(c.phone));
}

async function rawCandidates(task, personKey, { today = kampalaDay(), limit = 400 } = {}) {
  const cfg = task.config || {};
  const out = [];
  // Due callbacks for this task come first, the caller's own before anyone else's.
  const callbacks = await rows(
    `SELECT DISTINCT ON (a.phone_key) a.phone_key, a.phone, a.full_name, a.person_key, a.callback_at, a.prospect_id, a.list_number_id, a.agent_id, a.outcome, a.task_key, a.source_label, a.next_step, a.note, a.transcript->>'summary' AS tx_summary
       FROM call_attempts a WHERE a.status = 'done' AND a.callback_at IS NOT NULL AND a.callback_at <= NOW() + INTERVAL '${CALLBACK_EARLY_MIN} minutes'
      ORDER BY a.phone_key, COALESCE(a.wrapped_at, a.shown_at) DESC`
  );
  // A callback goes back to the person who booked it, at the time they booked.
  // Someone else only gets it once it is 2 hours overdue, so none is lost.
  const late = Date.now() - 2 * 3600000;
  for (const c of callbacks.filter((c) => c.task_key === task.key && (c.person_key === personKey || new Date(c.callback_at).getTime() < late)).sort((a, b) => (a.person_key === personKey ? 0 : 1) - (b.person_key === personKey ? 0 : 1) || new Date(a.callback_at) - new Date(b.callback_at))) {
    out.push({ phone: c.phone, phone_key: c.phone_key, full_name: c.full_name, source_kind: 'callback', source_label: `Callback set ${c.person_key === personKey ? 'by you' : `by ${c.person_key}`} (${c.outcome.replace(/_/g, ' ')})${c.next_step ? `: ${c.next_step}` : ''}`, reason: c.tx_summary || c.note || c.source_label || '', prospect_id: c.prospect_id, list_number_id: c.list_number_id, agent_id: c.agent_id, callback: true });
  }
  // The caller's own numbers (added on the screen) go to them first, in the mode they chose.
  const own = await safeRows(
    `SELECT id, full_name, phone, phone_key, how_known, note FROM call_number_submissions
      WHERE status = 'own' AND person_key = $1 AND COALESCE(mode, 'new_agents') = $2 ORDER BY added_at LIMIT $3`, [personKey, task.key, limit]);
  for (const r of own) out.push({ phone: r.phone, phone_key: r.phone_key, full_name: r.full_name, source_kind: 'own', source_label: `Own number · added by you${r.how_known ? ` · ${r.how_known}` : ''}`, reason: r.note || '', submission_id: r.id });
  if (task.queue_kind === 'new_agents') {
    const list = await safeRows(
      // Earliest list day first (today's list before a batch loaded with a later day), then upload order.
      `SELECT id, full_name, phone, phone_key, lead_source, list_day::text AS list_day, what_they_posted, list_source FROM outreach_list_numbers
        WHERE accepted IS TRUE AND person_key = $1 AND list_day <= $2::date ORDER BY list_day ASC, added_at ASC, list_order ASC NULLS LAST LIMIT $3`,
      [personKey, today, limit]
    );
    for (const r of list) out.push({ phone: r.phone, phone_key: r.phone_key, full_name: r.full_name, source_kind: 'list', source_label: `Your list ${r.list_day}${r.list_source ? ` · ${r.list_source.replace(/_/g, ' ')}` : ''}${r.lead_source === 'found_online' ? ' · found online' : r.lead_source === 'staff_added' ? ' · added by you' : ''}`, reason: r.what_they_posted ? `What they posted: ${r.what_they_posted}` : '', list_number_id: r.id, found_online: r.lead_source === 'found_online' });
    const prospects = await safeRows(
      `SELECT id, full_name, phone, phone_key, status, pitched_at, pitched_by_name, video_kind, metadata FROM agent_prospects
        WHERE COALESCE(do_not_contact, false) = false AND COALESCE(status, '') NOT IN ('signed_up', 'approved', 'registered')
          AND phone_key IS NOT NULL AND agent_id IS NULL
        ORDER BY (LOWER(COALESCE(pitched_by_name, '')) LIKE $1 || '%') DESC, COALESCE(follow_up_at, pitched_at) ASC NULLS LAST LIMIT $2`,
      [personKey, limit]
    );
    // Leads and listings: people who enquired or listed privately in the last 14 days.
    const leads = await safeRows(
      `SELECT COALESCE(c.phone, c.whatsapp, l.metadata->>'phone', l.metadata->>'contact_phone') AS phone,
              COALESCE(NULLIF(c.name, ''), l.metadata->>'name', l.metadata->>'contact_name') AS full_name, l.source, l.category, l.location, l.created_at
         FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id
        WHERE l.created_at > NOW() - INTERVAL '14 days' AND COALESCE(l.is_test, false) = false AND l.deleted_at IS NULL
        ORDER BY l.created_at DESC LIMIT $1`, [Math.min(limit, 150)]);
    for (const r of leads) {
      const k = phoneKey9(r.phone); if (!k) continue;
      out.push({ phone: canonicalUgPhone(r.phone) || r.phone, phone_key: k, full_name: r.full_name, source_kind: 'lead', source_label: `Lead ${kampalaDay(r.created_at)} · ${String(r.source || 'website').replace(/_/g, ' ')}`, reason: [r.category, r.location].filter(Boolean).join(' · ') });
    }
    const listings = await safeRows(
      `SELECT p.lister_phone AS phone, p.lister_name AS full_name, p.title, p.area, p.created_at, ${foundOnlinePropertySql('p')} AS found_online
         FROM properties p
        WHERE p.agent_id IS NULL AND COALESCE(p.lister_phone, '') <> '' AND p.created_at > NOW() - INTERVAL '30 days'
        ORDER BY p.created_at DESC LIMIT $1`, [Math.min(limit, 150)]);
    for (const r of listings) {
      const k = phoneKey9(r.phone); if (!k) continue;
      out.push({ phone: canonicalUgPhone(r.phone) || r.phone, phone_key: k, full_name: r.full_name, source_kind: 'listing', source_label: `Listing ${kampalaDay(r.created_at)}${r.found_online ? ' · found online' : ' · listed it themselves'}`, reason: [String(r.title || '').replace(/\*+/g, '').slice(0, 70), r.area].filter(Boolean).join(' · '), found_online: Boolean(r.found_online) });
    }
    // Older found-online posters nobody has called yet (Arthur, 22 Nov 2026): they never drop out of the feed.
    const older = await safeRows(
      `SELECT p.lister_phone AS phone, p.lister_name AS full_name, p.title, p.area, p.created_at
         FROM properties p
        WHERE p.agent_id IS NULL AND COALESCE(p.lister_phone, '') <> '' AND p.created_at <= NOW() - INTERVAL '30 days' AND ${foundOnlinePropertySql('p')}
          AND NOT EXISTS (SELECT 1 FROM call_attempts ca WHERE ca.phone_key = RIGHT(regexp_replace(p.lister_phone, '\\D', '', 'g'), 9))
        ORDER BY p.created_at DESC LIMIT $1`, [Math.min(limit, 200)]);
    for (const r of older) {
      const k = phoneKey9(r.phone); if (!k) continue;
      out.push({ phone: canonicalUgPhone(r.phone) || r.phone, phone_key: k, full_name: r.full_name, source_kind: 'listing', source_label: `Listing ${kampalaDay(r.created_at)} · found online · never called`, reason: [String(r.title || '').replace(/\*+/g, '').slice(0, 70), r.area].filter(Boolean).join(' · '), found_online: true });
    }
    for (const r of prospects) {
      const when = r.pitched_at ? kampalaDay(r.pitched_at) : '';
      const by = r.pitched_by_name || '';
      out.push({ phone: r.phone, phone_key: r.phone_key, full_name: r.full_name, source_kind: 'prospect', source_label: `Outreach: ${r.video_kind === 'owner' ? 'owner' : 'agent'} film${when ? ` sent ${when}` : ''}${by ? ` by ${by}` : ''} · ${String(r.status || 'pitched')}`, prospect_id: r.id, prospect_pitched: Boolean(r.pitched_at), found_online: Boolean(r.metadata && r.metadata.found_online) });
    }
  } else if (task.queue_kind === 'payments' || task.queue_kind === 'retention') {
    const split = Number(cfg.lapsed_split_days || 14);
    const agents = await safeRows(
      `SELECT a.id, a.full_name, COALESCE(NULLIF(a.phone, ''), a.whatsapp) AS phone, a.paid_until::text AS paid_until, a.last_payment_on::text AS last_payment_on,
              COALESCE(a.approved_at, a.created_at) AS joined_at, l.last_listing_at, l.live
         FROM agents a
         LEFT JOIN LATERAL (SELECT MAX(p.created_at) AS last_listing_at, COUNT(*) FILTER (WHERE p.status = 'approved') AS live FROM properties p WHERE p.agent_id = a.id) l ON true
        WHERE a.removed_at IS NULL AND a.status = 'approved' AND COALESCE(a.fee_exempt, false) = false
          AND COALESCE(NULLIF(a.phone, ''), a.whatsapp) IS NOT NULL
        ORDER BY a.paid_until ASC NULLS FIRST, a.created_at ASC LIMIT $1`,
      [limit]
    );
    for (const a of agents) {
      const live = Number(a.live || 0);
      let reason = '';
      if (task.queue_kind === 'payments') {
        if (!a.paid_until) reason = `Signed up ${kampalaDay(a.joined_at)}, not paid yet · ${live} live`;
        else if (a.paid_until < today && a.paid_until >= addDays(today, -split)) reason = `Renewal overdue since ${a.paid_until}`;
      } else {
        const window = Number(cfg.renewal_window_days || 7);
        const idle = Number(cfg.inactive_days || 14);
        if (a.paid_until && a.paid_until >= today && a.paid_until <= addDays(today, window)) reason = `Renews ${a.paid_until}`;
        else if (a.paid_until && a.paid_until >= today && (!a.last_listing_at || kampalaDay(a.last_listing_at) < addDays(today, -idle))) reason = `No new listing in ${idle}+ days · ${live} live`;
        else if (a.paid_until && a.paid_until < addDays(today, -split)) reason = `Payment lapsed since ${a.paid_until}`;
      }
      if (!reason) continue;
      out.push({ phone: a.phone, phone_key: phoneKey9(a.phone), full_name: a.full_name, source_kind: 'agent', source_label: `Agent · ${reason}`, reason, agent_id: a.id });
    }
  }
  // TEST practice numbers never reach a real caller.
  return out.filter((c) => c.phone_key && c.phone_key.length === 9 && !sandbox.isTestKey(c.phone_key));
}

/** A practice caller's queue: their own TEST callbacks first, then the TEST practice numbers. Never a real phone. */
async function practiceCandidates(task, personKey) {
  const cbs = await safeRows(
    `SELECT DISTINCT ON (phone_key) phone_key, phone, full_name, callback_at, outcome FROM call_attempts
      WHERE person_key = $1 AND task_key = $2 AND status = 'done' AND callback_at IS NOT NULL AND callback_at <= NOW() + INTERVAL '${CALLBACK_EARLY_MIN} minutes'
      ORDER BY phone_key, COALESCE(wrapped_at, shown_at) DESC`, [personKey, task.key]);
  const mine = await safeRows("SELECT id, full_name, phone, phone_key FROM call_number_submissions WHERE person_key = $1 AND status = 'practice' ORDER BY added_at", [personKey]);
  const mineKeys = new Set(mine.map((m) => m.phone_key));
  const out = mine.map((m) => ({ submission_id: m.id, phone: m.phone, phone_key: m.phone_key, full_name: m.full_name, source_kind: 'own', source_label: 'Your real test phone · this one really rings (nothing is texted or counted)', reason: 'Real test call', practice_real: true }));
  out.push(...cbs.filter((c) => sandbox.isTestKey(c.phone_key) || mineKeys.has(c.phone_key)).map((c) => ({ phone: c.phone, phone_key: c.phone_key, full_name: c.full_name, source_kind: 'callback', source_label: `${sandbox.isTestKey(c.phone_key) ? 'TEST practice' : 'Your real test phone'} · callback you set (${String(c.outcome || '').replace(/_/g, ' ')})`, reason: 'Practice callback' })));
  const label = { new_agents: 'TEST practice number · pretend new agent', payments: 'TEST practice number · pretend unpaid sign-up', retention: 'TEST practice number · pretend client to keep' }[task.queue_kind] || 'TEST practice number';
  for (const n of sandbox.practiceNumbers()) out.push({ ...n, source_kind: 'list', source_label: `${label} – practice only, can't dial`, reason: 'Practice' });
  return out;
}

async function eligibleQueue(task, personKey, { now = new Date(), tasks = null, limit = 400 } = {}) {
  const today = kampalaDay(now);
  const all = tasks || await loadTasks({ all: true });
  const cands = await candidatesFor(task, personKey, { today, limit });
  const seen = new Set();
  const unique = cands.filter((c) => (seen.has(c.phone_key) ? false : (seen.add(c.phone_key), true)));
  const keys = unique.map((c) => c.phone_key);
  const [hist, dnc, agentSet] = await Promise.all([attemptsFor(keys), blockedKeys(keys), task.queue_kind === 'new_agents' ? agentKeys(keys) : Promise.resolve(new Set())]);
  const queue = [];
  for (const c of unique) {
    if (dnc.has(c.phone_key)) continue;
    if (task.queue_kind === 'new_agents' && agentSet.has(c.phone_key)) continue;
    const h = hist.get(c.phone_key) || [];
    let e = eligibility(h, task, { now, tasks: all });
    // A practice login's own real test phone can be rung again 10 minutes after the last try (to retest).
    if (!e.ok && c.practice_real && !h.some((x) => ['shown', 'calling'].includes(x.status))
      && !h.some((x) => new Date(x.wrapped_at || x.shown_at).getTime() > now.getTime() - 10 * 60000)) e = { ok: true, kind: 'fresh' };
    if (!e.ok) continue;
    if (c.callback && e.kind !== 'callback') continue;
    queue.push({ ...c, kind: e.kind, history: h });
  }
  const rank = { callback: 0, retry: 2, fresh: 1 };
  queue.sort((a, b) => rank[a.kind] - rank[b.kind] || moneyScore(b) - moneyScore(a));
  return queue;
}

async function historyFor(phoneKey) {
  const list = await rows(
    `SELECT shown_at, wrapped_at, person_key, task_key, status, outcome, note, skip_reason, callback_at, talk_s, next_step, transcript->>'summary' AS tx_summary FROM call_attempts
      WHERE phone_key = $1 AND status IN ('done', 'skipped') ORDER BY COALESCE(wrapped_at, shown_at) DESC LIMIT 30`,
    [phoneKey]
  );
  const events = await safeRows(
    `SELECT created_at, outcome, note, person_key FROM outreach_events WHERE phone_key = $1 AND kind = 'outcome' ORDER BY created_at DESC LIMIT 4`,
    [phoneKey]
  );
  const listed = await safeRows(
    `SELECT added_at, person_key, list_day::text AS list_day, what_they_posted, list_source FROM outreach_list_numbers
      WHERE phone_key = $1 AND accepted IS TRUE ORDER BY added_at DESC LIMIT 2`, [phoneKey]);
  return [
    ...list.map((a) => (a.status === 'skipped'
      ? { at: a.wrapped_at || a.shown_at, by: a.person_key, what: 'skipped', note: a.skip_reason || '', task: a.task_key, skipped: true }
      : { at: a.wrapped_at, by: a.person_key, what: `${a.outcome.replace(/_/g, ' ')}${a.talk_s != null ? ` · ${a.talk_s}s` : ''}`, outcome: a.outcome, note: a.note || '', task: a.task_key, next_step: a.callback_at || null, next_text: a.next_step || '', summary: a.tx_summary || '' })),
    ...events.map((e) => ({ at: e.created_at, by: e.person_key || '', what: `Outreach: ${String(e.outcome || '').replace(/_/g, ' ')}`, note: e.note || '', task: 'outreach' })),
    ...listed.map((l) => ({ at: l.added_at, by: l.person_key || '', what: `Put on the list for ${l.list_day}${l.list_source ? ` · ${String(l.list_source).replace(/_/g, ' ')}` : ''}`, note: l.what_they_posted ? `What they posted: ${l.what_they_posted}` : '', task: 'outreach', list: true }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
}

/**
 * Best time to call, from past calls to this number that were answered
 * (spoke). Returns e.g. { label: 'around 10:00–11:00', answered: 2, tries: 3 }.
 */
function bestTimeFrom(attempts = []) {
  const hourOf = (t) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(new Date(t))) % 24;
  const tried = attempts.filter((a) => a.tapped_at);
  const answered = tried.filter((a) => a.spoke);
  if (!answered.length) return tried.length ? { label: '', answered: 0, tries: tried.length, missed_hours: [...new Set(tried.map((a) => hourOf(a.tapped_at)))] } : null;
  const counts = {};
  for (const a of answered) { const h = hourOf(a.tapped_at); counts[h] = (counts[h] || 0) + 1; }
  const best = Number(Object.keys(counts).sort((x, y) => counts[y] - counts[x] || x - y)[0]);
  const part = best < 12 ? 'morning' : best < 17 ? 'afternoon' : 'evening';
  return { hour: best, label: `around ${String(best).padStart(2, '0')}:00–${String(best + 1).padStart(2, '0')}:00 (${part})`, answered: answered.length, tries: tried.length };
}
async function bestTimeFor(phoneKey) {
  return bestTimeFrom(await rows("SELECT tapped_at, spoke FROM call_attempts WHERE phone_key = $1 AND status = 'done' ORDER BY tapped_at DESC LIMIT 30", [phoneKey]));
}

/** Has this number sent us anything on WhatsApp ("said Hello")? Read only. */
async function helloFor(phoneKey) {
  const r = (await safeRows(
    `SELECT MIN(created_at) AS first_at, COUNT(*)::int AS n FROM whatsapp_messages
      WHERE direction = 'inbound' AND RIGHT(regexp_replace(user_phone, '\\D', '', 'g'), 9) = $1`, [phoneKey]))[0];
  return r && r.n ? { at: r.first_at, messages: r.n } : null;
}

const SOURCE_KIND_LABELS = Object.freeze({
  list: 'Your list', prospect: 'Outreach prospect', agent: 'Signed-up agent', callback: 'Callback',
  lead: 'Lead (enquiry)', whatsapp: 'WhatsApp message', staff_added: 'Own number', own: 'Own number', listing: 'Lister'
});
function sourceKindLabel(a = {}) {
  const label = String(a.source_label || '');
  if (/found online/i.test(label)) return 'Found online';
  if (/added by you|own number/i.test(label)) return 'Own number';
  if (/^Agent · Signed up/.test(label)) return 'Signed up, not paid';
  if (/listing|ref /i.test(label)) return 'Listing enquiry';
  return SOURCE_KIND_LABELS[a.source_kind] || 'Number';
}

function present(attempt, task, history = [], { callerName = '', withPhone = true, hello = null, bestTime = null } = {}) {
  const lastCall = history.find((h) => !h.skipped && h.task !== 'outreach') || null;
  const calls = history.filter((h) => !h.skipped && h.task !== 'outreach');
  return {
    context: {
      source_kind_label: sourceKindLabel(attempt),
      source_label: attempt.source_label || '',
      reason: attempt.reason || '',
      calls_before: calls.length,
      skips_before: history.filter((h) => h.skipped).length,
      last: history[0] || null,
      said_hello: hello,
      best_time: bestTime,
      last_call: lastCall ? { at: lastCall.at, by: lastCall.by, outcome: lastCall.outcome || lastCall.what, note: lastCall.note || '', task: lastCall.task, next_text: lastCall.next_text || '', summary: lastCall.summary || '' } : null,
      money: moneyScore(attempt) >= 80 ? 'Likely to pay' : moneyScore(attempt) >= 65 ? 'Warm' : 'Cold'
    },
    attempt: { ...maskedAttempt(attempt), phone: withPhone ? canonicalUgPhone(attempt.phone) : maskPhoneLast3(attempt.phone), phone_masked: maskPhoneLast3(attempt.phone) },
    tel: withPhone ? `tel:${canonicalUgPhone(attempt.phone)}` : null,
    history,
    script_variant: attempt.script_variant,
    caller: callerName
  };
}

/**
 * The next number for this session. If the session already has a number up
 * (a refresh, a lost tab), that one comes back. Otherwise the first eligible
 * number is claimed; the unique index on open numbers means two callers can
 * never take the same one, so on a clash we simply try the next.
 */
async function nextNumber(sessionId, { now = new Date(), preferSubmission = '', fallback = true } = {}) {
  let s = await openSession(sessionId);
  const tasks = await loadTasks({ all: true });
  let task = tasks.find((t) => t.key === s.task_key);
  const callers = await loadCallers();
  const callerName = callers.find((p) => p.key === s.person_key)?.name || s.person_key;
  const current = (await rows("SELECT * FROM call_attempts WHERE session_id = $1 AND status IN ('shown', 'calling') ORDER BY shown_at DESC LIMIT 1", [sessionId]))[0];
  if (current) return { ...present(current, task, await historyFor(current.phone_key), { callerName, hello: await helloFor(current.phone_key), bestTime: await bestTimeFor(current.phone_key) }), resumed: true, left: null };
  await tidy(now);
  let queue = await eligibleQueue(task, s.person_key, { now, tasks });
  let fellBackFrom = null;
  // Never run dry: when this task's list is empty, move to the next task that still has numbers.
  if (!queue.length && fallback) {
    for (const t of tasks.filter((x) => x.active !== false && x.key !== task.key)) {
      const q2 = await eligibleQueue(t, s.person_key, { now, tasks });
      if (!q2.length) continue;
      fellBackFrom = task;
      s = await switchTask(sessionId, t.key);
      await db.query("INSERT INTO call_session_events (session_id, kind, detail, at) VALUES ($1, 'auto_fallback', $2, $3)", [sessionId, `${fellBackFrom.key}>${t.key}`, now]);
      task = t; queue = q2; break;
    }
  }
  // "Add & call next": the number just added goes to the front.
  if (preferSubmission) {
    const i = queue.findIndex((c) => c.submission_id && String(c.submission_id) === String(preferSubmission));
    if (i > 0) queue = [queue[i], ...queue.slice(0, i), ...queue.slice(i + 1)];
  }
  const extra = fellBackFrom ? { task_key: task.key, fell_back_from: { key: fellBackFrom.key, name: fellBackFrom.name } } : { task_key: task.key };
  for (const c of queue) {
    const variant = variantFor(task, c, c.history);
    const row = (await rows(
      `INSERT INTO call_attempts (session_id, person_key, task_key, phone, phone_key, full_name, source_kind, source_label, reason, script_variant, prospect_id, list_number_id, agent_id, shown_at, actor_account, actor_user_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, actor_account, actor_user_id FROM call_sessions WHERE id = $1
       ON CONFLICT (phone_key) WHERE status IN ('shown', 'calling') DO NOTHING RETURNING *`,
      [sessionId, s.person_key, task.key, canonicalUgPhone(c.phone), c.phone_key, c.full_name || null, c.source_kind, c.source_label || null, c.reason || null, variant, c.prospect_id || null, c.list_number_id || null, c.agent_id || null, now]
    ))[0];
    if (row) return { ...present(row, task, await historyFor(row.phone_key), { callerName, hello: await helloFor(row.phone_key), bestTime: await bestTimeFor(row.phone_key) }), resumed: false, left: queue.length - 1, ...extra };
  }
  return { attempt: null, left: 0, empty_message: emptyMessage(task), all_empty: fallback, ...extra };
}

function emptyMessage(task) {
  if (task.queue_kind === 'new_agents') return 'No numbers left for this task. Ask your Companion for today\'s list, add your own numbers, or switch task.';
  if (task.queue_kind === 'payments') return 'Nobody left to chase for payment right now. Switch task.';
  return 'No agents to check in with right now. Switch task.';
}

async function attemptInSession(attemptId, sessionId) {
  const a = (await rows('SELECT * FROM call_attempts WHERE id = $1', [attemptId]))[0];
  if (!a) throw httpError(404, 'Call not found.');
  if (String(a.session_id) !== String(sessionId)) throw httpError(403, 'That call belongs to another session.');
  await openSession(sessionId);
  return a;
}

/**
 * Offline support. The screen logs a tap, end or wrap-up with the time it
 * happened on the phone and an op id, and replays it when the connection is
 * back. The time is trusted only inside [shown_at, now]; an op id already
 * applied returns the row unchanged, so a retry never counts twice.
 */
function clientTime(at, a, now = new Date()) {
  if (!at) return now;
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return now;
  const floor = new Date(a.tapped_at || a.shown_at).getTime();
  return new Date(Math.min(now.getTime(), Math.max(floor, t.getTime())));
}
function cleanOp(op) {
  const v = String(op || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : '';
}
async function alreadyApplied(attemptId, op) {
  if (!op) return null;
  return (await rows('SELECT * FROM call_attempts WHERE id = $1 AND $2 = ANY(client_ops)', [attemptId, op]))[0] || null;
}

async function tap(attemptId, { sessionId, now = new Date(), at = null, op = '', check = null } = {}) {
  const opId = cleanOp(op);
  const done = await alreadyApplied(attemptId, opId);
  if (done) return maskedAttempt(done);
  if (!notesCheckOk(check, now)) {
    const err = httpError(428, 'Do the mic and live-notes check first (and reconnect the phone if it dropped). If this keeps showing, reload the page.');
    err.code = 'notes_check_required';
    throw err;
  }
  const a = await attemptInSession(attemptId, sessionId);
  if (!['shown', 'calling'].includes(a.status)) throw httpError(409, 'This call is already finished.');
  const when = clientTime(at, a, now);
  const out = (await rows(
    `UPDATE call_attempts SET tapped_at = COALESCE(tapped_at, $2), tap_count = tap_count + 1, status = 'calling', ended_at = NULL,
        client_ops = CASE WHEN $3 = '' THEN client_ops ELSE array_append(client_ops, $3) END
      WHERE id = $1 RETURNING *`,
    [attemptId, when, opId]
  ))[0];
  return maskedAttempt(out);
}

async function endCall(attemptId, { sessionId, now = new Date(), at = null, op = '' } = {}) {
  const opId = cleanOp(op);
  const done = await alreadyApplied(attemptId, opId);
  if (done) return maskedAttempt(done);
  const a = await attemptInSession(attemptId, sessionId);
  if (a.status !== 'calling') throw httpError(409, 'Tap to call first.');
  const when = clientTime(at, a, now);
  const out = (await rows(
    `UPDATE call_attempts SET ended_at = COALESCE(ended_at, $2), talk_s = EXTRACT(EPOCH FROM (COALESCE(ended_at, $2) - tapped_at))::int,
        client_ops = CASE WHEN $3 = '' THEN client_ops ELSE array_append(client_ops, $3) END
      WHERE id = $1 RETURNING *`,
    [attemptId, when, opId]
  ))[0];
  return maskedAttempt(out);
}

function parseCallback(value, now = new Date()) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'Pick a valid date and time for the follow-up.');
  if (d.getTime() < now.getTime() - 5 * 60000) throw httpError(400, 'The follow-up must be in the future.'); // now = when the call was wrapped up
  if (d.getTime() > now.getTime() + 120 * 86400000) throw httpError(400, 'The follow-up must be within 120 days.');
  return d;
}

/** The call counts only here: an outcome, a note, and the follow-up when the outcome needs one. */
/** Keep only text from the live transcript; long digit runs become •••123. */
function cleanTranscript(t) {
  if (!t || typeof t !== 'object') return null;
  const mask = (v, n) => String(v || '').replace(/\d[\d\s-]{6,}\d/g, (m) => `•••${m.replace(/\D/g, '').slice(-3)}`).trim().slice(0, n);
  const text = mask(t.text, 8000);
  if (!text && !t.summary) return null;
  return {
    text, summary: mask(t.summary, 600), suggested_outcome: mask(t.suggested_outcome, 40), suggested_next_step: mask(t.suggested_next_step || t.next_step, 300),
    confirmed: t.confirmed === true, edited: t.edited === true, engine: 'chrome-web-speech', audio_kept: false, words: text ? text.split(/\s+/).length : 0
  };
}
/** A call "closes the loop" with a close, a final no, or a next step. */
function closesLoop(def = {}) { return Boolean(def.close || def.terminal); }

async function wrapUp(attemptId, { sessionId, outcome = '', note = '', callbackAt = '', checklist = {}, transcript = null, nextStep = '', now: serverNow = new Date(), at = null, op = '', contactName = '', phoneConfirmed = false } = {}) {
  const opId = cleanOp(op);
  const applied = await alreadyApplied(attemptId, opId);
  if (applied) return maskedAttempt(applied);
  const a = await attemptInSession(attemptId, sessionId);
  if (!['shown', 'calling'].includes(a.status)) throw httpError(409, 'This call is already wrapped up.');
  const now = clientTime(at, a, serverNow);
  const task = await loadTask(a.task_key).catch(async () => (await loadTasks({ all: true })).find((t) => t.key === a.task_key));
  const def = outcomeDef(task, outcome);
  if (!def) throw httpError(400, 'Pick what happened on the call.');
  // No outcome without the Call tap (Arthur, 22 Nov 2026). Only "wrong number" can be logged without dialling.
  if (!a.tapped_at && !rules.NO_DIAL_OK.has(def.key)) throw httpError(409, 'Tap Call first. An outcome can only be saved after you rang the number.');
  // A note is needed when they spoke; for no answer / wrong number the outcome is the note.
  let text = String(note || '').trim().slice(0, 1000);
  if (text.length < 3 && !def.spoke) text = def.label || def.key.replace(/_/g, ' ');
  if (text.length < 3) throw httpError(400, 'Write a short note about the call (or tap one of the quick notes).');
  let cb = parseCallback(callbackAt, now);
  if (rules.INTERESTED_OUTCOMES.includes(def.key) && !cb) throw httpError(400, 'Interested: pick the follow-up date and time.');
  // Interested on a new-agents call (Arthur, 22 Nov 2026): the name they want shown and the number, checked with them.
  const newAgentInterested = def.key === 'interested' && task.key === 'new_agents';
  const shownName = newAgentInterested ? followThrough.cleanShownName(contactName) : '';
  if (newAgentInterested && !shownName) throw httpError(400, 'Interested: type their name as they want it shown.');
  if (newAgentInterested && phoneConfirmed !== true) throw httpError(400, 'Interested: read the number back to them and tick that it is right.');
  if (def.key === rules.SEEKER_OUTCOME.key) {
    const texted = (await rows(`SELECT 1 FROM call_sms_log WHERE attempt_id = $1 AND template = 'first_seeker' LIMIT 1`, [a.id]))[0];
    if (!texted) throw httpError(400, 'Seeker: fill in what they are looking for and open the text first (Script → Looking for a place).');
  }
  if (def.date === 'required' && !cb) throw httpError(400, 'Pick the date and time to call back.');
  // Call backs are at least 24 hours away (Arthur, 16 Nov 2026). Ten minutes of slack for slow saves.
  if (cb && cb.getTime() < now.getTime() + CALLBACK_MIN_HOURS * 3600000 - 10 * 60000) throw httpError(400, `Call backs are at least ${CALLBACK_MIN_HOURS} hours away. Pick tomorrow or later.`);
  // Every call ends with a close, a final no, or a next step.
  let next = String(nextStep || '').trim().slice(0, 300);
  // An open follow-up that did not answer comes back by itself: next day, then every 2 days.
  if (def.key === 'no_answer' && !cb) {
    const earlier = await rows(
      `SELECT outcome FROM call_attempts WHERE phone_key = $1 AND id <> $2 AND status = 'done' ORDER BY COALESCE(wrapped_at, shown_at) DESC LIMIT 12`, [a.phone_key, a.id]);
    const auto = rules.autoRetryAt(earlier, now);
    if (auto) { cb = auto; if (!next) next = 'Follow-up: no answer, try again'; }
  }
  if (!next && def.key === 'no_answer') next = 'Try again next working day';
  if (!next && cb) next = 'Call back';
  if (!next && !closesLoop(def)) throw httpError(400, 'Pick the next step (call back, chase payment, send the film…).');
  const tx = cleanTranscript(transcript);
  const ticks = {};
  for (const step of Array.isArray(task.checklist) ? task.checklist : []) ticks[step.key] = Boolean(checklist && checklist[step.key]);
  // Coach answers are kept with the call too: did they answer, did they agree to WhatsApp "hi".
  for (const extra of ['answered', 'wa_hi', 'asked_hello', 'recorded']) if (checklist && Object.prototype.hasOwnProperty.call(checklist, extra)) ticks[extra] = checklist[extra] === true ? true : (checklist[extra] === false ? false : String(checklist[extra]).slice(0, 20));
  // Steps are only enforced for a close; every other outcome is one tap + a quick note.
  if (def.close) {
    const missing = (task.checklist || []).filter((s) => s.required && !ticks[s.key]).map((s) => s.label);
    if (missing.length) throw httpError(400, `Tick the required steps first: ${missing.join('; ')}.`);
  }
  if (def.close) {
    const closeChecks = scripts.CLOSE_CHECKS[task.key] || [];
    const missingClose = closeChecks.filter((_label, i) => !(checklist && checklist[`close_${i}`]));
    if (missingClose.length) throw httpError(400, `Before marking a close, tick every key thing: ${missingClose.join('; ')}.`);
    closeChecks.forEach((_label, i) => { ticks[`close_${i}`] = true; });
  }
  const prev = (await rows(
    `SELECT tapped_at, wrapped_at FROM call_attempts WHERE person_key = $1 AND id <> $2 AND status = 'done' AND wrapped_at <= $3 ORDER BY wrapped_at DESC LIMIT 1`,
    [a.person_key, a.id, now]
  ))[0];
  const prevTap = (await rows(
    `SELECT tapped_at FROM call_attempts WHERE person_key = $1 AND id <> $2 AND tapped_at IS NOT NULL AND tapped_at <= COALESCE($3::timestamptz, $4::timestamptz) ORDER BY tapped_at DESC LIMIT 1`,
    [a.person_key, a.id, a.tapped_at, now]
  ))[0];
  const ended = a.ended_at || (a.tapped_at ? null : null);
  const record = { tapped_at: a.tapped_at, ended_at: ended, wrapped_at: now, callback_at: cb };
  const flags = flagsFor(record, def, prevTap?.tapped_at || null, tx);
  if (!a.tapped_at) flags.push('no_dial');
  const talk = a.tapped_at ? seconds(a.tapped_at, a.ended_at || now) : null;
  const wrapS = seconds(a.ended_at || a.tapped_at || a.shown_at, now);
  const gapS = prev?.wrapped_at && a.tapped_at && kampalaDay(prev.wrapped_at) === kampalaDay(a.tapped_at) ? seconds(prev.wrapped_at, a.tapped_at) : null;
  const out = (await rows(
    `UPDATE call_attempts SET status = 'done', wrapped_at = $2, outcome = $3, spoke = $4, is_close = $5, note = $6, callback_at = $7,
        checklist = $8::jsonb, flags = $9::text[], talk_s = $10, wrapup_s = $11, gap_s = $12,
        client_ops = CASE WHEN $13 = '' THEN client_ops ELSE array_append(client_ops, $13) END,
        next_step = NULLIF($14, ''), transcript = $15::jsonb
      WHERE id = $1 AND status IN ('shown', 'calling') RETURNING *`,
    [a.id, now, def.key, Boolean(def.spoke), Boolean(def.close) && PAID_OUTCOMES.has(def.key), text, cb, JSON.stringify(ticks), flags, talk, wrapS, gapS, opId, next, tx ? JSON.stringify(tx) : null]
  ))[0];
  if (!out) throw httpError(409, 'This call is already wrapped up.');
  await mirrorToProspect(out, def).catch(() => null);
  let profile = null;
  // Their pending agent profile under that name. A practice login never opens one for a real number.
  if (shownName && (sandbox.isTestKey(out.phone_key) || !(await sandbox.isSandbox(out.person_key)))) {
    profile = await followThrough.provisionInterested(out, { name: shownName }).catch((e) => { console.warn('Interested profile not opened:', e.message); return null; });
  }
  // A practice login never writes the real do-not-contact list (its own test phones are real numbers).
  if (def.key === 'do_not_contact' && (sandbox.isTestKey(out.phone_key) || !(await sandbox.isSandbox(out.person_key)))) await blockNumber(out.phone_key, { by: out.person_key, reason: out.note || 'Asked not to be called', attemptId: out.id });
  if (profile) return { ...maskedAttempt(out), profile };
  return maskedAttempt(out);
}

/** Keep the Outreach tab in step: called, follow-up, do-not-contact on the prospect row. */
async function mirrorToProspect(a, def) {
  if (!a.prospect_id) return;
  const by = a.person_key;
  await db.query(
    `UPDATE agent_prospects SET called_at = COALESCE($2, called_at), called_by = CASE WHEN $2::timestamptz IS NULL THEN called_by ELSE $3 END,
        follow_up_at = COALESCE($4, follow_up_at), follow_up_note = CASE WHEN $4::timestamptz IS NULL THEN follow_up_note ELSE $5 END, follow_up_by = CASE WHEN $4::timestamptz IS NULL THEN follow_up_by ELSE $3 END,
        do_not_contact = CASE WHEN $6 THEN true ELSE do_not_contact END, do_not_contact_at = CASE WHEN $6 THEN NOW() ELSE do_not_contact_at END, do_not_contact_by = CASE WHEN $6 THEN $3 ELSE do_not_contact_by END,
        updated_at = NOW()
      WHERE id = $1`,
    [a.prospect_id, a.tapped_at, by, a.callback_at, a.note, def.key === 'do_not_contact']
  );
}

async function skip(attemptId, { sessionId, reason = '', reasonCode = '', note = '' } = {}) {
  const a = await attemptInSession(attemptId, sessionId);
  if (a.status !== 'shown') throw httpError(409, a.status === 'calling' ? 'You tapped to call, so pick an outcome instead.' : 'This number is already finished.');
  const code = String(reasonCode || '').trim();
  const known = SKIP_REASONS.find(([k]) => k === code);
  const extra = String(note || '').trim().slice(0, 180);
  let why = String(reason || '').trim().slice(0, 200);
  if (known) why = known[0] === 'other' ? (extra.length >= 3 ? `Other: ${extra}` : '') : (extra ? `${known[1]}: ${extra}` : known[1]);
  if (why.length < 3) throw httpError(400, code === 'other' ? 'Write why you are skipping.' : 'Pick why you are skipping this number.');
  const out = (await rows("UPDATE call_attempts SET status = 'skipped', skip_reason = $2, wrapped_at = NOW() WHERE id = $1 RETURNING *", [a.id, why]))[0];
  if (code === 'do_not_contact') await blockNumber(out.phone_key, { by: out.person_key, reason: why, attemptId: out.id });
  return maskedAttempt(out);
}

// ----------------------------------------------------- do not contact --

async function blockNumber(phoneKey, { by = '', reason = '', attemptId = null } = {}) {
  await db.query(
    `INSERT INTO call_blocks (phone_key, reason, blocked_by, attempt_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (phone_key) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, attempt_id = EXCLUDED.attempt_id, blocked_at = NOW(), removed_at = NULL, removed_by = NULL, removed_note = NULL
       WHERE call_blocks.removed_at IS NOT NULL`, [phoneKey, String(reason).slice(0, 200), cleanKey(by) || 'staff', attemptId]);
  // Anything still waiting for this number goes too.
  await db.query("UPDATE call_attempts SET status = 'released' WHERE phone_key = $1 AND status = 'shown'", [phoneKey]);
}
async function blockOf(phoneKey) {
  return (await safeRows('SELECT reason, blocked_by, blocked_at FROM call_blocks WHERE phone_key = $1 AND removed_at IS NULL', [phoneKey]))[0] || null;
}
/** King only. */
async function unblockNumber(phoneKey, { actor = '', note = '' } = {}) {
  const r = (await rows("UPDATE call_blocks SET removed_at = NOW(), removed_by = $2, removed_note = $3 WHERE phone_key = $1 AND removed_at IS NULL RETURNING phone_key", [phoneKey, String(actor).slice(0, 80), String(note).slice(0, 200)]))[0];
  if (!r) throw httpError(404, 'That number is not blocked.');
  await db.query('UPDATE agent_prospects SET do_not_contact = false WHERE phone_key = $1', [phoneKey]).catch(() => null);
  return { phone_key: phoneKey, unblocked: true };
}
async function listBlocks() {
  const list = await rows('SELECT b.*, (SELECT full_name FROM call_attempts a WHERE a.phone_key = b.phone_key AND full_name IS NOT NULL ORDER BY shown_at DESC LIMIT 1) AS name FROM call_blocks b WHERE removed_at IS NULL ORDER BY blocked_at DESC LIMIT 300');
  return list.map((b) => ({ phone_key: b.phone_key, phone: `•••${b.phone_key.slice(-3)}`, name: b.name || '', reason: b.reason, by: b.blocked_by, at: b.blocked_at }));
}

// ----------------------------------------------------- incoming calls --

/**
 * They rang us and Ronald answered on the laptop (Phone Link). He taps
 * "Incoming call" and types the number: it goes on screen as a live call
 * (direction inbound) and ends in the same wrap-up.
 */
async function startInbound(sessionId, { phone = '', fromAttempt = '', name = '', now = new Date() } = {}) {
  const s = await openSession(sessionId);
  if (fromAttempt) phone = (await rows('SELECT phone FROM call_attempts WHERE id::text = $1', [String(fromAttempt)]))[0]?.phone || phone;
  const canonical = canonicalUgPhone(phone);
  const key = phoneKey9(canonical);
  if (!key || !/^\+256\d{9}$/.test(canonical)) throw httpError(400, 'Type the number that is calling, like 0772 123 456.');
  if (await sandbox.isSandbox(s.person_key) && !sandbox.isTestKey(key)
    && !(await safeRows("SELECT 1 FROM call_number_submissions WHERE person_key = $1 AND phone_key = $2 AND status = 'practice' LIMIT 1", [s.person_key, key])).length) throw httpError(409, 'Practice account (TEST): use a TEST practice number, e.g. 0700 000 101. Real numbers are never used from practice.');
  if (!(await sandbox.isSandbox(s.person_key)) && sandbox.isTestKey(key)) throw httpError(400, 'That is a TEST practice number, not a real caller.');
  const busy = (await rows("SELECT id FROM call_attempts WHERE session_id = $1 AND status = 'calling'", [sessionId]))[0];
  if (busy) throw httpError(409, 'Finish the wrap-up for this call first.');
  await db.query("UPDATE call_attempts SET status = 'released' WHERE (session_id = $1 OR phone_key = $2) AND status = 'shown'", [sessionId, key]);
  const task = await loadTask(s.task_key);
  const prev = (await safeRows('SELECT full_name FROM call_attempts WHERE phone_key = $1 AND full_name IS NOT NULL ORDER BY shown_at DESC LIMIT 1', [key]))[0];
  const block = await blockOf(key);
  const row = (await rows(
    `INSERT INTO call_attempts (session_id, person_key, task_key, phone, phone_key, full_name, source_kind, source_label, reason, script_variant, shown_at, tapped_at, status, direction, actor_account, actor_user_id)
     SELECT $1, $2, $3, $4, $5, $6, 'inbound', $7, $8, $9, $10, $10, 'calling', 'inbound', actor_account, actor_user_id FROM call_sessions WHERE id = $1
     ON CONFLICT (phone_key) WHERE status IN ('shown', 'calling') DO NOTHING RETURNING *`,
    [sessionId, s.person_key, task.key, canonical, key, String(name || '').trim().slice(0, 120) || prev?.full_name || null, 'Incoming call (they rang us)',
      block ? `On the do-not-contact list: ${block.reason || ''}` : null, (task.script_variants || [])[0] || 'cold_call', now]
  ))[0];
  if (!row) throw httpError(409, 'A colleague has this number on a call right now.');
  return { attempt_id: row.id, blocked: Boolean(block) };
}

// ------------------------------------------------------------- search --

const TXT = (a) => [a.full_name, a.note, a.next_step, a.outcome, a.skip_reason, a.source_label, a.transcript && a.transcript.summary, a.transcript && a.transcript.text].filter(Boolean).join(' ');
/** Search calls by words in notes, summaries, names, outcomes, or the last digits of the phone. Phones come back masked. */
async function searchCalls(qText = '', { personKey = '', limit = 40 } = {}) {
  const raw = String(qText || '').trim().slice(0, 80);
  if (raw.length < 2) return { q: raw, results: [] };
  const digits = raw.replace(/\D/g, '');
  const words = raw.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
  const like = words.map((w) => `%${w.replace(/[%_]/g, '')}%`);
  const list = await rows(
    `SELECT id, person_key, task_key, direction, phone_key, full_name, status, outcome, note, next_step, skip_reason, source_label, transcript, callback_at, COALESCE(wrapped_at, tapped_at, shown_at) AS at
       FROM call_attempts
      WHERE status IN ('done', 'skipped') AND ($3 = '' OR person_key = $3) AND ($3 <> '' OR ${sandbox.REAL_PEOPLE()})
        AND ((LENGTH($2) >= 3 AND phone_key LIKE '%' || $2 || '%')
          OR (SELECT bool_and(LOWER(CONCAT_WS(' ', full_name, note, next_step, outcome, skip_reason, source_label, transcript->>'summary', transcript->>'text')) LIKE w) FROM unnest($1::text[]) AS w))
      ORDER BY COALESCE(wrapped_at, tapped_at, shown_at) DESC LIMIT $4`, [like.length ? like : ['%%'], digits, cleanKey(personKey), limit]);
  return {
    q: raw,
    results: list.map((a) => {
      const text = TXT(a); const lw = text.toLowerCase(); const w = words.find((x) => lw.includes(x));
      const i = w ? lw.indexOf(w) : 0;
      return { id: a.id, at: a.at, by: a.person_key, task: a.task_key, direction: a.direction, phone: `•••${a.phone_key.slice(-3)}`, name: a.full_name || '', outcome: a.status === 'skipped' ? 'skipped' : a.outcome,
        next_step: a.next_step || '', summary: (a.transcript && a.transcript.summary) || a.note || a.skip_reason || '', snippet: text.slice(Math.max(0, i - 40), i + 100).replace(/\d[\d\s-]{6,}\d/g, '•••'), callback_at: a.callback_at };
    })
  };
}

/** King: what was discussed, closed, still open, and the next steps, for a day / week / month. */
async function callsSummary({ from, to } = {}) {
  const start = `${from}T00:00:00+03:00`; const end = `${addDays(to, 1)}T00:00:00+03:00`;
  const list = await rows(
    `SELECT id, person_key, task_key, direction, phone_key, full_name, status, outcome, is_close, flags, note, next_step, callback_at, transcript, talk_s, COALESCE(wrapped_at, tapped_at, shown_at) AS at
       FROM call_attempts WHERE status IN ('done', 'skipped') AND COALESCE(tapped_at, shown_at) >= $1 AND COALESCE(tapped_at, shown_at) < $2 AND ${sandbox.REAL_PEOPLE()} ORDER BY at`, [start, end]);
  const misses = list.filter(isNoAnswer);
  const done = list.filter(countsAsCall);
  // Phone link / audio drops and failed mic checks the screen reported, per caller.
  const drops = (await rows(
    `SELECT s.person_key, e.kind, e.detail, e.at FROM call_session_events e JOIN call_sessions s ON s.id = e.session_id
      WHERE e.kind IN ('link_drop', 'notes_check_failed') AND e.at >= $1 AND e.at < $2 ORDER BY e.at`, [start, end]).catch(() => []))
    .map((e) => ({ by: e.person_key, kind: e.kind, detail: e.detail || '', at: e.at }));
  const by = {}; const outcomes = {};
  for (const a of misses) {
    const p = by[a.person_key] || (by[a.person_key] = { calls: 0, not_answered: 0, outbound: 0, inbound: 0, closes: 0, talk_s: 0 });
    p.not_answered += 1; outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1;
  }
  for (const a of done) {
    const p = by[a.person_key] || (by[a.person_key] = { calls: 0, not_answered: 0, outbound: 0, inbound: 0, closes: 0, talk_s: 0 });
    p.calls += 1; p[a.direction === 'inbound' ? 'inbound' : 'outbound'] += 1; if (closedPaid(a)) p.closes += 1; p.talk_s += Number(a.talk_s || 0);
    outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1;
  }
  // Screen hidden / switched away (visibilitychange), per caller, so King sees it next to the calls.
  for (const w of await rows(`SELECT person_key, SUM(away_ms)::bigint AS away_ms, SUM(oncall_hidden_ms)::bigint AS oncall_ms, SUM(exit_count)::int AS exits
      FROM call_sessions WHERE started_at >= $1 AND started_at < $2 GROUP BY person_key`, [start, end]).catch(() => [])) {
    const p = by[w.person_key]; if (!p) continue;
    p.away_s = Math.round(Number(w.away_ms || 0) / 1000); p.away_on_call_s = Math.round(Number(w.oncall_ms || 0) / 1000); p.exits = Number(w.exits || 0);
  }
  const item = (a) => ({ at: a.at, by: a.person_key, direction: a.direction, name: a.full_name || '', phone: `•••${a.phone_key.slice(-3)}`, outcome: a.outcome, summary: (a.transcript && a.transcript.summary) || a.note || '', next_step: a.next_step || '', callback_at: a.callback_at });
  const finalNo = new Set(['rejected', 'do_not_contact', 'wrong_number', 'not_renewing']);
  // A number is "open" if its latest call this period set a next step that isn't a close or a final no.
  const latest = new Map(); for (const a of done) latest.set(a.phone_key, a);
  return {
    from, to, calls: done.length, not_answered: misses.length, outbound: done.filter((a) => a.direction !== 'inbound').length, inbound: done.filter((a) => a.direction === 'inbound').length,
    skipped: list.length - done.length - misses.length, outcomes, by_person: by,
    discussed: done.filter((a) => (a.transcript && a.transcript.summary) || (a.note && a.note.length > 12)).slice(-40).reverse().map(item),
    closed: done.filter(closedPaid).reverse().map(item),
    no_transcript: done.filter((a) => (a.flags || []).includes('no_transcript')).reverse().map(item),
    link_drops: drops,
    open: [...latest.values()].filter((a) => !a.is_close && !finalNo.has(a.outcome)).sort((x, y) => new Date(x.callback_at || '2999-01-01') - new Date(y.callback_at || '2999-01-01')).slice(0, 60).map(item),
    no_next_step: done.filter((a) => !a.is_close && !finalNo.has(a.outcome) && !a.next_step && !a.callback_at).map(item)
  };
}

// ------------------------------------------------------ add your own number --

const HOW_KNOWN = ['Friend or referral', 'Saw their listing', 'Sign board', 'Social media', 'Met them', 'Other'];

/**
 * A caller adds a number they found. Checked against everything we have by
 * phone_key (agents, Outreach, lists, leads, listings, calls, other callers'
 * own numbers). Already known: nothing is added and the history is shown.
 * New: it goes straight into this caller's queue, tagged "own number".
 * Commission is unchanged: it still only follows the normal rules (a
 * confirmed payment, on a number nobody else had).
 */
async function submitNumber({ personKey, name = '', phone = '', note = '', howKnown = '', mode = 'new_agents', addedBy = '' } = {}) {
  const callers = await loadCallers();
  const person = callers.find((p) => p.key === cleanKey(personKey));
  if (!person) throw httpError(400, 'Pick who is adding the number.');
  const canonical = canonicalUgPhone(phone);
  const key = phoneKey9(canonical);
  if (person.sandbox) return addPracticeNumber(person, { canonical, key, name, note, mode });
  if (!isUgandanPhone(phone) && /^\+\d{10,15}$/.test(canonical)) throw httpError(400, 'International number: WhatsApp only. Calls go to Ugandan numbers only, so it is not added to a calling queue.');
  if (!/^\+2567\d{8}$/.test(canonical)) throw httpError(400, 'Type a Uganda mobile number, like 0772 123 456.');
  const fullName = String(name || '').trim().slice(0, 120);
  const tasks = await loadTasks({ all: true });
  const modeKey = tasks.some((t) => t.key === mode) ? mode : 'new_agents';
  const how = String(howKnown || '').trim().slice(0, 80);
  const one = async (sql) => (await safeRows(sql, [key])).length > 0;
  const checks = [
    ['an agent already', async () => (await agentKeys([key])).has(key)],
    ['already called', () => one("SELECT 1 FROM call_attempts WHERE phone_key = $1 AND status IN ('done', 'shown', 'calling', 'skipped') LIMIT 1")],
    ['someone\'s own number already', () => one("SELECT 1 FROM call_number_submissions WHERE phone_key = $1 AND status IN ('own', 'pending') LIMIT 1")],
    ['on Outreach already', () => one('SELECT 1 FROM agent_prospects WHERE phone_key = $1 LIMIT 1')],
    ['on the Companion\'s list already', () => one('SELECT 1 FROM outreach_list_numbers WHERE phone_key = $1 AND accepted IS TRUE LIMIT 1')],
    ['a lead already', () => one("SELECT 1 FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, c.whatsapp, l.metadata->>'phone', ''), '[^0-9]', '', 'g'), 9) = $1 LIMIT 1")],
    ['a lister already', () => one("SELECT 1 FROM properties WHERE RIGHT(REGEXP_REPLACE(COALESCE(lister_phone, ''), '[^0-9]', '', 'g'), 9) = $1 LIMIT 1")]
  ];
  checks.unshift(['on the do-not-contact list', async () => Boolean(await blockOf(key))]);
  let duplicate = '';
  for (const [label, fn] of checks) { if (await fn()) { duplicate = label; break; } }
  const row = (await rows(
    `INSERT INTO call_number_submissions (person_key, full_name, phone, phone_key, note, status, duplicate_of, added_by, mode, how_known)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING RETURNING *`,
    [person.key, fullName || null, canonical, key, String(note || '').trim().slice(0, 300) || null, duplicate ? 'duplicate' : 'own', duplicate || null, String(addedBy).slice(0, 120), modeKey, how || null]
  ))[0];
  if (!row && !duplicate) duplicate = 'someone\'s own number already';
  if (duplicate) {
    // Show what we know instead (masked: the caller sees who, when and what, not the number).
    const hist = (await attemptsFor([key])).get(key) || [];
    const owner = (await safeRows("SELECT person_key, added_at FROM call_number_submissions WHERE phone_key = $1 AND status = 'own' LIMIT 1", [key]))[0] || null;
    return {
      status: 'exists', duplicate_of: duplicate, phone: maskPhoneLast3(canonical), name: fullName,
      owner: owner ? { person_key: owner.person_key, added_at: owner.added_at } : null,
      history: hist.slice(0, 8).map((h) => ({ at: h.wrapped_at || h.shown_at, by: h.person_key, task: h.task_key, outcome: h.status === 'skipped' ? 'skipped' : (h.outcome || h.status), note: h.note || '', callback_at: h.callback_at || null }))
    };
  }
  return { id: row.id, status: 'own', mode: modeKey, phone: maskPhoneLast3(canonical), name: fullName };
}

/**
 * Practice login only: a real number of the tester's own (theirs or a friend's)
 * so the Call button really rings through the phone. It only goes into the
 * practice queue (status 'practice'), never onto a real list, and a number we
 * already know (agent, Outreach, list, lead, lister, do-not-contact, a real
 * caller's own number) is refused, so practice calls never touch a customer.
 * Texts, WhatsApp, payments and videos stay blocked for the practice login.
 */
async function addPracticeNumber(person, { canonical, key, name = '', note = '', mode = 'new_agents' } = {}) {
  if (sandbox.isTestKey(key)) throw httpError(400, 'That is one of the TEST practice numbers already in your queue. Add a real phone of your own to test a real call.');
  const digits = String(canonical || '').replace(/\D/g, '');
  if (key.length !== 9 || digits.length < 9 || digits.length > 15) throw httpError(400, 'Type a phone number, like 0772 123 456 or +44 7700 900123.');
  const one = async (sql) => (await safeRows(sql, [key])).length > 0;
  const known = [
    ['on the do-not-contact list', async () => Boolean(await blockOf(key))],
    ['an agent', async () => (await agentKeys([key])).has(key)],
    ['on Outreach', () => one('SELECT 1 FROM agent_prospects WHERE phone_key = $1 LIMIT 1')],
    ['on a call list', () => one('SELECT 1 FROM outreach_list_numbers WHERE phone_key = $1 AND accepted IS TRUE LIMIT 1')],
    ['a lead', () => one("SELECT 1 FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, c.whatsapp, l.metadata->>'phone', ''), '[^0-9]', '', 'g'), 9) = $1 LIMIT 1")],
    ['a lister', () => one("SELECT 1 FROM properties WHERE RIGHT(REGEXP_REPLACE(COALESCE(lister_phone, ''), '[^0-9]', '', 'g'), 9) = $1 LIMIT 1")],
    ['a real caller\'s number', () => one("SELECT 1 FROM call_number_submissions WHERE phone_key = $1 AND status IN ('own', 'pending') LIMIT 1")],
    ['called by a real caller', () => one(`SELECT 1 FROM call_attempts WHERE phone_key = $1 AND ${sandbox.REAL_PEOPLE()} LIMIT 1`)]
  ];
  for (const [label, fn] of known) {
    if (await fn()) throw httpError(409, `That number is ${label} already, so it is not used for practice. Add your own phone or a friend's.`);
  }
  const tasks = await loadTasks({ all: true });
  const modeKey = tasks.some((t) => t.key === mode) ? mode : 'new_agents';
  const have = (await safeRows("SELECT id FROM call_number_submissions WHERE person_key = $1 AND phone_key = $2 AND status = 'practice' LIMIT 1", [person.key, key]))[0];
  const fullName = String(name || '').trim().slice(0, 120) || 'My test phone';
  if (have) {
    await db.query('UPDATE call_number_submissions SET full_name = $2, mode = $3 WHERE id = $1', [have.id, fullName, modeKey]);
    return { id: have.id, status: 'own', practice: true, mode: modeKey, phone: maskPhoneLast3(canonical), name: fullName };
  }
  const row = (await rows(
    `INSERT INTO call_number_submissions (person_key, full_name, phone, phone_key, note, status, added_by, mode, how_known)
     VALUES ($1, $2, $3, $4, $5, 'practice', $6, $7, 'practice: real test phone') RETURNING id`,
    [person.key, fullName, canonical, key, String(note || '').trim().slice(0, 300) || null, person.name || person.key, modeKey]
  ))[0];
  return { id: row.id, status: 'own', practice: true, mode: modeKey, phone: maskPhoneLast3(canonical), name: fullName };
}

async function listSubmissions({ status = 'pending' } = {}) {
  const list = await rows(
    `SELECT * FROM call_number_submissions WHERE status <> 'practice' AND ($1 = 'all' OR status = $1 OR ($1 = 'pending' AND status = 'own' AND reviewed_at IS NULL AND added_at > NOW() - INTERVAL '7 days'))
      ORDER BY added_at DESC LIMIT 200`, [status]);
  return list.map((r) => ({ mode: r.mode || 'new_agents', how_known: r.how_known || '', id: r.id, person_key: r.person_key, name: r.full_name, phone: maskPhoneLast3(r.phone), note: r.note, status: r.status, duplicate_of: r.duplicate_of, added_at: r.added_at, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at }));
}

async function reviewSubmission(id, { decision = '', name, actor = '' } = {}) {
  const r = (await rows('SELECT * FROM call_number_submissions WHERE id = $1', [id]))[0];
  if (!r) throw httpError(404, 'Number not found.');
  if (r.status === 'own') {
    // Own numbers are already in the caller's queue; King can only take one out.
    if (decision === 'reject') { await db.query("UPDATE call_number_submissions SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1", [id, actor]); return { id, status: 'rejected' }; }
    await db.query('UPDATE call_number_submissions SET reviewed_by = $2, reviewed_at = NOW() WHERE id = $1', [id, actor]);
    return { id, status: 'own' };
  }
  if (r.status !== 'pending') throw httpError(409, 'This number has already been reviewed.');
  if (!['approve', 'reject'].includes(decision)) throw httpError(400, 'Approve or reject.');
  const fullName = name != null ? String(name).trim().slice(0, 120) : r.full_name;
  let listId = null;
  if (decision === 'approve') {
    const ins = (await rows(
      `INSERT INTO outreach_list_numbers (person_key, list_day, full_name, phone, phone_key, accepted, lead_source, added_by, added_by_person)
       VALUES ($1, $2::date, $3, $4, $5, true, 'staff_added', $6, $1)
       ON CONFLICT (phone_key) WHERE accepted IS TRUE DO NOTHING RETURNING id`,
      [r.person_key, kampalaDay(), fullName, r.phone, r.phone_key, String(actor).slice(0, 120)]
    ))[0];
    if (!ins) {
      await db.query("UPDATE call_number_submissions SET status = 'duplicate', duplicate_of = 'already on a call list', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1", [id, actor]);
      throw httpError(409, 'That number is already on someone\'s list.');
    }
    listId = ins.id;
  }
  await db.query('UPDATE call_number_submissions SET status = $2, full_name = $3, list_number_id = $4, reviewed_by = $5, reviewed_at = NOW() WHERE id = $1', [id, decision === 'approve' ? 'approved' : 'rejected', fullName, listId, actor]);
  return { id, status: decision === 'approve' ? 'approved' : 'rejected' };
}

// -------------------------------------------------------- stats and reports --

async function dayAttempts(personKey, day) {
  return rows(
    `SELECT * FROM call_attempts WHERE ($1::text IS NULL OR person_key = $1) AND ($1::text IS NOT NULL OR ${sandbox.REAL_PEOPLE()})
        AND (COALESCE(tapped_at, shown_at) AT TIME ZONE '${TZ}')::date = $2::date ORDER BY shown_at`,
    [personKey, day]
  );
}

async function daySessions(personKey, day) {
  return rows(
    `SELECT * FROM call_sessions WHERE ($1::text IS NULL OR person_key = $1) AND ($1::text IS NOT NULL OR ${sandbox.REAL_PEOPLE()}) AND (started_at AT TIME ZONE '${TZ}')::date = $2::date ORDER BY started_at`,
    [personKey, day]
  );
}

/**
 * Time on each task (ms), from the session events: 'start' and 'task_switch' name the task,
 * housekeeping_on/off mark housekeeping, breaks pause the clock. A session ends at ended_at,
 * or at its last heartbeat (or now, if the screen is still open).
 */
function taskTime(sessions = [], events = [], now = new Date()) {
  const out = {};
  const add = (k, ms) => { if (k && ms > 0) out[k] = (out[k] || 0) + ms; };
  for (const s of sessions) {
    const evs = events.filter((e) => String(e.session_id) === String(s.id)).sort((a, b) => new Date(a.at) - new Date(b.at));
    const fresh = !s.ended_at && now.getTime() - new Date(s.last_heartbeat_at).getTime() < DROPPED_AFTER_MS;
    const stop = new Date(s.ended_at || (fresh ? now : s.last_heartbeat_at || s.started_at)).getTime();
    let task = s.task_key; let base = task; let hk = false; let paused = false;
    let t = new Date(s.started_at).getTime();
    for (const e of evs) {
      const at = Math.min(new Date(e.at).getTime(), stop);
      const cur = hk ? 'housekeeping' : task;
      if (e.kind === 'start') { task = base = String(e.detail || task); continue; }
      if (!['task_switch', 'housekeeping_on', 'housekeeping_off', 'break_start', 'break_end'].includes(e.kind)) continue;
      if (!paused) add(cur, at - t);
      t = at;
      if (e.kind === 'task_switch') { task = base = String(e.detail || task).split(/\s/)[0]; hk = false; }
      else if (e.kind === 'housekeeping_on') hk = true;
      else if (e.kind === 'housekeeping_off') { hk = false; task = base; }
      else if (e.kind === 'break_start') paused = true;
      else if (e.kind === 'break_end') paused = false;
    }
    if (!paused) add(hk ? 'housekeeping' : task, stop - t);
  }
  return out;
}

async function dayTaskTime(sessions = [], now = new Date()) {
  if (!sessions.length) return {};
  const events = await rows("SELECT session_id, kind, detail, at FROM call_session_events WHERE session_id = ANY($1::uuid[]) AND kind IN ('start', 'task_switch', 'housekeeping_on', 'housekeeping_off', 'break_start', 'break_end') ORDER BY at", [sessions.map((x) => x.id)]);
  return taskTime(sessions, events, now);
}

function sessionTotals(sessions = [], now = new Date()) {
  const t = { sessions: sessions.length, open_ms: 0, focus_ms: 0, away_ms: 0, break_ms: 0, oncall_hidden_ms: 0, exits: 0, breaks: 0, first_start: null, last_end: null };
  for (const s of sessions) {
    t.open_ms += Number(s.open_ms) || 0; t.focus_ms += Number(s.focus_ms) || 0; t.away_ms += Number(s.away_ms) || 0;
    t.break_ms += Number(s.break_ms) || 0; t.oncall_hidden_ms += Number(s.oncall_hidden_ms) || 0;
    t.exits += Number(s.exit_count) || 0; t.breaks += Number(s.break_count) || 0;
    if (!t.first_start || s.started_at < t.first_start) t.first_start = s.started_at;
    const end = s.ended_at || s.last_heartbeat_at;
    if (!t.last_end || end > t.last_end) t.last_end = end;
  }
  t.open_now = sessions.some((s) => !s.ended_at && now.getTime() - new Date(s.last_heartbeat_at).getTime() < DROPPED_AFTER_MS);
  return t;
}

async function callsByDay(personKey, fromDay, toDay) {
  const list = await rows(
    `SELECT (wrapped_at AT TIME ZONE '${TZ}')::date::text AS day, COUNT(*)::int AS n FROM call_attempts
      WHERE person_key = $1 AND ${COUNTED_SQL()} AND (wrapped_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date GROUP BY 1`,
    [personKey, fromDay, toDay]
  );
  return Object.fromEntries(list.map((r) => [r.day, r.n]));
}

async function roadTo1000() {
  const campaign = await perf.loadCampaign();
  const today = kampalaDay();
  const paying = await perf.payingAgents(today, campaign.starts_on);
  return { goal: Number(campaign.goal_paying_agents || 1000), paying_now: paying.now, percent: Math.min(100, Math.round((paying.now / Number(campaign.goal_paying_agents || 1000)) * 1000) / 10), ends_on: campaign.ends_on };
}

async function leaderboard(day) {
  const list = await rows(
    `SELECT person_key, COUNT(*) FILTER (WHERE ${COUNTED_SQL()})::int AS calls, COUNT(*) FILTER (WHERE status = 'done' AND outcome = '${NO_ANSWER}')::int AS not_answered, COUNT(*) FILTER (WHERE is_close AND outcome IN ('paid', 'renewed'))::int AS closes
       FROM call_attempts WHERE (COALESCE(tapped_at, shown_at) AT TIME ZONE '${TZ}')::date = $1::date AND ${sandbox.REAL_PEOPLE()} GROUP BY person_key ORDER BY closes DESC, calls DESC`,
    [day]
  );
  const callers = await loadCallers();
  return list.map((r) => ({ person_key: r.person_key, name: callers.find((p) => p.key === r.person_key)?.name || r.person_key, calls: r.calls, not_answered: r.not_answered, closes: r.closes }));
}

async function callbacksDue(personKey, now = new Date()) {
  const list = await rows(
    `SELECT DISTINCT ON (phone_key) phone_key, phone, full_name, callback_at, outcome, task_key, person_key FROM call_attempts
      WHERE status = 'done' AND callback_at IS NOT NULL AND (person_key = $1 OR ${sandbox.REAL_PEOPLE()}) ORDER BY phone_key, wrapped_at DESC`, [cleanKey(personKey || '')]
  );
  const later = await rows("SELECT phone_key, MAX(COALESCE(wrapped_at, shown_at)) AS at FROM call_attempts WHERE status IN ('shown','calling') GROUP BY phone_key");
  const busy = new Set(later.map((r) => r.phone_key));
  const today = kampalaDay(now);
  return list
    .filter((c) => (!personKey || c.person_key === personKey) && !busy.has(c.phone_key))
    .map((c) => ({ phone: maskPhoneLast3(c.phone), name: c.full_name, at: c.callback_at, task_key: c.task_key, outcome: c.outcome, person_key: c.person_key, due_now: new Date(c.callback_at).getTime() <= now.getTime() + CALLBACK_EARLY_MIN * 60000, overdue_days: Math.max(0, perf.daysBetween(kampalaDay(c.callback_at), today)) }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

async function stats(personKey, { now = new Date(), sessionId = null } = {}) {
  const key = cleanKey(personKey);
  const day = kampalaDay(now);
  const tasks = await loadTasks({ all: true });
  const [attempts, targets, byDay, board, road, cbs] = await Promise.all([
    dayAttempts(key, day), targetsFor(key, day), callsByDay(key, addDays(day, -30), day), leaderboard(day), roadTo1000(), callbacksDue(key, now)
  ]);
  const sum = summarize(attempts, tasks);
  const taskMs = await dayTaskTime(await daySessions(key, day), now);
  let left = null;
  if (sessionId) {
    const s = (await rows('SELECT task_key FROM call_sessions WHERE id = $1', [sessionId]))[0];
    const task = s && tasks.find((t) => t.key === s.task_key);
    if (task) left = (await eligibleQueue(task, key, { now, tasks, limit: 300 })).length;
  }
  return {
    person_key: key,
    day,
    targets,
    calls: sum.calls,
    not_answered: sum.not_answered,
    closes: sum.closes,
    connected: sum.connected,
    talk_s: sum.talk_s,
    calls_left_to_target: Math.max(0, targets.calls_per_day - sum.calls),
    calls_hit: sum.calls >= targets.calls_per_day,
    closes_hit: sum.closes >= targets.closes_per_day,
    queue_left: left,
    by_task: sum.by_task,
    task_ms: taskMs,
    flagged_calls: sum.flagged_calls,
    streak_days: streakDays(byDay, day, targets.calls_per_day),
    next_milestone: nextMilestone(sum.calls, sum.closes, targets),
    this_hour: sum.by_hour[Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(now)) % 24] || 0,
    callbacks_due_now: cbs.filter((c) => c.due_now).length,
    skipped: sum.skipped,
    by_hour: sum.by_hour,
    money: await moneyToday(key, attempts),
    leaderboard: board,
    road_to_1000: road
  };
}

/**
 * Commission today, as an estimate the caller can see. Earned: payments and
 * renewals closed today. At stake: sign-ups and payment promises still to pay.
 * Uses the person's commission rate; the real payout comes from the
 * Commission tab once payments are confirmed.
 */
const FEE_UGX = 50000;
async function moneyToday(personKey, attempts = []) {
  const callers = await loadCallers();
  const me = callers.find((c) => c.key === personKey) || {};
  const rate = Number(me.rate_pct || 0);
  const done = attempts.filter((a) => a.status === 'done');
  const paid = done.filter(closedPaid).length;
  const pending = done.filter((a) => a.outcome === 'signed_up' || a.outcome === 'promised').length;
  const per = Math.round(FEE_UGX * rate / 100);
  return { rate_pct: rate, on_commission: rate > 0, per_payment_ugx: per, earned_ugx: paid * per, at_stake_ugx: pending * per, payments_closed: paid, payments_pending: pending };
}

/** Numbers waiting in each mode for this person (for the mode switch). */
/** Fresh (never-called) new-agent numbers left for one caller, for the low-list warning. */
async function freshLeft(personKey, { now = new Date() } = {}) {
  const key = cleanKey(personKey);
  const tasks = await loadTasks({ all: true });
  const task = tasks.find((t) => t.queue_kind === 'new_agents' && t.active !== false);
  if (!key || !task) return { fresh: null, low: false, threshold: rules.LOW_LIST_AT };
  const q = await eligibleQueue(task, key, { now, tasks, limit: 400 });
  const fresh = q.filter((c) => c.kind === 'fresh').length;
  return { fresh, low: fresh < rules.LOW_LIST_AT, threshold: rules.LOW_LIST_AT };
}

async function queueCounts(personKey, { now = new Date() } = {}) {
  const key = cleanKey(personKey);
  const tasks = await loadTasks({ all: true });
  const active = tasks.filter((t) => t.active !== false);
  const out = {};
  for (const t of active) out[t.key] = (await eligibleQueue(t, key, { now, tasks, limit: 300 })).length;
  out.housekeeping = (await planner().housekeeping(key).catch(() => ({ items: [] }))).items.length;
  out.international = (await internationalNumbers({ personKey: key, limit: 300 })).length;
  return out;
}

const planner = () => require('./callingPlanner');

/**
 * International numbers sitting in the calling lists: kept out of every queue (callers ring
 * Ugandan numbers only) and listed here for WhatsApp follow-up. Nothing is deleted.
 */
async function internationalNumbers({ personKey = '', limit = 200, now = new Date() } = {}) {
  const tasks = (await loadTasks({ all: true })).filter((t) => t.active !== false);
  const people = personKey ? [cleanKey(personKey)] : (await loadCallers()).filter((p) => !p.sandbox).map((p) => p.key);
  const seen = new Map();
  for (const pk of people) {
    for (const t of tasks) {
      for (const c of await rawCandidates(t, pk, { today: kampalaDay(now), limit: 400 })) {
        if (isUgandanPhone(c.phone) || sandbox.isTestKey(c.phone_key)) continue;
        const k = String(c.phone || '').replace(/\D/g, '');
        if (!k || seen.has(k)) continue;
        seen.set(k, { name: maskName(c.full_name) || '', phone: `•••${k.slice(-3)}`, source: c.source_label || c.source_kind, task: t.key, person_key: pk, label: 'International – WhatsApp only' });
      }
    }
  }
  return [...seen.values()].slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));
}

async function feed(personKey, { now = new Date() } = {}) {
  const key = cleanKey(personKey);
  const items = [];
  for (const a of await safeRows("SELECT full_name, phone, created_at FROM agents WHERE created_at > $1::timestamptz - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 5", [now])) {
    items.push({ kind: 'signup', at: a.created_at, text: `New agent sign-up: ${maskName(a.full_name) || 'agent'} ${maskPhoneLast3(a.phone)}` });
  }
  for (const p of await safeRows(
    `SELECT r.amount_ugx, r.paid_at, a.full_name FROM revenue_entries r LEFT JOIN agents a ON a.id = r.agent_id
      WHERE r.direction = 'in' AND r.kind = 'agent_subscription' AND r.voided_at IS NULL AND r.paid_at > $1::timestamptz - INTERVAL '24 hours' ORDER BY r.paid_at DESC LIMIT 5`, [now])) {
    items.push({ kind: 'payment', at: p.paid_at, text: `Payment in: UGX ${Number(p.amount_ugx || 0).toLocaleString('en-UG')}${p.full_name ? ` from ${maskName(p.full_name)}` : ''}` });
  }
  for (const r of await safeRows("SELECT phone_key, created_at FROM outreach_events WHERE kind = 'replied' AND created_at > $1::timestamptz - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 5", [now])) {
    items.push({ kind: 'reply', at: r.created_at, text: `WhatsApp reply from •••${String(r.phone_key || '').slice(-3)}` });
  }
  const cbs = (await callbacksDue(key, now)).filter((c) => c.due_now);
  for (const c of cbs.slice(0, 5)) items.push({ kind: 'callback', at: c.at, text: `Callback due: ${c.name || 'contact'} ${c.phone}`, urgent: true });
  const st = await stats(key, { now });
  const nudge = st.calls_hit ? (st.closes_hit ? 'Both targets hit today.' : `${st.targets.closes_per_day - st.closes} close(s) to your close target.`) : `${st.calls_left_to_target} calls to your target of ${st.targets.calls_per_day}.`;
  items.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || new Date(b.at) - new Date(a.at));
  return { nudge, items: items.slice(0, 12) };
}

async function report(personKey, day = kampalaDay(), { now = new Date() } = {}) {
  const key = cleanKey(personKey);
  const tasks = await loadTasks({ all: true });
  const [attempts, sessions, targets] = await Promise.all([dayAttempts(key, day), daySessions(key, day), targetsFor(key, day)]);
  const sum = summarize(attempts, tasks);
  const callers = await loadCallers();
  return {
    person_key: key,
    name: callers.find((p) => p.key === key)?.name || key,
    day,
    targets,
    ...sum,
    calls_hit: sum.calls >= targets.calls_per_day,
    closes_hit: sum.closes >= targets.closes_per_day,
    work: sessionTotals(sessions, now),
    task_ms: await dayTaskTime(sessions, now),
    flag_labels: FLAG_LABELS,
    evidence: attempts.map(maskedAttempt),
    made_at: now.toISOString()
  };
}

async function saveReport(personKey, day) {
  const r = await report(personKey, day);
  const { evidence, ...figures } = r;
  await db.query(
    `INSERT INTO call_daily_reports (person_key, day, figures, made_at) VALUES ($1, $2::date, $3::jsonb, NOW())
     ON CONFLICT (person_key, day) DO UPDATE SET figures = EXCLUDED.figures, made_at = NOW()`,
    [r.person_key, day, JSON.stringify(figures)]
  );
  return r;
}

function liveStatus(session, attempts = [], events = [], now = new Date()) {
  if (!session) return { state: 'not_started', label: 'Not calling' };
  if (session.ended_at) return { state: 'ended', label: `Finished ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(session.ended_at))}` };
  if (now.getTime() - new Date(session.last_heartbeat_at).getTime() > DROPPED_AFTER_MS) return { state: 'dropped', label: 'Screen closed' };
  const lastEvent = events[events.length - 1];
  if (lastEvent?.kind === 'break_start') return { state: 'break', label: 'On a break' };
  const current = attempts.find((a) => String(a.session_id) === String(session.id) && (a.status === 'calling' || a.status === 'shown'));
  if (current?.status === 'calling' && !current.ended_at) return { state: 'on_call', label: `On a call ${Math.round((now - new Date(current.tapped_at)) / 1000)} s` };
  if (current?.status === 'calling') return { state: 'wrap_up', label: 'Wrapping up' };
  if (lastEvent && (lastEvent.kind === 'fs_exit' || lastEvent.kind === 'hidden')) return { state: 'away', label: 'Away from the screen' };
  return { state: 'ready', label: 'Ready / between calls' };
}

/** King's view: everyone who calls, today's numbers, per task, flags, live status. New people appear on their own. */
async function performance({ day = kampalaDay(), now = new Date() } = {}) {
  await tidy(now).catch(() => null);
  const tasks = await loadTasks({ all: true });
  const callers = await loadCallers();
  const [attempts, sessions, cbs, submissions, road] = await Promise.all([
    dayAttempts(null, day), daySessions(null, day), callbacksDue(null, now), listSubmissions({ status: 'pending' }), roadTo1000()
  ]);
  const keys = new Set([...callers.filter((p) => !p.sandbox).map((p) => p.key), ...attempts.map((a) => a.person_key), ...sessions.map((s) => s.person_key)]);
  const people = [];
  for (const key of keys) {
    const mine = attempts.filter((a) => a.person_key === key);
    const ses = sessions.filter((s) => s.person_key === key);
    const latest = ses[ses.length - 1] || null;
    const events = latest ? await rows('SELECT kind, at FROM call_session_events WHERE session_id = $1 ORDER BY at DESC LIMIT 1', [latest.id]) : [];
    const targets = await targetsFor(key, day);
    const sum = summarize(mine, tasks);
    const week = await callsByDay(key, addDays(day, -6), day);
    const info = callers.find((p) => p.key === key) || { key, name: key };
    people.push({
      person_key: key,
      name: info.name,
      role: info.role || (info.commission_active ? 'closer' : ''),
      rate_pct: info.rate_pct || 0,
      targets,
      live: liveStatus(latest, mine, events, now),
      calls: sum.calls, not_answered: sum.not_answered, closes: sum.closes, connected: sum.connected, talk_s: sum.talk_s, avg_talk_s: sum.avg_talk_s,
      shown: sum.shown, tapped: sum.tapped, skipped: sum.skipped, skip_reasons: sum.skip_reasons, median_gap_s: sum.median_gap_s,
      callbacks_booked: sum.callbacks_booked, follow_ups_done: sum.follow_ups_done,
      callbacks_due: cbs.filter((c) => c.person_key === key && c.due_now).length,
      callbacks_overdue: cbs.filter((c) => c.person_key === key && c.overdue_days > 0).length,
      flags: sum.flags, flagged_calls: sum.flagged_calls,
      by_task: sum.by_task,
      task_ms: await dayTaskTime(ses, now),
      outcomes: sum.outcomes,
      work: sessionTotals(ses, now),
      last_7_days: perf.listDays(addDays(day, -6), day).map((d) => ({ day: d, calls: week[d] || 0 })),
      calls_hit: sum.calls >= targets.calls_per_day,
      closes_hit: sum.closes >= targets.closes_per_day
    });
  }
  people.sort((a, b) => (b.calls - a.calls) || a.name.localeCompare(b.name));
  const team = summarize(attempts, tasks);
  return {
    day,
    tasks: tasks.map((t) => ({ key: t.key, name: t.name, active: t.active })),
    people,
    team: { calls: team.calls, not_answered: team.not_answered, closes: team.closes, connected: team.connected, talk_s: team.talk_s, by_task: team.by_task, flagged_calls: team.flagged_calls },
    pending_numbers: submissions,
    callbacks: cbs.slice(0, 50),
    flag_labels: FLAG_LABELS,
    road_to_1000: road
  };
}

async function evidence(personKey, day = kampalaDay()) {
  const key = cleanKey(personKey);
  const [attempts, sessions] = await Promise.all([dayAttempts(key, day), daySessions(key, day)]);
  const events = sessions.length ? await rows('SELECT session_id, kind, detail, at FROM call_session_events WHERE session_id = ANY($1::uuid[]) ORDER BY at', [sessions.map((s) => s.id)]) : [];
  return {
    person_key: key,
    day,
    attempts: attempts.map(maskedAttempt),
    sessions: sessions.map((s) => ({ id: s.id, task_key: s.task_key, started_at: s.started_at, ended_at: s.ended_at, end_reason: s.end_reason, open_ms: Number(s.open_ms), focus_ms: Number(s.focus_ms), away_ms: Number(s.away_ms), break_ms: Number(s.break_ms), exit_count: s.exit_count, device: s.device, actor_account: s.actor_account })),
    events: events.map((e) => ({ session_id: e.session_id, kind: e.kind, detail: e.detail, at: e.at })),
    task_ms: taskTime(sessions, events),
    summary: (() => { const sm = summarize(attempts, []); return { calls: sm.calls, not_answered: sm.not_answered, connected: sm.connected, closes: sm.closes, talk_s: sm.talk_s, outcomes: sm.outcomes, shown: sm.shown, skipped: sm.skipped }; })(),
    logins: loginsUsed(sessions, attempts),
    dropoffs: dropOffs(sessions, events, attempts),
    on_call: onCallSegments(attempts, events),
    audit: trackingAudit(sessions, events, attempts),
    trends: await evidenceTrends(key),
    tracking_since: await trackingSince(),
    flag_labels: FLAG_LABELS
  };
}

// ---- Evidence trail v2: trends, drop-offs, logins and a tracking audit (pure helpers are tested) ----
const LONG_GAP_MIN = 15;
const LONG_AWAY_MIN = 5;
const minutesBetween = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

/** Which logins were used, so a shared login (e.g. Moderator 1) shows next to the caller the calls count for. */
function loginsUsed(sessions = [], attempts = []) {
  const m = new Map();
  for (const s of sessions) { const k = s.actor_account || 'not recorded'; const v = m.get(k) || { login: k, sessions: 0, calls: 0 }; v.sessions += 1; m.set(k, v); }
  for (const a of attempts) { if (!countsAsCall(a)) continue; const k = a.actor_account || 'not recorded'; const v = m.get(k) || { login: k, sessions: 0, calls: 0 }; v.calls += 1; m.set(k, v); }
  return [...m.values()].sort((x, y) => y.calls - x.calls || y.sessions - x.sessions);
}

/**
 * When the caller was actually on a call: one segment per tapped call (Call now tap to call end), the gap since the
 * previous call ended (break time not counted), and a day summary (calls, talk, average and longest gap).
 */
function onCallSegments(attempts = [], events = []) {
  const ms = (v) => (v ? new Date(v).getTime() : null);
  const breaks = [];
  const bs = events.filter((e) => e.kind === 'break_start' || e.kind === 'break_end').sort((a, b) => ms(a.at) - ms(b.at));
  let open = null;
  for (const e of bs) { if (e.kind === 'break_start') open = ms(e.at); else if (open != null) { breaks.push([open, ms(e.at)]); open = null; } }
  const breakIn = (a, b) => breaks.reduce((t, [x, y]) => t + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  const calls = attempts.filter((a) => a.tapped_at).sort((a, b) => ms(a.tapped_at) - ms(b.tapped_at));
  let prevEnd = null;
  const items = calls.map((a) => {
    const from = ms(a.tapped_at);
    const talkEnd = a.talk_s != null ? from + Number(a.talk_s) * 1000 : null;
    const to = Math.max(from, ms(a.ended_at) || talkEnd || ms(a.wrapped_at) || from);
    const gap = prevEnd == null ? null : Math.max(0, Math.round((from - prevEnd - breakIn(prevEnd, from)) / 1000));
    prevEnd = Math.max(prevEnd || 0, ms(a.wrapped_at) || to);
    return {
      attempt_id: a.id, session_id: a.session_id, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      wrapped_at: a.wrapped_at || null, talk_s: a.talk_s == null ? null : Number(a.talk_s),
      outcome: a.status === 'done' ? a.outcome : (a.status === 'skipped' ? 'skipped' : 'no outcome saved'), gap_s: gap
    };
  });
  const gaps = items.map((i) => i.gap_s).filter((g) => g != null);
  const longest = items.reduce((m, i) => (i.gap_s != null && (!m || i.gap_s > m.gap_s) ? i : m), null);
  return {
    calls: items,
    summary: {
      // Same count as everywhere else: a call is a tapped call with an outcome other than "No answer".
      calls: items.filter((i) => i.outcome !== NO_ANSWER && i.outcome !== 'no outcome saved' && i.outcome !== 'skipped').length,
      not_answered: items.filter((i) => i.outcome === NO_ANSWER).length,
      no_outcome: items.filter((i) => i.outcome === 'no outcome saved' || i.outcome === 'skipped').length,
      talk_s: items.reduce((t, i) => t + (i.talk_s || 0), 0),
      avg_gap_s: gaps.length ? Math.round(gaps.reduce((t, g) => t + g, 0) / gaps.length) : null,
      longest_gap_s: longest ? longest.gap_s : null,
      longest_gap_before: longest ? longest.from : null
    }
  };
}

/** When and why work stopped: dropped sessions, closed pages, long time away, long gaps between calls, calls left without an outcome. */
function dropOffs(sessions = [], events = [], attempts = [], now = new Date()) {
  const out = [];
  for (const s of sessions) {
    const evs = events.filter((e) => String(e.session_id) === String(s.id)).sort((a, b) => new Date(a.at) - new Date(b.at));
    if (s.end_reason === 'dropped') out.push({ at: s.ended_at || s.last_heartbeat_at, kind: 'dropped', title: 'Session dropped', why: `The screen stopped checking in (no signal for ${Math.round(DROPPED_AFTER_MS / 60000)}+ minutes): laptop asleep, browser closed or internet lost.`, session_id: s.id });
    if (s.end_reason === 'replaced') out.push({ at: s.ended_at, kind: 'replaced', title: 'Session replaced', why: 'A new session was started (another tab or device), so this one was closed.', session_id: s.id });
    let away = null; let onBreak = false;
    for (const e of evs) {
      if (e.kind === 'screen_close' && /page closed/.test(e.detail || '')) out.push({ at: e.at, kind: 'page_closed', title: 'Page closed', why: 'The calling page was closed or reloaded.', session_id: s.id });
      if (e.kind === 'break_start') onBreak = true;
      if (e.kind === 'break_end') onBreak = false;
      if (e.kind === 'hidden' && e.detail !== IN_MEETING && !onBreak) away = e;
      if (e.kind === 'visible' && away) {
        const mins = minutesBetween(away.at, e.at);
        if (mins >= LONG_AWAY_MIN) out.push({ at: away.at, kind: 'away', title: `Away from the screen ${mins} min`, why: away.detail === 'on a call' ? 'Switched away during a call.' : 'Switched to another window or app, not on a break.', minutes: mins, session_id: s.id });
        away = null;
      }
    }
    const done = attempts.filter((a) => String(a.session_id) === String(s.id)).sort((a, b) => new Date(a.shown_at) - new Date(b.shown_at));
    for (let i = 1; i < done.length; i++) {
      const prevEnd = done[i - 1].wrapped_at || done[i - 1].ended_at || done[i - 1].shown_at;
      const mins = minutesBetween(prevEnd, done[i].shown_at);
      if (mins < LONG_GAP_MIN) continue;
      const breakIn = evs.some((e) => e.kind === 'break_start' && new Date(e.at) >= new Date(prevEnd) && new Date(e.at) <= new Date(done[i].shown_at));
      const hk = evs.some((e) => e.kind === 'housekeeping_on' && new Date(e.at) >= new Date(prevEnd) && new Date(e.at) <= new Date(done[i].shown_at));
      if (!breakIn && !hk) out.push({ at: prevEnd, kind: 'gap', title: `Long gap: ${mins} min between calls`, why: 'No call, break or housekeeping logged in between.', minutes: mins, session_id: s.id });
    }
  }
  // One line per drop-off: a closed page that then dropped or was replaced is the same event.
  for (let i = out.length - 1; i >= 0; i--) {
    const d = out[i];
    if (d.kind !== 'dropped' && d.kind !== 'replaced') continue;
    const pc = out.find((x) => x.kind === 'page_closed' && x.session_id === d.session_id && Math.abs(new Date(d.at) - new Date(x.at)) < 5 * 60000);
    if (pc) { pc.title = d.kind === 'dropped' ? 'Page closed, session dropped' : 'Page closed, then restarted'; pc.why = d.kind === 'dropped' ? 'The calling page was closed and did not come back.' : 'The page was closed or reloaded and a new session started straight after.'; out.splice(i, 1); }
  }
  for (const a of attempts) {
    if (a.tapped_at && !['done', 'skipped'].includes(a.status)) out.push({ at: a.tapped_at, kind: 'no_outcome', title: 'Call with no outcome saved', why: a.status === 'abandoned' ? 'The session ended before the wrap-up was saved.' : 'Still open: wrap-up not saved yet.', attempt_id: a.id });
  }
  return out.sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** Are we tracking everything? Each check says what is missing so gaps are visible. */
function trackingAudit(sessions = [], events = [], attempts = []) {
  const done = attempts.filter((a) => a.status === 'done');
  const tapped = attempts.filter((a) => a.tapped_at);
  const spoke = done.filter((a) => a.spoke);
  const kinds = new Set(events.map((e) => e.kind));
  const check = (label, missing, total, note = '') => ({ label, ok: missing === 0, missing, total, note });
  return [
    check('Every call has an outcome', tapped.filter((a) => !['done', 'skipped'].includes(a.status)).length, tapped.length),
    check('Every tapped call has an end time', tapped.filter((a) => !a.ended_at && a.status !== 'calling').length, tapped.length),
    check('Every call records the login used', done.filter((a) => !a.actor_account).length, done.length),
    check('Every session records the login and device', sessions.filter((s) => !s.actor_account || !s.device).length, sessions.length),
    check('Every session closed properly (not dropped)', sessions.filter((s) => s.end_reason === 'dropped').length, sessions.length, 'Dropped = no signal from the screen for 3+ minutes.'),
    check('Talk time saved on connected calls', spoke.filter((a) => a.talk_s == null).length, spoke.length),
    check('Screen focus tracked (switched away / came back)', sessions.length && !kinds.has('start') ? sessions.length : 0, sessions.length),
    check('Script steps tracked on connected calls', spoke.length && !kinds.has('route') ? spoke.length : 0, spoke.length, 'Script answers are logged as steps.'),
    check('Live notes on connected calls (laptop)', spoke.filter((a) => !a.transcript).length, spoke.length, 'Needs Chrome/Edge on the laptop and mic permission; off on phones.')
  ];
}

/** Calls, talk time, conversations, closes and outcomes for the last days, weeks and months (Kampala time), oldest first. */
/** The first day the calling screen recorded any call (Kampala). Periods before it were not tracked, so "0" there means "no data", not "no calls". */
async function trackingSince() {
  const r = await rows(`SELECT to_char(MIN(COALESCE(tapped_at, shown_at)) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS d FROM call_attempts`);
  return (r[0] && r[0].d) || null;
}

async function evidenceTrends(personKey) {
  const spans = { day: 14, week: 8, month: 6 };
  const out = {};
  for (const [unit, n] of Object.entries(spans)) {
    const base = await rows(
      `WITH b AS (SELECT generate_series(date_trunc('${unit}', now() AT TIME ZONE '${TZ}') - ($2::int - 1) * interval '1 ${unit}', date_trunc('${unit}', now() AT TIME ZONE '${TZ}'), interval '1 ${unit}') AS k)
       SELECT to_char(b.k, 'YYYY-MM-DD') AS k,
              COUNT(a.id) FILTER (WHERE ${COUNTED_SQL('a.')})::int AS calls,
              COUNT(a.id) FILTER (WHERE a.status = 'done' AND a.outcome = '${NO_ANSWER}')::int AS not_answered,
              COALESCE(SUM(a.talk_s) FILTER (WHERE a.status = 'done'), 0)::int AS talk_s,
              COUNT(a.id) FILTER (WHERE a.status = 'done' AND a.spoke)::int AS connected,
              COUNT(a.id) FILTER (WHERE a.status = 'done' AND a.is_close AND a.outcome IN ('paid', 'renewed'))::int AS closes
         FROM b LEFT JOIN call_attempts a ON a.person_key = $1 AND date_trunc('${unit}', COALESCE(a.tapped_at, a.shown_at) AT TIME ZONE '${TZ}') = b.k
        GROUP BY b.k ORDER BY b.k`, [personKey, n]);
    const outs = await rows(
      `SELECT to_char(date_trunc('${unit}', COALESCE(tapped_at, shown_at) AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS k, outcome, COUNT(*)::int AS n
         FROM call_attempts WHERE person_key = $1 AND status = 'done'
          AND COALESCE(tapped_at, shown_at) >= (date_trunc('${unit}', now() AT TIME ZONE '${TZ}') - ($2::int - 1) * interval '1 ${unit}') AT TIME ZONE '${TZ}'
        GROUP BY 1, 2`, [personKey, n]);
    out[unit] = base.map((r) => ({ ...r, outcomes: Object.fromEntries(outs.filter((o) => o.k === r.k).map((o) => [o.outcome, o.n])) }));
  }
  return out;
}

async function bootstrap({ userId = '', scope = '', isKing = false } = {}) {
  // Approved team tips (King-approved script lines) join the written "If they say…" answers.
  const [tasks, callers, tips] = await Promise.all([loadTasks(), loadCallers(), require('./teamLearnings').approvedTips().catch(() => ({}))]);
  const me = callers.find((p) => p.user_id && userId && String(p.user_id) === String(userId)) || null;
  return {
    tasks: tasks.map((t) => ({ key: t.key, name: t.name, description: t.description, queue_kind: t.queue_kind, checklist: t.checklist, outcomes: t.outcomes, script_variants: t.script_variants })),
    // The practice account is offered only to King and to its own login.
    callers: callers.filter((p) => !p.sandbox || isKing || (me && me.key === p.key)).map((p) => ({ key: p.key, name: p.name, sandbox: Boolean(p.sandbox) || undefined })),
    locked_person: me ? me.key : null,
    sandbox: Boolean(me && me.sandbox),
    scripts: { variants: scripts.VARIANTS, objections: require('./teamLearnings').withTips(scripts.OBJECTIONS, tips), greetings: scripts.GREETINGS, luganda_status: 'Ronald to check', routes: callRoutes.ROUTES, pickup: callRoutes.PICKUP },
    callback_min_hours: CALLBACK_MIN_HOURS,
    sms_texts: scripts.SMS_TEXTS,
    first_text_for: scripts.FIRST_TEXT_FOR,
    templates: scripts.TEMPLATES,
    template_rules: scripts.TEMPLATE_RULES,
    sales_kit: scripts.salesKit(),
    momo_code: scripts.MOMO_CODE,
    whatsapp_number: scripts.WHATSAPP_NUMBER,
    whatsapp_display: scripts.WHATSAPP_DISPLAY,
    close_checks: scripts.CLOSE_CHECKS,
    coach: scripts.COACH,
    scope: isKing ? 'king' : (scope || 'staff'),
    flag_labels: FLAG_LABELS
  };
}

module.exports = {
  countsAsCall,
  isNoAnswer,
  NO_ANSWER_RETRY_MS,
  onCallSegments,
  dropOffs,
  trackingAudit,
  loginsUsed,
  evidenceTrends,
  trackingSince,
  taskTime,
  internationalNumbers,
  roadTo1000,
  callbacksDue,
  SKIP_REASONS,
  HOW_KNOWN,
  blockNumber,
  blockOf,
  unblockNumber,
  listBlocks,
  startInbound,
  searchCalls,
  callsSummary,
  cleanTranscript,
  closesLoop,
  skipCodeOf,
  moneyScore,
  sourceKindLabel,
  helloFor,
  bestTimeFrom,
  moneyToday,
  queueCounts,
  freshLeft,
  DEFAULT_TARGETS,
  FLAG_LABELS,
  PAID_OUTCOMES,
  closedPaid,
  notesCheckOk,
  flagsFor,
  eligibility,
  variantFor,
  nextMilestone,
  streakDays,
  summarize,
  maskedAttempt,
  liveStatus,
  bootstrap,
  loadTasks,
  loadCallers,
  targetsFor,
  saveTargets,
  startSession,
  heartbeat,
  switchTask,
  endSession,
  nextNumber,
  eligibleQueue,
  tap,
  endCall,
  wrapUp,
  skip,
  submitNumber,
  listSubmissions,
  reviewSubmission,
  stats,
  feed,
  report,
  saveReport,
  performance,
  evidence,
  tidy,
  // used by callingExtras
  attemptsFor,
  historyFor,
  present,
  openSession,
  dayAttempts,
  kampalaDay,
  httpError,
  cleanKey
};
