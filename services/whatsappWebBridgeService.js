const db = require('../config/database');
const { normalizeUgPhoneForWhatsApp } = require('./whatsappNotificationService');
const crypto = require('crypto');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isWhatsappWebBridgeEnabled() {
  return isTruthy(process.env.WHATSAPP_WEB_BRIDGE_ENABLED)
    || String(process.env.WHATSAPP_DELIVERY_MODE || '').trim().toLowerCase() === 'web_bridge';
}

function getWhatsappDeliveryMode() {
  const raw = String(process.env.WHATSAPP_DELIVERY_MODE || 'auto').trim().toLowerCase();
  return ['provider', 'web_bridge', 'test', 'auto'].includes(raw) ? raw : 'auto';
}

function getWhatsappWebBridgeToken() {
  return String(process.env.WHATSAPP_WEB_BRIDGE_TOKEN || '').trim();
}

function normalizeBridgeRecipient(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalizedPhone = normalizeUgPhoneForWhatsApp(raw);
  if (normalizedPhone) return normalizedPhone;
  return raw.replace(/\s+/g, ' ').slice(0, 160).trim();
}

/**
 * What kind of WhatsApp chat an id names: '' for a person, or 'group',
 * 'newsletter', 'broadcast'. A group id is 18 digits ("120363423279489703@g.us");
 * a phone number is at most 15 (E.164). Stripping the suffix does not make a
 * group a person.
 *
 * On 1 Nov 2026 the number was added to a WhatsApp group. Every message in
 * it reached the assistant as if a customer had typed it, 604 of them in
 * fourteen hours, and every reply was queued to "120363423279489703" and sent
 * as a chat: 270 replies, each tried eight times, every one refused by
 * WhatsApp ("no LID found") until the account was rate-limited.
 */
function whatsappChatKind(chatId, phone = '') {
  const id = String(chatId || '').trim().toLowerCase();
  if (/@g\.us$/.test(id)) return 'group';
  if (/@newsletter$/.test(id)) return 'newsletter';
  if (/@broadcast$/.test(id)) return 'broadcast';
  const digits = String(phone || id).replace(/@.*$/, '').replace(/\D/g, '');
  if (digits.length > 15) return 'group';
  if (/^\d+-\d+$/.test(String(chatId || '').replace(/@.*$/, ''))) return 'group';
  return '';
}

/** A recipient the bridge can actually deliver to: a phone number, 9 to 15 digits, nothing else. */
function isDeliverableWhatsappRecipient(value) {
  return /^\d{9,15}$/.test(String(value || '').trim());
}

/**
 * Read a bridge's failure report. Some failures will never succeed on a retry
 * — the number is not on WhatsApp, the id is not a person — and some mean
 * "slow down", not "try again in a second".
 */
function classifyBridgeSendError(message = '') {
  const text = String(message || '');
  // The WhatsApp session itself is down: logged out, restarting, waiting to be
  // linked. Nothing is wrong with the message or with the person it is for.
  // WAHA answers 422 for it ("Session status is not as expected"), and a 422
  // read as "this recipient was refused". 15 Nov 2026: WhatsApp removed the
  // link at 15:42 and every message queued after it was dropped for good on
  // its first try.
  if (/session status is not as expected|"status"\s*:\s*"(?:FAILED|STOPPED|STARTING|SCAN_QR_CODE)"/i.test(text)) {
    return { permanent: false, reason: 'session_not_ready', retryDelaySeconds: 300 };
  }
  if (/no LID found|not a valid whatsapp|is not on whatsapp|not registered on whatsapp|item-not-found|unroutable recipient|invalid recipient|invalid chat ?id|empty message body|-> 4(?:00|22):/i.test(text)) {
    return { permanent: true, reason: 'recipient_or_payload_rejected', retryDelaySeconds: null };
  }
  if (/rate-overlimit|rate.?limit|too many requests|-> 429:/i.test(text)) {
    return { permanent: false, reason: 'rate_limited', retryDelaySeconds: 600 };
  }
  return { permanent: false, reason: '', retryDelaySeconds: null };
}

function normalizeReplyBodyForDedupe(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 1000);
}

function createBridgeReplyDedupeKey({ userPhone, body, source, metadata = {} }) {
  const seed = JSON.stringify({
    recipient: normalizeBridgeRecipient(userPhone),
    source: String(source || 'system').trim().toLowerCase(),
    next_step: String(metadata.next_step || '').trim(),
    body: normalizeReplyBodyForDedupe(body)
  });
  return `webbridge-reply:${crypto.createHash('sha1').update(seed).digest('hex')}`;
}

function getReplyDedupeWindowSeconds() {
  return Math.min(
    30,
    Math.max(5, Number(process.env.WHATSAPP_WEB_BRIDGE_REPLY_DEDUPE_SECONDS || 15))
  );
}

/**
 * The same words to the same person, on purpose.
 *
 * The WAHA bridge never sends anyone the same words twice within two minutes
 * (rule 4, DUPLICATE_BODY_WINDOW_MS, in services/waha-bridge/server.js on the
 * waha-bridge branch). It drops the second copy and tells us it was sent. That
 * guard is for one reply queued twice. It cannot tell when the person has
 * asked again, and then they hear nothing.
 *
 * 13 Nov 2026, 05:16 to 05:19 UK time. Arthur opened Agent 007, chose 3 and
 * sent the agent video to Sulait. Then he sent "Agent 007", "Complete" and
 * "Agent 007". Each was answered with the menu he had been sent a minute
 * before. The bridge dropped the first two as repeats, and this queue's own
 * 15-second guard folded the third into the second. Nothing reached him, so
 * the bot looked dead.
 *
 * So when somebody's new message is answered with words they were sent in the
 * last few minutes, the answer opens by saying it is a repeat. That makes it a
 * different message, and the bridge sends it. Two cases are left alone, so
 * the guards still do their job:
 * - the same inbound message handled twice;
 * - a burst, where the same answer went out moments ago (one is enough).
 *
 * The same morning, 06:49 to 06:54: Arthur sent the video to five prospects
 * in five minutes (Agent 007, 3, name and number, each time). The first two
 * repeats went out with the two opening lines. The fourth went out plain,
 * because the plain menu was more than two minutes old. The fifth had no
 * unused wording left, went out plain 63 seconds after the plain menu, and
 * the bridge dropped it. So the wording never runs out now: after the two
 * lines the repeats are numbered.
 */
