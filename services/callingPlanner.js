'use strict';

/**
 * Calling screen v5: the day split and housekeeping.
 *
 * Day split: King sets time blocks (Kampala time) for existing customers
 * (payments + keep clients), new-agent outreach and housekeeping. The screen
 * follows the block for the time of day and shows progress per block.
 *
 * Housekeeping: follow-ups built from existing data with read-only queries
 * (agents missing an ID document, listings missing photos or details,
 * promised to pay and still unpaid). Only the caller's "done" or note is
 * written, to call_housekeeping.
 */
const db = require('../config/database');
const sandbox = require('./callingSandbox');
const { maskPhoneLast3 } = require('./outreachSenderName');

const TZ = 'Africa/Kampala';
const KINDS = Object.freeze({
  existing: { label: 'Existing customers', tasks: ['payments', 'retention'] },
  new: { label: 'New agents', tasks: ['new_agents'] },
  housekeeping: { label: 'Housekeeping', tasks: [] },
  lunch: { label: 'Lunch', tasks: [] }
});
const DEFAULT_SPLIT = Object.freeze({
  blocks: [
    { start: '08:00', end: '10:00', kind: 'existing' },
    { start: '10:00', end: '13:00', kind: 'new' },
    { start: '13:00', end: '14:00', kind: 'lunch' },
    { start: '14:00', end: '15:00', kind: 'housekeeping' },
    { start: '15:00', end: '17:00', kind: 'new' },
    { start: '17:00', end: '18:00', kind: 'existing' }
  ],
  housekeeping_per_hour: 8
});
const HIDE_DONE_DAYS = 7;

async function rows(sql, params = []) { return (await db.query(sql, params)).rows || []; }
const httpError = (status, message) => Object.assign(new Error(message), { status });
const cleanKey = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
const toMin = (hm) => { const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const kampalaMinutes = (now = new Date()) => {
  const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(now).split(':');
  return (Number(p[0]) % 24) * 60 + Number(p[1]);
};
const kampalaDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);

function cleanSplit(input) {
  const list = Array.isArray(input?.blocks) ? input.blocks : [];
  const blocks = list.map((b) => ({ start: String(b.start || '').trim(), end: String(b.end || '').trim(), kind: String(b.kind || '') }))
    .filter((b) => toMin(b.start) != null && toMin(b.end) != null && KINDS[b.kind]);
  if (!blocks.length) throw httpError(400, 'Add at least one block with a start, an end and what it is for.');
  if (blocks.length > 16) throw httpError(400, 'At most 16 blocks.');
  for (const b of blocks) if (toMin(b.end) <= toMin(b.start)) throw httpError(400, `Block ${b.start}–${b.end}: the end must be after the start.`);
  blocks.sort((a, b) => toMin(a.start) - toMin(b.start));
  for (let i = 1; i < blocks.length; i += 1) if (toMin(blocks[i].start) < toMin(blocks[i - 1].end)) throw httpError(400, `Blocks ${blocks[i - 1].start}–${blocks[i - 1].end} and ${blocks[i].start}–${blocks[i].end} overlap.`);
  const perHour = Math.max(1, Math.min(60, Math.round(Number(input?.housekeeping_per_hour) || DEFAULT_SPLIT.housekeeping_per_hour)));
  return { blocks, housekeeping_per_hour: perHour };
}

async function getSplit() {
  const r = (await rows("SELECT value, updated_by, updated_at FROM call_settings WHERE key = 'day_split'").catch(() => []))[0];
  let v = DEFAULT_SPLIT; let custom = false;
  if (r?.value) { try { v = cleanSplit(r.value); custom = true; } catch (_e) { v = DEFAULT_SPLIT; } }
  return { ...v, kinds: KINDS, custom, updated_by: r?.updated_by || null, updated_at: r?.updated_at || null };
}

