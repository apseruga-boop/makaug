'use strict';

/**
 * "How to post on WhatsApp" — one message to every approved agent.
 *
 * Their WhatsApp number is how the bot knows them (routes/whatsapp.js,
 * findApprovedAgentByPhone), so the whole explanation is: say hello, send the
 * property, we review it, you get the link. A short film goes first with a
 * two-line caption, then the full message, the same shape as the welcome pack.
 *
 * The copy has to match what the bot actually replies — if the menu or the
 * example caption change there, change them here.
 */

const BROADCAST_KEY = 'agent_how_to_post_v1';
const VIDEO_PATH = '/assets/marketing/makaug-agent-how-to-post.mp4';

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function videoUrl() {
  return `${siteUrl()}${VIDEO_PATH}`;
}

function firstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!first || /^(mr|mrs|ms|dr|eng|hon)\.?$/i.test(first)) return String(name || '').trim().split(/\s+/)[1] || '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function buildCaption({ name = '' } = {}) {
  const first = firstName(name);
  return [
    `*Hi${first ? ` ${first}` : ''} 👋 You can now post your properties to makaug right here on WhatsApp.*`,
    'Watch this — it takes under a minute. The full steps are in the next message.'
  ].join('\n');
}

function buildMessage({ name = '' } = {}) {
  const first = firstName(name);
  return [
    `Hi${first ? ` ${first}` : ''},`,
    '',
    'From today you can post your properties to makaug straight from WhatsApp — in this chat.',
    '',
    'This number already knows you are a makaug approved agent, so there is nothing to log in to. Just make sure you message from the number you registered with.',
    '',
    '*How it works*',
    '1️⃣ Say *hello* — you get your agent menu',
    '2️⃣ Send the property: photos or a short video, and a caption with what it is, the exact area and district, and the price',
    '     e.g. _"3 bedroom house for rent in Kira, Wakiso — UGX 1.2m a month"_',
    '3️⃣ I confirm it straight away, and tell you if anything is missing',
    '4️⃣ Our team reviews it',
    '5️⃣ The moment it is live I send you the link to share — your name and number are on it',
    '',
    'One property per message.',
    '',
    '*Handy words*',
    '*SHARE* — your page link and agent card',
    '*STATUS* — where your properties are',
    '*HELP* — talk to a person',
    '',
    'Try it now — just say *hello* 👇'
  ].join('\n');
}

/** Approved agents with a usable WhatsApp number, one row per number. */
async function listRecipients(db, { excludeKeys = [] } = {}) {
  const result = await db.query(
    `SELECT id, full_name, COALESCE(NULLIF(TRIM(whatsapp), ''), NULLIF(TRIM(phone), '')) AS number
       FROM agents
      WHERE LOWER(COALESCE(status, '')) = 'approved'
        AND COALESCE(NULLIF(TRIM(whatsapp), ''), NULLIF(TRIM(phone), '')) IS NOT NULL
      ORDER BY (NULLIF(TRIM(whatsapp), '') IS NULL), full_name ASC`
  );
  const seen = new Set(excludeKeys.map(String));
  const out = [];
  for (const row of result.rows) {
    const digits = String(row.number || '').replace(/\D+/g, '');
    const key = digits.slice(-9);
    if (key.length < 9 || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: row.id, name: row.full_name, number: digits.length === 9 ? `256${digits}` : (digits.startsWith('0') ? `256${digits.slice(1)}` : digits) });
  }
  return out;
}

/** Agent ids that have already been sent this broadcast (preview sends do not count). */
async function alreadySentAgentIds(db) {
  const result = await db.query(
    `SELECT DISTINCT metadata->>'agent_id' AS agent_id
       FROM outbound_message_queue
      WHERE COALESCE(metadata->>'broadcast_key', '') = $1::text
        AND COALESCE(metadata->>'preview', 'false') <> 'true'
        AND status IN ('pending', 'retry', 'sent', 'processing')`,
    [BROADCAST_KEY]
  );
  return new Set(result.rows.map((row) => row.agent_id).filter(Boolean));
}

/**
 * Queue the film (with caption) and then the full message for one person.
 * `queue` is queueWhatsappWebBridgeMessage, passed in so tests can stub it.
 */
async function queueFor({ queue, to, name = '', agentId = null, preview = false, source, actorId, nonce = '' }) {
  const base = `${BROADCAST_KEY}:${agentId || 'none'}:${preview ? `preview:${nonce || Date.now()}` : 'live'}`;
  const metadata = { message_kind: 'agent_how_to_post', broadcast_key: BROADCAST_KEY, agent_id: agentId, preview };
  const video = await queue({
    recipient: to,
    text: buildCaption({ name }),
    mediaUrl: videoUrl(),
    mediaType: 'video',
    source,
    actorId,
    metadata: { ...metadata, part: 'video', reply_dedupe_key: `${base}:video` }
  });
  const text = await queue({
    recipient: to,
    text: buildMessage({ name }),
    source,
    actorId,
    metadata: { ...metadata, part: 'text', reply_dedupe_key: `${base}:text` }
  });
  return { video_id: video?.id || null, text_id: text?.id || null };
}

module.exports = {
  BROADCAST_KEY,
  VIDEO_PATH,
  videoUrl,
  firstName,
  buildCaption,
  buildMessage,
  listRecipients,
  alreadySentAgentIds,
  queueFor
};