const REPEAT_LEADS = Object.freeze({
  en: Object.freeze(['🔁 Here it is again:', '🔁 Once more:']),
  lg: Object.freeze(['🔁 Nate:', '🔁 Omulundi omulala:']),
  sw: Object.freeze(['🔁 Hii hapa tena:', '🔁 Kwa mara nyingine:'])
});
const NUMBERED_REPEAT_LEAD = Object.freeze({
  en: (n) => `🔁 Again (${n}):`,
  lg: (n) => `🔁 Nate (${n}):`,
  sw: (n) => `🔁 Tena (${n}):`
});
// Enough for one a minute inside any window the bridge can be set to (30 minutes).
const MAX_NUMBERED_REPEATS = 60;

function repeatLeadsFor(language = 'en') {
  return REPEAT_LEADS[String(language || '').trim().toLowerCase()] || REPEAT_LEADS.en;
}

/** Every opening line a repeat can have, in the order they are tried: never runs out. */
function* repeatLeadSequence(language = 'en') {
  const lang = REPEAT_LEADS[String(language || '').trim().toLowerCase()] ? String(language).trim().toLowerCase() : 'en';
  const named = REPEAT_LEADS[lang];
  yield* named;
  for (let n = named.length + 1; n <= named.length + MAX_NUMBERED_REPEATS; n += 1) yield NUMBERED_REPEAT_LEAD[lang](n);
}

/** How far back the bridge might still hold the words: its two minutes, with room to spare. */
function getRepeatWindowSeconds() {
  return Math.min(1800, Math.max(60, Number(process.env.WHATSAPP_WEB_BRIDGE_REPEAT_WINDOW_SECONDS || 300)));
}

/** The same answer this recently is a burst: the first copy is the answer. */
function getRepeatBurstSeconds() {
  return Math.min(120, Math.max(5, Number(process.env.WHATSAPP_WEB_BRIDGE_REPEAT_BURST_SECONDS || 20)));
}

/** What the bridge compares: the words with the spacing squeezed, and the media. */
function bridgeBodyFingerprint(text, mediaUrl = '') {
  return `${String(text || '').replace(/\s+/g, ' ').trim()}|${String(mediaUrl || '').trim()}`;
}

/** Every repeat line is one line that starts 🔁 and ends with a colon, then a blank line. */
function withoutRepeatLead(text) {
  return String(text || '').replace(/^🔁[^\n]{0,60}:\n\n/u, '');
}

/**
 * The reply as it should be queued: unchanged, or opened with a repeat line
 * the person has not been sent in the window. `language` may be a function,
 * so the session is only read when a repeat is found.
 */
async function repeatSafeReplyText({ recipient, text, mediaUrl = '', inboundMessageId = null, language = 'en', now = new Date() } = {}) {
  const body = String(text || '').trim();
  const userPhone = normalizeBridgeRecipient(recipient);
  if (!body || !userPhone) return body;
  const rows = (await db.query(
    `SELECT payload->>'text' AS text,
            COALESCE(payload->>'media_url', '') AS media_url,
            COALESCE(metadata->>'inbound_message_id', '') AS inbound_message_id,
            created_at
       FROM outbound_message_queue
      WHERE user_phone = $1
        AND channel = 'whatsapp'
        AND status IN ('pending', 'retry', 'sent')
        AND COALESCE(metadata->>'duplicate_suppressed', 'false') <> 'true'
        -- The index bound (user_phone, created_at); a reply queued yesterday
        -- for this morning still counts from when it went.
        AND created_at >= $2::timestamptz - INTERVAL '2 days'
        AND COALESCE(sent_at, created_at) >= $2::timestamptz - ($3 || ' seconds')::interval
      ORDER BY created_at DESC
      LIMIT 50`,
    [userPhone, now.toISOString(), String(getRepeatWindowSeconds())]
  )).rows || [];
  const wanted = bridgeBodyFingerprint(body, mediaUrl);
  const same = rows.filter((row) => bridgeBodyFingerprint(withoutRepeatLead(row.text), row.media_url) === wanted);
  if (!same.length) return body;
  if (inboundMessageId && same.some((row) => row.inbound_message_id === String(inboundMessageId))) return body;
  const newest = Math.max(...same.map((row) => new Date(row.created_at).getTime()));
  if (now.getTime() - newest < getRepeatBurstSeconds() * 1000) return body;
  const taken = new Set(rows.map((row) => bridgeBodyFingerprint(row.text, row.media_url)));
  // The plain words are best when they are not in the window any more.
  if (!taken.has(wanted)) return body;
  const lang = typeof language === 'function' ? await Promise.resolve(language()).catch(() => 'en') : language;
  for (const lead of repeatLeadSequence(lang)) {
    const candidate = `${lead}\n\n${body}`;
    if (!taken.has(bridgeBodyFingerprint(candidate, mediaUrl))) return candidate;
  }
  return body;
}

function getBridgeClaimWindowSeconds() {
  return Math.min(
    180,
    Math.max(60, Number(process.env.WHATSAPP_WEB_BRIDGE_CLAIM_SECONDS || 90))
  );
}

// How many times one queued message may be handed to a bridge, in total.
function getBridgeMaxClaims() {
  return Math.min(8, Math.max(1, Number(process.env.WHATSAPP_WEB_BRIDGE_MAX_CLAIMS || 3)));
}

