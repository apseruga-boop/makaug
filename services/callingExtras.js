'use strict';

/**
 * Calling screen, part 2 (16 Nov 2026, for Ronald's first day on 17 Nov).
 *
 *   Logins          Ronald's and Sharon's own staff logins (migration 230) and
 *                   one-time setup links: King makes one, it works once, for 48 h.
 *   WhatsApp feed   READ-ONLY view of inbound whatsapp_messages with suggested
 *                   replies from simple rules. Nothing is ever sent from here and
 *                   the WhatsApp bridge is not touched.
 *   Lead feed       new leads and enquiries; one tap puts the number on screen.
 *   Pipeline        the meeting review: every agent and prospect until they pay
 *                   or King archives them with a reason (never deleted).
 *   Timeline        every attempt on one number, follow-up by follow-up.
 *   Daily summary   saved at 17:00 Kampala (and whenever a session ends).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const calling = require('./callingScreen');
const scripts = require('./callingScripts');
const perf = require('./staffPerformance');
const { maskPhoneLast3 } = require('./outreachSenderName');
const { phoneKey9, canonicalUgPhone } = require('../utils/ugPhone');

const { httpError, kampalaDay, cleanKey } = calling;
const SETUP_HOURS = 48;
const TZ = 'Africa/Kampala';
const sandbox = require('./callingSandbox');

async function rows(sql, params = []) { return (await db.query(sql, params)).rows || []; }
async function safeRows(sql, params = []) { try { return await rows(sql, params); } catch (_) { return []; } }
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const textOf = (payload) => String((payload && (payload.effectiveBody || payload.body)) || '').trim();
const kampalaHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(d)) % 24;

// ------------------------------------------------------------------ logins --

async function staffLoginUsers() {
  return rows(
    `SELECT id, first_name, last_name, email, status, last_login_at, created_at, profile_data
       FROM users
      WHERE role = 'moderator' AND profile_data ? 'person_key' AND profile_data ? 'staff_scope'
      ORDER BY first_name`
  );
}

async function listLogins({ now = new Date() } = {}) {
  const users = await staffLoginUsers();
  const links = users.length ? await rows(
    `SELECT DISTINCT ON (user_id) user_id, created_at, expires_at, used_at, revoked_at, created_by
       FROM staff_setup_links WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, created_at DESC`,
    [users.map((u) => u.id)]
  ) : [];
  return users.map((u) => {
    const p = u.profile_data || {};
    const l = links.find((x) => String(x.user_id) === String(u.id));
    const linkState = !l ? 'none' : l.used_at ? 'used' : l.revoked_at ? 'revoked' : new Date(l.expires_at) < now ? 'expired' : 'waiting';
    return {
      user_id: u.id, person_key: p.person_key, name: (String(p.sandbox) === 'true' ? `${u.first_name} ${u.last_name || ''}` : `${u.first_name}`).trim(), login: u.email, scope: p.staff_scope, sandbox: String(p.sandbox) === 'true',
      password_set: p.password_setup === 'done', password_set_at: p.password_set_at || null,
      last_login_at: u.last_login_at, status: u.status,
      link: l ? { state: linkState, created_at: l.created_at, expires_at: l.expires_at, used_at: l.used_at, created_by: l.created_by } : { state: 'none' }
    };
  });
}

/** King makes a link. Older unused links for the same person stop working. The token is shown once, only its hash is kept. */
async function makeSetupLink(userId, { actor = 'King', origin = 'https://makaug.com', now = new Date() } = {}) {
  const u = (await staffLoginUsers()).find((x) => String(x.id) === String(userId));
  if (!u) throw httpError(404, 'That staff login was not found.');
  if (u.status !== 'active') throw httpError(409, 'That login is not active.');
  await db.query('UPDATE staff_setup_links SET revoked_at = $2 WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [u.id, now]);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + SETUP_HOURS * 3600000);
  await db.query('INSERT INTO staff_setup_links (user_id, token_hash, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)', [u.id, hash(token), actor, now, expires]);
  const base = String(origin || 'https://makaug.com').replace(/\/+$/, '');
  return { url: `${base}/staff-setup?t=${token}`, expires_at: expires.toISOString(), login: u.email, name: u.first_name };
}

async function linkFor(token, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) throw httpError(404, 'This setup link is not valid.');
  const l = (await rows(
    `SELECT l.*, u.first_name, u.email, u.status FROM staff_setup_links l JOIN users u ON u.id = l.user_id WHERE l.token_hash = $1`,
    [hash(token)]
  ))[0];
  if (!l) throw httpError(404, 'This setup link is not valid.');
  if (l.used_at) throw httpError(410, 'This setup link was already used. Ask Arthur for a new one if you need to reset your password.');
  if (l.revoked_at) throw httpError(410, 'This setup link was replaced by a newer one. Use the latest link Arthur sent.');
  if (new Date(l.expires_at) < now) throw httpError(410, 'This setup link has expired (links last 48 hours). Ask Arthur for a new one.');
  if (l.status !== 'active') throw httpError(410, 'This login is not active.');
  return l;
}

