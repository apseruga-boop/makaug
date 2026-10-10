'use strict';

// WhatsApp activity for the admin and staff panels (C5, 10 Oct 2026).
//
// The panels read whatsapp_message_logs, whose last row is 12 Sep 2026: the
// web bridge writes whatsapp_messages (inbound and outbound) and the outbox
// (outbound_message_queue) instead. One source of truth now:
//   - messages:  whatsapp_messages (what the bridge actually received/sent)
//   - failures:  outbound_message_queue, channel 'whatsapp', status 'failed'
//   - conversations: whatsapp_conversation_state
// whatsapp_message_logs is still written by the template sender and keeps its
// retry route, but no panel count reads it any more.

const { maskPhone } = require('./whatsappMessageLogService');

const FAILED_WHATSAPP_SQL = `SELECT COUNT(*)::int AS total
  FROM outbound_message_queue
 WHERE COALESCE(channel, 'whatsapp') = 'whatsapp'
   AND status = 'failed'`;

function messagePreview(payload = {}) {
  const value = payload && typeof payload === 'object'
    ? (payload.text?.body || payload.text || payload.body || payload.caption || payload.message || '')
    : '';
  const text = String(typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

// Newest first: bridge messages plus failed outbox sends, in the shape the
// admin log list already renders (message_type, status, recipient_phone_masked,
// failure_reason, created_at).
async function listWhatsappActivity(db, { limit = 50, offset = 0, status = '' } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const wanted = String(status || '').trim().toLowerCase();
  const includeMessages = !wanted || ['received', 'sent', 'inbound', 'outbound'].includes(wanted);
  const includeFailures = !wanted || wanted === 'failed';
  const directionFilter = wanted === 'received' || wanted === 'inbound' ? "AND direction = 'inbound'"
    : (wanted === 'sent' || wanted === 'outbound' ? "AND direction = 'outbound'" : '');
  const parts = [];
  if (includeMessages) {
    parts.push(`SELECT id::text AS id, 'whatsapp_messages' AS source, user_phone, direction,
                       message_type, CASE WHEN direction = 'inbound' THEN 'received' ELSE 'sent' END AS status,
                       payload, NULL::text AS failure_reason, created_at
                  FROM whatsapp_messages
                 WHERE TRUE ${directionFilter}`);
  }
  if (includeFailures) {
    parts.push(`SELECT id::text AS id, 'outbound_message_queue' AS source, user_phone, 'outbound' AS direction,
                       COALESCE(payload->>'type', 'outbox') AS message_type, status,
                       payload, last_error AS failure_reason, COALESCE(updated_at, created_at) AS created_at
                  FROM outbound_message_queue
                 WHERE COALESCE(channel, 'whatsapp') = 'whatsapp' AND status = 'failed'`);
  }
  const unionSql = parts.join(' UNION ALL ');
  const [rows, count] = await Promise.all([
    db.query(`SELECT * FROM (${unionSql}) activity ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]),
    db.query(`SELECT COUNT(*)::int AS total FROM (${unionSql}) activity`)
  ]);
  return {
    total: Number(count.rows[0]?.total || 0),
    rows: rows.rows.map((row) => ({
      id: row.id,
      source: row.source,
      direction: row.direction,
      message_type: row.message_type || 'message',
      status: row.status,
      recipient_phone_masked: maskPhone(row.user_phone),
      preview: messagePreview(row.payload),
      failure_reason: row.failure_reason || null,
      created_at: row.created_at
    }))
  };
}

async function countFailedWhatsapp(db) {
  const result = await db.query(FAILED_WHATSAPP_SQL);
  return Number(result.rows[0]?.total || 0);
}

// Freshness for the panel header: when the bridge last received and sent.
async function whatsappActivityFreshness(db) {
  const result = await db.query(
    `SELECT MAX(created_at) FILTER (WHERE direction = 'inbound') AS last_inbound_at,
            MAX(created_at) FILTER (WHERE direction = 'outbound') AS last_outbound_at,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS messages_24h
       FROM whatsapp_messages`
  );
  const row = result.rows[0] || {};
  return {
    source: 'whatsapp_messages',
    last_inbound_at: row.last_inbound_at || null,
    last_outbound_at: row.last_outbound_at || null,
    messages_24h: Number(row.messages_24h || 0)
  };
}

module.exports = {
  FAILED_WHATSAPP_SQL,
  countFailedWhatsapp,
  listWhatsappActivity,
  messagePreview,
  whatsappActivityFreshness
};