async function upsertWhatsappWebBridgeClient({
  clientId,
  operatorName = null,
  status = 'online',
  browserName = 'Google Chrome',
  profileDir = null,
  currentUrl = null,
  activeChatKey = null,
  unreadCount = 0,
  lastError = null,
  stats = {},
  metadata = {}
}) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return null;

  const normalizedStatus = [
    'offline',
    'starting',
    'waiting_for_login',
    'open_elsewhere',
    'browser_database_error',
    'online',
    'degraded',
    'error'
  ].includes(String(status || '').trim().toLowerCase())
    ? String(status || '').trim().toLowerCase()
    : 'online';

  const result = await db.query(
    `INSERT INTO whatsapp_web_bridge_clients (
      client_id,
      operator_name,
      status,
      browser_name,
      profile_dir,
      current_url,
      active_chat_key,
      unread_count,
      last_error,
      stats,
      metadata,
      last_seen_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, GREATEST(0, $8::int), $9, $10::jsonb, $11::jsonb, NOW()
    )
    ON CONFLICT (client_id) DO UPDATE
    SET
      operator_name = COALESCE(NULLIF($2, ''), whatsapp_web_bridge_clients.operator_name),
      status = $3,
      browser_name = COALESCE(NULLIF($4, ''), whatsapp_web_bridge_clients.browser_name),
      profile_dir = COALESCE(NULLIF($5, ''), whatsapp_web_bridge_clients.profile_dir),
      current_url = COALESCE(NULLIF($6, ''), whatsapp_web_bridge_clients.current_url),
      active_chat_key = COALESCE(NULLIF($7, ''), whatsapp_web_bridge_clients.active_chat_key),
      unread_count = GREATEST(0, $8::int),
      last_error = NULLIF($9, ''),
      stats = COALESCE(whatsapp_web_bridge_clients.stats, '{}'::jsonb) || $10::jsonb,
      metadata = COALESCE(whatsapp_web_bridge_clients.metadata, '{}'::jsonb) || $11::jsonb,
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING *`,
    [
      normalizedClientId,
      operatorName ? String(operatorName).trim() : null,
      normalizedStatus,
      browserName ? String(browserName).trim() : null,
      profileDir ? String(profileDir).trim() : null,
      currentUrl ? String(currentUrl).trim() : null,
      activeChatKey ? String(activeChatKey).trim() : null,
      Number.isFinite(Number(unreadCount)) ? Number(unreadCount) : 0,
      lastError ? String(lastError).trim() : null,
      JSON.stringify(stats && typeof stats === 'object' ? stats : {}),
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})
    ]
  );

  return result.rows[0] || null;
}

async function queueWhatsappWebBridgeMessage({
  recipient,
  text,
  mediaUrl = '',
  mediaType = 'text',
  source = 'system',
  actorId = 'system',
  metadata = {},
  campaignId = null,
  // A message can wait for its time: the agents' Morning Brief is queued the day
  // before and goes at 7:00am. Absent, in the past or not a time: it goes now.
  sendAt = null
}) {
  const userPhone = normalizeBridgeRecipient(recipient);
  const body = String(text || '').trim();
  const sendAtDate = sendAt ? new Date(sendAt) : null;
  const scheduledAt = sendAtDate && !Number.isNaN(sendAtDate.getTime()) && sendAtDate.getTime() > Date.now()
    ? sendAtDate.toISOString()
    : null;
  if (!userPhone) {
    const error = new Error('Invalid recipient');
    error.status = 400;
    throw error;
  }
  if (!body) {
    const error = new Error('Reply text is required');
    error.status = 400;
    throw error;
  }

  const normalizedMediaUrl = (() => {
    const candidate = String(mediaUrl || '').trim();
    if (!candidate || candidate.length > 2000) return '';
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
      return parsed.toString();
    } catch (_error) {
      return '';
    }
  })();
  const requestedMediaType = String(mediaType || '').trim().toLowerCase();
  const normalizedMediaType = normalizedMediaUrl && ['image', 'video'].includes(requestedMediaType)
    ? requestedMediaType
    : 'text';

  const payload = {
    text: body,
    ...(normalizedMediaUrl ? {
      caption: body,
      media_url: normalizedMediaUrl,
      media_type: normalizedMediaType
    } : {})
  };

  const meta = {
    delivery_mode: 'web_bridge',
    source: String(source || 'system').trim().toLowerCase(),
    actor_id: actorId || 'system',
    ...(metadata && typeof metadata === 'object' ? metadata : {})
  };
  meta.reply_dedupe_key = String(meta.reply_dedupe_key || createBridgeReplyDedupeKey({
    userPhone,
    body,
    source: meta.source,
    metadata: meta
  })).trim();
  meta.reply_dedupe_window_seconds = getReplyDedupeWindowSeconds();

  // A group id, a newsletter, a chat key that is not a number: the bridge
  // would send it as a person and WhatsApp would refuse it, eight times. Keep
  // the record, never the retries.
  if (!isDeliverableWhatsappRecipient(userPhone)) {
    const rejected = await db.query(
      `INSERT INTO outbound_message_queue (
        user_phone, payload, status, attempts, next_attempt_at, channel, user_consent_snapshot, campaign_id, metadata, last_error
      ) VALUES ($1, $2::jsonb, 'failed', 0, NOW(), 'whatsapp', TRUE, $3, $4::jsonb, $5)
      RETURNING *`,
      [
        userPhone.slice(0, 160),
        JSON.stringify(payload),
        campaignId || null,
        JSON.stringify({
          ...meta,
          retry_suppressed: true,
          failure_class: 'invalid_recipient',
          recipient_kind: whatsappChatKind(userPhone) || 'not_a_phone'
        }),
        `invalid_recipient: ${whatsappChatKind(userPhone) || 'not a phone number'} (${userPhone.slice(0, 40)})`
      ]
    );
    return { ...(rejected.rows[0] || {}), rejected: true, rejected_reason: 'invalid_recipient' };
  }

  // A number staff have paused is sent nothing unasked. The record is kept,
  // so it can be seen what it would have been sent; an answer to a message of
  // theirs is not stopped.
  if (!meta.inbound_message_id && await isNumberPaused(userPhone)) {
    const held = await db.query(
      `INSERT INTO outbound_message_queue (
        user_phone, payload, status, attempts, next_attempt_at, channel, user_consent_snapshot, campaign_id, metadata, last_error
      ) VALUES ($1, $2::jsonb, 'failed', 0, NOW(), 'whatsapp', TRUE, $3, $4::jsonb, $5)
      RETURNING *`,
      [
        userPhone,
        JSON.stringify(payload),
        campaignId || null,
        JSON.stringify({ ...meta, retry_suppressed: true, failure_class: 'paused_number' }),
        'Not sent: this number is paused and is sent nothing for now.'
      ]
    );
    return { ...(held.rows[0] || {}), rejected: true, rejected_reason: 'paused_number' };
  }

  const existing = await db.query(
    `SELECT *
       FROM outbound_message_queue
      WHERE user_phone = $1
        AND channel = 'whatsapp'
        AND status IN ('pending', 'retry', 'sent')
        AND COALESCE(metadata->>'delivery_mode', '') = 'web_bridge'
        AND COALESCE(metadata->>'reply_dedupe_key', '') = $2
        AND created_at >= NOW() - ($3 || ' seconds')::interval
      ORDER BY created_at DESC
      LIMIT 1`,
    [userPhone, meta.reply_dedupe_key, String(meta.reply_dedupe_window_seconds)]
  );
  if (existing.rows[0]) {
    const existingReply = existing.rows[0];
    const existingStatus = String(existingReply.status || '').trim().toLowerCase();
    // A message waiting for its time keeps it: queueing it again must not send it early.
    if (scheduledAt) return { ...existingReply, duplicate_suppressed: true };
    if (['pending', 'retry'].includes(existingStatus)) {
      const refreshed = await db.query(
        `UPDATE outbound_message_queue
         SET
           status = 'pending',
           next_attempt_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object(
               'duplicate_refreshed_at', NOW()::text,
               'duplicate_refresh_reason', 'same_reply_new_inbound'
             ),
           updated_at = NOW()
         WHERE id = $1
           AND status IN ('pending', 'retry')
           AND (
             next_attempt_at <= NOW()
             OR next_attempt_at > NOW() + INTERVAL '30 seconds'
           )
         RETURNING *`,
        [existingReply.id]
      );
      return {
        ...(refreshed.rows[0] || existingReply),
        duplicate_suppressed: true,
        duplicate_refreshed: Boolean(refreshed.rows[0])
      };
    }
    return {
      ...existingReply,
      duplicate_suppressed: true
    };
  }

  const result = await db.query(
    `INSERT INTO outbound_message_queue (
      user_phone,
      payload,
      status,
      attempts,
      next_attempt_at,
      channel,
      user_consent_snapshot,
      campaign_id,
      metadata
    ) VALUES (
      $1,
      $2::jsonb,
      'pending',
      0,
      COALESCE($5::timestamptz, NOW()),
      'whatsapp',
      TRUE,
      $3,
      $4::jsonb
    )
    RETURNING *`,
    [
      userPhone,
      JSON.stringify(payload),
      campaignId || null,
      JSON.stringify(scheduledAt ? { ...meta, scheduled_for: scheduledAt } : meta),
      scheduledAt
    ]
  );

  return result.rows[0] || null;
}

