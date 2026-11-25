'use strict';

/**
 * Staff desk 3b (Arthur, 21 Nov 2026): the pipeline pages.
 *  - Outcome owed: every dialled call ends with an outcome. Calls left without
 *    one (screen closed, connection lost) must get one before calling again.
 *  - My pipeline: Interested → Said Hi → To close → Paid, one bucket per number
 *    (the furthest stage it reached), from the person's own calls.
 *  - Agents to approve, Owes us money (with Chase), Missed calls.
 * Always one person's own data; phones masked to the last 3 digits except where
 * the person must dial (Chase adds the number to their own calling list).
 */
const db = require('../config/database');
const calling = require('./callingScreen');
const rules = require('./callingRules');
const { canonicalUgPhone, phoneKey9 } = require('../utils/ugPhone');

const logger = require('../config/logger');

// Reads never break a page; a failing query is logged so it is not silent.
async function rows(sql, params = []) {
  try { return (await db.query(sql, params)).rows || []; } catch (e) { logger.warn('staffPipeline read failed', { error: e.message }); return []; }
}
const httpError = calling.httpError;
const key9 = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);
const last3 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d ? `•••${d.slice(-3)}` : ''; };
const INTERESTED = ['interested', 'promised', 'will_list', 'signed_up'];
const TO_CLOSE = ['promised', 'signed_up'];
const DAY_MS = 86400000;

// ------------------------------------------------------------ owed outcome --

/** Dialled calls of this person with no outcome yet (last 14 days). */
async function owed(personKey) {
  if (!personKey) return [];
  const list = await rows(
    `SELECT id, phone_key, phone, full_name, task_key, tapped_at, status FROM call_attempts
      WHERE person_key = $1 AND tapped_at IS NOT NULL AND outcome IS NULL AND status IN ('calling', 'abandoned')
        AND tapped_at > NOW() - INTERVAL '14 days' AND COALESCE(direction, 'outbound') = 'outbound'
      ORDER BY tapped_at`, [personKey]);
  return list.map((a) => ({ id: a.id, name: a.full_name || '', phone: last3(a.phone || a.phone_key), task_key: a.task_key, at: a.tapped_at, open: a.status === 'calling' }));
}

/**
 * Give a dialled call its outcome later. Same rules as the wrap-up (outcome of the
 * task, a short note when they spoke, a next step unless it closes the loop),
 * flagged 'late_outcome' so King can see it was added afterwards.
 */
async function lateOutcome(personKey, attemptId, body = {}) {
  if (!personKey) throw httpError(403, 'Your login has no calling name.');
  if (!/^[0-9a-f-]{36}$/i.test(String(attemptId || ''))) throw httpError(400, 'Invalid call id.');
  const a = (await rows(`SELECT * FROM call_attempts WHERE id = $1`, [attemptId]))[0];
  if (!a || a.person_key !== personKey) throw httpError(404, 'That call was not found.');
  if (a.outcome || !a.tapped_at || !['calling', 'abandoned'].includes(a.status)) throw httpError(409, 'This call already has an outcome.');
  const task = (await calling.loadTasks({ all: true })).find((t) => t.key === a.task_key);
  const def = (task && Array.isArray(task.outcomes) ? task.outcomes : []).find((o) => o.key === String(body.outcome || ''));
  if (!def) throw httpError(400, 'Pick what happened on the call.');
  if (def.close) throw httpError(400, 'A paid close needs the full wrap-up: open the call from your calls and tick the steps.');
  let note = String(body.note || '').trim().slice(0, 1000);
  if (note.length < 3 && !def.spoke) note = def.label || def.key.replace(/_/g, ' ');
  if (note.length < 3) throw httpError(400, 'Write a short note about the call.');
  let next = String(body.next_step || '').trim().slice(0, 300);
  if (!next && def.key === 'no_answer') next = 'Try again next working day';
  const cb = body.callback_at ? new Date(body.callback_at) : null;
  if (cb && Number.isNaN(cb.getTime())) throw httpError(400, 'Pick a valid call-back time.');
  if (def.date === 'required' && !cb) throw httpError(400, 'Pick the date and time to call back.');
  if (cb && cb.getTime() < Date.now() + DAY_MS - 10 * 60000) throw httpError(400, 'Call backs are at least 24 hours away. Pick tomorrow or later.');
  if (!next && cb) next = 'Call back';
  if (!next && !calling.closesLoop(def)) throw httpError(400, 'Pick the next step (call back, chase payment, text them the link…).');
  const out = (await db.query(
    `UPDATE call_attempts SET status = 'done', outcome = $2, spoke = $3, is_close = false, note = $4, next_step = NULLIF($5, ''), callback_at = $6,
        wrapped_at = NOW(), flags = array_append(array_remove(COALESCE(flags, '{}'), 'late_outcome'), 'late_outcome')
      WHERE id = $1 AND person_key = $7 AND outcome IS NULL AND status IN ('calling', 'abandoned') RETURNING id, outcome, status`,
    [a.id, def.key, Boolean(def.spoke), note, next, cb, personKey])).rows[0];
  if (!out) throw httpError(409, 'This call already has an outcome.');
  return out;
}

