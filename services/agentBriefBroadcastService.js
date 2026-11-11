'use strict';

/**
 * The agents' brief: a 30-second video of the Uganda property news that affects
 * them. Each story is followed by what it means for how they make money, and the
 * caption carries the article links.
 *
 * Arthur, 11 Nov 2026, asked for this to go out every morning. The first one went
 * out that afternoon and was called an Afternoon Brief. From 12 Nov a Morning Brief
 * reaches the agents at 7:00am Kampala time.
 *
 * The video and caption are made outside the server (scripts/agent-brief) and the
 * video is served from makaug.com. This file decides who gets a brief and when:
 *   - every approved agent with a WhatsApp number, so new agents are included the
 *     day they are approved;
 *   - not anyone who replied STOP (whatsapp_user_profiles: opted out, with the time they said it);
 *   - not the agents Arthur said never to message (NEVER_SEND);
 *   - never twice: one message per agent per brief, keyed by date and slot;
 *   - at a set time. The queue's next_attempt_at holds each message until then, so
 *     a Morning Brief goes at 7:00am whether or not anyone is at a computer. The
 *     sends are 15 seconds apart.
 * Until it goes, a brief can be held: hold() withdraws every message still waiting.
 */

const agentHowToPost = require('./agentHowToPostBroadcastService');

const KEY_PREFIX = 'agent_brief';
const SLOTS = Object.freeze(['morning', 'afternoon', 'evening']);
// Arthur's standing instruction: never message these agents. Matched on the full
// name as it is in King, ignoring case and spacing.
const NEVER_SEND = Object.freeze(['promise ahimbisibwe']);
const KAMPALA_UTC_OFFSET_HOURS = 3; // East Africa Time has no daylight saving.
const MORNING_HOUR = 7;
const STAGGER_MS = 15 * 1000;
const MAX_AHEAD_MS = 48 * 60 * 60 * 1000;
const HELD_ERROR = 'brief_held_by_admin';
const CAPTION_MAX = 1024; // WhatsApp's limit for a caption

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function phoneKey(value) {
  return String(value || '').replace(/\D+/g, '').slice(-9);
}

function cleanName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function siteHost() {
  try {
    return new URL(String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://makaug.com')).host;
  } catch (_ignored) {
    return 'makaug.com';
  }
}

/** One key per brief: "agent_brief:2026-11-12:morning". */
function briefKey({ date, slot = 'morning' } = {}) {
  const day = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw badRequest('date must be YYYY-MM-DD');
  }
  const s = String(slot || 'morning').trim().toLowerCase();
  if (!SLOTS.includes(s)) throw badRequest(`slot must be one of: ${SLOTS.join(', ')}`);
  return `${KEY_PREFIX}:${day}:${s}`;
}

/** A clock time in Kampala on that date, e.g. 07:00 on 2026-11-12 is 04:00 UTC. */
function kampalaTime(date, hour = MORNING_HOUR, minute = 0) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - KAMPALA_UTC_OFFSET_HOURS, minute));
}

/** The video must be an .mp4 served from makaug.com, the same place WhatsApp already fetches our films from. */
function checkVideoUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_ignored) {
    throw badRequest('video_url must be a full https:// address');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw badRequest('video_url must be https');
  const host = siteHost();
  if (url.host !== host && url.host !== `www.${host}`) throw badRequest(`video_url must be on ${host}`);
  if (!/\.mp4$/i.test(url.pathname)) throw badRequest('video_url must be an .mp4');
  return url.toString();
}

/** The caption goes to people as Phillip, and every brief tells them how to stop it. */
function checkCaption(value) {
  const text = String(value || '').trim();
  if (text.length < 40) throw badRequest('caption is too short');
  if (text.length > CAPTION_MAX) throw badRequest(`caption must be at most ${CAPTION_MAX} characters (it is ${text.length})`);
  if (!/\bSTOP\b/.test(text)) throw badRequest('caption must tell agents they can reply STOP');
  if (!/\bPhillip\b/.test(text)) throw badRequest('caption must be signed by Phillip');
  return text;
}

