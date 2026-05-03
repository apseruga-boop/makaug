'use strict';

const logger = require('../config/logger');

function maskPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 6 ? `${digits.slice(0, 4)}***${digits.slice(-3)}` : digits;
}

async function logWhatsAppMessage(db, entry = {}) {
  if (!db) return null;
  try {
    const result = await db.query(
      `INSERT INTO whatsapp_message_logs (
        conversation_id,
        recipient_phone_masked,
        user_id,
        template_key,
        message_type,
        language,
        status,
        related_listing_id,
        related_lead_id,
        related_booking_id,
        related_campaign_id,
        failure_reason,
        sent_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id`,
      [
        entry.conversationId || entry.conversation_id || null,
        maskPhone(entry.recipientPhone || entry.recipient_phone),
        entry.userId || entry.user_id || null,
        entry.templateKey || entry.template_key || null,
        entry.messageType || entry.message_type || 'template',
        entry.language || 'en',
        entry.status || 'logged',
        entry.relatedListingId || entry.related_listing_id || null,
        entry.relatedLeadId || entry.related_lead_id || null,
        entry.relatedBookingId || entry.related_booking_id || null,
        entry.relatedCampaignId || entry.related_campaign_id || null,
        entry.failureReason || entry.failure_reason || null,
        entry.sentAt || entry.sent_at || null
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (!['42P01', '42703'].includes(error?.code)) {
      logger.warn('WhatsApp message log write failed', {
        templateKey: entry.templateKey || entry.template_key,
        error: error.message
      });
    }
    return null;
  }
}

module.exports = {
  logWhatsAppMessage,
  maskPhone
};
