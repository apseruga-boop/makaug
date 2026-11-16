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
const perf = require('./staffPerformance');
const { staffSenderChoices, maskPhoneLast3 } = require('./outreachSenderName');
const { phoneKey9, canonicalUgPhone } = require('../utils/ugPhone');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');

const TZ = 'Africa/Kampala';
const DEFAULT_TARGETS = Object.freeze({ calls_per_day: 40, closes_per_day: 2 });
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
  no_end: 'Wrapped up without ending the call'
});

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
function flagsFor(attempt = {}, def = {}, prevTapAt = null) {
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
  if (done.some((a) => kampalaDay(a.wrapped_at || a.shown_at) === today)) {
    const latestToday = done[0];
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
  if (c.source_kind === 'list') return c.found_online ? 67 : 70; // the Companion's daily list
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
  const done = attempts.filter((a) => a.status === 'done');
  const out = {
    shown: attempts.length,
    tapped: attempts.filter((a) => a.tapped_at).length,
    calls: done.length,
    connected: done.filter((a) => a.spoke).length,
    closes: done.filter((a) => a.is_close).length,
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
  for (const a of done) {
    out.outcomes[a.outcome] = (out.outcomes[a.outcome] || 0) + 1;
    const bt = out.by_task[a.task_key] || (out.by_task[a.task_key] = { name: a.task_key, calls: 0, closes: 0, connected: 0 });
    bt.calls += 1; if (a.is_close) bt.closes += 1; if (a.spoke) bt.connected += 1;
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
    flags: a.flags || []
  };
}

// ---------------------------------------------------------------- loading --

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows || [];
}

async function safeRows(sql, params = []) {
  try { return await rows(sql, params); } catch (_) { return []; }
}

async function loadTasks({ all = false } = {}) {
  return rows(`SELECT key, name, description, queue_kind, sort_order, active, script_variants, checklist, outcomes, config
                 FROM call_tasks ${all ? '' : 'WHERE active'} ORDER BY sort_order, key`);
}

async function loadTask(key) {
  const t = (await rows('SELECT key, name, description, queue_kind, sort_order, active, script_variants, checklist, outcomes, config FROM call_tasks WHERE key = $1', [key]))[0];
  if (!t || !t.active) throw httpError(400, 'Pick a task.');
  return t;
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
  for (const r of await safeRows("SELECT profile_data->>'person_key' AS person_key, TRIM(CONCAT(first_name, ' ', last_name)) AS full_name FROM users WHERE role = 'moderator' AND status = 'active' AND COALESCE(profile_data->>'person_key', '') <> ''")) add(r.person_key, r.full_name);
  for (const r of await safeRows('SELECT DISTINCT person_key FROM call_targets')) add(r.person_key, null);
  for (const r of await safeRows("SELECT DISTINCT person_key FROM call_sessions WHERE started_at > NOW() - INTERVAL '60 days'")) add(r.person_key, null);
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

async function startSession({ personKey, taskKey, device = '', actorAccount = '', actorUserId = '', now = new Date() } = {}) {
  const callers = await loadCallers();
  const person = callers.find((p) => p.key === cleanKey(personKey));
  if (!person) throw httpError(400, 'Pick who is calling.');
  const task = await loadTask(taskKey);
  await tidy(now);
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
const EVENT_KINDS = new Set(['inbound_start', 'fs_exit', 'fs_enter', 'hidden', 'visible', 'break_start', 'break_end', 'kit_send', 'screen_open', 'screen_close', 'idle_start', 'idle_end', 'action', 'work_on', 'work_off', 'meeting_join', 'meeting_end']);

/**
 * Heartbeat from the screen: running totals (ms) and the events since the last
 * beat. Totals only ever go up, and open time can't exceed the wall clock.
 */
async function heartbeat(id, { totals = {}, events = [], now = new Date() } = {}) {
  const s = await openSession(id);
  const wall = Math.max(0, now.getTime() - new Date(s.started_at).getTime()) + 5000;
  const n = (v) => Math.max(0, Math.min(wall, Math.round(Number(v) || 0)));
  const list = (Array.isArray(events) ? events : []).slice(0, 200).filter((e) => EVENT_KINDS.has(e?.kind));
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

/** Candidates in queue order for one task and caller. Each: phone, phone_key, name, source. */
async function candidatesFor(task, personKey, { today = kampalaDay(), limit = 400 } = {}) {
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
      `SELECT id, full_name, phone, phone_key, lead_source, list_day::text AS list_day FROM outreach_list_numbers
        WHERE accepted IS TRUE AND person_key = $1 AND list_day <= $2::date ORDER BY list_day DESC, added_at LIMIT $3`,
      [personKey, today, limit]
    );
    for (const r of list) out.push({ phone: r.phone, phone_key: r.phone_key, full_name: r.full_name, source_kind: 'list', source_label: `Your list ${r.list_day}${r.lead_source === 'found_online' ? ' · found online' : r.lead_source === 'staff_added' ? ' · added by you' : ''}`, list_number_id: r.id, found_online: r.lead_source === 'found_online' });
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
  return out.filter((c) => c.phone_key && c.phone_key.length === 9);
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
    const e = eligibility(h, task, { now, tasks: all });
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
  return [
    ...list.map((a) => (a.status === 'skipped'
      ? { at: a.wrapped_at || a.shown_at, by: a.person_key, what: 'skipped', note: a.skip_reason || '', task: a.task_key, skipped: true }
      : { at: a.wrapped_at, by: a.person_key, what: `${a.outcome.replace(/_/g, ' ')}${a.talk_s != null ? ` · ${a.talk_s}s` : ''}`, outcome: a.outcome, note: a.note || '', task: a.task_key, next_step: a.callback_at || null, next_text: a.next_step || '', summary: a.tx_summary || '' })),
    ...events.map((e) => ({ at: e.created_at, by: e.person_key || '', what: `Outreach: ${String(e.outcome || '').replace(/_/g, ' ')}`, note: e.note || '', task: 'outreach' }))
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
async function nextNumber(sessionId, { now = new Date() } = {}) {
  const s = await openSession(sessionId);
  const tasks = await loadTasks({ all: true });
  const task = tasks.find((t) => t.key === s.task_key);
  const callers = await loadCallers();
  const callerName = callers.find((p) => p.key === s.person_key)?.name || s.person_key;
  const current = (await rows("SELECT * FROM call_attempts WHERE session_id = $1 AND status IN ('shown', 'calling') ORDER BY shown_at DESC LIMIT 1", [sessionId]))[0];
  if (current) return { ...present(current, task, await historyFor(current.phone_key), { callerName, hello: await helloFor(current.phone_key), bestTime: await bestTimeFor(current.phone_key) }), resumed: true, left: null };
  await tidy(now);
  const queue = await eligibleQueue(task, s.person_key, { now, tasks });
  for (const c of queue) {
    const variant = variantFor(task, c, c.history);
    const row = (await rows(
      `INSERT INTO call_attempts (session_id, person_key, task_key, phone, phone_key, full_name, source_kind, source_label, reason, script_variant, prospect_id, list_number_id, agent_id, shown_at, actor_account, actor_user_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, actor_account, actor_user_id FROM call_sessions WHERE id = $1
       ON CONFLICT (phone_key) WHERE status IN ('shown', 'calling') DO NOTHING RETURNING *`,
      [sessionId, s.person_key, task.key, canonicalUgPhone(c.phone), c.phone_key, c.full_name || null, c.source_kind, c.source_label || null, c.reason || null, variant, c.prospect_id || null, c.list_number_id || null, c.agent_id || null, now]
    ))[0];
    if (row) return { ...present(row, task, await historyFor(row.phone_key), { callerName, hello: await helloFor(row.phone_key), bestTime: await bestTimeFor(row.phone_key) }), resumed: false, left: queue.length - 1 };
  }
  return { attempt: null, left: 0, empty_message: emptyMessage(task) };
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

async function tap(attemptId, { sessionId, now = new Date(), at = null, op = '' } = {}) {
  const opId = cleanOp(op);
  const done = await alreadyApplied(attemptId, opId);
  if (done) return maskedAttempt(done);
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

async function wrapUp(attemptId, { sessionId, outcome = '', note = '', callbackAt = '', checklist = {}, transcript = null, nextStep = '', now: serverNow = new Date(), at = null, op = '' } = {}) {
  const opId = cleanOp(op);
  const applied = await alreadyApplied(attemptId, opId);
  if (applied) return maskedAttempt(applied);
  const a = await attemptInSession(attemptId, sessionId);
  if (!['shown', 'calling'].includes(a.status)) throw httpError(409, 'This call is already wrapped up.');
  const now = clientTime(at, a, serverNow);
  const task = await loadTask(a.task_key).catch(async () => (await loadTasks({ all: true })).find((t) => t.key === a.task_key));
  const def = outcomeDef(task, outcome);
  if (!def) throw httpError(400, 'Pick what happened on the call.');
  // A note is needed when they spoke; for no answer / wrong number the outcome is the note.
  let text = String(note || '').trim().slice(0, 1000);
  if (text.length < 3 && !def.spoke) text = def.label || def.key.replace(/_/g, ' ');
  if (text.length < 3) throw httpError(400, 'Write a short note about the call (or tap one of the quick notes).');
  const cb = parseCallback(callbackAt, now);
  if (def.date === 'required' && !cb) throw httpError(400, 'Pick the date and time to call back.');
  // Every call ends with a close, a final no, or a next step.
  let next = String(nextStep || '').trim().slice(0, 300);
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
  const flags = flagsFor(record, def, prevTap?.tapped_at || null);
  const talk = a.tapped_at ? seconds(a.tapped_at, a.ended_at || now) : null;
  const wrapS = seconds(a.ended_at || a.tapped_at || a.shown_at, now);
  const gapS = prev?.wrapped_at && a.tapped_at && kampalaDay(prev.wrapped_at) === kampalaDay(a.tapped_at) ? seconds(prev.wrapped_at, a.tapped_at) : null;
  const out = (await rows(
    `UPDATE call_attempts SET status = 'done', wrapped_at = $2, outcome = $3, spoke = $4, is_close = $5, note = $6, callback_at = $7,
        checklist = $8::jsonb, flags = $9::text[], talk_s = $10, wrapup_s = $11, gap_s = $12,
        client_ops = CASE WHEN $13 = '' THEN client_ops ELSE array_append(client_ops, $13) END,
        next_step = NULLIF($14, ''), transcript = $15::jsonb
      WHERE id = $1 AND status IN ('shown', 'calling') RETURNING *`,
    [a.id, now, def.key, Boolean(def.spoke), Boolean(def.close), text, cb, JSON.stringify(ticks), flags, talk, wrapS, gapS, opId, next, tx ? JSON.stringify(tx) : null]
  ))[0];
  if (!out) throw httpError(409, 'This call is already wrapped up.');
  await mirrorToProspect(out, def).catch(() => null);
  if (def.key === 'do_not_contact') await blockNumber(out.phone_key, { by: out.person_key, reason: out.note || 'Asked not to be called', attemptId: out.id });
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
      WHERE status IN ('done', 'skipped') AND ($3 = '' OR person_key = $3)
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
    `SELECT id, person_key, task_key, direction, phone_key, full_name, status, outcome, is_close, note, next_step, callback_at, transcript, talk_s, COALESCE(wrapped_at, tapped_at, shown_at) AS at
       FROM call_attempts WHERE status IN ('done', 'skipped') AND COALESCE(tapped_at, shown_at) >= $1 AND COALESCE(tapped_at, shown_at) < $2 ORDER BY at`, [start, end]);
  const done = list.filter((a) => a.status === 'done');
  const by = {}; const outcomes = {};
  for (const a of done) {
    const p = by[a.person_key] || (by[a.person_key] = { calls: 0, outbound: 0, inbound: 0, closes: 0, talk_s: 0 });
    p.calls += 1; p[a.direction === 'inbound' ? 'inbound' : 'outbound'] += 1; if (a.is_close) p.closes += 1; p.talk_s += Number(a.talk_s || 0);
    outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1;
  }
  const item = (a) => ({ at: a.at, by: a.person_key, direction: a.direction, name: a.full_name || '', phone: `•••${a.phone_key.slice(-3)}`, outcome: a.outcome, summary: (a.transcript && a.transcript.summary) || a.note || '', next_step: a.next_step || '', callback_at: a.callback_at });
  const finalNo = new Set(['rejected', 'do_not_contact', 'wrong_number', 'not_renewing']);
  // A number is "open" if its latest call this period set a next step that isn't a close or a final no.
  const latest = new Map(); for (const a of done) latest.set(a.phone_key, a);
  return {
    from, to, calls: done.length, outbound: done.filter((a) => a.direction !== 'inbound').length, inbound: done.filter((a) => a.direction === 'inbound').length,
    skipped: list.length - done.length, outcomes, by_person: by,
    discussed: done.filter((a) => (a.transcript && a.transcript.summary) || (a.note && a.note.length > 12)).slice(-40).reverse().map(item),
    closed: done.filter((a) => a.is_close).reverse().map(item),
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

async function listSubmissions({ status = 'pending' } = {}) {
  const list = await rows(
    `SELECT * FROM call_number_submissions WHERE ($1 = 'all' OR status = $1 OR ($1 = 'pending' AND status = 'own' AND reviewed_at IS NULL AND added_at > NOW() - INTERVAL '7 days'))
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
    `SELECT * FROM call_attempts WHERE ($1::text IS NULL OR person_key = $1)
        AND (COALESCE(tapped_at, shown_at) AT TIME ZONE '${TZ}')::date = $2::date ORDER BY shown_at`,
    [personKey, day]
  );
}

async function daySessions(personKey, day) {
  return rows(
    `SELECT * FROM call_sessions WHERE ($1::text IS NULL OR person_key = $1) AND (started_at AT TIME ZONE '${TZ}')::date = $2::date ORDER BY started_at`,
    [personKey, day]
  );
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
      WHERE person_key = $1 AND status = 'done' AND (wrapped_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date GROUP BY 1`,
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
    `SELECT person_key, COUNT(*) FILTER (WHERE status = 'done')::int AS calls, COUNT(*) FILTER (WHERE is_close)::int AS closes
       FROM call_attempts WHERE (COALESCE(tapped_at, shown_at) AT TIME ZONE '${TZ}')::date = $1::date GROUP BY person_key ORDER BY closes DESC, calls DESC`,
    [day]
  );
  const callers = await loadCallers();
  return list.map((r) => ({ person_key: r.person_key, name: callers.find((p) => p.key === r.person_key)?.name || r.person_key, calls: r.calls, closes: r.closes }));
}

async function callbacksDue(personKey, now = new Date()) {
  const list = await rows(
    `SELECT DISTINCT ON (phone_key) phone_key, phone, full_name, callback_at, outcome, task_key, person_key FROM call_attempts
      WHERE status = 'done' AND callback_at IS NOT NULL ORDER BY phone_key, wrapped_at DESC`
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
    closes: sum.closes,
    connected: sum.connected,
    talk_s: sum.talk_s,
    calls_left_to_target: Math.max(0, targets.calls_per_day - sum.calls),
    calls_hit: sum.calls >= targets.calls_per_day,
    closes_hit: sum.closes >= targets.closes_per_day,
    queue_left: left,
    by_task: sum.by_task,
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
  const paid = done.filter((a) => a.is_close && a.task_key !== 'new_agents').length;
  const pending = done.filter((a) => (a.is_close && a.task_key === 'new_agents') || a.outcome === 'promised').length;
  const per = Math.round(FEE_UGX * rate / 100);
  return { rate_pct: rate, on_commission: rate > 0, per_payment_ugx: per, earned_ugx: paid * per, at_stake_ugx: pending * per, payments_closed: paid, payments_pending: pending };
}

/** Numbers waiting in each mode for this person (for the mode switch). */
async function queueCounts(personKey, { now = new Date() } = {}) {
  const key = cleanKey(personKey);
  const tasks = await loadTasks({ all: true });
  const active = tasks.filter((t) => t.active !== false);
  const out = {};
  for (const t of active) out[t.key] = (await eligibleQueue(t, key, { now, tasks, limit: 300 })).length;
  return out;
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
  const keys = new Set([...callers.map((p) => p.key), ...attempts.map((a) => a.person_key), ...sessions.map((s) => s.person_key)]);
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
      calls: sum.calls, closes: sum.closes, connected: sum.connected, talk_s: sum.talk_s, avg_talk_s: sum.avg_talk_s,
      shown: sum.shown, tapped: sum.tapped, skipped: sum.skipped, skip_reasons: sum.skip_reasons, median_gap_s: sum.median_gap_s,
      callbacks_booked: sum.callbacks_booked, follow_ups_done: sum.follow_ups_done,
      callbacks_due: cbs.filter((c) => c.person_key === key && c.due_now).length,
      callbacks_overdue: cbs.filter((c) => c.person_key === key && c.overdue_days > 0).length,
      flags: sum.flags, flagged_calls: sum.flagged_calls,
      by_task: sum.by_task,
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
    team: { calls: team.calls, closes: team.closes, connected: team.connected, talk_s: team.talk_s, by_task: team.by_task, flagged_calls: team.flagged_calls },
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
    flag_labels: FLAG_LABELS
  };
}

async function bootstrap({ userId = '', scope = '', isKing = false } = {}) {
  const [tasks, callers] = await Promise.all([loadTasks(), loadCallers()]);
  const me = callers.find((p) => p.user_id && userId && String(p.user_id) === String(userId)) || null;
  return {
    tasks: tasks.map((t) => ({ key: t.key, name: t.name, description: t.description, queue_kind: t.queue_kind, checklist: t.checklist, outcomes: t.outcomes, script_variants: t.script_variants })),
    callers: callers.map((p) => ({ key: p.key, name: p.name })),
    locked_person: me ? me.key : null,
    scripts: { variants: scripts.VARIANTS, objections: scripts.OBJECTIONS, greetings: scripts.GREETINGS, luganda_status: 'Ronald to check' },
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
  DEFAULT_TARGETS,
  FLAG_LABELS,
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