// ---------------------------------------------------------------- pipeline --

const STAGES = ['contacted', 'interested', 'said_hi', 'to_close', 'paid'];
const STAGE_LABELS = { contacted: 'Contacted · text not sent', interested: 'Interested', said_hi: 'Said Hi', to_close: 'To close', paid: 'Paid' };

/** Furthest stage a number reached (pure, tested). */
function stageOf(n) {
  if (n.paid) return 'paid';
  // A final no (not interested, do not call, wrong number) takes the number out of the pipeline.
  if (n.last && rules.FINAL_NO.has(n.last.outcome) && !n.signed_up) return null;
  if (n.signed_up || TO_CLOSE.some((o) => n.outcomes.includes(o))) return 'to_close';
  if (n.said_hi) return 'said_hi';
  // Interested counts only once the follow-up text was marked sent (Arthur, 22 Nov 2026).
  if (INTERESTED.some((o) => n.outcomes.includes(o))) return n.text_sent ? 'interested' : 'contacted';
  return null;
}

async function pipeline(personKey, { days = null } = {}) {
  const empty = { stages: STAGES.map((k) => ({ key: k, label: STAGE_LABELS[k], items: [] })), since_days: days };
  if (!personKey) return empty;
  const calls = await rows(
    `SELECT id, phone_key, phone, full_name, outcome, next_step, callback_at, COALESCE(wrapped_at, tapped_at) AS at,
            (checklist->>'asked_hello') IN ('true', 'auto', 'manual') AS hi
       FROM call_attempts
      WHERE person_key = $1 AND status = 'done' AND phone_key IS NOT NULL AND ($2::int IS NULL OR COALESCE(wrapped_at, tapped_at) > NOW() - ($2::int * INTERVAL '1 day'))
      ORDER BY COALESCE(wrapped_at, tapped_at)`, [personKey, days == null ? null : Number(days)]);
  const by = new Map();
  for (const c of calls) {
    const n = by.get(c.phone_key) || { phone_key: c.phone_key, name: '', phone: '', outcomes: [], said_hi: false, first_at: c.at, last: null };
    n.name = c.full_name || n.name; n.phone = c.phone || n.phone;
    if (c.outcome) n.outcomes.push(c.outcome);
    if (c.hi) n.said_hi = true;
    n.last = c;
    by.set(c.phone_key, n);
  }
  const keys = [...by.keys()];
  if (keys.length) {
    // WhatsApp "Hello" read-only: an inbound message from the number after we first called counts as Said Hi.
    for (const h of await rows(
      `WITH m AS MATERIALIZED (SELECT RIGHT(REGEXP_REPLACE(COALESCE(user_phone, ''), '[^0-9]', '', 'g'), 9) AS k, created_at
                                 FROM whatsapp_messages WHERE direction = 'inbound' AND created_at >= $2::timestamptz)
       SELECT k, MIN(created_at) AS at FROM m WHERE k = ANY($1::text[]) GROUP BY k`, [keys, new Date(Math.min(...[...by.values()].map((v) => new Date(v.first_at).getTime())) - 7 * DAY_MS).toISOString()])) {
      const n = by.get(h.k); if (n && new Date(h.at) >= new Date(n.first_at)) n.said_hi = true;
    }
    for (const g of await rows(
      `SELECT RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(a.phone, ''), a.whatsapp, ''), '[^0-9]', '', 'g'), 9) AS k, a.status, a.agent_application_channel AS channel,
              EXISTS (SELECT 1 FROM revenue_entries r WHERE r.agent_id = a.id AND r.direction = 'in' AND r.kind = 'agent_subscription' AND r.voided_at IS NULL) AS paid
         FROM agents a WHERE a.removed_at IS NULL
          AND RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(a.phone, ''), a.whatsapp, ''), '[^0-9]', '', 'g'), 9) = ANY($1::text[])`, [keys])) {
      const n = by.get(g.k); if (!n) continue;
      // A profile we opened ourselves on Interested is not a sign-up: it waits for their Hi, then for payment.
      if (g.channel === 'calling_interested' && !g.paid) continue;
      n.signed_up = true; if (g.paid) n.paid = true;
    }
    for (const t of await rows('SELECT phone_key, MAX(at) AS at FROM call_sms_log WHERE phone_key = ANY($1::text[]) GROUP BY phone_key', [keys])) {
      const n = by.get(t.phone_key); if (n && new Date(t.at) >= new Date(n.first_at)) n.text_sent = true;
    }
    for (const c of calls) if (c.outcome === 'paid' || c.outcome === 'renewed') { const n = by.get(c.phone_key); if (n) n.paid = true; }
  }
  const out = empty;
  for (const n of by.values()) {
    const st = stageOf(n); if (!st) continue;
    out.stages[STAGES.indexOf(st)].items.push({
      phone_key_tail: last3(n.phone_key), name: n.name, phone: last3(n.phone || n.phone_key), said_hi: n.said_hi, text_sent: Boolean(n.text_sent), signed_up: Boolean(n.signed_up),
      last_at: n.last.at, last_outcome: n.last.outcome, next_step: n.last.next_step || '', callback_at: n.last.callback_at, attempt_id: n.last.id
    });
  }
  for (const s of out.stages) s.items.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  return out;
}