// What a bridge reports when its WhatsApp session cannot send.
const SESSION_CANNOT_SEND = /^(?:FAILED|STOPPED|STARTING|SCAN_QR_CODE|PASSKEY_REQUIRED|PASSKEY_CONFIRMATION_REQUIRED|NOT_FOUND)$|^ERROR/i;

/**
 * Whether the bridge asking for messages has just said its WhatsApp session is
 * down. It says so every half minute, in its heartbeat. While it is down a
 * message handed over can only fail, and a hand-over is not free: a message is
 * handed over a few times in its life and then never again. So nothing is
 * handed over, and everything waits in the queue for the session to come back.
 * A bridge that has gone quiet (no heartbeat for three minutes) is not
 * believed either way.
 */
async function bridgeSessionCannotSend(clientId) {
  try {
    const result = await db.query(
      `SELECT metadata->>'waha_status' AS waha_status
         FROM whatsapp_web_bridge_clients
        WHERE client_id = $1
          AND last_seen_at >= NOW() - INTERVAL '3 minutes'
        LIMIT 1`,
      [String(clientId || '')]
    );
    const status = String(result.rows?.[0]?.waha_status || '').trim();
    return Boolean(status) && SESSION_CANNOT_SEND.test(status);
  } catch (_error) {
    return false;
  }
}

// A session that will not come back by itself: somebody has to link the number again.
const SESSION_NEEDS_LINKING = /^(?:FAILED|STOPPED|SCAN_QR_CODE|PASSKEY_REQUIRED|PASSKEY_CONFIRMATION_REQUIRED|NOT_FOUND)$/i;

/**
 * Whether WhatsApp cannot send for anybody until somebody links the number
 * again: a bridge heard from in the last three minutes says its session is
 * logged out or stopped, and no bridge heard from in that time is working. A
 * session that is only starting is not counted; it is back in a minute. When
 * it cannot be told, the answer is no.
 */
async function whatsappSessionNeedsLinking() {
  try {
    const result = await db.query(
      `SELECT status, metadata->>'waha_status' AS waha_status
         FROM whatsapp_web_bridge_clients
        WHERE last_seen_at >= NOW() - INTERVAL '3 minutes'`
    );
    const clients = result.rows || [];
    const working = (client) => /^WORKING$/i.test(String(client.waha_status || '').trim())
      || (!String(client.waha_status || '').trim() && String(client.status || '').toLowerCase() === 'online');
    if (clients.some(working)) return false;
    return clients.some((client) => SESSION_NEEDS_LINKING.test(String(client.waha_status || '').trim()));
  } catch (_error) {
    return false;
  }
}

/**
 * The kind of message the bridge asks for. It asks by name, and a message
 * queued under any other name is never handed over: it sits "pending" and
 * nobody is told. Staff replies were lost to that until 5 Oct 2026. Sign-in
 * codes ('otp') and short-stay messages ('short_stay_request',
 * 'agent_booking') still were on 16 Nov 2026: three codes and six booking
 * messages, up to twelve days old, never sent. Anything that must reach a
 * person is queued under this name, with what it is kept in its details.
 */
function bridgeCarriedSource() {
  return String(process.env.WHATSAPP_REPLY_BRIDGE_SOURCE || 'whatsapp_runtime').trim().toLowerCase() || 'whatsapp_runtime';
}

// What the bridge asks for unless it is told otherwise (OUTBOX_ALLOWED_SOURCES
// on the bridge service). tests/whatsapp-bridge-carried-sources.test.js holds
// every queued message to this list.
const BRIDGE_CARRIED_SOURCES = ['whatsapp_runtime', 'whatsapp_missed_call'];

/** A one-time code, written so that it can be kept: "your code is ••••••". */
function withoutTheCode(text = '') {
  return String(text || '').replace(/\b\d{4,8}\b/g, '••••••');
}

/** Whether a queued message carries a one-time code. */
function carriesACode(row = {}) {
  const meta = (row && row.metadata) || {};
  return String(meta.kind || '').toLowerCase() === 'otp' || String(meta.source || '').toLowerCase() === 'otp';
}

