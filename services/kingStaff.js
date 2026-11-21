'use strict';

/**
 * Staff, pay & targets (Arthur, 21 Nov 2026). King adds a person (their own
 * login, set up with a one-time link), removes them (login off, reason kept,
 * all history kept), sets a monthly salary (every change kept) and the daily
 * targets each morning.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const calling = require('./callingScreen');
const extras = require('./callingExtras');

async function rows(sql, params = []) { return (await db.query(sql, params)).rows || []; }
const httpError = calling.httpError;
const SCOPES = { caller: 'Calling only', staff: 'Staff desk + calling' };
const REMOVE_REASONS = { left: 'Left the company', performance: 'Performance', contract_end: 'Contract ended', break: 'Taking a break', other: 'Other' };
const mask = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 3 ? `•••${d.slice(-3)}` : ''; };

function monthOf(day) { const m = String(day || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[1]}-${m[2]}-01` : null; }
function prevDay(day) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

/** +256… from 07…, 2567…, +2567… or another full international number. */
function normalizePhone(v) {
  const raw = String(v || '').trim(); const d = raw.replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return `+256${d.slice(1)}`;
  if (/^256\d{9}$/.test(d)) return `+${d}`;
  if (/^7\d{8}$/.test(d)) return `+256${d}`;
  if (raw.startsWith('+') && d.length >= 10 && d.length <= 15) return `+${d}`;
  return null;
}
function ugxAmount(v) {
  const n = Math.round(Number(String(v == null ? '' : v).replace(/[,\s]/g, '').replace(/^UGX/i, '')));
  if (!Number.isFinite(n) || n < 0 || n > 100000000) throw httpError(400, 'Salary must be a whole number of UGX (0 to 100,000,000).');
  return n;
}
function wholeTarget(v, max, label) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) throw httpError(400, `${label} must be a whole number from 0 to ${max}.`);
  return n;
}

/** Salary that applies to a month: the latest set for that month, or else the last set before it. */
function salaryFor(history = [], month) {
  const sorted = history.filter((h) => String(h.month).slice(0, 10) <= month)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)) || new Date(b.set_at) - new Date(a.set_at));
  const h = sorted[0];
  return h ? { month, ugx: Number(h.salary_ugx), set_at: h.set_at, set_by: h.set_by, carried: String(h.month).slice(0, 10) !== month } : { month, ugx: null, carried: false };
}

async function freePersonKey(first) {
  const base = calling.cleanKey(first).replace(/[0-9]+$/, '') || 'staff';
  const taken = new Set([
    ...(await rows("SELECT LOWER(profile_data->>'person_key') AS k FROM users WHERE profile_data ? 'person_key'")).map((r) => r.k),
    ...(await rows('SELECT LOWER(person_key) AS k FROM commission_staff')).map((r) => r.k),
    ...(await rows('SELECT DISTINCT LOWER(person_key) AS k FROM call_targets')).map((r) => r.k),
    ...(await rows('SELECT DISTINCT LOWER(person_key) AS k FROM call_sessions')).map((r) => r.k)
  ]);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  throw httpError(409, 'Could not find a free name key for this person.');
}

async function list({ day = calling.kampalaDay() } = {}) {
  const month = monthOf(day);
  const users = await rows(
    `SELECT id::text AS id, first_name, last_name, email, phone, status, last_login_at, created_at, profile_data
       FROM users WHERE role = 'moderator' AND profile_data ? 'person_key' AND profile_data ? 'staff_scope'
        AND COALESCE(profile_data->>'sandbox', 'false') <> 'true'
      ORDER BY first_name`);
  const keys = users.map((u) => String(u.profile_data.person_key));
  const logins = await extras.listLogins().catch(() => []);
  const [targets, salaries, changes] = keys.length ? await Promise.all([
    rows(`SELECT DISTINCT ON (person_key) person_key, calls_per_day, closes_per_day, effective_from::text AS effective_from, set_by, set_at
            FROM call_targets WHERE person_key = ANY($1) AND effective_from <= $2::date ORDER BY person_key, effective_from DESC`, [keys, day]),
    rows('SELECT person_key, month::text AS month, salary_ugx, note, set_by, set_at FROM staff_salaries WHERE person_key = ANY($1) ORDER BY month DESC, set_at DESC', [keys]).catch(() => []),
    rows('SELECT person_key, action, reason, actor, at FROM staff_changes WHERE person_key = ANY($1) ORDER BY at DESC', [keys]).catch(() => [])
  ]) : [[], [], []];
  const people = users.map((u) => {
    const p = u.profile_data || {}; const key = String(p.person_key);
    const t = targets.find((x) => x.person_key === key);
    const hist = salaries.filter((s) => s.person_key === key);
    const login = logins.find((l) => String(l.user_id) === u.id) || {};
    const active = u.status === 'active';
    return {
      user_id: u.id, person_key: key, name: `${u.first_name}${u.last_name && u.last_name !== 'Makaug' ? ` ${u.last_name}` : ''}`.trim(), first_name: u.first_name,
      login: u.email, phone: mask(u.phone), scope: p.staff_scope, scope_label: SCOPES[p.staff_scope] || p.staff_scope, status: u.status, active,
      removed: !active && p.removed_at ? { at: p.removed_at, reason: p.removed_reason || '', reason_label: REMOVE_REASONS[p.removed_reason_code] || '', by: p.removed_by || '' } : null,
      password_set: p.password_setup === 'done', link_state: (login.link && login.link.state) || 'none', last_login_at: u.last_login_at, added_at: u.created_at,
      targets: t ? { calls_per_day: Number(t.calls_per_day), closes_per_day: Number(t.closes_per_day), effective_from: t.effective_from, set_today: t.effective_from === day, set_by: t.set_by } : { ...calling.DEFAULT_TARGETS, effective_from: null, set_today: false, default: true },
      salary: salaryFor(hist, month),
      salary_history: hist.slice(0, 24).map((h) => ({ month: h.month, ugx: Number(h.salary_ugx), note: h.note, set_by: h.set_by, set_at: h.set_at })),
      changes: changes.filter((c) => c.person_key === key).slice(0, 20)
    };
  });
  const act = people.filter((x) => x.active);
  return {
    day, month, scopes: SCOPES, remove_reasons: REMOVE_REASONS,
    people, active_count: act.length, targets_set_today: act.filter((x) => x.targets.set_today).length,
    payroll_month_ugx: act.reduce((s, x) => s + (x.salary.ugx || 0), 0)
  };
}