async function saveSplit(input, actor = 'King') {
  if (input && input.reset) { await db.query("DELETE FROM call_settings WHERE key = 'day_split'"); return getSplit(); }
  const v = cleanSplit(input);
  await db.query(
    `INSERT INTO call_settings (key, value, updated_by, updated_at) VALUES ('day_split', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(v), String(actor || 'King').slice(0, 60)]
  );
  return getSplit();
}

/** Today's plan for one caller: each block, its target and progress so far. */
async function dayPlan(personKey, { now = new Date() } = {}) {
  const pk = cleanKey(personKey);
  const split = await getSplit();
  const target = (await rows(`SELECT calls_per_day FROM call_targets WHERE person_key = $1 AND effective_from <= (NOW() AT TIME ZONE '${TZ}')::date ORDER BY effective_from DESC LIMIT 1`, [pk]).catch(() => []))[0]?.calls_per_day || 40;
  const callMin = split.blocks.filter((b) => KINDS[b.kind].tasks.length).reduce((n, b) => n + toMin(b.end) - toMin(b.start), 0) || 1;
  const day = kampalaDay(now);
  const calls = await rows(
    `SELECT task_key, ((EXTRACT(HOUR FROM wrapped_at AT TIME ZONE '${TZ}') * 60) + EXTRACT(MINUTE FROM wrapped_at AT TIME ZONE '${TZ}'))::int AS m
       FROM call_attempts WHERE person_key = $1 AND status = 'done' AND (wrapped_at AT TIME ZONE '${TZ}')::date = $2::date`, [pk, day]);
  const hk = await rows(
    `SELECT ((EXTRACT(HOUR FROM created_at AT TIME ZONE '${TZ}') * 60) + EXTRACT(MINUTE FROM created_at AT TIME ZONE '${TZ}'))::int AS m
       FROM call_housekeeping WHERE person_key = $1 AND (created_at AT TIME ZONE '${TZ}')::date = $2::date`, [pk, day]).catch(() => []);
  const nowMin = kampalaMinutes(now);
  const blocks = split.blocks.map((b, i) => {
    const s = toMin(b.start); const e = toMin(b.end); const k = KINDS[b.kind];
    const inBlock = (m) => m >= s && m < e;
    const done = b.kind === 'housekeeping' ? hk.filter((x) => inBlock(x.m)).length : calls.filter((c) => k.tasks.includes(c.task_key) && inBlock(c.m)).length;
    const goal = b.kind === 'housekeeping' ? Math.round(split.housekeeping_per_hour * (e - s) / 60) : (k.tasks.length ? Math.max(1, Math.round(target * (e - s) / callMin)) : 0);
    return { id: `${i}-${b.start}`, start: b.start, end: b.end, kind: b.kind, label: k.label, tasks: k.tasks, target: goal, done, now: nowMin >= s && nowMin < e, past: nowMin >= e };
  });
  const totals = {};
  for (const b of blocks) { const t = totals[b.kind] || (totals[b.kind] = { label: b.label, target: 0, done: 0, minutes: 0 }); t.target += b.target; t.done += b.done; t.minutes += toMin(b.end) - toMin(b.start); }
  return { day, blocks, current: blocks.find((b) => b.now) || null, totals, custom: split.custom };
}

// ------------------------------------------------------------ housekeeping --

function practiceItems() {
  return [
    { key: 'practice:id', kind: 'id', title: 'TEST – Kato Agent: no ID document yet', detail: 'Practice item. Ask for a photo of their national ID on WhatsApp.', phone: '•••105' },
    { key: 'practice:listing', kind: 'listing', title: 'TEST – 2-bedroom in Ntinda: no photos', detail: 'Practice item. Ask the agent for 4+ photos and the price.', phone: '•••106' },
    { key: 'practice:promise', kind: 'promise', title: 'TEST – Nakato Grace promised to pay 2 days ago', detail: 'Practice item. Check MoMo, then call or message them.', phone: '•••107' }
  ];
}

/** Read-only list of follow-ups. Items done in the last 7 days are hidden. */
async function housekeeping(personKey, { limit = 12 } = {}) {
  const pk = cleanKey(personKey);
  const done = new Map((await rows(
    `SELECT DISTINCT ON (item_key) item_key, status, note, created_at, person_key FROM call_housekeeping
      WHERE created_at > NOW() - INTERVAL '${HIDE_DONE_DAYS} days' ORDER BY item_key, created_at DESC`).catch(() => [])).map((r) => [r.item_key, r]));
  const keep = (items) => items.filter((i) => done.get(i.key)?.status !== 'done').map((i) => ({ ...i, last_note: done.get(i.key)?.status === 'note' ? done.get(i.key).note : '' }));
  if (await sandbox.isSandbox(pk)) return { items: keep(practiceItems()), practice: true };
  const lim = Math.max(1, Math.min(30, Number(limit) || 12));
  const ids = await rows(
    `SELECT id, full_name, phone, created_at FROM agents
      WHERE removed_at IS NULL AND status = 'approved' AND (identity_document_url IS NULL OR identity_document_url = '')
      ORDER BY created_at ASC LIMIT $1`, [lim]).catch(() => []);
  const listings = await rows(
    `SELECT p.id, p.title, p.area, p.district, a.full_name, a.phone, p.price, length(COALESCE(p.description, '')) AS dlen,
            (SELECT COUNT(*) FROM property_images i WHERE i.property_id = p.id)::int AS photos
       FROM properties p JOIN agents a ON a.id = p.agent_id
      WHERE p.status = 'approved' AND a.removed_at IS NULL
        AND ((SELECT COUNT(*) FROM property_images i WHERE i.property_id = p.id) < 2 OR p.price IS NULL OR length(COALESCE(p.description, '')) < 40)
      ORDER BY p.created_at DESC LIMIT $1`, [lim]).catch(() => []);
  const promises = await rows(
    `SELECT * FROM (
       SELECT DISTINCT ON (phone_key) phone_key, phone, full_name, callback_at, wrapped_at, outcome, person_key
         FROM call_attempts WHERE status = 'done' AND ${sandbox.REAL_PEOPLE('person_key')} ORDER BY phone_key, wrapped_at DESC) x
      WHERE x.outcome = 'promised' AND x.callback_at < NOW() - INTERVAL '1 day' AND x.phone_key NOT LIKE '${sandbox.TEST_PREFIX}%'
      ORDER BY x.callback_at ASC LIMIT $1`, [lim]).catch(() => []);
  const items = [
    ...promises.map((r) => ({ key: `promise:${r.phone_key}`, kind: 'promise', title: `${r.full_name || 'Agent'} promised to pay, still not paid`, detail: `Promised for ${new Date(r.callback_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })}. Check MoMo, then follow up.`, phone: maskPhoneLast3(r.phone) })),
    ...ids.map((r) => ({ key: `id:${r.id}`, kind: 'id', title: `${r.full_name || 'Agent'}: no ID document`, detail: 'Ask for a clear photo of their national ID on WhatsApp so they can be verified.', phone: maskPhoneLast3(r.phone) })),
    ...listings.map((r) => ({ key: `listing:${r.id}`, kind: 'listing', title: `${r.title || 'Listing'}${r.area ? ` (${r.area})` : ''}: ${[r.photos < 2 ? `${r.photos} photo${r.photos === 1 ? '' : 's'}` : '', r.price == null ? 'no price' : '', r.dlen < 40 ? 'short description' : ''].filter(Boolean).join(', ')}`, detail: `Ask ${r.full_name || 'the agent'} for what is missing.`, phone: maskPhoneLast3(r.phone) }))
  ];
  return { items: keep(items).slice(0, lim * 2), practice: false };
}

async function markHousekeeping(personKey, { key, note = '', status = 'done' } = {}) {
  const pk = cleanKey(personKey);
  const k = String(key || '').trim().slice(0, 120);
  if (!pk || !/^(id|listing|promise|practice):[\w-]+$/.test(k)) throw httpError(400, 'Pick a housekeeping item.');
  const st = status === 'note' ? 'note' : 'done';
  const text = String(note || '').trim().slice(0, 500);
  if (st === 'note' && text.length < 2) throw httpError(400, 'Write a short note.');
  if (k.startsWith('practice:') !== (await sandbox.isSandbox(pk))) throw httpError(409, 'That item is not on your list.');
  const r = (await rows(`INSERT INTO call_housekeeping (person_key, item_key, kind, status, note) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`, [pk, k, k.split(':')[0], st, text]))[0];
  return { id: r.id, at: r.created_at, key: k, status: st };
}

module.exports = { KINDS, DEFAULT_SPLIT, getSplit, saveSplit, cleanSplit, dayPlan, housekeeping, markHousekeeping, practiceItems, toMin, kampalaMinutes };
