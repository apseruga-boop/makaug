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

async function refreshCampaignStatus(campaignId) {
  if (!campaignId) return null;
  const counts = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM outbound_message_queue
     WHERE campaign_id = $1`,
    [campaignId]
  );
  const row = counts.rows[0] || {};
  const total = parseInt(row.total, 10) || 0;
  const pending = parseInt(row.pending, 10) || 0;
  const sent = parseInt(row.sent, 10) || 0;
  const nextStatus = total > 0 && pending === 0 ? 'sent' : 'queued';

  const updated = await db.query(
    `UPDATE marketing_campaigns
     SET status = $2,
         sent_at = CASE WHEN $2 = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END,
         updated_at = NOW()
     WHERE id = $1
       AND status <> 'cancelled'
     RETURNING id, status, queued_at, sent_at, updated_at`,
    [campaignId, nextStatus]
  );

  return {
    ...(updated.rows[0] || { id: campaignId, status: nextStatus }),
    total_recipients: total,
    pending_count: pending,
    sent_count: sent,
    failed_count: parseInt(row.failed, 10) || 0
  };
}

async function processPendingCampaignQueue({ limit = 100, maxAttempts = 4, campaignId = null } = {}) {
  const normalizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  const rows = await db.query(
    `SELECT id, user_phone, payload, attempts, campaign_id
     FROM outbound_message_queue
     WHERE status IN ('pending','retry')
       AND channel = 'whatsapp'
       AND next_attempt_at <= NOW()
       AND ($2::uuid IS NULL OR campaign_id = $2)
     ORDER BY created_at ASC
     LIMIT $1`,
    [normalizedLimit, campaignId || null]
  );

  const summary = {
    processed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    campaigns: []
  };
  const campaignIds = [...new Set(rows.rows.map((row) => row.campaign_id).filter(Boolean))];

  if (campaignIds.length) {
    await db.query(
      `UPDATE marketing_campaigns
       SET status = 'sending',
           updated_at = NOW()
       WHERE id = ANY($1::uuid[])
         AND status IN ('draft','queued','sending')`,
      [campaignIds]
    );
  }

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

  for (const campaignId of campaignIds) {
    const status = await refreshCampaignStatus(campaignId);
    if (status) summary.campaigns.push(status);
  }

  return summary;
}

module.exports = {
  processPendingCampaignQueue,
  refreshCampaignStatus
};
