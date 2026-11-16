'use strict';

/**
 * Meeting mode on the calling screen.
 *
 * King sets the daily meeting time(s) and the Google Meet link. Ten minutes
 * before, the caller's screen builds a Meeting report from the same numbers
 * the rest of the calling screen uses (no new sums), and during the meeting he
 * keeps notes (typed or speech-to-text in the browser; text only, no audio)
 * and action items. An action item with a number becomes that number's next
 * step in the pipeline, owned by him; the rest show as meeting tasks.
 */
const db = require('../config/database');
const calling = require('./callingScreen');
const day = require('./callingDay');
const extras = require('./callingExtras');
const perf = require('./staffPerformance');
const { maskPhoneLast3 } = require('./outreachSenderName');
const { phoneKey9, canonicalUgPhone } = require('../utils/ugPhone');

const TZ = 'Africa/Kampala';
const EARLY_MIN = 10;
const LATE_MIN = 90;
const { kampalaDay, httpError, cleanKey } = calling;

async function rows(sql, params = []) { return (await db.query(sql, params)).rows || []; }
const safe = (p, fallback = null) => Promise.resolve().then(() => p()).catch(() => fallback);

// ---------------------------------------------------------------- settings --

async function getSettings() {
  const r = (await rows("SELECT value, updated_by, updated_at FROM call_settings WHERE key = 'meeting'").catch(() => []))[0];
  const v = r?.value || {};
  return { times: Array.isArray(v.times) ? v.times : [], meet_url: v.meet_url || '', title: v.title || 'Daily team meeting', updated_by: r?.updated_by || null, updated_at: r?.updated_at || null };
}

function cleanTimes(times) {
  const list = (Array.isArray(times) ? times : String(times || '').split(/[,\s]+/)).map((t) => String(t).trim()).filter(Boolean);
  const out = [];
  for (const t of list) {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw httpError(400, `"${t}" is not a time. Use 24-hour HH:MM, like 08:30.`);
    out.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  if (out.length > 6) throw httpError(400, 'At most 6 meetings a day.');
  return [...new Set(out)].sort();
}

function cleanMeetUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (!/^https:\/\/meet\.google\.com\/[a-z0-9-]{3,}(\?[^\s]*)?$/i.test(u)) throw httpError(400, 'Paste the Google Meet link, like https://meet.google.com/abc-defg-hij');
  return u;
}