/** How long a one-time code is good for, in minutes. */
function codeMinutes() {
  return Math.min(60, Math.max(parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10) || 10, 1));
}

let lastCodeSweepAt = 0;

/**
 * A one-time code is good for ten minutes. One that could not be sent in that
 * time, because the session was down, is let go: a code that arrives hours
 * later opens nothing, and comes from a number its receiver was not expecting
 * to hear from. Looked at once a minute at most.
 */
async function letGoOfExpiredCodes({ force = false } = {}) {
  if (!force && Date.now() - lastCodeSweepAt < 60000) return 0;
  lastCodeSweepAt = Date.now();
  try {
    const result = await db.query(
      `UPDATE outbound_message_queue
          SET status = 'failed',
              last_error = 'The code had run out before WhatsApp could send it.',
              -- A code that will never be used is not kept either.
              payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{text}',
                to_jsonb(regexp_replace(COALESCE(payload->>'text', ''), '[0-9]{4,8}', '••••••', 'g'))),
              metadata = COALESCE(metadata, '{}'::jsonb) || '{"failure_class":"expired","retry_suppressed":true}'::jsonb,
              updated_at = NOW()
        WHERE channel = 'whatsapp'
          AND status IN ('pending', 'retry')
          AND (LOWER(COALESCE(metadata->>'kind', '')) = 'otp' OR LOWER(COALESCE(metadata->>'source', '')) = 'otp')
          AND created_at < NOW() - ($1 || ' minutes')::interval`,
      [String(codeMinutes())]
    );
    return result.rowCount || 0;
  } catch (_error) {
    return 0;
  }
}

/**
 * The number only writes to people who have written to it.
 *
 * 15 Nov 2026, 15:42:03: WhatsApp removed the link that carries every message
 * and restricted the number for "spam, automated or bulk messaging". Two
 * seconds earlier the number had sent "your property is live" to a new agent
 * who had never written to it. 16 Nov 2026, 05:28:12, thirteen minutes after
 * the number was linked again: removed again. Two seconds earlier it had sent
 * a lead-desk notice to a member of staff's number that had been sent 186
 * automatic messages in a month and had never once answered.
 *
 * So a message is handed to the bridge only when the person it is for has
 * written to the number lately, or when it answers a message of theirs.
 * Anything else waits in the queue. The moment they write, even "Hi", what is
 * waiting for them goes. It is the rule for every kind of message, the
 * welcome to a new agent and a notice to staff included, because WhatsApp
 * makes no exception for them. WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE=off removes
 * it; under test it is off unless a test turns it on.
 *
 * "Lately" is the last seven days (20 Nov 2026). Having written once was not
 * enough: an agent who last wrote on 26 Oct and had answered none of the 28
 * messages sent since was the last person written to before the number was
 * restricted on 17 Nov (the Morning Brief) and again on 20 Nov (a payment
 * link a member of staff sent him).
 */
function onlyToPeopleWhoWrote(env = process.env) {
  const flag = String(env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE || '').trim().toLowerCase();
  if (['off', 'false', '0', 'no'].includes(flag)) return false;
  if (['on', 'true', '1', 'yes'].includes(flag)) return true;
  if (env.NODE_TEST_CONTEXT) return false;
  return String(env.NODE_ENV || '').toLowerCase() !== 'test';
}

/**
 * How many days back a message of theirs counts as "lately": seven, or
 * WHATSAPP_WROTE_WITHIN_DAYS (1 to 90). It is the same window the agents'
 * Morning Brief has used for its audience since 17 Nov 2026.
 */
function wroteWithinDays(env = process.env) {
  const days = Number.parseInt(String(env.WHATSAPP_WROTE_WITHIN_DAYS || '').trim(), 10);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 7;
}

/**
 * SQL, true when the person a queued row is for has written to us lately, or
 * the row answers a message of theirs. `q` is the row's alias. The first test
 * uses the index on (user_phone, created_at); the second is for a reply whose
 * number is stored in another form than the message it answers.
 */
function hasWrittenSql(q = 'q', { days = wroteWithinDays() } = {}) {
  const within = Number.isInteger(days) && days >= 1 && days <= 90 ? days : 7;
  return `(
          EXISTS (
            SELECT 1 FROM whatsapp_messages m
             WHERE m.direction = 'inbound'
               -- A call is not a message: somebody who only rang has not written.
               AND m.message_type <> 'call'
               AND m.user_phone IN (
                 ${q}.user_phone,
                 regexp_replace(COALESCE(${q}.user_phone, ''), '\\D', '', 'g'),
                 '+' || regexp_replace(COALESCE(${q}.user_phone, ''), '\\D', '', 'g')
               )
               -- Lately: somebody who last wrote a month ago has not asked for this.
               AND m.created_at >= NOW() - INTERVAL '${within} days'
          )
          OR EXISTS (
            SELECT 1 FROM whatsapp_messages m
             WHERE COALESCE(${q}.metadata->>'inbound_message_id', '') <> ''
               AND m.wa_message_id = ${q}.metadata->>'inbound_message_id'
               AND m.direction = 'inbound'
               AND RIGHT(regexp_replace(m.user_phone, '\\D', '', 'g'), 9)
                 = RIGHT(regexp_replace(COALESCE(${q}.user_phone, ''), '\\D', '', 'g'), 9)
          )
        )`;
}

/** Whether this number has written to us lately (wroteWithinDays). When it cannot be told, no. */
async function hasWrittenToUs(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 9) return false;
  const normalized = normalizeBridgeRecipient(phone) || digits;
  try {
    const result = await db.query(
      `SELECT 1 FROM whatsapp_messages
        WHERE direction = 'inbound' AND message_type <> 'call' AND user_phone = ANY($1::text[])
          AND created_at >= NOW() - make_interval(days => $2)
        LIMIT 1`,
      [[...new Set([normalized, digits, `+${digits}`, String(normalized).replace(/\D/g, ''), `+${String(normalized).replace(/\D/g, '')}`])], wroteWithinDays()]
    );
    return result.rows.length > 0;
  } catch (_error) {
    return false;
  }
}

/**
 * Whether what the number sends this person now would only wait in the queue:
 * the rule is on and they have not written lately. When it cannot be told, it
 * would wait.
 */