async function logChange(personKey, userId, action, reason, actor) {
  await db.query('INSERT INTO staff_changes (person_key, user_id, action, reason, actor) VALUES ($1, $2, $3, $4, $5)', [personKey, userId, action, String(reason || '').slice(0, 500), String(actor || 'King').slice(0, 120)]);
}

async function addStaff(input = {}, { actor = 'King', origin = 'https://makaug.com', day = calling.kampalaDay() } = {}) {
  const first = String(input.first_name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const last = String(input.last_name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!first || !/[A-Za-z]/.test(first)) throw httpError(400, 'Type their first name.');
  const phone = normalizePhone(input.phone);
  if (!phone) throw httpError(400, 'Type their phone number, e.g. 07XX XXX XXX.');
  const scope = SCOPES[input.scope] ? input.scope : 'caller';
  const calls = wholeTarget(input.calls_per_day == null || input.calls_per_day === '' ? calling.DEFAULT_TARGETS.calls_per_day : input.calls_per_day, 1000, 'Calls a day');
  const closes = wholeTarget(input.closes_per_day == null || input.closes_per_day === '' ? calling.DEFAULT_TARGETS.closes_per_day : input.closes_per_day, 200, 'Paid a day');
  const salary = input.salary_ugx == null || input.salary_ugx === '' ? null : ugxAmount(input.salary_ugx);
  const taken = await rows('SELECT id FROM users WHERE phone = $1 LIMIT 1', [phone]);
  if (taken.length) throw httpError(409, 'That phone number already has a makaug account. Use another number, or change that account in Staff accounts (advanced).');
  const key = await freePersonKey(first);
  const email = `${key}@staff.makaug.internal`;
  if ((await rows('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [email])).length) throw httpError(409, 'That login name is taken. Try a different first name spelling.');
  const code = `STAFF-${key.toUpperCase().slice(0, 12)}`;
  // Nobody knows this password: the person chooses their own with the one-time link.
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const profile = {
    audience: 'moderator', account_kind: 'moderator', staff_dashboard_enabled: true, staff_code: code, employee_number: code,
    staff_scope: scope, person_key: key, password_setup: 'pending', password_managed_by_admin: false,
    created_by: `King desk (${String(actor).slice(0, 80)})`
  };
  const user = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, email, role, password_hash, phone_verified, status, marketing_opt_in, weekly_tips_opt_in, preferred_contact_channel, preferred_language, profile_data)
     VALUES ($1, $2, $3, $4, 'moderator', $5, TRUE, 'active', FALSE, FALSE, 'email', 'en', $6::jsonb) RETURNING id::text AS id`,
    [first, last || 'Makaug', phone, email, hash, JSON.stringify(profile)])).rows[0];
  await calling.saveTargets({ targets: [{ person_key: key, calls_per_day: calls, closes_per_day: closes }], actor, day });
  if (salary != null) await db.query('INSERT INTO staff_salaries (person_key, month, salary_ugx, note, set_by) VALUES ($1, $2::date, $3, $4, $5)', [key, monthOf(day), salary, 'Starting salary', actor]);
  await logChange(key, user.id, 'added', SCOPES[scope], actor);
  const link = await extras.makeSetupLink(user.id, { actor, origin });
  return { user_id: user.id, person_key: key, name: first, login: email, scope, link };
}

async function staffUser(userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) throw httpError(400, 'Invalid staff id.');
  const u = (await rows(`SELECT id::text AS id, first_name, status, profile_data FROM users WHERE id = $1 AND role = 'moderator' AND profile_data ? 'person_key' AND profile_data ? 'staff_scope'`, [userId]))[0];
  if (!u) throw httpError(404, 'That staff member was not found.');
  return u;
}

async function removeStaff(userId, { reason_code = '', reason = '', actor = 'King' } = {}) {
  const u = await staffUser(userId);
  if (String(u.profile_data.sandbox) === 'true') throw httpError(409, 'The practice login is not staff.');
  if (u.status !== 'active') throw httpError(409, `${u.first_name} is already removed.`);
  const code = REMOVE_REASONS[reason_code] ? reason_code : '';
  const why = String(reason || '').trim().slice(0, 500);
  if (!code) throw httpError(400, 'Pick why they are leaving.');
  if (code === 'other' && why.length < 3) throw httpError(400, 'Write a short reason.');
  const now = new Date().toISOString();
  await db.query(
    `UPDATE users SET status = 'suspended', updated_at = NOW(),
       profile_data = COALESCE(profile_data, '{}'::jsonb) || jsonb_build_object('removed_at', $2::text, 'removed_reason_code', $3::text, 'removed_reason', $4::text, 'removed_by', $5::text)
     WHERE id = $1`, [u.id, now, code, why, actor]);
  await db.query('UPDATE staff_setup_links SET revoked_at = NOW() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [u.id]).catch(() => null);
  await logChange(u.profile_data.person_key, u.id, 'removed', `${REMOVE_REASONS[code]}${why ? `: ${why}` : ''}`, actor);
  return { user_id: u.id, person_key: u.profile_data.person_key, status: 'suspended', removed_at: now };
}

async function reactivateStaff(userId, { actor = 'King' } = {}) {
  const u = await staffUser(userId);
  if (u.status === 'active') throw httpError(409, `${u.first_name} is already active.`);
  if (!u.profile_data.removed_at) throw httpError(409, 'Only people removed here can be brought back here.');
  await db.query(
    `UPDATE users SET status = 'active', updated_at = NOW(),
       profile_data = (COALESCE(profile_data, '{}'::jsonb) - 'removed_at' - 'removed_reason_code' - 'removed_reason' - 'removed_by') || jsonb_build_object('reactivated_at', NOW()::text, 'reactivated_by', $2::text)
     WHERE id = $1`, [u.id, actor]);
  await logChange(u.profile_data.person_key, u.id, 'reactivated', '', actor);
  return { user_id: u.id, person_key: u.profile_data.person_key, status: 'active' };
}

async function setSalary(personKey, { month = '', salary_ugx, note = '', actor = 'King', day = calling.kampalaDay() } = {}) {
  const key = calling.cleanKey(personKey);
  const known = await rows("SELECT 1 FROM users WHERE profile_data->>'person_key' = $1 AND role = 'moderator' LIMIT 1", [key]);
  if (!known.length) throw httpError(404, 'That staff member was not found.');
  const m = monthOf(month || day);
  if (!m) throw httpError(400, 'Pick a month.');
  const amount = ugxAmount(salary_ugx);
  await db.query('INSERT INTO staff_salaries (person_key, month, salary_ugx, note, set_by) VALUES ($1, $2::date, $3, $4, $5)', [key, m, amount, String(note || '').slice(0, 200), actor]);
  return { person_key: key, month: m, salary_ugx: amount };
}

async function setTargets(items = [], { actor = 'King', day = calling.kampalaDay() } = {}) {
  const list = (Array.isArray(items) ? items : []).map((t) => ({ person_key: t.person_key, calls_per_day: wholeTarget(t.calls_per_day, 1000, 'Calls a day'), closes_per_day: wholeTarget(t.closes_per_day, 200, 'Paid a day') }));
  if (!list.length) throw httpError(400, 'No targets to save.');
  return calling.saveTargets({ targets: list, actor, day });
}

/** Morning: keep each active person's current targets for today (one tap). */
async function keepTargetsForToday({ actor = 'King', day = calling.kampalaDay() } = {}) {
  const l = await list({ day });
  const todo = l.people.filter((p) => p.active && !p.targets.set_today);
  if (!todo.length) return [];
  return calling.saveTargets({ targets: todo.map((p) => ({ person_key: p.person_key, calls_per_day: p.targets.calls_per_day, closes_per_day: p.targets.closes_per_day })), actor, day });
}

module.exports = { list, addStaff, removeStaff, reactivateStaff, setSalary, setTargets, keepTargetsForToday, normalizePhone, salaryFor, monthOf, prevDay, ugxAmount, SCOPES, REMOVE_REASONS };
