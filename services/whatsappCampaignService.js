const twilio = require('twilio');

const db = require('../config/database');
const logger = require('../config/logger');

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

async function sendWhatsAppText({ to, body }) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!client || !from) {
    logger.info('[WHATSAPP CAMPAIGN MOCK SEND]', { to, body });
    return { mocked: true, status: 'mocked' };
  }

  const toFormatted = String(to || '').startsWith('whatsapp:')
    ? String(to)
    : `whatsapp:${String(to || '').replace(/\s+/g, '')}`;
  const fromFormatted = String(from).startsWith('whatsapp:')
    ? String(from)
    : `whatsapp:${String(from)}`;

  const result = await client.messages.create({
    from: fromFormatted,
    to: toFormatted,
    body
  });

  return { sid: result.sid, status: result.status || 'queued', mocked: false };
}

async function processPendingCampaignQueue({ limit = 100, maxAttempts = 4 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  const rows = await db.query(
    `SELECT id, user_phone, payload, attempts, campaign_id
     FROM outbound_message_queue
     WHERE status IN ('pending','retry')
       AND channel = 'whatsapp'
       AND next_attempt_at <= NOW()
     ORDER BY created_at ASC
     LIMIT $1`,
    [normalizedLimit]
  );

  const summary = {
    processed: 0,
    sent: 0,
    failed: 0,
    retried: 0
  };

  for (const row of rows.rows) {
    summary.processed += 1;
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const text = String(payload.text || payload.body || '').trim();
    if (!text) {
      await db.query(
        `UPDATE outbound_message_queue
         SET status = 'failed', attempts = attempts + 1, last_error = 'missing_message_body', updated_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
      summary.failed += 1;
      continue;
    }

    try {
      const sendResult = await sendWhatsAppText({ to: row.user_phone, body: text });
      await db.query(
        `UPDATE outbound_message_queue
         SET status = 'sent',
             attempts = attempts + 1,
             sent_at = NOW(),
             last_error = NULL,
             payload = payload || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, JSON.stringify({ provider: 'twilio', result: sendResult })]
      );
      summary.sent += 1;
    } catch (error) {
      const nextAttempts = (parseInt(row.attempts, 10) || 0) + 1;
      const retryDelayMinutes = Math.min(60, 2 ** Math.min(nextAttempts, 6));
      const shouldRetry = nextAttempts < maxAttempts;

      await db.query(
        `UPDATE outbound_message_queue
         SET status = $2,
             attempts = attempts + 1,
             last_error = $3,
             next_attempt_at = CASE WHEN $2 = 'retry' THEN NOW() + ($4::text || ' minutes')::interval ELSE next_attempt_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, shouldRetry ? 'retry' : 'failed', String(error.message || 'send_failed').slice(0, 500), String(retryDelayMinutes)]
      );

      if (shouldRetry) summary.retried += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

module.exports = {
  processPendingCampaignQueue
};