async function waitsForThem(phone) {
  if (!onlyToPeopleWhoWrote()) return false;
  return !(await hasWrittenToUs(phone).catch(() => false));
}

/**
 * What a member of staff is told instead of "sent" when the person has not
 * written lately (20 Nov 2026, in Arthur's words: tell them this person has yet
 * to message, so we cannot, or we will be blocked). `waiting` true: what they
 * asked for is in the queue and goes the moment the person writes, and staff
 * are told when it has. False: nothing was queued, and they send it again once
 * the person has written.
 */
function notSentUntilTheyWrite({ name = '', what = 'message', waiting = true, days = wroteWithinDays(), helloLink = '' } = {}) {
  const who = String(name || '').trim().split(/\s+/)[0] || '';
  const subject = who || 'This person';
  const link = helloLink || require('./filmLinkService').helloLink();
  return [
    `⏸️ *Not sent — ${subject} hasn't written to makaug in the last ${days} days.*`,
    '',
    'WhatsApp blocks our number when we message people who haven\'t written to us.',
    '',
    `Ask ${who || 'them'} to message us first. Send them this link to tap and press send:`,
    link,
    '',
    waiting
      ? `The ${what} is waiting and goes to them the moment they write. I'll tell you when it has gone.`
      : `Once they have written, send the ${what} again from here and it goes straight away.`
  ].join('\n');
}

// Numbers that are sent nothing unasked for the time being, on staff's say
// (16 Nov 2026: a member of staff's number that had been sent 186 automatic
// notices in a month). Kept in billing_settings so it can be changed without
// a release: { tails: ["700555061"], notes: { "700555061": { by, at, note } } }.
const PAUSED_NUMBERS_KEY = 'whatsapp_paused_numbers';

function phoneTail(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9);
}

/**
 * SQL, true when the number a queued row is for is paused and the row is not
 * an answer to a message of theirs. An answer still goes: somebody who writes
 * to us is not met with silence.
 */
function pausedSql(q = 'q') {
  return `(
          COALESCE(${q}.metadata->>'inbound_message_id', '') = ''
          AND EXISTS (
            SELECT 1 FROM billing_settings b
             WHERE b.key = '${PAUSED_NUMBERS_KEY}'
               AND (b.value->'tails') ? RIGHT(regexp_replace(COALESCE(${q}.user_phone, ''), '\\D', '', 'g'), 9)
          )
        )`;
}

let pausedNumbersRead = { at: 0, value: { tails: [], notes: {} } };

/**
 * The paused numbers: { tails, notes }. Read at most every fifteen seconds
 * (it is asked for every message that is queued); the hand-over to the bridge
 * always asks the database itself. When it cannot be read, nobody is paused.
 */
async function pausedNumbers({ fresh = false } = {}) {
  if (!fresh && Date.now() - pausedNumbersRead.at < 15000) return pausedNumbersRead.value;
  try {
    const result = await db.query('SELECT value FROM billing_settings WHERE key = $1 LIMIT 1', [PAUSED_NUMBERS_KEY]);
    const value = result.rows?.[0]?.value || {};
    const tails = Array.isArray(value.tails) ? value.tails.map((tail) => String(tail)).filter((tail) => /^\d{9}$/.test(tail)) : [];
    pausedNumbersRead = { at: Date.now(), value: { tails, notes: value.notes && typeof value.notes === 'object' ? value.notes : {} } };
    return pausedNumbersRead.value;
  } catch (_error) {
    return { tails: [], notes: {} };
  }
}

async function isNumberPaused(phone) {
  const tail = phoneTail(phone);
  if (tail.length !== 9) return false;
  return (await pausedNumbers()).tails.includes(tail);
}

/**
 * Pause a number, or let it receive again. Returns the list as it now stands.
 * Pausing also lets go of what is already waiting for them unasked, so the day
 * they are let receive again they are not sent a pile of old notices.
 */
