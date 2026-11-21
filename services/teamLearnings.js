'use strict';

/**
 * Rejections & lessons (Arthur, 21 Nov 2026, ops 3c part 2).
 *  - Why people said no on calls, and why listings were sent back, in the last
 *    30 days: team counts only (no names, no numbers).
 *  - A learnings store: staff suggest a lesson, optionally with a script line
 *    for one call type ("If they say … / We say …"). King approves (and may
 *    edit the words), declines with a note, or later retires it. Only approved
 *    script lines reach the calling screen, as team tips under "If they say…".
 */
const db = require('../config/database');
const logger = require('../config/logger');
const scripts = require('./callingScripts');

async function rows(sql, params = []) {
  try { return (await db.query(sql, params)).rows || []; } catch (e) { logger.warn('teamLearnings read failed', { error: e.message }); return []; }
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

// Why a call ended in a no. Most specific first; the words come from the wrap-up chips and skip reasons.
const CALL_REASONS = [
  ['free_trial', 'Wanted a free trial first', /free\s*tr(ia|ai)ls?/i],
  ['other_site', 'Uses another site (Jiji, Facebook…)', /another site|other site|jiji|facebook/i],
  ['price', 'Price too high', /price|expensive|afford|too much/i],
  ['no_clients', 'Wants to stop: no clients calling', /no client|want(s)? to stop|i want to stop/i],
  ['number', 'Asked where we got their number', /where did you get my number|who is this/i],
  ['not_agent', 'Not an agent / no places to list', /not an agent|no propert|no places/i],
  ['already_agent', 'Already an agent', /already an agent/i],
  ['stop_calling', 'Asked us to stop calling', /do not contact|asked us to stop/i],
  ['not_interested', 'Just not interested', /not int(e)?rested|rejected|^no\b/i]
];
// Why a listing was sent back.
const LISTING_REASONS = [
  ['not_property', 'Not a property listing', /not a property|not related to property|company video|comonay/i],
  ['duplicate', 'Duplicate or replaced', /duplicate|superseded|was an update/i],
  ['no_contact', 'No contact details', /contact/i],
  ['no_price', 'No real price', /price/i],
  ['no_area', 'No specific area', /area|location/i],
  ['photos', 'No photos or unclear photos', /photo|video/i],
  ['other_listing', 'Other (see the notes)', /./]
];
const THEMES = Object.freeze(Object.fromEntries([
  ...CALL_REASONS.map(([k, l]) => [k, l]),
  ...LISTING_REASONS.filter(([k]) => k !== 'other_listing').map(([k, l]) => [k, l]),
  ['other', 'Something else']
]));
const TASKS = Object.freeze({ new_agents: 'Get new agents', payments: 'Get payments in', retention: 'Client retention' });
// What the script already says for a reason (the existing "If they say…" answers), shown next to the counts.
const SCRIPT_FOR = { price: ['new_agents', 'It is too expensive'], free_trial: ['new_agents', 'Can I try it free first?'], other_site: ['new_agents', 'I already use Jiji or Facebook'], number: ['new_agents', 'Where did you get my number?'] };

function classify(list, text) {
  const t = String(text || '');
  for (const [key, label, re] of list) if (re.test(t)) return { key, label };
  return null;
}
function scriptLine(reason) {
  const s = SCRIPT_FOR[reason]; if (!s) return null;
  const o = ((scripts.OBJECTIONS || {})[s[0]] || []).find((x) => x[0] === s[1]);
  return o ? { task: TASKS[s[0]], if_they_say: o[0], we_say: o[1] } : null;
}

async function rejections({ days = 30 } = {}) {
  const d = Math.max(1, Math.min(90, Number(days) || 30));
  const [calls, listings] = await Promise.all([
    rows(`SELECT COALESCE(NULLIF(note, ''), NULLIF(skip_reason, ''), outcome) AS why
            FROM call_attempts
           WHERE COALESCE(wrapped_at, shown_at) >= NOW() - ($1 || ' days')::interval
             AND COALESCE(person_key, '') NOT IN (SELECT profile_data->>'person_key' FROM users WHERE role = 'moderator' AND COALESCE(profile_data->>'sandbox', 'false') = 'true' AND profile_data ? 'person_key')
             AND (outcome IN ('rejected', 'not_interested', 'wont_pay', 'not_renewing')
                  OR (status = 'skipped' AND skip_reason ~* '(not interested|free tr|already an agent|do not contact|no propert)'))`, [String(d)]),
    rows(`SELECT moderation_reason AS why FROM properties
           WHERE rejected_at >= NOW() - ($1 || ' days')::interval AND COALESCE(status, '') <> 'approved'
             AND COALESCE(moderation_reason, '') !~* '^(staff )?approved'`, [String(d)])
  ]);
  const tally = (list, src) => {
    const m = new Map();
    src.forEach((r) => { const c = classify(list, r.why); if (!c) return; const cur = m.get(c.key) || { key: c.key, label: c.label, count: 0 }; cur.count += 1; m.set(c.key, cur); });
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  const callReasons = tally(CALL_REASONS, calls).map((r) => ({ ...r, script: scriptLine(r.key) }));
  const listingReasons = tally(LISTING_REASONS, listings);
  return { days: d, calls: { total: callReasons.reduce((a, r) => a + r.count, 0), reasons: callReasons }, listings: { total: listingReasons.reduce((a, r) => a + r.count, 0), reasons: listingReasons } };
}

function shape(r, { king = false } = {}) {
  const out = {
    id: Number(r.id), theme: r.theme, theme_label: THEMES[r.theme] || 'Something else', lesson: r.lesson,
    script: r.task_key && r.if_they_say ? { task_key: r.task_key, task: TASKS[r.task_key] || '', if_they_say: r.if_they_say, we_say: r.we_say } : null,
    status: r.status, created_at: r.created_at, decided_at: r.decided_at, king_note: r.king_note || ''
  };
  if (king) { out.proposed_by = r.proposed_by || 'Staff'; out.decided_by = r.decided_by || ''; }
  return out;
}
function readInput(input = {}) {
  const theme = THEMES[input.theme] ? input.theme : '';
  if (!theme) throw httpError(400, 'Pick what the lesson is about.');
  const lesson = clean(input.lesson, 600);
  if (lesson.length < 10) throw httpError(400, 'Write the lesson in a sentence or two.');
  const ifSay = clean(input.if_they_say, 200); const weSay = clean(input.we_say, 400);
  let task = null;
  if (ifSay || weSay) {
    task = TASKS[input.task_key] ? input.task_key : null;
    if (!task) throw httpError(400, 'Pick which calls the script line is for.');
    if (ifSay.length < 3 || weSay.length < 3) throw httpError(400, 'Fill in both "If they say" and "We say", or leave both empty.');
  }
  return { theme, lesson, task, ifSay: task ? ifSay : '', weSay: task ? weSay : '' };
}
const SELECT = 'SELECT id, theme, lesson, task_key, if_they_say, we_say, status, proposed_by, created_at, decided_by, decided_at, king_note FROM team_learnings';

// ----------------------------------------------------------------- staff --
async function staffView(user = {}) {
  const [rej, approved, mine] = await Promise.all([
    rejections(),
    rows(`${SELECT} WHERE status = 'approved' ORDER BY decided_at DESC NULLS LAST, id DESC LIMIT 60`),
    user.userId ? rows(`${SELECT} WHERE proposed_by_user_id = $1 ORDER BY created_at DESC LIMIT 30`, [String(user.userId)]) : []
  ]);
  return { themes: THEMES, tasks: TASKS, rejections: rej, approved: approved.map((r) => shape(r)), mine: mine.map((r) => shape(r)) };
}
async function suggest(user = {}, input = {}) {
  if (!user.userId) throw httpError(401, 'Sign in first.');
  const v = readInput(input);
  const status = user.king ? 'approved' : 'suggested';
  const r = await db.query(`INSERT INTO team_learnings (theme, lesson, task_key, if_they_say, we_say, status, proposed_by_user_id, proposed_by, decided_by, decided_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, status`,
  [v.theme, v.lesson, v.task, v.ifSay, v.weSay, status, String(user.userId), clean(user.name, 120) || 'Staff', user.king ? (clean(user.name, 120) || 'King') : null, user.king ? new Date() : null]);
  return { id: Number(r.rows[0].id), status: r.rows[0].status };
}

// ------------------------------------------------------------------ King --
async function kingView() {
  const [rej, waiting, decided] = await Promise.all([
    rejections(),
    rows(`${SELECT} WHERE status = 'suggested' ORDER BY created_at ASC LIMIT 100`),
    rows(`${SELECT} WHERE status <> 'suggested' ORDER BY decided_at DESC NULLS LAST, id DESC LIMIT 60`)
  ]);
  return { themes: THEMES, tasks: TASKS, rejections: rej, waiting: waiting.map((r) => shape(r, { king: true })), decided: decided.map((r) => shape(r, { king: true })) };
}
// approve (King may edit the words first), decline (with a note staff see), retire (take an approved one off the calling screen).
async function decide(id, input = {}, { actor = 'King' } = {}) {
  const n = Number(id); if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'Unknown suggestion.');
  const action = String(input.action || '');
  const note = clean(input.note, 300);
  const by = clean(actor, 120) || 'King';
  const cur = (await rows(`${SELECT} WHERE id = $1`, [n]))[0];
  if (!cur) throw httpError(404, 'Suggestion not found.');
  if (action === 'approve') {
    if (cur.status !== 'suggested') throw httpError(409, 'This one has already been decided.');
    const v = readInput({ theme: input.theme || cur.theme, lesson: input.lesson != null ? input.lesson : cur.lesson, task_key: input.task_key !== undefined ? input.task_key : cur.task_key, if_they_say: input.if_they_say != null ? input.if_they_say : cur.if_they_say, we_say: input.we_say != null ? input.we_say : cur.we_say });
    await db.query(`UPDATE team_learnings SET status = 'approved', theme = $2, lesson = $3, task_key = $4, if_they_say = $5, we_say = $6, decided_by = $7, decided_at = NOW(), king_note = $8 WHERE id = $1 AND status = 'suggested'`,
      [n, v.theme, v.lesson, v.task, v.ifSay, v.weSay, by, note]);
    return { id: n, status: 'approved' };
  }
  if (action === 'decline') {
    if (cur.status !== 'suggested') throw httpError(409, 'This one has already been decided.');
    if (note.length < 3) throw httpError(400, 'Say why, so they learn from it too.');
    await db.query("UPDATE team_learnings SET status = 'declined', decided_by = $2, decided_at = NOW(), king_note = $3 WHERE id = $1 AND status = 'suggested'", [n, by, note]);
    return { id: n, status: 'declined' };
  }
  if (action === 'retire') {
    if (cur.status !== 'approved') throw httpError(409, 'Only an approved lesson can be retired.');
    await db.query("UPDATE team_learnings SET status = 'retired', decided_by = $2, decided_at = NOW(), king_note = COALESCE(NULLIF($3, ''), king_note) WHERE id = $1 AND status = 'approved'", [n, by, note]);
    return { id: n, status: 'retired' };
  }
  throw httpError(400, 'Approve, decline or retire.');
}
async function waitingCount() {
  const r = await rows("SELECT COUNT(*)::int AS n FROM team_learnings WHERE status = 'suggested'");
  return r[0] ? Number(r[0].n) : 0;
}

// --------------------------------------------------------- calling screen --
// Approved script lines, added after the written "If they say…" answers for their call type.
async function approvedTips() {
  const list = await rows("SELECT task_key, if_they_say, we_say FROM team_learnings WHERE status = 'approved' AND task_key IS NOT NULL AND if_they_say <> '' ORDER BY decided_at ASC NULLS LAST, id ASC LIMIT 60");
  const out = {};
  list.forEach((r) => { (out[r.task_key] = out[r.task_key] || []).push([r.if_they_say, r.we_say, 'team']); });
  return out;
}
function withTips(objections = {}, tips = {}) {
  const out = {};
  Object.keys(objections).forEach((k) => { out[k] = (objections[k] || []).slice(); });
  Object.keys(tips).forEach((k) => { out[k] = (out[k] || []).concat(tips[k]); });
  return out;
}

module.exports = { THEMES, TASKS, CALL_REASONS, LISTING_REASONS, classify, rejections, staffView, suggest, kingView, decide, waitingCount, approvedTips, withTips };