// --------------------------------------------------------- agents to approve --

/** Agents waiting for approval. Staff see all of them; a caller only those they called. */
async function toApprove(personKey, { caller = false, awaitingHi = false } = {}) {
  // awaitingHi: the profiles opened on an Interested / Signed up call instead. They approve
  // themselves when they say Hi, so they are not waiting on staff and are not in the badge,
  // but the page lists them so the staff desk shows what King sees (Arthur, 25 Nov 2026).
  const list = await rows(
    `SELECT a.id, a.full_name, COALESCE(NULLIF(a.phone, ''), a.whatsapp) AS phone, a.created_at, a.company_name AS agency_name,
            RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(a.phone, ''), a.whatsapp, ''), '[^0-9]', '', 'g'), 9) AS k
       FROM agents a WHERE a.removed_at IS NULL AND a.status = 'pending'
        -- Opened on an Interested call: approved by itself when they say Hi, so not waiting on staff.
        AND (COALESCE(a.agent_application_channel, '') = 'calling_interested') = $1
      ORDER BY a.created_at LIMIT 200`, [Boolean(awaitingHi)]);
  const keys = list.map((a) => a.k).filter(Boolean);
  const calledBy = new Map();
  if (keys.length) {
    for (const c of await rows(
      `SELECT DISTINCT ON (phone_key) phone_key, person_key, COALESCE(wrapped_at, tapped_at) AS at FROM call_attempts
        WHERE phone_key = ANY($1::text[]) AND status = 'done' ORDER BY phone_key, COALESCE(wrapped_at, tapped_at) DESC`, [keys])) calledBy.set(c.phone_key, c);
  }
  return list
    .map((a) => ({ id: a.id, name: a.full_name || '', agency: a.agency_name || '', phone: last3(a.phone), signed_up_at: a.created_at,
      waiting_days: Math.floor((Date.now() - new Date(a.created_at).getTime()) / DAY_MS), called_by: calledBy.get(a.k)?.person_key || '', mine: calledBy.get(a.k)?.person_key === personKey }))
    .filter((a) => !caller || a.mine);
}

// ------------------------------------------------------------ owes us money --

