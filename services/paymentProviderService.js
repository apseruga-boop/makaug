'use strict';

const { writeAdminAudit, mirrorLegacyAudit } = require('./adminSecurityService');

function clean(value) {
  return String(value || '').trim();
}

function paymentProviderConfigured() {
  return Boolean(process.env.PAYMENT_LINK_BASE_URL || process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET || process.env.PAYMENT_PROVIDER_API_KEY);
}

function normalizePaymentStatus(value) {
  const status = clean(value).toLowerCase();
  if (['paid', 'success', 'successful', 'completed'].includes(status)) return 'paid';
  if (['failed', 'declined', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['expired'].includes(status)) return 'expired';
  return 'pending';
}

async function updateCampaignPayment(db, campaignId, status, reference = null) {
  if (!campaignId) return null;
  const campaignStatus = status === 'paid' ? 'paid' : status === 'failed' ? 'awaiting_payment' : null;
  const paymentStatus = status === 'paid' ? 'paid' : status === 'failed' ? 'unpaid' : status;
  const result = await db.query(
    `UPDATE advertising_campaigns
     SET payment_status = $2,
         status = COALESCE($3, status),
         payment_reference = COALESCE($4, payment_reference),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [campaignId, paymentStatus, campaignStatus, reference]
  );
  return result.rows[0] || null;
}

async function markInvoicePaidManually(db, {
  invoiceId,
  adminUserId = null,
  reason = '',
  reference = '',
  req = null
} = {}) {
  if (!invoiceId) {
    const error = new Error('invoiceId is required');
    error.status = 400;
    throw error;
  }
  if (!clean(reason)) {
    const error = new Error('reason is required for manual payment marking');
    error.status = 400;
    throw error;
  }
  const invoice = await db.query(
    `UPDATE invoices
     SET status = 'paid',
         payment_method = COALESCE(NULLIF(payment_method, ''), 'manual'),
         payment_provider = COALESCE(NULLIF(payment_provider, ''), 'manual'),
         payment_reference = COALESCE($2, payment_reference),
         paid_at = COALESCE(paid_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [invoiceId, clean(reference) || null]
  );
  if (!invoice.rows.length) {
    const error = new Error('Invoice not found');
    error.status = 404;
    throw error;
  }
  const item = invoice.rows[0];
  await db.query(
    `UPDATE payment_links
     SET status = 'paid',
         paid_at = COALESCE(paid_at, NOW()),
         updated_at = NOW()
     WHERE invoice_id = $1`,
    [invoiceId]
  ).catch(() => {});
  await updateCampaignPayment(db, item.campaign_id, 'paid', clean(reference) || item.invoice_number);
  await writeAdminAudit(db, {
    adminUserId,
    action: 'manual_payment_marked_paid',
    targetType: 'invoice',
    targetId: invoiceId,
    metadata: { reason: clean(reason), reference: clean(reference) || null, campaign_id: item.campaign_id },
    req
  });
  await mirrorLegacyAudit(db, {
    actorId: adminUserId || 'admin_api_key',
    action: 'manual_payment_marked_paid',
    details: { invoice_id: invoiceId, reason: clean(reason), reference: clean(reference) || null }
  });
  return item;
}

async function handlePaymentWebhook(db, {
  provider = process.env.PAYMENT_PROVIDER || 'manual',
  payload = {},
  signature = '',
  req = null
} = {}) {
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const reference = clean(safePayload.providerReference || safePayload.provider_reference || safePayload.reference || safePayload.invoice_number || safePayload.invoiceNumber);
  const invoiceId = clean(safePayload.invoiceId || safePayload.invoice_id);
  const status = normalizePaymentStatus(safePayload.status || safePayload.payment_status || safePayload.event);
  const values = [];
  let where = '';
  if (invoiceId) {
    values.push(invoiceId);
    where = `id = $${values.length}`;
  } else if (reference) {
    values.push(reference);
    where = `(invoice_number = $${values.length} OR payment_reference = $${values.length})`;
  } else {
    const error = new Error('Webhook payload is missing invoiceId or provider reference');
    error.status = 400;
    throw error;
  }
  const invoiceResult = await db.query(`SELECT * FROM invoices WHERE ${where} LIMIT 1`, values);
  if (!invoiceResult.rows.length) {
    const error = new Error('Invoice not found for payment webhook');
    error.status = 404;
    throw error;
  }
  const invoice = invoiceResult.rows[0];
  const invoiceStatus = status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending_payment';
  const updatedInvoice = await db.query(
    `UPDATE invoices
     SET status = $2,
         payment_provider = $3,
         payment_reference = COALESCE($4, payment_reference),
         paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [invoice.id, invoiceStatus, clean(provider) || 'manual', reference || null]
  );
  await db.query(
    `UPDATE payment_links
     SET status = $2,
         provider_reference = COALESCE($3, provider_reference),
         webhook_payload = $4::jsonb,
         paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
         updated_at = NOW()
     WHERE invoice_id = $1`,
    [invoice.id, status, reference || null, JSON.stringify({ provider, signature_present: Boolean(signature), payload: safePayload })]
  ).catch(() => {});
  if (invoice.campaign_id) {
    await updateCampaignPayment(db, invoice.campaign_id, status, reference || invoice.invoice_number);
  }
  await writeAdminAudit(db, {
    action: 'payment_webhook_processed',
    targetType: 'invoice',
    targetId: invoice.id,
    metadata: { provider, status, reference: reference || null, configured: paymentProviderConfigured() },
    req
  });
  return updatedInvoice.rows[0] || null;
}

async function getPaymentStatus(db, paymentLinkId) {
  const result = await db.query(
    `SELECT pl.*, i.status AS invoice_status, c.status AS campaign_status, c.payment_status AS campaign_payment_status
     FROM payment_links pl
     LEFT JOIN invoices i ON i.id = pl.invoice_id
     LEFT JOIN advertising_campaigns c ON c.id = pl.related_campaign_id
     WHERE pl.id = $1 OR pl.provider_reference = $1
     LIMIT 1`,
    [paymentLinkId]
  );
  return result.rows[0] || null;
}

module.exports = {
  getPaymentStatus,
  handlePaymentWebhook,
  markInvoicePaidManually,
  normalizePaymentStatus,
  paymentProviderConfigured
};