async function saveSettings({ times, meet_url: meetUrl, title } = {}, actor = 'King') {
  const value = { times: cleanTimes(times), meet_url: cleanMeetUrl(meetUrl), title: String(title || '').trim().slice(0, 80) || 'Daily team meeting' };
  await db.query(
    `INSERT INTO call_settings (key, value, updated_by, updated_at) VALUES ('meeting', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(value), String(actor || 'King').slice(0, 60)]
  );
  return getSettings();
}

/** Kampala wall time "HH:MM" today → a real instant. */
function slotInstant(dayStr, slot) { return new Date(`${dayStr}T${slot}:00+03:00`); }

/** The meeting that is coming up, on now, or just finished (today, Kampala). */
function currentSlot(settings, now = new Date()) {
  const today = kampalaDay(now);
  let best = null;
  for (const slot of settings.times || []) {
    const at = slotInstant(today, slot);
    const mins = Math.round((at.getTime() - now.getTime()) / 60000);
    const c = { day: today, slot, starts_at: at.toISOString(), minutes_to: mins, soon: mins <= EARLY_MIN && mins > 0, on: mins <= 0 && mins > -LATE_MIN, report_ready: mins <= EARLY_MIN && mins > -LATE_MIN };
    if (mins > -LATE_MIN && (!best || at < new Date(best.starts_at))) best = c;
  }
  return best;
}

// ------------------------------------------------------------------ report --

async function owes(today) {
  const list = await rows(
    `SELECT a.id, a.full_name, COALESCE(NULLIF(a.phone, ''), a.whatsapp) AS phone, a.paid_until::text AS paid_until, COALESCE(a.approved_at, a.created_at) AS joined_at
       FROM agents a WHERE a.removed_at IS NULL AND a.status = 'approved' AND COALESCE(a.fee_exempt, false) = false
        AND (a.paid_until IS NULL OR a.paid_until < $1::date)
      ORDER BY a.paid_until ASC NULLS FIRST, a.created_at DESC LIMIT 400`, [today]).catch(() => []);
  const unpaid = list.filter((a) => !a.paid_until);
  const overdue = list.filter((a) => a.paid_until);
  const fmt = (a) => ({ name: a.full_name || '', phone: maskPhoneLast3(a.phone || ''), since: a.paid_until || kampalaDay(a.joined_at) });
  return { unpaid_signups: unpaid.length, overdue: overdue.length, top: [...unpaid.slice(0, 6), ...overdue.slice(0, 6)].map(fmt) };
}

async function ownNumbers(pk, dayStr) {
  const list = await rows(
    `SELECT full_name, phone, status FROM call_number_submissions WHERE person_key = $1 AND (added_at AT TIME ZONE '${TZ}')::date = $2::date ORDER BY added_at`, [pk, dayStr]).catch(() => []);
  return { count: list.length, list: list.slice(0, 12).map((r) => ({ name: r.full_name || '', phone: maskPhoneLast3(r.phone), status: r.status })) };
}

async function money(pk, dayStr) {
  const [act, proofs] = await Promise.all([
    safe(() => day.activity({ period: 'day', day: dayStr, personKey: pk })),
    rows(`SELECT COALESCE(c.status, p.status) AS status, COUNT(*)::int AS n, COALESCE(SUM(p.amount_ugx), 0)::bigint AS ugx
           FROM payment_sms_proofs p LEFT JOIN payment_claims c ON c.id = p.claim_id
          WHERE p.uploaded_by = $1 AND (p.created_at AT TIME ZONE '${TZ}')::date = $2::date GROUP BY 1`, [pk, dayStr]).catch(() => [])
  ]);
  const t = act?.totals || {};
  const by = Object.fromEntries(proofs.map((r) => [r.status, { n: r.n, ugx: Number(r.ugx) }]));
  return {
    pay_links_sent: t.pay_sent || 0, claimed: t.pay_claimed || 0, confirmed: Math.max(t.pay_confirmed || 0, t.payments || 0),
    sms_proofs_waiting: by.pending || { n: 0, ugx: 0 }, sms_proofs_confirmed: by.confirmed || { n: 0, ugx: 0 }
  };
}

function dayBlock(r) {
  if (!r) return null;
  return { day: r.day, calls: r.calls, connected: r.connected, closes: r.closes, skipped: r.skipped, talk_s: r.talk_s, callbacks_booked: r.callbacks_booked, outcomes: r.outcomes || {}, targets: r.targets ? { calls: r.targets.calls_per_day, closes: r.targets.closes_per_day } : null };
}

async function buildReport(personKey, { now = new Date() } = {}) {
  const pk = cleanKey(personKey);
  if (!pk) throw httpError(400, 'Pick who the report is for.');
  const today = kampalaDay(now);
  const yesterday = perf.addDays(today, -1);
  const [t, y, ownT, ownY, moneyT, moneyY, owed, road, pipe, due, mine, callers] = await Promise.all([
    safe(() => calling.report(pk, today, { now })), safe(() => calling.report(pk, yesterday, { now })),
    ownNumbers(pk, today), ownNumbers(pk, yesterday), money(pk, today), money(pk, yesterday), owes(today),
    safe(() => calling.roadTo1000()), safe(() => extras.pipeline({ now }), { items: [] }), safe(() => calling.callbacksDue(pk, now), []),
    safe(() => day.myMoney(pk)), safe(() => calling.loadCallers(), [])
  ]);
  const myLoops = (pipe?.items || []).filter((x) => (x.owner || '') === pk && (x.open_loop || x.overdue));
  return {
    person_key: pk, name: (callers || []).find((c) => c.key === pk)?.name || pk, made_at: now.toISOString(),
    today: { ...dayBlock(t), new_numbers: ownT, money: moneyT },
    yesterday: { ...dayBlock(y), new_numbers: ownY, money: moneyY },
    owes: owed,
    road_to_1000: road,
    open_loops: {
      count: myLoops.length, callbacks_overdue: (due || []).filter((d) => d.overdue_days > 0).length, callbacks_due_now: (due || []).filter((d) => d.due_now).length,
      list: myLoops.slice(0, 10).map((x) => ({ name: x.name || '', phone: x.phone_masked || maskPhoneLast3(x.phone || ''), stage: x.stage || '', next_action: x.next_action || '', due: x.due || null, overdue: x.overdue, open_loop: x.open_loop }))
    },
    commission: mine ? { on_commission: mine.on_commission, rate_pct: mine.rate_pct, earned_ugx: mine.earned_ugx ?? null, due_next_payday_ugx: mine.due_next_payday_ugx ?? null, next_payday: mine.next_payday || null } : null
  };
}

// ------------------------------------------------------------------- notes --

function cleanActions(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((a) => ({
    text: String(a?.text || '').trim().slice(0, 300),
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(a?.due || '')) ? String(a.due) : null,
    phone: String(a?.phone || '').trim().slice(0, 20),
    done: Boolean(a?.done),
    pipeline: Boolean(a?.pipeline)
  })).filter((a) => a.text);
}

async function saveNotes(personKey, { day: dayStr, slot, notes = '', actions = [], joined = false, report = null } = {}, { actor = '', now = new Date() } = {}) {
  const pk = cleanKey(personKey);
  if (!pk) throw httpError(400, 'Pick who the notes are for.');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dayStr || '')) ? dayStr : kampalaDay(now);
  const s = /^\d{2}:\d{2}$/.test(String(slot || '')) ? slot : 'adhoc';
  const items = cleanActions(actions);
  if (items.some((a) => a.phone && !a.pipeline) && await require('./callingSandbox').isSandbox(pk)) throw httpError(409, 'Practice account (TEST): action items with a number are not put on the real pipeline. Leave the number empty.');
  // Numbers become the next step on that number, owned by the caller.
  for (const a of items) {
    if (!a.phone || a.pipeline) continue;
    const key = phoneKey9(canonicalUgPhone(a.phone));
    if (!key || key.length !== 9) throw httpError(400, `"${a.phone}" is not a Uganda number. Leave it empty for a general task.`);
    await extras.savePipeline(key, { next_action: a.text, due: a.due || undefined, owner: pk, actor: actor || pk });
    a.phone = maskPhoneLast3(canonicalUgPhone(a.phone)); a.phone_key = key; a.pipeline = true;
  }
  const snap = report || await safe(() => buildReport(pk, { now }));
  const r = (await rows(
    `INSERT INTO call_meeting_notes (day, slot, person_key, joined_at, report, notes, actions, saved_by, updated_at)
     VALUES ($1::date, $2, $3, CASE WHEN $4 THEN NOW() END, $5::jsonb, $6, $7::jsonb, $8, NOW())
     ON CONFLICT (person_key, day, slot) DO UPDATE SET
       joined_at = COALESCE(call_meeting_notes.joined_at, EXCLUDED.joined_at),
       report = COALESCE(call_meeting_notes.report, EXCLUDED.report),
       notes = EXCLUDED.notes, actions = EXCLUDED.actions, saved_by = EXCLUDED.saved_by, updated_at = NOW()
     RETURNING *`,
    [d, s, pk, Boolean(joined), snap ? JSON.stringify(snap) : null, String(notes || '').slice(0, 20000), JSON.stringify(mergeActions([], items)), String(actor || pk).slice(0, 60)]
  ))[0];
  return present(r);
}

function mergeActions(_old, items) { return items.map((a) => { const { phone_key: _k, ...rest } = a; return rest; }); }

function present(r) {
  return { id: r.id, day: typeof r.day === 'string' ? r.day : kampalaDay(r.day), slot: r.slot, person_key: r.person_key, joined_at: r.joined_at, notes: r.notes || '', actions: r.actions || [], report: r.report || null, updated_at: r.updated_at, saved_by: r.saved_by };
}

async function notesFor(personKey, dayStr, slot) {
  const r = (await rows('SELECT * FROM call_meeting_notes WHERE person_key = $1 AND day = $2::date AND slot = $3', [cleanKey(personKey), dayStr, slot]))[0];
  return r ? present(r) : null;
}

async function history({ personKey = '', limit = 30 } = {}) {
  const list = await rows(
    `SELECT * FROM call_meeting_notes ${personKey ? 'WHERE person_key = $2' : ''} ORDER BY day DESC, slot DESC, person_key LIMIT $1`,
    personKey ? [Math.min(100, Number(limit) || 30), cleanKey(personKey)] : [Math.min(100, Number(limit) || 30)]);
  return list.map(present);
}

/** Open meeting tasks (no number) for the caller's screen. */
async function openTasks(personKey) {
  const list = await rows(`SELECT day, slot, actions FROM call_meeting_notes WHERE person_key = $1 AND day >= (NOW() AT TIME ZONE '${TZ}')::date - 14 ORDER BY day DESC, slot DESC`, [cleanKey(personKey)]);
  const out = [];
  for (const r of list) for (const a of (r.actions || [])) if (!a.done && !a.pipeline) out.push({ ...a, day: kampalaDay(r.day), slot: r.slot });
  return out;
}

/** What the calling screen polls: settings, the slot, and (when it is time) the report and notes. */
async function status(personKey, { now = new Date() } = {}) {
  const settings = await getSettings();
  const slot = currentSlot(settings, now);
  const pk = cleanKey(personKey);
  const out = { settings: { times: settings.times, meet_url: settings.meet_url, title: settings.title }, slot, early_min: EARLY_MIN, tasks: pk ? await openTasks(pk).catch(() => []) : [] };
  if (slot && pk) out.notes = await notesFor(pk, slot.day, slot.slot).catch(() => null);
  return out;
}

module.exports = { EARLY_MIN, getSettings, saveSettings, cleanTimes, cleanMeetUrl, currentSlot, buildReport, saveNotes, notesFor, history, openTasks, status };