async function feeUgx() {
  const v = (await rows(`SELECT value FROM billing_settings WHERE key = 'agent_fee'`))[0]?.value;
  const n = Number((typeof v === 'string' ? JSON.parse(v || '{}') : v || {}).monthly_ugx);
  return Number.isFinite(n) && n > 0 ? n : 50000;
}

/** Approved agents past their paid-until date (or never paid), with the last chase. */
async function owes(personKey) {
  const fee = await feeUgx();
  const list = await rows(
    `SELECT a.id, a.full_name, COALESCE(NULLIF(a.phone, ''), a.whatsapp) AS phone, a.paid_until, COALESCE(a.approved_at, a.created_at) AS since,
            RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(a.phone, ''), a.whatsapp, ''), '[^0-9]', '', 'g'), 9) AS k
       FROM agents a
      WHERE a.removed_at IS NULL AND a.status = 'approved' AND COALESCE(a.fee_exempt, false) = false
        AND (a.paid_until IS NULL OR a.paid_until < (NOW() AT TIME ZONE 'Africa/Kampala')::date)
      ORDER BY a.paid_until NULLS FIRST, a.created_at LIMIT 300`);
  const keys = list.map((a) => a.k).filter(Boolean);
  const chase = new Map();
  if (keys.length) {
    for (const c of await rows(
      `SELECT DISTINCT ON (phone_key) phone_key, person_key, at, note FROM call_payment_actions
        WHERE phone_key = ANY($1::text[]) AND kind = 'chase' ORDER BY phone_key, at DESC`, [keys])) chase.set(c.phone_key, c);
  }
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  return {
    fee_ugx: fee,
    items: list.map((a) => {
      const from = a.paid_until ? String(a.paid_until instanceof Date ? a.paid_until.toISOString().slice(0, 10) : a.paid_until).slice(0, 10) : null;
      const overdueDays = from ? Math.max(0, Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / DAY_MS)) : null;
      const months = from ? Math.max(1, Math.ceil(overdueDays / 30)) : 1;
      const c = chase.get(a.k);
      const rf = rules.removeFlag({ paid_until: from, since: a.since });
      return { id: a.id, name: a.full_name || '', phone: last3(a.phone), paid_until: from, never_paid: !from, overdue_days: overdueDays, unpaid_days: rf.unpaid_days, remove_flag: rf.remove,
        owed_ugx: months * fee, last_chase: c ? { at: c.at, by: c.person_key, note: c.note || '', mine: c.person_key === personKey } : null };
    })
  };
}

/** Chase one agent: log it and put the number at the top of my "Get payments in" list. */
async function chase(personKey, agentId, { note = '' } = {}) {
  if (!personKey) throw httpError(403, 'Your login has no calling name.');
  if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) throw httpError(400, 'Invalid agent id.');
  const a = (await rows(`SELECT id, full_name, COALESCE(NULLIF(phone, ''), whatsapp) AS phone FROM agents WHERE id = $1 AND removed_at IS NULL AND status = 'approved'`, [agentId]))[0];
  if (!a || !a.phone) throw httpError(404, 'That agent was not found.');
  const canon = canonicalUgPhone(a.phone) || a.phone;
  const k = key9(canon);
  const block = await calling.blockOf(k).catch(() => null);
  if (block) throw httpError(409, 'This number is on the do-not-contact list.');
  const text = String(note || '').trim().slice(0, 300) || 'Payment chase';
  await db.query(`INSERT INTO call_payment_actions (phone_key, person_key, kind, note) VALUES ($1, $2, 'chase', $3)`, [k, personKey, text]);
  const queued = (await rows(`SELECT id FROM call_number_submissions WHERE person_key = $1 AND phone_key = $2 AND status = 'own' AND COALESCE(mode, 'new_agents') = 'payments'`, [personKey, k]))[0];
  if (!queued) {
    await db.query(
      `INSERT INTO call_number_submissions (person_key, full_name, phone, phone_key, note, status, added_by, mode, how_known)
       VALUES ($1, $2, $3, $4, $5, 'own', $1, 'payments', 'chase')`, [personKey, a.full_name || '', canon, k, text]);
  }
  return { ok: true, queued: !queued, phone: last3(a.phone) };
}

// ------------------------------------------------------------- missed calls --

/**
 * WhatsApp calls we missed on the company line (whatsapp_call_events, read only). They reach
 * the database only while the bridge reports calls; none have since 31 Aug 2026. Shown to every
 * caller until somebody calls the number back or takes it ("Call back").
 */
