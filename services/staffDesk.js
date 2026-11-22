'use strict';

/**
 * Staff desk (Arthur, 21 Nov 2026): the numbers behind a staff member's own
 * sidebar pages. Home ("Good morning <name>"), My performance, My pay and
 * Profile. Always one person's own data: routes pass the signed-in person's
 * key, never one from the request (King may look at anyone).
 */
const db = require('../config/database');
const calling = require('./callingScreen');
const rules = require('./callingRules');
const planner = require('./callingPlanner');
const day = require('./callingDay');
const kd = require('./kingDesk');

async function rows(sql, params = []) { try { return (await db.query(sql, params)).rows || []; } catch (_) { return []; } }
const num = (v) => Number(v || 0);
const httpError = calling.httpError;
const startOf = (d) => new Date(`${d}T00:00:00+03:00`);
const ID_TYPES = { national_id: 'National ID', passport: 'Passport', driving_permit: 'Driving permit', refugee_id: 'Refugee ID' };

/** Last 3 characters only (ID numbers, phones). */
function maskTail(v) { const s = String(v || '').replace(/\s+/g, ''); return s.length >= 3 ? `•••${s.slice(-3)}` : (s ? '•••' : ''); }

const pace = planner.pace;

async function personRow(personKey) {
  return (await rows(`SELECT id::text AS user_id, first_name, last_name, email, profile_data FROM users WHERE role = 'moderator' AND profile_data->>'person_key' = $1 ORDER BY (status = 'active') DESC LIMIT 1`, [personKey]))[0] || null;
}

async function checklist(pk, plan, today, nowMin, targets, todayCounts) {
  const items = [];
  const [mic] = await Promise.all([
    rows(`SELECT 1 FROM call_session_events e JOIN call_sessions s ON s.id = e.session_id
           WHERE s.person_key = $1 AND e.kind = 'notes_check_passed' AND e.at >= $2 LIMIT 1`, [pk, startOf(today)])
  ]);
  items.push({ key: 'mic', label: 'Mic check passed (live notes on)', done: mic.length > 0, progress: mic.length ? 'done' : 'not yet', state: mic.length ? 'done' : 'todo' });
  for (const b of plan.blocks || []) {
    if (!b.target) continue;
    const state = b.done >= b.target ? 'done' : (b.past ? 'missed' : (b.now ? 'now' : 'todo'));
    items.push({ key: `block:${b.id}`, label: `${b.label}: ${b.target} ${b.kind === 'housekeeping' ? 'follow-ups' : 'calls'}`, block: `${b.start}–${b.end}`, done: b.done >= b.target, progress: `${b.done}/${b.target}`, state });
  }
  const due = await rows(
    `WITH last AS (SELECT DISTINCT ON (phone_key) phone_key, callback_at, COALESCE(wrapped_at, tapped_at) AS at FROM call_attempts
                    WHERE person_key = $1 AND status = 'done' AND callback_at IS NOT NULL ORDER BY phone_key, COALESCE(wrapped_at, tapped_at) DESC)
     SELECT COUNT(*) FILTER (WHERE callback_at < $3)::int AS due,
            COUNT(*) FILTER (WHERE callback_at < $3 AND EXISTS (SELECT 1 FROM call_attempts a WHERE a.phone_key = last.phone_key AND a.person_key = $1 AND a.status = 'done' AND a.tapped_at >= $2 AND a.tapped_at > last.at))::int AS done
       FROM last WHERE callback_at >= $2 - INTERVAL '7 days'`, [pk, startOf(today), startOf(kd.ranges().tomorrow)]);
  const d = due[0] || {};
  if (num(d.due)) items.push({ key: 'callbacks', label: `Call back ${num(d.due)} ${num(d.due) === 1 ? 'person' : 'people'} due today`, done: num(d.done) >= num(d.due), progress: `${num(d.done)}/${num(d.due)}`, state: num(d.done) >= num(d.due) ? 'done' : (nowMin >= 17 * 60 ? 'missed' : 'todo') });
  items.push({ key: 'paid', label: `${targets.closes_per_day} paid today`, done: todayCounts.paid >= targets.closes_per_day, progress: `${todayCounts.paid}/${targets.closes_per_day}`, state: todayCounts.paid >= targets.closes_per_day ? 'done' : (nowMin >= 18 * 60 ? 'missed' : 'todo') });
  return items;
}