/**
 * Numbers that replied STOP, by their last nine digits. marketing_opt_in is
 * FALSE by default for every WhatsApp profile (migration 009), so "false" alone
 * means "never opted in", not "said stop". Only the STOP keyword sets
 * marketing_opt_out_at, and START sets marketing_opt_in back to TRUE.
 */
async function optedOutKeys(db) {
  const rows = (await db.query(
    `SELECT phone
       FROM whatsapp_user_profiles
      WHERE marketing_opt_in = FALSE
        AND marketing_opt_out_at IS NOT NULL`
  )).rows;
  return new Set(rows.map((row) => phoneKey(row.phone)).filter((key) => key.length === 9));
}

/** Who gets a brief, and who does not and why. */
async function listRecipients(db, { excludeKeys = [], excludeAgentIds = [] } = {}) {
  const all = await agentHowToPost.listRecipients(db, { excludeKeys });
  const optedOut = await optedOutKeys(db);
  const excluded = new Set((excludeAgentIds || []).map(String));
  const recipients = [];
  const skipped = [];
  for (const row of all) {
    if (NEVER_SEND.includes(cleanName(row.name))) skipped.push({ ...row, reason: 'never_send' });
    else if (excluded.has(String(row.id))) skipped.push({ ...row, reason: 'excluded' });
    else if (optedOut.has(phoneKey(row.number))) skipped.push({ ...row, reason: 'replied_stop' });
    else recipients.push(row);
  }
  return { recipients, skipped };
}

/** Agents this brief is already waiting for, or already went to. A held brief does not count. */
async function alreadyQueuedAgentIds(db, key) {
  const result = await db.query(
    `SELECT DISTINCT metadata->>'agent_id' AS agent_id
       FROM outbound_message_queue
      WHERE COALESCE(metadata->>'broadcast_key', '') = $1::text
        AND COALESCE(metadata->>'preview', 'false') <> 'true'
        AND status IN ('pending', 'retry', 'sent', 'processing')`,
    [key]
  );
  return new Set(result.rows.map((row) => row.agent_id).filter(Boolean));
}

/** When it goes: the time asked for, else 7:00am Kampala for a morning brief, else now. */
function sendTime({ date, slot, sendAt, now }) {
  let at;
  if (sendAt) at = new Date(sendAt);
  else if (slot === 'morning') at = kampalaTime(date, MORNING_HOUR);
  else at = new Date(now);
  if (Number.isNaN(at.getTime())) throw badRequest('send_at is not a time');
  if (at.getTime() > now.getTime() + MAX_AHEAD_MS) throw badRequest('send_at must be within 48 hours');
  return at.getTime() < now.getTime() ? new Date(now) : at;
}

/**
 * Queue the brief for every recipient, to go at the send time, 15 seconds apart.
 * `queue` is queueWhatsappWebBridgeMessage, passed in so tests can stub it.
 */
async function scheduleBrief({
  db,
  queue,
  date,
  slot = 'morning',
  videoUrl,
  caption,
  sendAt = null,
  source,
  actorId,
  excludeKeys = [],
  excludeAgentIds = [],
  now = new Date()
}) {
  const key = briefKey({ date, slot });
  const s = String(slot || 'morning').trim().toLowerCase();
  const video = checkVideoUrl(videoUrl);
  const text = checkCaption(caption);
  const at = sendTime({ date, slot: s, sendAt, now });
  const { recipients, skipped } = await listRecipients(db, { excludeKeys, excludeAgentIds });
  const done = await alreadyQueuedAgentIds(db, key);
  const results = [];
  let slotIndex = 0;
  for (const agent of recipients) {
    if (done.has(String(agent.id))) {
      results.push({ id: agent.id, name: agent.name, status: 'already_queued' });
      continue;
    }
    const goesAt = new Date(at.getTime() + slotIndex * STAGGER_MS);
    slotIndex += 1;
    try {
      const row = await queue({
        recipient: agent.number,
        text,
        mediaUrl: video,
        mediaType: 'video',
        source,
        actorId,
        sendAt: goesAt.getTime() > now.getTime() ? goesAt : null,
        metadata: {
          message_kind: 'agent_brief',
          broadcast_key: key,
          brief_date: date,
          brief_slot: s,
          agent_id: agent.id,
          reply_dedupe_key: `${key}:${agent.id}`
        }
      });
      results.push({ id: agent.id, name: agent.name, status: 'queued', queue_id: row?.id || null, goes_at: goesAt.toISOString() });
    } catch (error) {
      results.push({ id: agent.id, name: agent.name, status: 'failed', error: error.message });
    }
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    key,
    send_at: at.toISOString(),
    video_url: video,
    queued: count('queued'),
    already_queued: count('already_queued'),
    failed: count('failed'),
    skipped: skipped.map((r) => ({ id: r.id, name: r.name, reason: r.reason })),
    results
  };
}