async function whatsappMissed({ days = 14 } = {}) {
  const list = await rows(
    `WITH e AS (
       SELECT DISTINCT ON (RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9))
              id, phone, contact_name, COALESCE(first_seen_at, created_at) AS at, RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) AS k
         FROM whatsapp_call_events
        WHERE LOWER(COALESCE(status, '')) IN ('missed', 'rejected', 'declined', 'no_answer', 'unanswered')
          AND COALESCE(first_seen_at, created_at) > NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9), COALESCE(first_seen_at, created_at) DESC)
     SELECT e.*,
            (SELECT MAX(COALESCE(a.wrapped_at, a.tapped_at)) FROM call_attempts a WHERE a.phone_key = e.k AND a.status = 'done' AND COALESCE(a.wrapped_at, a.tapped_at) > e.at) AS called_back_at,
            (SELECT m.person_key FROM call_missed m WHERE m.phone_key = e.k AND m.note = 'Missed WhatsApp call' AND m.missed_at >= e.at - INTERVAL '1 minute' ORDER BY m.id DESC LIMIT 1) AS taken_by
       FROM e WHERE length(e.k) = 9 ORDER BY e.at DESC LIMIT 100`, [days]);
  return list.map((m) => ({ id: `wa:${m.id}`, wa_event_id: m.id, name: m.contact_name || '', phone: last3(m.phone), at: m.at, source: 'whatsapp', note: 'Missed WhatsApp call', called_back_at: m.called_back_at, taken_by: m.taken_by || '' }));
}

/** "Call back" on a missed WhatsApp call: it becomes my missed call and the number goes to the top of my calls. */
async function takeWhatsappMissed(personKey, eventId) {
  if (!personKey) throw httpError(403, 'Your login has no calling name.');
  if (!/^[0-9a-f-]{36}$/i.test(String(eventId || ''))) throw httpError(400, 'Invalid call.');
  const e = (await rows(`SELECT id, phone, contact_name, COALESCE(first_seen_at, created_at) AS at FROM whatsapp_call_events WHERE id = $1`, [eventId]))[0];
  if (!e) throw httpError(404, 'That WhatsApp call was not found.');
  const phone = canonicalUgPhone(String(e.phone || '')) || '';
  const k = phoneKey9(phone);
  if (!k || !/^\+256\d{9}$/.test(phone)) throw httpError(400, 'That WhatsApp call is not from a Ugandan number. Reply on WhatsApp instead.');
  const had = (await rows(`SELECT id FROM call_missed WHERE phone_key = $1 AND note = 'Missed WhatsApp call' AND missed_at >= $2::timestamptz - INTERVAL '1 minute' LIMIT 1`, [k, e.at]))[0];
  if (!had) {
    await db.query(`INSERT INTO call_missed (person_key, phone, phone_key, name, missed_at, note, source) VALUES ($1, $2, $3, $4, $5, 'Missed WhatsApp call', 'manual')`,
      [personKey, phone, k, String(e.contact_name || '').slice(0, 80), e.at]);
  }
  const queued = (await rows(`SELECT id FROM call_number_submissions WHERE person_key = $1 AND phone_key = $2 AND status = 'own'`, [personKey, k]))[0];
  if (!queued && !(await calling.blockOf(k).catch(() => null))) {
    await db.query(
      `INSERT INTO call_number_submissions (person_key, full_name, phone, phone_key, note, status, added_by, mode, how_known)
       VALUES ($1, $2, $3, $4, 'Missed WhatsApp call: ring back', 'own', $1, 'new_agents', 'missed_call')`, [personKey, String(e.contact_name || '').slice(0, 80), phone, k]);
  }
  return { ok: true, phone: last3(phone) };
}