async function setNumberPaused(phone, paused, { by = '', note = '' } = {}) {
  const tail = phoneTail(phone);
  if (tail.length !== 9) {
    const error = new Error('That is not a phone number');
    error.status = 400;
    throw error;
  }
  const current = await pausedNumbers({ fresh: true });
  const tails = current.tails.filter((entry) => entry !== tail);
  const notes = { ...current.notes };
  delete notes[tail];
  if (paused) {
    tails.push(tail);
    notes[tail] = { by: String(by || '').slice(0, 80), at: new Date().toISOString(), note: String(note || '').slice(0, 200) };
  }
  await db.query(
    `INSERT INTO billing_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [PAUSED_NUMBERS_KEY, JSON.stringify({ tails, notes }), String(by || 'system').slice(0, 80)]
  );
  pausedNumbersRead = { at: Date.now(), value: { tails, notes } };
  let letGo = 0;
  if (paused) {
    const cleared = await db.query(
      `UPDATE outbound_message_queue
          SET status = 'failed',
              last_error = 'Not sent: this number was paused.',
              metadata = COALESCE(metadata, '{}'::jsonb) || '{"failure_class":"paused_number","retry_suppressed":true}'::jsonb,
              updated_at = NOW()
        WHERE channel = 'whatsapp'
          AND status IN ('pending', 'retry')
          AND COALESCE(metadata->>'inbound_message_id', '') = ''
          AND RIGHT(regexp_replace(COALESCE(user_phone, ''), '\\D', '', 'g'), 9) = $1`,
      [tail]
    );
    letGo = cleared.rowCount || 0;
  }
  return { tails, notes, let_go: letGo };
}

let lastWaitingSweepAt = 0;
let lastNoLongerLiveSweepAt = 0;

/**
 * A "your property is live" that is still waiting is dropped when the listing
 * is no longer live. 22 Nov 2026: an agent who had never written had eight
 * waiting, one of them for a copy of a listing that staff had since hidden as
 * a duplicate; the day he wrote, he would have been sent its link.
 */
async function letGoOfLiveNoticesNoLongerTrue({ force = false } = {}) {
  if (!force && Date.now() - lastNoLongerLiveSweepAt < 60000) return 0;
  lastNoLongerLiveSweepAt = Date.now();
  try {
    const result = await db.query(
      `UPDATE outbound_message_queue
          SET status = 'failed',
              last_error = 'Not sent: the listing is no longer live.',
              metadata = COALESCE(metadata, '{}'::jsonb) || '{"failure_class":"listing_no_longer_live","retry_suppressed":true}'::jsonb,
              updated_at = NOW()
        WHERE channel = 'whatsapp'
          AND status IN ('pending', 'retry')
          AND COALESCE(metadata->>'message_kind', '') = 'listing_status_approved'
          AND COALESCE(metadata->>'listing_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND NOT EXISTS (
            SELECT 1 FROM properties p
             WHERE p.id = (outbound_message_queue.metadata->>'listing_id')::uuid
               AND p.status = 'approved'
          )`
    );
    return result.rowCount || 0;
  } catch (_error) {
    return 0;
  }
}

/**
 * What is waiting for somebody who has not written lately does not wait for
 * ever. A notice to staff, a Morning Brief or "sorry we missed your call" is
 * no use the next day and is let go after twelve hours, so a member of staff
 * who writes after a quiet week is not sent a pile of old notices at once;
 * everything else (a welcome, "your property is live") after seven days.
 * Looked at once a minute at most, and only while the rule is on.
 */
async function letGoOfWhatNobodyCameFor({ force = false } = {}) {
  if (!onlyToPeopleWhoWrote()) return 0;
  if (!force && Date.now() - lastWaitingSweepAt < 60000) return 0;
  lastWaitingSweepAt = Date.now();
  try {
    const result = await db.query(
      `UPDATE outbound_message_queue q
          SET status = 'failed',
              last_error = 'Not sent: they had not written to the makaug number lately.',
              metadata = COALESCE(q.metadata, '{}'::jsonb) || '{"failure_class":"never_wrote","retry_suppressed":true}'::jsonb,
              updated_at = NOW()
        WHERE q.channel = 'whatsapp'
          AND q.status IN ('pending', 'retry')
          AND COALESCE(q.metadata->>'delivery_mode', '') = 'web_bridge'
          AND q.next_attempt_at < NOW() - (
            CASE WHEN COALESCE(q.metadata->>'message_kind', '') ~ '^(agent_brief|lead_handoff_)|_notice$'
                   OR LOWER(COALESCE(q.metadata->>'source', '')) = 'whatsapp_missed_call'
              THEN INTERVAL '12 hours' ELSE INTERVAL '7 days' END
          )
          AND NOT ${hasWrittenSql('q')}`
    );
    return result.rowCount || 0;
  } catch (_error) {
    return 0;
  }
}

/**
 * The hours nobody is messaged late: 22:00 to 07:00 where the business is.
 * A reply to somebody who has just written goes at any hour. A message that
 * fell due more than half an hour ago, because the session was down or the
 * bridge was, does not arrive at two in the morning: it goes at seven.
 */
function isOutboxQuietHours(date = new Date()) {
  const raw = String(process.env.WHATSAPP_QUIET_HOURS ?? '22-7').trim().toLowerCase();
  if (!raw || raw === 'off') return false;
  const [start, end] = raw.split('-').map((value) => Number(value));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const timeZone = String(process.env.WHATSAPP_QUIET_TZ || '').trim()
    || (String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'ZA' ? 'Africa/Johannesburg' : 'Africa/Kampala');
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone }).format(date)) % 24;
  } catch (_error) {
    return false;
  }
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
}

async function claimWhatsappWebBridgeMessages({ clientId, limit = 10, recipient = '', allowedSources = [] } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const claimWindow = getBridgeClaimWindowSeconds();
  const normalizedClientId = String(clientId || '').trim() || 'web_bridge';
  await letGoOfExpiredCodes();
  await letGoOfWhatNobodyCameFor();
  if (await bridgeSessionCannotSend(normalizedClientId)) return [];
  await letGoOfLiveNoticesNoLongerTrue();
  const recipientDigits = String(recipient || '').replace(/\D/g, '');
  const normalizedAllowedSources = (Array.isArray(allowedSources) ? allowedSources : String(allowedSources || '').split(','))
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value, index, values) => value && /^[a-z0-9_:-]{1,80}$/.test(value) && values.indexOf(value) === index)
    .slice(0, 8);

  const result = await db.query(
    `WITH claimable AS (
      SELECT q.id, q.next_attempt_at AS due_at
      FROM outbound_message_queue q
      WHERE q.channel = 'whatsapp'
        AND q.status IN ('pending', 'retry')
        AND q.next_attempt_at <= NOW()
        AND COALESCE(q.metadata->>'delivery_mode', '') = 'web_bridge'
        AND ($4::text = '' OR regexp_replace(COALESCE(q.user_phone, ''), '\\D', '', 'g') = $4::text)
        AND (
          COALESCE(array_length($5::text[], 1), 0) = 0
          OR LOWER(COALESCE(q.metadata->>'source', 'system')) = ANY($5::text[])
        )
        -- Hard ceiling on hand-outs. A claim that is never answered (bridge
        -- crashed mid-send, ack lost) lapses and the row is handed out again,
        -- and a claim does not count as an attempt. Without this ceiling that
        -- cycle has no end, and every lap may deliver the message again.
        AND COALESCE(NULLIF(q.metadata->>'claim_count', '')::int, 0) < $6::int
        -- Only a phone number can be delivered to. A group id (18 digits) or a
        -- chat title is never handed out, however it got into the queue.
        AND regexp_replace(COALESCE(q.user_phone, ''), '\\D', '', 'g') ~ '^[0-9]{9,15}$'
        -- In the quiet hours, a message that is more than half an hour late
        -- waits for the morning.
        AND NOT ($7::boolean AND q.next_attempt_at < NOW() - INTERVAL '30 minutes')
        -- Nothing unasked to a number staff have paused.
        AND NOT ${pausedSql('q')}
        -- Only to somebody who has written to us, or in answer to them.
        AND (NOT $9::boolean OR ${hasWrittenSql('q')})
        -- A one-time code that has run out is never handed over.
        AND NOT (
          (LOWER(COALESCE(q.metadata->>'kind', '')) = 'otp' OR LOWER(COALESCE(q.metadata->>'source', '')) = 'otp')
          AND q.created_at < NOW() - ($8 || ' minutes')::interval
        )
      ORDER BY q.next_attempt_at ASC, q.created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbound_message_queue q
    SET
      status = 'retry',
      next_attempt_at = NOW() + ($3 || ' seconds')::interval,
      metadata = COALESCE(q.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'claimed_by', $2::text,
          'claimed_at', NOW()::text,
          'claim_count', COALESCE(NULLIF(q.metadata->>'claim_count', '')::int, 0) + 1
        ),
      updated_at = NOW()
    FROM claimable
    WHERE q.id = claimable.id
    RETURNING q.*, claimable.due_at`,
    [safeLimit, normalizedClientId, String(claimWindow), recipientDigits, normalizedAllowedSources, getBridgeMaxClaims(), isOutboxQuietHours(), String(codeMinutes()), onlyToPeopleWhoWrote()]
  );

  // UPDATE … RETURNING hands rows back in no particular order, and the bridge
  // sends them in the order it is given. A new agent's welcome reached them
  // with the payment message in the middle and the first message near the end
  // (13 Nov 2026). So: in the order they fell due, then the order they were queued.
  const time = (value) => {
    const at = new Date(value).getTime();
    return Number.isNaN(at) ? 0 : at;
  };
  return [...(result.rows || [])].sort((a, b) => time(a.due_at) - time(b.due_at) || time(a.created_at) - time(b.created_at));
}

async function markWhatsappWebBridgeMessageSent(id, patch = {}) {
  const metadata = patch && typeof patch === 'object' ? patch : {};
  const result = await db.query(
    `UPDATE outbound_message_queue
     SET
       status = 'sent',
       sent_at = NOW(),
       last_error = NULL,
       metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(metadata)]
  );
  return result.rows[0] || null;
}