/** Send the brief now to a few numbers (Arthur and Ronald) so they see it first. Does not count as sent to anyone. */
async function previewBrief({ queue, date, slot = 'morning', videoUrl, caption, to = [], source, actorId, nonce = Date.now() }) {
  const key = briefKey({ date, slot });
  const video = checkVideoUrl(videoUrl);
  const text = checkCaption(caption);
  const numbers = [...new Set((Array.isArray(to) ? to : [to]).map((n) => String(n || '').replace(/\D+/g, '')).filter((n) => n.length >= 9))];
  if (!numbers.length) throw badRequest('to: at least one number to preview to');
  const queued = [];
  for (const number of numbers) {
    const row = await queue({
      recipient: number,
      text,
      mediaUrl: video,
      mediaType: 'video',
      source,
      actorId,
      metadata: { message_kind: 'agent_brief', broadcast_key: key, preview: true, reply_dedupe_key: `${key}:preview:${number}:${nonce}` }
    });
    queued.push({ to_masked: `${number.slice(0, 5)}***${number.slice(-2)}`, queue_id: row?.id || null });
  }
  return { key, queued };
}

/** Withdraw every message of this brief that has not gone yet. */
async function holdBrief(db, { date, slot = 'morning' } = {}) {
  const key = briefKey({ date, slot });
  const result = await db.query(
    `UPDATE outbound_message_queue
        SET status = 'failed',
            last_error = $2,
            updated_at = NOW()
      WHERE COALESCE(metadata->>'broadcast_key', '') = $1::text
        AND status IN ('pending', 'retry')
      RETURNING id`,
    [key, HELD_ERROR]
  );
  return { key, held: result.rowCount || result.rows.length || 0 };
}

/** Where a brief stands: how many are waiting, sent, failed or held, and when the first and last go. */
async function briefStatus(db, { date, slot = 'morning' } = {}) {
  const key = briefKey({ date, slot });
  const rows = (await db.query(
    `SELECT CASE WHEN status = 'failed' AND COALESCE(last_error, '') = $2 THEN 'held' ELSE status END AS state,
            COUNT(*)::int AS n,
            MIN(next_attempt_at) AS first_at,
            MAX(next_attempt_at) AS last_at
       FROM outbound_message_queue
      WHERE COALESCE(metadata->>'broadcast_key', '') = $1::text
        AND COALESCE(metadata->>'preview', 'false') <> 'true'
      GROUP BY 1`,
    [key, HELD_ERROR]
  )).rows;
  const by = Object.fromEntries(rows.map((row) => [row.state, row]));
  const n = (state) => Number(by[state]?.n || 0);
  return {
    key,
    waiting: n('pending') + n('retry') + n('processing'),
    sent: n('sent'),
    failed: n('failed'),
    held: n('held'),
    first_at: by.pending?.first_at || null,
    last_at: by.pending?.last_at || null
  };
}

module.exports = {
  KEY_PREFIX,
  SLOTS,
  NEVER_SEND,
  STAGGER_MS,
  HELD_ERROR,
  briefKey,
  kampalaTime,
  checkVideoUrl,
  checkCaption,
  listRecipients,
  alreadyQueuedAgentIds,
  scheduleBrief,
  previewBrief,
  holdBrief,
  briefStatus
};
