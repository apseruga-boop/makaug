'use strict';

const logger = require('../config/logger');

function maskRecipient(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) {
    const [name, domain] = raw.split('@');
    return `${name.slice(0, 2)}***@${domain || 'email'}`;
  }
  const digits = raw.replace(/\D/g, '');
  return digits.length > 4 ? `${digits.slice(0, 4)}***${digits.slice(-3)}` : raw;
}

async function logNotification(db, entry = {}) {
  if (!db) return null;
  try {
    const result = await db.query(
      `INSERT INTO notifications (
        user_id,
        recipient_phone,
        recipient_email,
        channel,
        type,
        status,
        payload_summary,
        related_listing_id,
        related_saved_search_id,
        related_lead_id,
        failure_reason,
        sent_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
      RETURNING id`,
      [
        entry.userId || null,
        entry.recipientPhone || null,
        entry.recipientEmail || null,
        entry.channel || 'in_app',
        entry.type || 'event',
        entry.status || 'logged',
        JSON.stringify({
          ...(entry.payloadSummary && typeof entry.payloadSummary === 'object' ? entry.payloadSummary : {}),
          recipient_phone_masked: maskRecipient(entry.recipientPhone),
          recipient_email_masked: maskRecipient(entry.recipientEmail)
        }),
        entry.relatedListingId || null,
        entry.relatedSavedSearchId || null,
        entry.relatedLeadId || null,
        entry.failureReason || null,
        entry.sentAt || null
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code !== '42P01' && error.code !== '42703') {
      logger.warn('Notification log write failed', { type: entry.type, channel: entry.channel, error: error.message });
    }
    return null;
  }
}

function notificationStatusFromDelivery(delivery = {}) {
  if (delivery?.sent === true) return 'sent';
  if (delivery?.mocked === true || delivery?.manual_url) return 'logged';
  if (delivery?.skipped === true) return 'skipped';
  if (delivery?.error || delivery?.failureReason || delivery?.reason) return 'failed';
  return 'logged';
}

module.exports = {
  logNotification,
  notificationStatusFromDelivery
};