async function checkSetup(token) {
  const l = await linkFor(token);
  return { name: l.first_name, login: l.email, expires_at: l.expires_at };
}

function passwordProblem(pw = '') {
  const v = String(pw || '');
  if (v.length < 10) return 'Use at least 10 characters.';
  if (v.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return 'Use letters and at least one number.';
  return '';
}

async function completeSetup(token, password, { now = new Date() } = {}) {
  const problem = passwordProblem(password);
  if (problem) throw httpError(400, problem);
  const l = await linkFor(token, now);
  const pwHash = await bcrypt.hash(String(password), 12);
  // Mark the link used first and only if still unused, so it can never work twice.
  const claimed = await rows('UPDATE staff_setup_links SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id', [l.id, now]);
  if (!claimed.length) throw httpError(410, 'This setup link was already used.');
  await db.query(
    `UPDATE users SET password_hash = $2, updated_at = NOW(),
        profile_data = COALESCE(profile_data, '{}'::jsonb) || jsonb_build_object('password_setup', 'done', 'password_set_at', $3::text)
      WHERE id = $1`,
    [l.user_id, pwHash, now.toISOString()]
  );
  return { ok: true, login: l.email, name: l.first_name };
}

/** staff_scope 'caller' = calling screen only. */
function scopeOf(user = {}) {
  const p = user && user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
  return String(p.staff_scope || '');
}

// ------------------------------------------------------------ name lookup --

async function namesFor(keys = []) {
  const want = [...new Set(keys.filter(Boolean))];
  const out = new Map();
  if (!want.length) return out;
  for (const r of await safeRows("SELECT phone_key, name FROM contacts WHERE phone_key = ANY($1) AND COALESCE(name, '') <> ''", [want])) out.set(r.phone_key, r.name);
  for (const r of await safeRows("SELECT RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) AS k, full_name FROM agents WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = ANY($1)", [want])) out.set(r.k, `${r.full_name} (agent)`);
  for (const r of await safeRows("SELECT phone_key, full_name FROM agent_prospects WHERE phone_key = ANY($1) AND COALESCE(full_name, '') <> ''", [want])) if (!out.has(r.phone_key)) out.set(r.phone_key, r.full_name);
  return out;
}

async function calledInfo(keys = []) {
  const want = [...new Set(keys.filter(Boolean))];
  if (!want.length) return new Map();
  const list = await rows(
    `SELECT DISTINCT ON (phone_key) phone_key, person_key, outcome, status, COALESCE(wrapped_at, shown_at) AS at
       FROM call_attempts WHERE phone_key = ANY($1) AND status IN ('done', 'shown', 'calling') ORDER BY phone_key, COALESCE(wrapped_at, shown_at) DESC`,
    [want]
  );
  return new Map(list.map((r) => [r.phone_key, r]));
}

// ---------------------------------------------------------- WhatsApp (RO) --

/** Newest conversations first: the latest inbound message per number. Read only. */
async function whatsappFeed({ limit = 30, days = 14 } = {}) {
  const list = await safeRows(
    `SELECT DISTINCT ON (user_phone) id, user_phone, payload, created_at
       FROM whatsapp_messages
      WHERE direction = 'inbound' AND created_at > NOW() - ($1 || ' days')::interval
      ORDER BY user_phone, created_at DESC`,
    [String(days)]
  );
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const top = list.slice(0, limit);
  const names = await namesFor(top.map((r) => phoneKey9(r.user_phone)));
  const called = await calledInfo(top.map((r) => phoneKey9(r.user_phone)));
  return top.map((r) => {
    const key = phoneKey9(r.user_phone);
    const c = called.get(key);
    return {
      ref: r.id, phone: maskPhoneLast3(r.user_phone), name: names.get(key) || '', at: r.created_at,
      text: textOf(r.payload).slice(0, 160) || (r.payload && r.payload.mediaType ? `[${r.payload.mediaType}]` : '[message]'),
      called: c ? { by: c.person_key, outcome: c.outcome || c.status, at: c.at } : null
    };
  });
}

async function whatsappThread(ref, { caller = '' } = {}) {
  const head = (await safeRows('SELECT user_phone FROM whatsapp_messages WHERE id::text = $1', [String(ref || '')]))[0];
  if (!head) throw httpError(404, 'Conversation not found.');
  const msgs = await rows(
    `SELECT direction, payload, created_at FROM whatsapp_messages WHERE user_phone = $1 ORDER BY created_at DESC LIMIT 60`,
    [head.user_phone]
  );
  const key = phoneKey9(head.user_phone);
  const name = (await namesFor([key])).get(key) || '';
  const lastIn = msgs.find((m) => m.direction === 'inbound');
  const vars = { caller: caller || 'the makaug team', name };
  return {
    ref, phone: maskPhoneLast3(head.user_phone), name,
    messages: msgs.reverse().map((m) => ({ direction: m.direction, at: m.created_at, text: textOf(m.payload) || (m.payload && m.payload.mediaType ? `[${m.payload.mediaType}]` : '[message]') })),
    suggestions: scripts.suggestReplies(lastIn ? textOf(lastIn.payload) : '').map((t) => scripts.fill(t, vars)),
    read_only: true
  };
}

// --------------------------------------------------------------- lead feed --

async function leadFeed({ days = 7, limit = 25 } = {}) {
  const leads = await safeRows(
    `SELECT l.id::text AS id, 'lead' AS kind, COALESCE(c.phone, c.whatsapp, l.metadata->>'phone', l.metadata->>'contact_phone') AS phone,
            COALESCE(NULLIF(c.name, ''), l.metadata->>'name', l.metadata->>'contact_name') AS name, l.source, l.category, l.location,
            l.message, l.created_at
       FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id
      WHERE l.created_at > NOW() - ($1 || ' days')::interval AND COALESCE(l.is_test, false) = false AND l.deleted_at IS NULL
      ORDER BY l.created_at DESC LIMIT 80`,
    [String(days)]
  );
  const inq = await safeRows(
    `SELECT id::text AS id, 'enquiry' AS kind, contact_phone AS phone, contact_name AS name, channel AS source, NULL AS category, NULL AS location, message, created_at
       FROM property_inquiries WHERE created_at > NOW() - ($1 || ' days')::interval ORDER BY created_at DESC LIMIT 40`,
    [String(days)]
  );
  const all = [...leads, ...inq].filter((r) => phoneKey9(r.phone)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const seen = new Set();
  const unique = all.filter((r) => { const k = phoneKey9(r.phone); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  const called = await calledInfo(unique.map((r) => phoneKey9(r.phone)));
  return unique.map((r) => {
    const c = called.get(phoneKey9(r.phone));
    return {
      kind: r.kind, ref: r.id, name: r.name || '', phone: maskPhoneLast3(r.phone), at: r.created_at,
      source: String(r.source || '').replace(/_/g, ' '),
      text: [r.category, r.location, String(r.message || '').slice(0, 120)].filter(Boolean).join(' · '),
      called: c ? { by: c.person_key, outcome: c.outcome || c.status, at: c.at } : null
    };
  });
}

async function resolveContact(kind, ref) {
  if (kind === 'lead') {
    const r = (await safeRows(
      `SELECT COALESCE(c.phone, c.whatsapp, l.metadata->>'phone', l.metadata->>'contact_phone') AS phone, COALESCE(NULLIF(c.name, ''), l.metadata->>'name') AS name, l.source, l.category, l.location
         FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id WHERE l.id::text = $1`, [String(ref)]))[0];
    if (r) return { ...r, label: `New lead · ${String(r.source || 'website').replace(/_/g, ' ')}`, reason: [r.category, r.location].filter(Boolean).join(' · ') };
  } else if (kind === 'enquiry') {
    const r = (await safeRows('SELECT contact_phone AS phone, contact_name AS name, channel FROM property_inquiries WHERE id::text = $1', [String(ref)]))[0];
    if (r) return { ...r, label: `Property enquiry · ${r.channel || 'website'}`, reason: '' };
  } else if (kind === 'whatsapp') {
    const r = (await safeRows('SELECT user_phone AS phone FROM whatsapp_messages WHERE id::text = $1', [String(ref)]))[0];
    if (r) { const key = phoneKey9(r.phone); return { ...r, name: (await namesFor([key])).get(key) || '', label: 'WhatsApp message', reason: '' }; }
  }
  throw httpError(404, 'That lead was not found.');
}

/**
 * Put a lead on the caller's screen now. Same never-twice rules as the queue:
 * not if someone else has it open, not do-not-contact, not called today.
 */
async function claimContact(sessionId, { kind = '', ref = '', now = new Date() } = {}) {
  const s = await calling.openSession(sessionId);
  if (await sandbox.isSandbox(s.person_key)) throw httpError(409, `${sandbox.PRACTICE_MSG} pulls a real WhatsApp contact or lead into your queue.`);
  const c = await resolveContact(String(kind), ref);
  const key = phoneKey9(c.phone);
  if (!key) throw httpError(400, 'That lead has no Ugandan phone number.');
  const busy = (await rows("SELECT id FROM call_attempts WHERE session_id = $1 AND status = 'calling'", [sessionId]))[0];
  if (busy) throw httpError(409, 'Finish the wrap-up for this call first.');
  const tasks = await calling.loadTasks({ all: true });
  const task = tasks.find((t) => t.key === s.task_key);
  const history = (await calling.attemptsFor([key])).get(key) || [];
  const mine = history.find((a) => (a.status === 'shown' || a.status === 'calling'));
  const dnc = (await safeRows('SELECT 1 FROM agent_prospects WHERE phone_key = $1 AND do_not_contact LIMIT 1', [key])).length > 0;
  if (dnc) throw httpError(409, 'This person asked not to be called.');
  if (!(mine && history.length && mine.person_key === s.person_key)) {
    const e = calling.eligibility(history, task, { now, tasks });
    if (!e.ok && e.why !== 'callback_other_task' && e.why !== 'closed' && e.why !== 'already_called' && e.why !== 'already_spoken' && e.why !== 'cooldown' && e.why !== 'no_answer_24h') {
      const why = { open_elsewhere: 'Someone else has this number on screen right now.', do_not_contact: 'This person asked not to be called (or the number is wrong).', called_today: 'This number was already called today.', callback_later: 'A callback is already booked for later.', too_many_no_answer: 'Three calls in a row were not answered.' }[e.why] || 'This number cannot be called now.';
      throw httpError(409, why);
    }
  }
  await db.query("UPDATE call_attempts SET status = 'released' WHERE session_id = $1 AND status = 'shown'", [sessionId]);
  const row = (await rows(
    `INSERT INTO call_attempts (session_id, person_key, task_key, phone, phone_key, full_name, source_kind, source_label, reason, script_variant, shown_at, actor_account, actor_user_id)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, actor_account, actor_user_id FROM call_sessions WHERE id = $1
     ON CONFLICT (phone_key) WHERE status IN ('shown', 'calling') DO NOTHING RETURNING *`,
    [sessionId, s.person_key, task.key, canonicalUgPhone(c.phone), key, c.name || null, kind === 'whatsapp' ? 'whatsapp' : 'lead', c.label, c.reason || null, kind === 'whatsapp' && task.key !== 'new_agents' ? (task.script_variants || [])[0] : 'lead_follow_up', now]
  ))[0];
  if (!row) throw httpError(409, 'Someone else has this number on screen right now.');
  return { attempt_id: row.id };
}

// ---------------------------------------------------------------- pipeline --

const NEGATIVE_END = new Set(['do_not_contact', 'wrong_number']);

/** Every agent who has not paid and every live prospect, one at a time, until they pay or King archives them. */
async function pipeline({ includeArchived = false, now = new Date() } = {}) {
  const today = kampalaDay(now);
  const [agents, prospects, attempts, items, events, pays] = await Promise.all([
    safeRows(`SELECT id, full_name, phone, status, paid_until, last_payment_on, fee_exempt, created_at FROM agents WHERE removed_at IS NULL AND status = 'approved'`),
    safeRows(`SELECT id, full_name, phone, phone_key, status, do_not_contact, follow_up_at, follow_up_note, pitched_at, created_at FROM agent_prospects`),
    rows(`SELECT phone_key, phone, full_name, person_key, task_key, outcome, note, callback_at, wrapped_at, shown_at, tapped_at, talk_s, status, next_step, transcript FROM call_attempts WHERE status = 'done' AND ${sandbox.REAL_PEOPLE()} ORDER BY wrapped_at DESC`),
    rows('SELECT * FROM pipeline_items'),
    safeRows(`SELECT phone_key, outcome, note, created_at, person_key FROM outreach_events WHERE kind = 'outcome' ORDER BY created_at DESC LIMIT 2000`),
    safeRows(`SELECT agent_id, MAX(paid_at) AS paid_at, SUM(amount_ugx)::bigint AS total FROM revenue_entries WHERE direction = 'in' AND kind = 'agent_subscription' AND voided_at IS NULL GROUP BY agent_id`)
  ]);
  const [skipRows, helloRows] = await Promise.all([
    rows(`SELECT phone_key, COUNT(*)::int AS n, (array_agg(skip_reason ORDER BY shown_at DESC))[1] AS last FROM call_attempts WHERE status = 'skipped' GROUP BY phone_key`),
    safeRows(`SELECT RIGHT(regexp_replace(user_phone, '\\D', '', 'g'), 9) AS phone_key, MIN(created_at) AS first_at FROM whatsapp_messages WHERE direction = 'inbound' GROUP BY 1`)
  ]);
  const skipsBy = new Map(skipRows.map((r) => [r.phone_key, r]));
  const helloBy = new Map(helloRows.map((r) => [r.phone_key, r.first_at]));
  const byKey = new Map();
  const put = (key, base) => { if (!key) return null; const cur = byKey.get(key) || { phone_key: key }; byKey.set(key, { ...base, ...cur, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v != null && v !== '')) }); return byKey.get(key); };
  for (const p of prospects) {
    if (p.do_not_contact) continue;
    put(p.phone_key || phoneKey9(p.phone), { kind: 'prospect', name: p.full_name, phone: p.phone, stage: `Prospect · ${String(p.status || 'new').replace(/_/g, ' ')}`, prospect_followup: p.follow_up_at, since: p.created_at });
  }
  for (const a of attempts) {
    if (a.task_key !== 'new_agents' || byKey.has(a.phone_key)) continue;
    if (['interested', 'call_back', 'signed_up'].includes(a.outcome)) put(a.phone_key, { kind: 'prospect', name: a.full_name, phone: a.phone, stage: `Prospect · ${a.outcome.replace(/_/g, ' ')}`, since: a.wrapped_at });
  }
  for (const a of agents) {
    const key = phoneKey9(a.phone);
    const paid = a.paid_until && String(a.paid_until).slice(0, 10) >= today;
    if (paid || a.fee_exempt) { byKey.delete(key); continue; } // paid (or never charged): off the list
    const pay = pays.find((x) => String(x.agent_id) === String(a.id));
    put(key, { kind: 'agent', name: a.full_name, phone: a.phone, stage: a.paid_until ? `Agent · payment lapsed ${String(a.paid_until).slice(0, 10)}` : 'Agent · signed up, not paid', payment: pay ? `Last paid ${new Date(pay.paid_at).toISOString().slice(0, 10)}` : 'Never paid', since: a.created_at });
  }
  const out = [];
  for (const [key, it] of byKey) {
    const item = items.find((x) => x.phone_key === key);
    if (item?.archived_at && !includeArchived) continue;
    const mine = attempts.filter((a) => a.phone_key === key);
    const last = mine[0];
    if (last && NEGATIVE_END.has(last.outcome)) continue;
    const ev = events.find((e) => e.phone_key === key);
    const said = [last && { at: last.wrapped_at, by: last.person_key, text: `${last.outcome.replace(/_/g, ' ')}${last.note ? `: ${last.note}` : ''}` }, ev && { at: ev.created_at, by: ev.person_key, text: `Outreach ${String(ev.outcome || '').replace(/_/g, ' ')}${ev.note ? `: ${ev.note}` : ''}` }]
      .filter(Boolean).sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
    const openCb = last && last.callback_at ? last.callback_at : it.prospect_followup || null;
    const due = item?.next_action_due ? String(item.next_action_due).slice(0, 10) : (openCb ? kampalaDay(openCb) : null);
    out.push({
      phone_key: key, phone: maskPhoneLast3(it.phone), name: it.name || '', kind: it.kind, stage: it.stage,
      payment: it.payment || (it.kind === 'agent' ? 'Not paid' : 'Not an agent yet'),
      last_said: said, calls: mine.length,
      skips: skipsBy.get(key)?.n || 0, last_skip: skipsBy.get(key)?.last || null,
      // The loop is open when the last call was not a close / final no and has no next step.
      open_loop: Boolean(last && !last.next_step && !last.callback_at && !['signed_up', 'paid', 'renewed', 'rejected', 'do_not_contact', 'wrong_number', 'no_answer'].includes(last.outcome)),
      last_transcript: last && last.transcript ? { at: last.wrapped_at, by: last.person_key, summary: last.transcript.summary || '', next_step: last.next_step || last.transcript.suggested_next_step || '', text: String(last.transcript.text || '').slice(0, 1500), confirmed: last.transcript.confirmed } : null,
      last_next_step: last ? last.next_step || null : null,
      said_hello: helloBy.has(key) ? { at: helloBy.get(key) } : null,
      next_action: item?.next_action || (last && last.callback_at ? `Call back (${last.outcome.replace(/_/g, ' ')})` : (last ? 'Call again' : 'First call')),
      due, overdue: Boolean(due && due < today), decision: item?.decision || '', owner: item?.owner_key || (last ? last.person_key : ''),
      archived: item?.archived_at ? { at: item.archived_at, reason: item.archive_reason } : null,
      history: item?.history || []
    });
  }
  const rank = (x) => (x.open_loop ? -1 : x.overdue ? 0 : x.due === today ? 1 : x.due ? 2 : 3);
  out.sort((a, b) => rank(a) - rank(b) || String(a.due || '9').localeCompare(String(b.due || '9')) || a.name.localeCompare(b.name));
  return { day: today, total: out.length, overdue: out.filter((x) => x.overdue).length, items: out };
}

async function savePipeline(phoneKey, { decision, next_action: nextAction, due, owner, archive = false, unarchive = false, reason = '', actor = 'King' } = {}) {
  const key = String(phoneKey || '');
  if (!/^[0-9]{9}$/.test(key)) throw httpError(400, 'Unknown contact.');
  if (archive && String(reason || '').trim().length < 3) throw httpError(400, 'Give a reason to close this one out.');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(String(due))) throw httpError(400, 'Pick a valid due date.');
  const entry = { at: new Date().toISOString(), by: actor, decision: decision || undefined, next_action: nextAction || undefined, due: due || undefined, archived: archive ? String(reason).trim() : undefined, unarchived: unarchive || undefined };
  const row = (await rows(
    `INSERT INTO pipeline_items (phone_key, decision, next_action, next_action_due, owner_key, archived_at, archive_reason, history, updated_by, updated_at)
     VALUES ($1, $2, $3, $4::date, $5, CASE WHEN $6 THEN NOW() END, CASE WHEN $6 THEN $7 END, jsonb_build_array($8::jsonb), $9, NOW())
     ON CONFLICT (phone_key) DO UPDATE SET
       decision = COALESCE(EXCLUDED.decision, pipeline_items.decision),
       next_action = COALESCE(EXCLUDED.next_action, pipeline_items.next_action),
       next_action_due = COALESCE(EXCLUDED.next_action_due, pipeline_items.next_action_due),
       owner_key = COALESCE(EXCLUDED.owner_key, pipeline_items.owner_key),
       archived_at = CASE WHEN $6 THEN NOW() WHEN $10 THEN NULL ELSE pipeline_items.archived_at END,
       archive_reason = CASE WHEN $6 THEN $7 WHEN $10 THEN NULL ELSE pipeline_items.archive_reason END,
       history = pipeline_items.history || $8::jsonb, updated_by = $9, updated_at = NOW()
     RETURNING *`,
    [key, decision || null, nextAction || null, due || null, owner ? cleanKey(owner) : null, Boolean(archive), String(reason || '').trim() || null, JSON.stringify(entry), actor, Boolean(unarchive)]
  ))[0];
  return { phone_key: row.phone_key, archived: Boolean(row.archived_at) };
}

// ---------------------------------------------------------------- timeline --

/**
 * Every touch on one number, oldest first, as a chain: each call hangs under
 * the call whose callback it answers (or the one before it). Proof per call:
 * when it was shown, tapped, ended, how long, by whom, from which login.
 */
async function timeline({ attemptId = '', phoneKey = '' } = {}) {
  let key = String(phoneKey || '');
  if (attemptId) key = (await rows('SELECT phone_key FROM call_attempts WHERE id::text = $1', [String(attemptId)]))[0]?.phone_key || '';
  if (!/^[0-9]{9}$/.test(key)) throw httpError(404, 'Number not found.');
  const [atts, evs, item, wa] = await Promise.all([
    rows(`SELECT id, direction, person_key, task_key, full_name, phone, status, outcome, note, callback_at, shown_at, tapped_at, ended_at, wrapped_at, talk_s, skip_reason, flags, actor_account, source_label, next_step, transcript
            FROM call_attempts WHERE phone_key = $1 AND status IN ('done', 'skipped', 'shown', 'calling') ORDER BY shown_at`, [key]),
    safeRows(`SELECT kind, outcome, note, person_key, created_at FROM outreach_events WHERE phone_key = $1 ORDER BY created_at`, [key]),
    rows('SELECT * FROM pipeline_items WHERE phone_key = $1', [key]),
    safeRows(`SELECT direction, COUNT(*)::int AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM whatsapp_messages WHERE RIGHT(regexp_replace(user_phone, '\\D', '', 'g'), 9) = $1 GROUP BY direction`, [key])
  ]);
  const nodes = [];
  let prevCall = null;
  let openCallback = null;
  for (const a of atts) {
    const parent = openCallback || prevCall;
    const node = {
      id: a.id, type: 'call', direction: a.direction || 'outbound', parent: parent ? parent.id : null, by: a.person_key, task: a.task_key, login: a.actor_account,
      shown_at: a.shown_at, tapped_at: a.tapped_at, ended_at: a.ended_at, wrapped_at: a.wrapped_at, talk_s: a.talk_s,
      outcome: a.status === 'skipped' ? 'skipped' : (a.outcome || a.status), note: a.note || a.skip_reason || '', flags: a.flags || [],
      callback_at: a.callback_at, follow_up_of: openCallback ? openCallback.id : null,
      next_step: a.next_step || null, transcript: a.transcript || null,
      proof: a.tapped_at ? 'served and tapped' : (a.status === 'done' ? 'outcome without a tap' : 'served, not tapped')
    };
    if (openCallback) node.on_time = new Date(a.shown_at) <= new Date(new Date(openCallback.callback_at).getTime() + 86400000);
    nodes.push(node);
    if (a.status === 'done') { prevCall = node; openCallback = a.callback_at ? node : null; }
  }
  const last = atts.filter((a) => a.status === 'done').slice(-1)[0];
  const head = atts[0] || {};
  return {
    phone_key_masked: maskPhoneLast3(head.phone || key), name: head.full_name || '',
    nodes,
    sms: (await safeRows('SELECT at, person_key AS by, lang, template FROM call_sms_log WHERE phone_key = $1 ORDER BY at', [key])),
    videos: (await safeRows('SELECT requested_at AS at, person_key AS by, video_key, status, decided_by, sent_at, sent_via, opens FROM call_video_requests WHERE phone_key = $1 ORDER BY requested_at', [key])),
    blocked: (await safeRows('SELECT reason, blocked_by AS by, blocked_at AS at FROM call_blocks WHERE phone_key = $1 AND removed_at IS NULL', [key]))[0] || null,
    outreach: evs.map((e) => ({ at: e.created_at, kind: e.kind, outcome: e.outcome, note: e.note, by: e.person_key })),
    whatsapp: wa,
    said_hello: (() => { const i = wa.find((w) => w.direction === 'inbound'); return i ? { at: i.first, messages: i.n } : null; })(),
    skips: atts.filter((a) => a.status === 'skipped').map((a) => ({ at: a.wrapped_at || a.shown_at, by: a.person_key, reason: a.skip_reason })),
    decision: item[0] ? { decision: item[0].decision, next_action: item[0].next_action, due: item[0].next_action_due, archived_at: item[0].archived_at, reason: item[0].archive_reason, history: item[0].history } : null,
    pick_up: last ? (last.callback_at ? `Call back ${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(last.callback_at))} · last: ${last.outcome.replace(/_/g, ' ')}${last.note ? ` – ${last.note}` : ''}` : `Last: ${last.outcome.replace(/_/g, ' ')}${last.note ? ` – ${last.note}` : ''}`) : 'Not called yet'
  };
}

/** Who is this? For the "Incoming call" box: a short, masked history by phone_key. */
async function lookup(phone = '') {
  const key = String(phone || '').replace(/\D/g, '').slice(-9);
  if (key.length !== 9) return { found: false };
  let t; try { t = await timeline({ phoneKey: key }); } catch (_) { return { found: false, phone: `•••${key.slice(-3)}` }; }
  const calls = t.nodes.filter((n) => n.outcome !== 'skipped');
  const last = calls.slice(-1)[0];
  return { found: t.nodes.length > 0 || t.outreach.length > 0, phone: t.phone_key_masked, name: t.name, calls: calls.length, inbound: calls.filter((n) => n.direction === 'inbound').length,
    last: last ? { at: last.wrapped_at || last.shown_at, by: last.by, outcome: last.outcome, note: last.note, next_step: last.next_step, summary: last.transcript && last.transcript.summary } : null,
    pick_up: t.pick_up, blocked: t.blocked, said_hello: Boolean(t.said_hello), last_attempt_id: (t.nodes.slice(-1)[0] || {}).id || null };
}

// ------------------------------------------------------------ daily summary --

/** Extra lines for the daily summary: payments chased, and what is due tomorrow. */
async function summaryExtras(personKey, day = kampalaDay()) {
  const key = cleanKey(personKey);
  const tomorrow = perf.addDays(day, 1);
  const due = await rows(
    `SELECT DISTINCT ON (phone_key) phone, full_name, callback_at, outcome, task_key FROM call_attempts
      WHERE person_key = $1 AND status = 'done' AND callback_at IS NOT NULL
        AND (callback_at AT TIME ZONE '${TZ}')::date = $2::date
      ORDER BY phone_key, wrapped_at DESC`,
    [key, tomorrow]
  );
  const attempts = await calling.dayAttempts(key, day);
  const done = attempts.filter((a) => a.status === 'done');
  return {
    payments_chased: done.filter((a) => a.task_key === 'payments').length,
    payments_promised: done.filter((a) => a.outcome === 'promised').length,
    payments_paid: done.filter((a) => a.outcome === 'paid' || a.outcome === 'renewed').length,
    calls_list: done.map((a) => ({ at: a.wrapped_at, name: a.full_name || '', phone: maskPhoneLast3(a.phone), task: a.task_key, outcome: a.outcome, talk_s: a.talk_s, note: a.note || '', next_step: a.next_step || '', summary: (a.transcript && a.transcript.summary) || '', live_notes: Boolean(a.transcript && a.transcript.text) })),
    due_tomorrow: due.map((d) => ({ at: d.callback_at, name: d.full_name || '', phone: maskPhoneLast3(d.phone), outcome: d.outcome, task: d.task_key })),
    tomorrow
  };
}

async function dailySummary(personKey, day = kampalaDay()) {
  const r = await calling.report(personKey, day);
  const extras = await summaryExtras(personKey, day);
  const { evidence, ...rest } = r;
  return { ...rest, ...extras };
}

async function saveSummary(personKey, day = kampalaDay(), reason = 'session_end') {
  const s = await dailySummary(personKey, day);
  await db.query(
    `INSERT INTO call_daily_reports (person_key, day, figures, made_at) VALUES ($1, $2::date, $3::jsonb, NOW())
     ON CONFLICT (person_key, day) DO UPDATE SET figures = EXCLUDED.figures, made_at = NOW()`,
    [s.person_key, day, JSON.stringify({ ...s, saved_because: reason })]
  );
  return s;
}

/** At or after 17:00 Kampala, save today's summary for everyone who called (once after 17:00, then on each session end). */
async function autoSaveAtFive(now = new Date()) {
  if (kampalaHour(now) < 17) return 0;
  const day = kampalaDay(now);
  const people = await rows(
    `SELECT DISTINCT a.person_key FROM call_attempts a
      WHERE (a.shown_at AT TIME ZONE '${TZ}')::date = $1::date
        AND NOT EXISTS (SELECT 1 FROM call_daily_reports r WHERE r.person_key = a.person_key AND r.day = $1::date
                         AND (r.made_at AT TIME ZONE '${TZ}')::time >= '17:00' AND (r.made_at AT TIME ZONE '${TZ}')::date = $1::date)`,
    [day]
  );
  for (const p of people) await saveSummary(p.person_key, day, '17:00').catch(() => null);
  return people.length;
}

async function savedSummaries({ day = kampalaDay() } = {}) {
  return rows(`SELECT person_key, day, made_at, figures FROM call_daily_reports WHERE day = $1::date AND ${sandbox.REAL_PEOPLE()} ORDER BY person_key`, [day]);
}

module.exports = {
  lookup,
  SETUP_HOURS,
  passwordProblem,
  scopeOf,
  listLogins,
  makeSetupLink,
  checkSetup,
  completeSetup,
  whatsappFeed,
  whatsappThread,
  leadFeed,
  claimContact,
  pipeline,
  savePipeline,
  timeline,
  dailySummary,
  saveSummary,
  autoSaveAtFive,
  savedSummaries
};
