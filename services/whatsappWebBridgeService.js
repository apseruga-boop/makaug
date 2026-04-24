const db = require('../config/database');
const { normalizeUgPhoneForWhatsApp } = require('./whatsappNotificationService');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isWhatsappWebBridgeEnabled() {
  return isTruthy(process.env.WHATSAPP_WEB_BRIDGE_ENABLED)
    || String(process.env.WHATSAPP_DELIVERY_MODE || '').trim().toLowerCase() === 'web_bridge';
}

function getWhatsappDeliveryMode() {
  const raw = String(process.env.WHATSAPP_DELIVERY_MODE || 'auto').trim().toLowerCase();
  return ['provider', 'web_bridge', 'auto'].includes(raw) ? raw : 'auto';
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

  const normalizedStatus = ['offline', 'starting', 'waiting_for_login', 'online', 'degraded', 'error'].includes(String(status || '').trim().toLowerCase())
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
  source = 'system',
  actorId = 'system',
  metadata = {},
  campaignId = null
}) {
  const userPhone = normalizeBridgeRecipient(recipient);
  const body = String(text || '').trim();
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

  const payload = {
    text: body
  };

  const meta = {
    delivery_mode: 'web_bridge',
    source: String(source || 'system').trim().toLowerCase(),
    actor_id: actorId || 'system',
    ...(metadata && typeof metadata === 'object' ? metadata : {})
  };

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
      NOW(),
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
      JSON.stringify(meta)
    ]
  );

  return result.rows[0] || null;
}

async function claimWhatsappWebBridgeMessages({ clientId, limit = 10 } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const claimWindow = Math.min(300, Math.max(15, Number(process.env.WHATSAPP_WEB_BRIDGE_CLAIM_SECONDS || 45)));
  const normalizedClientId = String(clientId || '').trim() || 'web_bridge';

  const result = await db.query(
    `WITH claimable AS (
      SELECT q.id
      FROM outbound_message_queue q
      WHERE q.channel = 'whatsapp'
        AND q.status IN ('pending', 'retry')
        AND q.next_attempt_at <= NOW()
        AND COALESCE(q.metadata->>'delivery_mode', '') = 'web_bridge'
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
          'claimed_at', NOW()::text
        ),
      updated_at = NOW()
    FROM claimable
    WHERE q.id = claimable.id
    RETURNING q.*`,
    [safeLimit, normalizedClientId, String(claimWindow)]
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

async function markWhatsappWebBridgeMessageFailed(id, errorMessage = 'bridge_send_failed', patch = {}) {
  const retryDelay = Math.min(300, Math.max(15, Number(process.env.WHATSAPP_WEB_BRIDGE_RETRY_SECONDS || 30)));
  const metadata = patch && typeof patch === 'object' ? patch : {};
  const result = await db.query(
    `UPDATE outbound_message_queue
     SET
       status = CASE WHEN attempts + 1 >= 8 THEN 'failed' ELSE 'retry' END,
       attempts = attempts + 1,
       last_error = $2,
       next_attempt_at = NOW() + ($3 || ' seconds')::interval,
       metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, String(errorMessage || 'bridge_send_failed'), String(retryDelay), JSON.stringify(metadata)]
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
  getWhatsappDeliveryMode,
  getWhatsappWebBridgeStatus,
  getWhatsappWebBridgeToken,
  isWhatsappWebBridgeEnabled,
  markWhatsappWebBridgeMessageFailed,
  markWhatsappWebBridgeMessageSent,
  normalizeBridgeRecipient,
  queueWhatsappWebBridgeMessage,
  claimWhatsappWebBridgeMessages,
  upsertWhatsappWebBridgeClient
};
