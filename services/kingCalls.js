'use strict';

/**
 * One call, opened by King from a staff day timeline (Arthur, 21 Nov 2026):
 * transcript, summary, outcome, follow-up, actions taken, drop-offs, and
 * "Lessons learned" (key points and themes worked out from the call, plus
 * King's own note). Free rules over the text; no paid AI.
 */
const db = require('../config/database');
const calling = require('./callingScreen');

async function rows(sql, params = []) { return (await db.query(sql, params)).rows || []; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mask = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 3 ? `•••${d.slice(-3)}` : ''; };
const noDigits = (t) => String(t || '').replace(/\+?\d[\d\s-]{5,}\d/g, (m) => mask(m));

// Objections and themes heard on calls. Order matters only for display.
const THEMES = [
  ['price', 'Price / money', /\b(expensive|too much|money|price|cost|afford|cheap|discount|50,?000|fifty thousand|broke)\b/i],
  ['trust', 'Trust / is it real', /\b(scam|fake|trust|real\b|legit|fraud|cheat|believe)\b/i],
  ['timing', 'Timing / call later', /\b(later|busy|next week|tomorrow|call back|callback|another time|travelling|not now)\b/i],
  ['results', 'Will it bring clients', /\b(clients?|customers?|buyers?|tenants?|views?|leads?|results?|enquir(y|ies))\b/i],
  ['competitor', 'Uses another site', /\b(jiji|facebook|tiktok|instagram|whatsapp group|other site|property ?pro|lamudi)\b/i],
  ['payment', 'How to pay', /\b(momo|mobile money|airtel|pay|payment|merchant|code)\b/i],
  ['listings', 'Listings / photos', /\b(listings?|photos?|pictures?|upload|post(ing)?|properties)\b/i],
  ['not_agent', 'Not an agent / wrong person', /\b(not an agent|wrong number|landlord|owner|not me|retired)\b/i]
];
const EVENT_LABELS = {
  link_drop: 'Phone link / audio dropped', link_back: 'Phone link back', notes_check_passed: 'Mic check passed', notes_check_failed: 'Mic check failed',
  notes_start: 'Live notes on', notes_stop: 'Live notes off', notes_error: 'Live notes stopped', hidden: 'Left the screen', visible: 'Back on the screen',
  break_start: 'Break started', break_end: 'Break ended', work_on: 'Work mode on', work_off: 'Work mode off', meeting_start: 'Meeting', meeting_end: 'Meeting ended',
  inbound_start: 'Incoming call', screen_open: 'Opened the calling screen'
};
const DROP_KINDS = new Set(['link_drop', 'notes_error', 'notes_check_failed', 'hidden', 'work_off']);