async function profileOf(userId, { king = false } = {}) {
  const p = (await rows('SELECT * FROM staff_profiles WHERE user_id = $1', [userId]))[0] || {};
  const out = {
    photo: p.photo_data || '', id_type: p.id_type || '', id_type_label: ID_TYPES[p.id_type] || '', id_number_masked: maskTail(p.id_number), id_saved: Boolean(p.id_number),
    id_expiry: p.id_expiry ? new Date(p.id_expiry).toISOString().slice(0, 10) : '', home_area: p.home_area || '',
    emergency_name: p.emergency_name || '', emergency_phone_masked: maskTail(String(p.emergency_phone || '').replace(/\D/g, '')), updated_at: p.updated_at || null
  };
  if (king) { out.id_number = p.id_number || ''; out.emergency_phone = p.emergency_phone || ''; }
  out.missing = [!out.photo && 'photo', !out.id_saved && 'ID details', !out.emergency_name && 'emergency contact'].filter(Boolean);
  return out;
}

async function home(personKey, { now = new Date() } = {}) {
  const pk = calling.cleanKey(personKey);
  if (!pk) throw httpError(400, 'This login has no calling name yet. Ask King to add you on Staff, pay & targets.');
  const r = kd.ranges(now);
  const nowMin = planner.kampalaMinutes(now);
  const [user, targets, plan, callRows, todayRow, monthRow, money] = await Promise.all([
    personRow(pk),
    calling.targetsFor(pk, r.today),
    planner.dayPlan(pk, { now }),
    rows(`SELECT tapped_at AS at FROM call_attempts WHERE person_key = $1 AND tapped_at >= $2 AND tapped_at < $3 AND status = 'done' AND COALESCE(outcome, '') <> 'no_answer'`, [pk, startOf(r.lastWeekStart), startOf(r.tomorrow)]),
    rows(`SELECT COUNT(*) FILTER (WHERE status = 'done' AND COALESCE(outcome, '') <> 'no_answer')::int AS calls,
                 COUNT(*) FILTER (WHERE status = 'done' AND outcome IN ('interested', 'will_list') AND ${rules.textSentSql('call_attempts')})::int AS interested,
                 COUNT(*) FILTER (WHERE status = 'done' AND is_close AND outcome IN ('paid', 'renewed'))::int AS paid,
                 COALESCE(SUM(talk_s) FILTER (WHERE status = 'done'), 0)::int AS talk_s
            FROM call_attempts WHERE person_key = $1 AND tapped_at >= $2`, [pk, startOf(r.today)]),
    rows(`SELECT COUNT(*) FILTER (WHERE tapped_at >= $2 AND status = 'done' AND COALESCE(outcome, '') <> 'no_answer')::int AS calls_now,
                 COUNT(*) FILTER (WHERE tapped_at >= $3 AND tapped_at < $4 AND status = 'done' AND COALESCE(outcome, '') <> 'no_answer')::int AS calls_prev,
                 COUNT(*) FILTER (WHERE tapped_at >= $2 AND status = 'done' AND is_close AND outcome IN ('paid', 'renewed'))::int AS paid_now,
                 COUNT(*) FILTER (WHERE tapped_at >= $3 AND tapped_at < $4 AND status = 'done' AND is_close AND outcome IN ('paid', 'renewed'))::int AS paid_prev
            FROM call_attempts WHERE person_key = $1 AND tapped_at >= $3`, [pk, startOf(r.monthStart), startOf(r.lastMonthStart), startOf(r.sameDayLastMonth)]),
    day.myMoney(pk).catch(() => null)
  ]);
  const t = todayRow[0] || {}; const m = monthRow[0] || {};
  const todayCounts = { calls: num(t.calls), interested: num(t.interested), paid: num(t.paid), talk_s: num(t.talk_s) };
  const p = pace(plan, nowMin);
  const prof = user ? await profileOf(user.user_id) : { missing: [] };
  return {
    day: r.today, now_min: nowMin,
    me: { person_key: pk, first_name: user ? user.first_name : pk, name: user ? `${user.first_name}`.trim() : pk, scope: user && user.profile_data ? user.profile_data.staff_scope || '' : '', photo: prof.photo || '' },
    targets: { calls: num(targets.calls_per_day), paid: num(targets.closes_per_day), interested: Math.max(1, Math.round(num(targets.calls_per_day) / 10)) },
    today: todayCounts,
    week: { this_week: kd.weekSeries(callRows, r.weekStart), last_week: kd.weekSeries(callRows, r.lastWeekStart), elapsed_days: r.elapsedWeekDays },
    month: { calls: num(m.calls_now), calls_prev: num(m.calls_prev), paid: num(m.paid_now), paid_prev: num(m.paid_prev), change_pct: kd.pctChange(num(m.calls_now), num(m.calls_prev)) },
    plan: { blocks: plan.blocks, current: plan.current },
    pace: p,
    checklist: await checklist(pk, plan, r.today, nowMin, targets, todayCounts),
    profile_missing: prof.missing,
    low_list: await calling.freshLeft(pk, { now }).catch(() => null),
    money: money ? { earned_ugx: num(money.earned_ugx), due_next_payday_ugx: num(money.due_next_payday_ugx), next_payday: money.next_payday, rate_pct: num(money.rate_pct) } : null
  };
}

