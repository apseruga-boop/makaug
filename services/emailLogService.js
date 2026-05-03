'use strict';

const logger = require('../config/logger');

function maskEmail(value = '') {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}***@${domain || 'email'}`;
}

async function logEmailEvent(db, entry = {}) {
  if (!db) return null;
  try {
    const result = await db.query(
      `INSERT INTO email_logs (
        event_type,
        recipient_user_id,
        recipient_email_masked,
        recipient_role,
        template_key,
        subject,
        language,
        status,
        provider,
        provider_message_id,
        related_listing_id,
        related_lead_id,
        related_advertiser_id,
        related_campaign_id,
        related_mortgage_lead_id,
        failure_reason,
        sent_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id`,
      [
        entry.eventType || entry.event_type || 'event',
        entry.recipientUserId || entry.recipient_user_id || null,
        maskEmail(entry.recipientEmail || entry.recipient_email),
        entry.recipientRole || entry.recipient_role || null,
        entry.templateKey || entry.template_key || null,
        entry.subject || null,
        entry.language || 'en',
        entry.status || 'logged',
        entry.provider || null,
        entry.providerMessageId || entry.provider_message_id || null,
        entry.relatedListingId || entry.related_listing_id || null,
        entry.relatedLeadId || entry.related_lead_id || null,
        entry.relatedAdvertiserId || entry.related_advertiser_id || null,
        entry.relatedCampaignId || entry.related_campaign_id || null,
        entry.relatedMortgageLeadId || entry.related_mortgage_lead_id || null,
        entry.failureReason || entry.failure_reason || null,
        entry.sentAt || entry.sent_at || null
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (!['42P01', '42703'].includes(error?.code)) {
      logger.warn('Email log write failed', {
        eventType: entry.eventType || entry.event_type,
        error: error.message
      });
    }
    return null;
  }
}

module.exports = {
  logEmailEvent,
  maskEmail
};