/** Key points and themes from the call (pure, tested). */
function extractLessons({ text = '', note = '', nextStep = '', outcome = '', flags = [] } = {}) {
  const all = [text, note, nextStep].filter(Boolean).join('\n');
  const themes = THEMES.filter(([, , re]) => re.test(all)).map(([k]) => k);
  const sentences = String(all).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  const scored = sentences.map((s, i) => ({ s, i, score: THEMES.reduce((t, [, , re]) => t + (re.test(s) ? 2 : 0), 0) + (/\?/.test(s) ? 1 : 0) + (/\b(no|not|don'?t|won'?t|can'?t)\b/i.test(s) ? 1 : 0) - (/^(we|our|hello|hi|this is|i am calling)\b/i.test(s) ? 3 : 0) }));
  const seen = new Set();
  const points = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)
    .filter((x) => { const k = x.s.toLowerCase().slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 4).sort((a, b) => a.i - b.i).map((x) => noDigits(x.s).slice(0, 220));
  const lessons = [];
  if (flags.includes('no_transcript')) lessons.push('No live notes on this call: check the mic before calling.');
  if (themes.includes('price')) lessons.push('Price came up: lead with what one client is worth before the UGX 50,000.');
  if (themes.includes('trust')) lessons.push('Trust came up: offer a live listing link and the WhatsApp Hello.');
  if (themes.includes('timing') && !nextStep) lessons.push('They asked for later but no follow-up was set.');
  if (outcome === 'interested' || outcome === 'signed_up') lessons.push('Interested: get them to say Hi on WhatsApp the same day.');
  return { themes, key_points: points, suggestions: lessons };
}

function windowEvents(events, a) {
  const from = new Date(a.tapped_at || a.shown_at).getTime() - 60000;
  // An unfinished call has no end: look 15 minutes past the tap for what went wrong.
  const end = a.wrapped_at || a.ended_at;
  const to = end ? new Date(end).getTime() + 60000 : new Date(a.tapped_at || a.shown_at).getTime() + 15 * 60000;
  return events.filter((e) => { const t = new Date(e.at).getTime(); return t >= from && t <= to; });
}

async function callDetail(attemptId) {
  if (!UUID.test(String(attemptId || ''))) throw calling.httpError(400, 'Invalid call.');
  const a = (await rows(`SELECT id, session_id, person_key, task_key, direction, phone, phone_key, full_name, source_label, reason, status, shown_at, tapped_at, ended_at, wrapped_at,
      talk_s, outcome, is_close, spoke, note, next_step, callback_at, checklist, flags, client_ops, transcript, actor_account, skip_reason FROM call_attempts WHERE id = $1`, [attemptId]))[0];
  if (!a) throw calling.httpError(404, 'Call not found.');
  const [events, earlier, lesson, tasks] = await Promise.all([
    a.session_id ? rows('SELECT kind, detail, at FROM call_session_events WHERE session_id = $1 ORDER BY at', [a.session_id]) : [],
    rows(`SELECT id, person_key, outcome, COALESCE(wrapped_at, tapped_at, shown_at) AS at, note FROM call_attempts WHERE phone_key = $1 AND id <> $2 AND status = 'done' ORDER BY COALESCE(wrapped_at, tapped_at, shown_at) DESC LIMIT 10`, [a.phone_key, a.id]),
    rows('SELECT themes, key_points, king_note, updated_by, updated_at FROM call_lessons WHERE attempt_id = $1', [a.id]).catch(() => []),
    calling.loadTasks({ all: true }).catch(() => [])
  ]);
  const task = tasks.find((t) => t.key === a.task_key) || {};
  const outcomeDef = (task.outcomes || []).find((o) => o.key === a.outcome) || {};
  const tx = a.transcript || {};
  const flags = a.flags || [];
  const inWin = windowEvents(events, a);
  const auto = extractLessons({ text: tx.text || '', note: a.note || '', nextStep: a.next_step || '', outcome: a.outcome || '', flags });
  const saved = lesson[0] || null;
  const actions = [];
  if (a.shown_at) actions.push({ at: a.shown_at, what: 'Number shown' });
  if (a.tapped_at) actions.push({ at: a.tapped_at, what: 'Call now tapped' });
  if (a.ended_at) actions.push({ at: a.ended_at, what: `Call ended${a.talk_s != null ? ` · ${Math.round(a.talk_s)} s talk` : ''}` });
  for (const e of inWin) if (EVENT_LABELS[e.kind] && !DROP_KINDS.has(e.kind)) actions.push({ at: e.at, what: EVENT_LABELS[e.kind] + (e.detail ? ` · ${noDigits(e.detail).slice(0, 80)}` : '') });
  for (const op of a.client_ops || []) actions.push({ at: null, what: `Used: ${String(op).replace(/_/g, ' ').slice(0, 60)}` });
  const ck = a.checklist || {};
  for (const [k, v] of Object.entries(ck)) if (v && v !== 'false') actions.push({ at: null, what: `✓ ${k.replace(/_/g, ' ')}` });
  if (a.wrapped_at) actions.push({ at: a.wrapped_at, what: `Wrap-up saved: ${outcomeDef.label || a.outcome || 'no outcome'}` });
  actions.sort((x, y) => (x.at ? new Date(x.at).getTime() : Infinity) - (y.at ? new Date(y.at).getTime() : Infinity));
  const drops = inWin.filter((e) => DROP_KINDS.has(e.kind)).map((e) => ({ at: e.at, what: EVENT_LABELS[e.kind] || e.kind, detail: noDigits(e.detail || '').slice(0, 80) }));
  if (a.tapped_at && a.status !== 'done' && a.status !== 'skipped') drops.push({ at: a.tapped_at, what: 'Call never got an outcome', detail: '' });
  return {
    id: a.id, person_key: a.person_key, task_key: a.task_key, task_name: task.name || a.task_key, direction: a.direction || 'outbound',
    name: a.full_name || '', phone: mask(a.phone || a.phone_key), source: a.source_label || '', reason: a.reason || '',
    status: a.status, shown_at: a.shown_at, tapped_at: a.tapped_at, ended_at: a.ended_at, wrapped_at: a.wrapped_at, talk_s: a.talk_s == null ? null : Number(a.talk_s),
    outcome: a.outcome, outcome_label: outcomeDef.label || a.outcome || 'No outcome saved', paid: calling.closedPaid(a), spoke: Boolean(a.spoke),
    note: noDigits(a.note), next_step: noDigits(a.next_step), callback_at: a.callback_at, login: a.actor_account || '',
    flags, flag_labels: Object.fromEntries(flags.map((f) => [f, calling.FLAG_LABELS[f] || f])),
    transcript: { text: noDigits(tx.text || ''), summary: noDigits(tx.summary || ''), secs: tx.secs || null },
    actions, drops,
    earlier: earlier.map((e) => ({ id: e.id, at: e.at, by: e.person_key, outcome: e.outcome, note: noDigits(e.note).slice(0, 140) })),
    lessons: { themes: auto.themes, theme_labels: Object.fromEntries(THEMES.map(([k, l]) => [k, l])), key_points: auto.key_points, suggestions: auto.suggestions, king_note: saved ? saved.king_note : '', updated_by: saved ? saved.updated_by : '', updated_at: saved ? saved.updated_at : null }
  };
}

async function saveLesson(attemptId, { note = '', actor = 'King' } = {}) {
  const d = await callDetail(attemptId);
  const text = String(note || '').trim().slice(0, 2000);
  await db.query(`INSERT INTO call_lessons (attempt_id, person_key, themes, key_points, king_note, updated_by, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())
      ON CONFLICT (attempt_id) DO UPDATE SET themes = EXCLUDED.themes, key_points = EXCLUDED.key_points, king_note = EXCLUDED.king_note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
  [d.id, d.person_key || '', d.lessons.themes, JSON.stringify(d.lessons.key_points), text, String(actor || 'King').slice(0, 120)]);
  return { attempt_id: d.id, king_note: text, themes: d.lessons.themes };
}

module.exports = { extractLessons, callDetail, saveLesson, THEMES, windowEvents };