/** My performance: own numbers only, day by day for the last 30 days plus this month's outcomes. */
async function performance(personKey, { now = new Date() } = {}) {
  const pk = calling.cleanKey(personKey);
  if (!pk) throw httpError(400, 'This login has no calling name yet.');
  const r = kd.ranges(now);
  const from = new Date(startOf(r.tomorrow).getTime() - 30 * 86400000);
  const [days, outcomes, targets] = await Promise.all([
    rows(`SELECT to_char(tapped_at AT TIME ZONE 'Africa/Kampala', 'YYYY-MM-DD') AS day,
                 COUNT(*) FILTER (WHERE status = 'done')::int AS dialled,
                 COUNT(*) FILTER (WHERE status = 'done' AND COALESCE(outcome, '') <> 'no_answer')::int AS calls,
                 COUNT(*) FILTER (WHERE status = 'done' AND outcome IN ('interested', 'will_list') AND ${rules.textSentSql('call_attempts')})::int AS interested,
                 COUNT(*) FILTER (WHERE status = 'done' AND is_close AND outcome IN ('paid', 'renewed'))::int AS paid,
                 COALESCE(SUM(talk_s) FILTER (WHERE status = 'done'), 0)::int AS talk_s
            FROM call_attempts WHERE person_key = $1 AND tapped_at >= $2 GROUP BY 1 ORDER BY 1 DESC`, [pk, from]),
    rows(`SELECT COALESCE(NULLIF(outcome, ''), 'none') AS outcome, COUNT(*)::int AS n FROM call_attempts
           WHERE person_key = $1 AND status = 'done' AND tapped_at >= $2 GROUP BY 1 ORDER BY 2 DESC`, [pk, startOf(r.monthStart)]),
    calling.targetsFor(pk, r.today)
  ]);
  const target = num(targets.calls_per_day);
  return {
    person_key: pk, target_calls: target, target_paid: num(targets.closes_per_day),
    days: days.map((d) => ({ day: d.day, dialled: num(d.dialled), calls: num(d.calls), interested: num(d.interested), paid: num(d.paid), talk_s: num(d.talk_s), hit: target > 0 && num(d.calls) >= target })),
    outcomes_month: outcomes.map((o) => ({ outcome: o.outcome, n: num(o.n) }))
  };
}