/** Follow-ups due now: my numbers whose last call set a call-back that has come round, with no call since. */
async function followUpsDue(personKey, { now = new Date() } = {}) {
  if (!personKey) return 0;
  const r = (await rows(
    `WITH last AS (
       SELECT DISTINCT ON (phone_key) phone_key, person_key, callback_at, outcome
         FROM call_attempts WHERE status = 'done' AND phone_key IS NOT NULL AND COALESCE(wrapped_at, tapped_at) > NOW() - INTERVAL '120 days'
        ORDER BY phone_key, COALESCE(wrapped_at, tapped_at) DESC)
     SELECT COUNT(*)::int AS n FROM last
      WHERE person_key = $1 AND callback_at IS NOT NULL AND callback_at <= $2
        AND NOT (outcome = ANY($3::text[]))
        AND NOT EXISTS (SELECT 1 FROM call_blocks b WHERE b.phone_key = last.phone_key AND b.removed_at IS NULL)`,
    [personKey, now, [...rules.FINAL_NO, 'paid', 'renewed']]))[0];
  return Number(r && r.n) || 0;
}

async function missed(personKey) {
  const wa = await whatsappMissed();
  if (!personKey) return wa;
  const list = await rows(
    `SELECT m.id, m.phone, m.phone_key, m.name, m.missed_at, m.source, m.note,
            (SELECT MAX(COALESCE(a.wrapped_at, a.tapped_at)) FROM call_attempts a WHERE a.phone_key = m.phone_key AND a.status = 'done' AND COALESCE(a.wrapped_at, a.tapped_at) > m.missed_at) AS called_back_at
       FROM call_missed m WHERE m.person_key = $1 AND m.dismissed_at IS NULL AND m.missed_at > NOW() - INTERVAL '14 days'
      ORDER BY m.missed_at DESC LIMIT 100`, [personKey]);
  // A WhatsApp call I took is stored as source 'manual' (the table's check allows manual/phone_app only) with this note.
  const own = list.map((m) => ({ id: Number(m.id), name: m.name, phone: last3(m.phone), at: m.missed_at, source: m.source, via: m.note === 'Missed WhatsApp call' ? 'whatsapp' : '', note: m.note, called_back_at: m.called_back_at }));
  // A WhatsApp call I already took shows once, as mine.
  return own.concat(wa.filter((w) => w.taken_by !== personKey)).sort((x, y) => new Date(y.at) - new Date(x.at));
}

async function logMissed(personKey, body = {}) {
  if (!personKey) throw httpError(403, 'Your login has no calling name.');
  const phone = canonicalUgPhone(String(body.phone || '').trim()) || '';
  const k = phoneKey9(phone);
  if (!k || !/^\+256\d{9}$/.test(phone)) throw httpError(400, 'Type the Ugandan number that called, like 0772 123 456.');
  const at = body.at ? new Date(body.at) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60000 || at.getTime() < Date.now() - 14 * DAY_MS) throw httpError(400, 'Pick when the call came in (the last 14 days).');
  const r = (await db.query(
    `INSERT INTO call_missed (person_key, phone, phone_key, name, missed_at, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [personKey, phone.slice(0, 40), k, String(body.name || '').trim().slice(0, 80), at, String(body.note || '').trim().slice(0, 300)])).rows[0];
  // Ring them back: the number goes to the top of my own list.
  const queued = (await rows(`SELECT id FROM call_number_submissions WHERE person_key = $1 AND phone_key = $2 AND status = 'own'`, [personKey, k]))[0];
  if (!queued && !(await calling.blockOf(k).catch(() => null))) {
    await db.query(
      `INSERT INTO call_number_submissions (person_key, full_name, phone, phone_key, note, status, added_by, mode, how_known)
       VALUES ($1, $2, $3, $4, 'Missed call: ring back', 'own', $1, 'new_agents', 'missed_call')`, [personKey, String(body.name || '').trim().slice(0, 80), phone.slice(0, 40), k]);
  }
  return { id: Number(r.id) };
}

async function dismissMissed(personKey, id) {
  const r = (await db.query(`UPDATE call_missed SET dismissed_at = NOW(), dismissed_by = $1 WHERE id = $2 AND person_key = $1 AND dismissed_at IS NULL RETURNING id`, [personKey, Number(id) || 0])).rows[0];
  if (!r) throw httpError(404, 'That missed call was not found.');
  return { ok: true };
}

module.exports = { owed, lateOutcome, stageOf, pipeline, STAGES, STAGE_LABELS, toApprove, owes, chase, missed, whatsappMissed, takeWhatsappMissed, followUpsDue, logMissed, dismissMissed, feeUgx, last3 };