async function markWhatsappWebBridgeMessageFailed(id, errorMessage = 'bridge_send_failed', patch = {}, options = {}) {
  const baseDelay = Math.min(120, Math.max(1, Number(process.env.WHATSAPP_WEB_BRIDGE_RETRY_SECONDS || 1)));
  // The bridge's own reading of the error comes first (it saw the response);
  // otherwise read the message. "no LID found" is WhatsApp saying there is no
  // such user: retrying in a second, eight times, only earns a rate limit.
  const classified = classifyBridgeSendError(errorMessage);
  const suppressRetry = options?.suppressRetry === true || options?.permanent === true || classified.permanent;
  // The session was down. The try is not counted against the message, nor the
  // hand-over that led to it: it has not yet had a chance to be sent. After a
  // day and a half of that, it is let go.
  const sessionDown = !suppressRetry && classified.reason === 'session_not_ready';
  const retryDelay = Math.max(
    baseDelay,
    Number(options?.retryDelaySeconds) || 0,
    classified.retryDelaySeconds || 0
  );
  const metadata = {
    ...(patch && typeof patch === 'object' ? patch : {}),
    ...(classified.reason ? { failure_class: classified.reason } : {}),
    ...(suppressRetry ? { retry_suppressed: true } : {})
  };
  const result = await db.query(
    `UPDATE outbound_message_queue
     SET
       status = CASE
         WHEN $5::boolean THEN 'failed'
         WHEN $6::boolean THEN CASE WHEN created_at < NOW() - INTERVAL '36 hours' THEN 'failed' ELSE 'retry' END
         WHEN attempts + 1 >= 8 THEN 'failed'
         ELSE 'retry'
       END,
       attempts = attempts + CASE WHEN $6::boolean THEN 0 ELSE 1 END,
       last_error = $2,
       next_attempt_at = CASE WHEN $5::boolean THEN NOW() ELSE NOW() + ($3 || ' seconds')::interval END,
       metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
         || CASE WHEN $6::boolean
              THEN jsonb_build_object('claim_count', GREATEST(COALESCE(NULLIF(metadata->>'claim_count', '')::int, 0) - 1, 0))
              ELSE '{}'::jsonb
            END,
       updated_at = NOW()
     WHERE id = $1
       -- A message already marked sent has reached the customer. A late or
       -- confused failure report must never put it back in the queue, or it
       -- is delivered again.
       AND status <> 'sent'
     RETURNING *`,
    [id, String(errorMessage || 'bridge_send_failed'), String(retryDelay), JSON.stringify(metadata), suppressRetry, sessionDown]
  );
  return result.rows[0] || null;
}

async function getWhatsappWebBridgeStatus() {
  const summary = await db.query(
    `SELECT
      COUNT(*)::int AS total_clients,
      COUNT(*) FILTER (WHERE status = 'online' AND last_seen_at >= NOW() - INTERVAL '90 seconds')::int AS online_clients,
      MAX(last_seen_at) AS last_seen_at
     FROM whatsapp_web_bridge_clients`
  );

  const clients = await db.query(
    `SELECT client_id, operator_name, status, browser_name, profile_dir, current_url, active_chat_key,
            unread_count, last_error, stats, metadata, last_seen_at, updated_at
     FROM whatsapp_web_bridge_clients
     ORDER BY last_seen_at DESC
     LIMIT 10`
  );

  return {
    summary: summary.rows[0] || { total_clients: 0, online_clients: 0, last_seen_at: null },
    clients: clients.rows
  };
}

module.exports = {
  letGoOfLiveNoticesNoLongerTrue,
  wroteWithinDays,
  waitsForThem,
  notSentUntilTheyWrite,
  classifyBridgeSendError,
  bridgeSessionCannotSend,
  bridgeCarriedSource,
  BRIDGE_CARRIED_SOURCES,
  onlyToPeopleWhoWrote,
  pausedSql,
  pausedNumbers,
  isNumberPaused,
  setNumberPaused,
  hasWrittenSql,
  hasWrittenToUs,
  letGoOfWhatNobodyCameFor,
  withoutTheCode,
  carriesACode,
  whatsappSessionNeedsLinking,
  letGoOfExpiredCodes,
  isOutboxQuietHours,
  getWhatsappDeliveryMode,
  getWhatsappWebBridgeStatus,
  getWhatsappWebBridgeToken,
  isDeliverableWhatsappRecipient,
  isWhatsappWebBridgeEnabled,
  markWhatsappWebBridgeMessageFailed,
  markWhatsappWebBridgeMessageSent,
  normalizeBridgeRecipient,
  queueWhatsappWebBridgeMessage,
  repeatSafeReplyText,
  repeatLeadsFor,
  REPEAT_LEADS,
  claimWhatsappWebBridgeMessages,
  upsertWhatsappWebBridgeClient,
  whatsappChatKind
};