/** Salary history (newest first) and the salary that applies this month. */
async function salaryOf(pk, month) {
  const hist = await rows('SELECT month::text AS month, salary_ugx, note, set_at FROM staff_salaries WHERE person_key = $1 ORDER BY month DESC, set_at DESC', [pk]);
  const cur = hist.filter((h) => h.month <= month).sort((a, b) => b.month.localeCompare(a.month) || new Date(b.set_at) - new Date(a.set_at))[0];
  return { month, salary_ugx: cur ? num(cur.salary_ugx) : null, carried: cur ? cur.month !== month : false, history: hist.slice(0, 24).map((h) => ({ month: h.month, salary_ugx: num(h.salary_ugx), note: h.note, set_at: h.set_at })) };
}

async function myPay(personKey, { now = new Date() } = {}) {
  const pk = calling.cleanKey(personKey);
  if (!pk) throw httpError(400, 'This login has no calling name yet.');
  const r = kd.ranges(now);
  const month = `${r.monthStart}`;
  const [money, salary] = await Promise.all([day.myMoney(pk).catch(() => null), salaryOf(pk, month)]);
  return { person_key: pk, month, salary, commission: money };
}

async function saveProfile(userId, personKey, body = {}, { actor = '' } = {}) {
  const cur = (await rows('SELECT * FROM staff_profiles WHERE user_id = $1', [userId]))[0] || {};
  const next = { ...cur };
  if (Object.prototype.hasOwnProperty.call(body, 'photo')) {
    const ph = String(body.photo || '');
    if (ph && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(ph)) throw httpError(400, 'The photo must be a JPEG, PNG or WebP picture.');
    if (ph.length > 120000) throw httpError(400, 'The photo is too big. Pick a smaller one (the page shrinks it for you).');
    next.photo_data = ph;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'id_type')) {
    if (body.id_type && !ID_TYPES[body.id_type]) throw httpError(400, 'Pick the kind of ID.');
    next.id_type = body.id_type || '';
  }
  // A blank ID number keeps the saved one (staff only ever see it masked).
  if (body.id_number) {
    const idn = String(body.id_number).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{5,20}$/.test(idn)) throw httpError(400, 'The ID number should be 5 to 20 letters and numbers.');
    next.id_number = idn;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'id_expiry')) {
    const e = String(body.id_expiry || '');
    if (e && !/^\d{4}-\d{2}-\d{2}$/.test(e)) throw httpError(400, 'Pick the ID expiry date.');
    next.id_expiry = e || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'home_area')) next.home_area = String(body.home_area || '').trim().slice(0, 80);
  if (Object.prototype.hasOwnProperty.call(body, 'emergency_name')) next.emergency_name = String(body.emergency_name || '').trim().slice(0, 80);
  if (body.emergency_phone) {
    const d = String(body.emergency_phone).replace(/[^\d+]/g, '');
    if (d.replace(/\D/g, '').length < 9 || d.replace(/\D/g, '').length > 15) throw httpError(400, 'Type the emergency contact phone in full.');
    next.emergency_phone = d;
  }
  await db.query(
    `INSERT INTO staff_profiles (user_id, person_key, photo_data, id_type, id_number, id_expiry, home_area, emergency_name, emergency_phone, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (user_id) DO UPDATE SET person_key = EXCLUDED.person_key, photo_data = EXCLUDED.photo_data, id_type = EXCLUDED.id_type, id_number = EXCLUDED.id_number,
       id_expiry = EXCLUDED.id_expiry, home_area = EXCLUDED.home_area, emergency_name = EXCLUDED.emergency_name, emergency_phone = EXCLUDED.emergency_phone, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [userId, personKey || '', next.photo_data || '', next.id_type || '', next.id_number || '', next.id_expiry || null, next.home_area || '', next.emergency_name || '', next.emergency_phone || '', String(actor || '').slice(0, 120)]);
  return profileOf(userId);
}

module.exports = { home, myPay, performance, pace, maskTail, profileOf, saveProfile, salaryOf, ID_TYPES };
