'use strict';

const { sendSupportEmail } = require('./emailService');
const { sendWhatsAppText } = require('./whatsappNotificationService');
const { notificationStatusFromDelivery } = require('./notificationLogService');
const { writeAdminAudit, mirrorLegacyAudit } = require('./adminSecurityService');

function clean(value) {
  return String(value || '').trim();
}

function isProviderMissing(delivery = {}) {
  const reason = clean(delivery.reason || delivery.error || delivery.failureReason).toLowerCase();
  return delivery.mocked === true || reason.includes('not_configured') || reason.includes('provider_missing');
}

async function auditRetry(db, { adminUserId, targetType, targetId, status, reason, req }) {
  await writeAdminAudit(db, {
    adminUserId,
    action: 'notification_retry_attempted',
    targetType,
    targetId,
    metadata: { status, reason: reason || null },
    req
  });
  await mirrorLegacyAudit(db, {
    actorId: adminUserId || 'admin_api_key',
    action: 'notification_retry_attempted',
    details: { target_type: targetType, target_id: targetId, status, reason: reason || null }
  });
}

async function retryNotification(db, { id, adminUserId = null, req = null } = {}) {
  const found = await db.query('SELECT * FROM notifications WHERE id = $1 LIMIT 1', [id]);
  if (!found.rows.length) {
    const error = new Error('Notification not found');
    error.status = 404;
    throw error;
  }
  const item = found.rows[0];
  const channel = clean(item.channel || 'in_app').toLowerCase();
  let delivery = { sent: false, reason: 'unsupported_channel' };
  if (channel === 'email') {
    delivery = await sendSupportEmail({
      to: item.recipient_email,
      subject: `MakaUg notification retry: ${item.type || 'update'}`,
      text: `MakaUg retry for ${item.type || 'notification'}.\n\nReference: ${id}`
    });
  } else if (channel === 'whatsapp') {
    delivery = await sendWhatsAppText({
      to: item.recipient_phone,
      body: `MakaUg update: retrying ${item.type || 'notification'}.\nRef: ${id}`
    });
  } else if (channel === 'in_app') {
    delivery = { sent: true, provider: 'in_app' };
  }
  const retryStatus = isProviderMissing(delivery) ? 'failed' : notificationStatusFromDelivery(delivery);
  const failureReason = delivery.error || delivery.reason || (isProviderMissing(delivery) ? `${channel}_provider_missing` : null);
  const updated = await db.query(
    `UPDATE notifications
     SET status = $2,
         failure_reason = $3,
         sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
     WHERE id = $1
     RETURNING *`,
    [id, retryStatus, failureReason]
  );
  await auditRetry(db, { adminUserId, targetType: 'notification', targetId: id, status: retryStatus, reason: failureReason, req });
  return { item: updated.rows[0], delivery };
}

async function retryEmailLog(db, { id, adminUserId = null, req = null } = {}) {
  const found = await db.query('SELECT * FROM email_logs WHERE id = $1 LIMIT 1', [id]);
  if (!found.rows.length) {
    const error = new Error('Email log not found');
    error.status = 404;
    throw error;
  }
  const item = found.rows[0];
  const delivery = await sendSupportEmail({
    to: item.recipient_email_masked && item.recipient_email_masked.includes('***') ? null : item.recipient_email_masked,
    subject: item.subject || `MakaUg email retry: ${item.template_key || item.event_type || 'notification'}`,
    text: `MakaUg email retry for ${item.event_type || item.template_key || 'notification'}.\n\nLog: ${id}`
  });
  const retryStatus = isProviderMissing(delivery) ? 'failed' : notificationStatusFromDelivery(delivery);
  const failureReason = delivery.error || delivery.reason || (isProviderMissing(delivery) ? 'email_provider_missing_or_recipient_masked' : null);
  const updated = await db.query(
    `UPDATE email_logs
     SET status = $2,
         failure_reason = $3,
         sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
     WHERE id = $1
     RETURNING *`,
    [id, retryStatus, failureReason]
  );
  await auditRetry(db, { adminUserId, targetType: 'email_log', targetId: id, status: retryStatus, reason: failureReason, req });
  return { item: updated.rows[0], delivery };
}

async function retryWhatsAppLog(db, { id, adminUserId = null, req = null } = {}) {
  const found = await db.query('SELECT * FROM whatsapp_message_logs WHERE id = $1 LIMIT 1', [id]);
  if (!found.rows.length) {
    const error = new Error('WhatsApp log not found');
    error.status = 404;
    throw error;
  }
  const item = found.rows[0];
  const retryStatus = 'failed';
  const failureReason = item.recipient_phone_masked
    ? 'recipient_phone_is_masked_retry_requires_original_conversation'
    : 'whatsapp_provider_missing_or_no_recipient';
  const updated = await db.query(
    `UPDATE whatsapp_message_logs
     SET status = $2,
         failure_reason = $3
     WHERE id = $1
     RETURNING *`,
    [id, retryStatus, failureReason]
  );
  await auditRetry(db, { adminUserId, targetType: 'whatsapp_message_log', targetId: id, status: retryStatus, reason: failureReason, req });
  return { item: updated.rows[0], delivery: { sent: false, reason: failureReason } };
}

module.exports = {
  retryEmailLog,
  retryNotification,
  retryWhatsAppLog
};
