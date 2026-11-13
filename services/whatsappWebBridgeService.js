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
 */
const REPEAT_LEADS = Object.freeze({
  en: Object.freeze(['🔁 Here it is again:', '🔁 Once more:']),
  lg: Object.freeze(['🔁 Nate:', '🔁 Omulundi omulala:']),
  sw: Object.freeze(['🔁 Hii hapa tena:', '🔁 Kwa mara nyingine:'])
});
const ALL_REPEAT_LEADS = Object.freeze([...new Set(Object.values(REPEAT_LEADS).flat())]);

function repeatLeadsFor(language = 'en') {
  return REPEAT_LEADS[String(language || '').trim().toLowerCase()] || REPEAT_LEADS.en;
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

function withoutRepeatLead(text) {
  const body = String(text || '');
  const lead = ALL_REPEAT_LEADS.find((candidate) => body.startsWith(`${candidate}\n\n`));
  return lead ? body.slice(lead.length + 2) : body;
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
  const lang = typeof language === 'function' ? await Promise.resolve(language()).catch(() => 'en') : language;
  for (const lead of repeatLeadsFor(lang)) {
    const candidate = `${lead}\n\n${body}`;
    if (!taken.has(bridgeBodyFingerprint(candidate, mediaUrl))) return candidate;
  }
  // Asked a third time inside the window: the bridge may hold this one back.
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

async function claimWhatsappWebBridgeMessages({ clientId, limit = 10, recipient = '', allowedSources = [] } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const claimWindow = getBridgeClaimWindowSeconds();
  const normalizedClientId = String(clientId || '').trim() || 'web_bridge';
  const recipientDigits = String(recipient || '').replace(/\D/g, '');
  const normalizedAllowedSources = (Array.isArray(allowedSources) ? allowedSources : String(allowedSources || '').split(','))
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value, index, values) => value && /^[a-z0-9_:-]{1,80}$/.test(value) && values.indexOf(value) === index)
    .slice(0, 8);

  const result = await db.query(
    `WITH claimable AS (
      SELECT q.id
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
    RETURNING q.*`,
    [safeLimit, normalizedClientId, String(claimWindow), recipientDigits, normalizedAllowedSources, getBridgeMaxClaims()]
  );

  return result.rows;
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
       status = CASE WHEN $5::boolean OR attempts + 1 >= 8 THEN 'failed' ELSE 'retry' END,
       attempts = attempts + 1,
       last_error = $2,
       next_attempt_at = CASE WHEN $5::boolean THEN NOW() ELSE NOW() + ($3 || ' seconds')::interval END,
       metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
       updated_at = NOW()
     WHERE id = $1
       -- A message already marked sent has reached the customer. A late or
       -- confused failure report must never put it back in the queue, or it
       -- is delivered again.
       AND status <> 'sent'
     RETURNING *`,
    [id, String(errorMessage || 'bridge_send_failed'), String(retryDelay), JSON.stringify(metadata), suppressRetry]
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
  classifyBridgeSendError,
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
