'use strict';

const crypto = require('crypto');
const { writeAdminAudit, mirrorLegacyAudit } = require('./adminSecurityService');
const { sendAdvertisingLifecycleNotification } = require('./advertisingLifecycleNotificationService');

function clean(value) {
  return String(value || '').trim();
}

function normalizeProvider(value = '') {
  const provider = clean(value || process.env.UGANDA_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();
  if (['flw', 'flutterwave', 'flutter_wave'].includes(provider)) return 'flutterwave';
  if (provider.includes('flutterwave')) return 'flutterwave';
  if (provider.includes('paypal')) return 'paypal';
  return provider || 'manual';
}

function isFlutterwaveProvider(value = '') {
  return normalizeProvider(value) === 'flutterwave';
}

function flutterwaveSecretKey() {
  return clean(process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY);
}

function flutterwaveWebhookSecret() {
  return clean(process.env.FLUTTERWAVE_WEBHOOK_SECRET || process.env.FLW_WEBHOOK_SECRET || process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET);
}

function flutterwaveSecretHash() {
  return clean(process.env.FLUTTERWAVE_SECRET_HASH || process.env.FLW_SECRET_HASH || process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH);
}

function paymentProviderConfigured(provider = process.env.UGANDA_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'manual') {
  const normalized = normalizeProvider(provider);
  if (normalized === 'flutterwave') {
    return Boolean(flutterwaveSecretKey() || process.env.FLUTTERWAVE_PAYMENT_LINK_BASE_URL || process.env.PAYMENT_LINK_BASE_URL);
  }
  return Boolean(process.env.PAYMENT_LINK_BASE_URL || process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET || process.env.PAYMENT_PROVIDER_API_KEY);
}

function normalizePaymentStatus(value) {
  const status = clean(value).toLowerCase();
  if (status.includes('charge.completed')) return 'paid';
  if (['paid', 'success', 'successful', 'completed'].includes(status)) return 'paid';
  if (['failed', 'declined', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['expired'].includes(status)) return 'expired';
  return 'pending';
}

function firstClean(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_error) {
    return '{}';
  }
}

function buildLocalPaymentUrl(paymentLinkId) {
  const base = clean(
    process.env.FLUTTERWAVE_PAYMENT_LINK_BASE_URL
    || process.env.PAYMENT_LINK_BASE_URL
    || process.env.PAYPAL_PAYMENT_LINK_BASE_URL
  ).replace(/\/$/, '');
  if (!base) return null;
  return `${base}/pay/${paymentLinkId}`;
}

function flutterwaveApiBase() {
  return clean(process.env.FLUTTERWAVE_API_BASE_URL || 'https://api.flutterwave.com/v3').replace(/\/$/, '');
}

function flutterwavePaymentOptions(method = '') {
  const normalized = clean(method).toLowerCase();
  if (normalized === 'mobile_money') return 'mobilemoneyuganda';
  if (normalized === 'paypal') return 'paypal';
  if (normalized === 'card') return 'card';
  return 'card,mobilemoneyuganda,paypal';
}

function publicBaseUrl() {
  return clean(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
}

async function createFlutterwaveCheckout({
  amount,
  currency = 'UGX',
  reference,
  invoiceId = null,
  campaignId = null,
  paymentMethod = 'card',
  customer = {},
  title = 'makaug advertising',
  description = 'makaug sponsored advertising booking',
  redirectUrl = '',
  metadata = {}
} = {}) {
  const secretKey = flutterwaveSecretKey();
  if (!secretKey) {
    return { configured: false, provider: 'flutterwave', checkoutUrl: null, providerReference: reference || null, providerError: 'FLUTTERWAVE_SECRET_KEY is not configured' };
  }

  const txRef = clean(reference) || `MK-FLW-${Date.now()}`;
  const payload = {
    tx_ref: txRef,
    amount: Number(amount || 0),
    currency: clean(currency || 'UGX').toUpperCase(),
    redirect_url: clean(redirectUrl) || `${publicBaseUrl()}/advertise?payment_ref=${encodeURIComponent(txRef)}`,
    payment_options: flutterwavePaymentOptions(paymentMethod),
    customer: {
      email: clean(customer.email) || `advertising-${txRef.toLowerCase()}@makaug.com`,
      phonenumber: clean(customer.phone) || undefined,
      name: clean(customer.name) || 'makaug advertiser'
    },
    customizations: {
      title: clean(title) || 'makaug advertising',
      description: clean(description) || 'makaug sponsored advertising booking',
      logo: clean(process.env.FLUTTERWAVE_CHECKOUT_LOGO_URL) || `${publicBaseUrl()}/assets/icon-512.png`
    },
    meta: {
      ...metadata,
      invoice_id: invoiceId,
      campaign_id: campaignId,
      source: 'advertising_selfserve_v1',
      payment_method: paymentMethod
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(process.env.FLUTTERWAVE_TIMEOUT_MS || 12000)));
  try {
    const response = await fetch(`${flutterwaveApiBase()}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.data?.link) {
      const message = body?.message || `Flutterwave checkout failed with HTTP ${response.status}`;
      return { configured: true, provider: 'flutterwave', checkoutUrl: null, providerReference: txRef, providerError: message, providerResponse: body };
    }
    return {
      configured: true,
      provider: 'flutterwave',
      checkoutUrl: body.data.link,
      providerReference: body.data.tx_ref || txRef,
      providerOrderId: body.data.id || null,
      providerResponse: {
        status: body.status || null,
        message: body.message || null,
        id: body.data.id || null,
        link_created: true
      }
    };
  } catch (error) {
    return { configured: true, provider: 'flutterwave', checkoutUrl: null, providerReference: txRef, providerError: error.name === 'AbortError' ? 'Flutterwave checkout timed out' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function createHostedPaymentLink(options = {}) {
  const provider = normalizeProvider(options.provider);
  if (provider === 'flutterwave') {
    return createFlutterwaveCheckout(options);
  }
  const checkoutUrl = buildLocalPaymentUrl(options.invoiceId || options.reference || options.paymentLinkId);
  return {
    configured: Boolean(checkoutUrl),
    provider,
    checkoutUrl,
    providerReference: clean(options.reference) || null,
    providerResponse: checkoutUrl ? { link_created: true, mode: 'configured_base_url' } : null,
    providerError: checkoutUrl ? null : 'PAYMENT_LINK_BASE_URL is not configured'
  };
}

async function requestFlutterwaveRefund({ transactionId, amount = null, reason = '' } = {}) {
  const secretKey = flutterwaveSecretKey();
  const txId = clean(transactionId);
  if (!secretKey) return { requested: false, provider: 'flutterwave', error: 'FLUTTERWAVE_SECRET_KEY is not configured' };
  if (!txId) return { requested: false, provider: 'flutterwave', error: 'Flutterwave transaction id is missing' };
  const payload = {};
  if (amount) payload.amount = Number(amount);
  if (clean(reason)) payload.comments = clean(reason).slice(0, 180);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(process.env.FLUTTERWAVE_TIMEOUT_MS || 12000)));
  try {
    const response = await fetch(`${flutterwaveApiBase()}/transactions/${encodeURIComponent(txId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { requested: false, provider: 'flutterwave', error: body?.message || `Flutterwave refund failed with HTTP ${response.status}`, response: body };
    }
    return { requested: true, provider: 'flutterwave', response: body };
  } catch (error) {
    return { requested: false, provider: 'flutterwave', error: error.name === 'AbortError' ? 'Flutterwave refund timed out' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function providerOrderIdFromWebhookPayload(value) {
  const parsed = value && typeof value === 'object' ? value : (() => {
    try { return JSON.parse(String(value || '{}')); } catch (_error) { return {}; }
  })();
  return firstClean(
    parsed.provider_order_id,
    parsed.payload?.data?.id,
    parsed.payload?.data?.transaction_id,
    parsed.payload?.data?.flw_ref
  );
}

async function requestAdvertisingCampaignRefund(db, {
  campaignId,
  reason = '',
  adminUserId = null,
  req = null
} = {}) {
  if (!campaignId) return { requested: false, reason: 'campaign_id_missing' };
  const result = await db.query(
    `SELECT pl.*, i.amount AS invoice_amount, i.currency AS invoice_currency, i.id AS invoice_id
     FROM payment_links pl
     LEFT JOIN invoices i ON i.id = pl.invoice_id
     WHERE pl.related_campaign_id = $1
     ORDER BY pl.created_at DESC
     LIMIT 1`,
    [campaignId]
  );
  const link = result.rows[0] || null;
  if (!link) return { requested: false, reason: 'payment_link_missing' };
  const provider = normalizeProvider(link.provider);
  let refund = { requested: false, provider, error: 'unsupported_provider' };
  if (provider === 'flutterwave') {
    refund = await requestFlutterwaveRefund({
      transactionId: providerOrderIdFromWebhookPayload(link.webhook_payload),
      amount: Number(link.invoice_amount || link.amount || 0) || null,
      reason
    });
  }
  const refundStatus = refund.requested ? 'refunded' : 'refund_pending';
  await db.query(
    `UPDATE payment_links
     SET status = $2,
         webhook_payload = COALESCE(webhook_payload, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [link.id, refundStatus, JSON.stringify({ refund })]
  ).catch(() => {});
  await db.query(
    `UPDATE invoices
     SET status = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [link.invoice_id, refund.requested ? 'refunded' : 'refund_pending']
  ).catch(() => {});
  await db.query(
    `UPDATE advertising_campaigns
     SET payment_status = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [campaignId, refundStatus]
  ).catch(() => {});
  await writeAdminAudit(db, {
    adminUserId,
    action: refund.requested ? 'advertising_refund_requested' : 'advertising_refund_pending',
    targetType: 'advertising_campaign',
    targetId: campaignId,
    metadata: { reason: clean(reason), refund },
    req
  }).catch(() => {});
  return refund;
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(clean(a));
  const right = Buffer.from(clean(b));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyFlutterwaveWebhookSignature({ signature = '', rawBody = '', payload = {} } = {}) {
  const header = clean(signature);
  const secretHash = flutterwaveSecretHash();
  const webhookSecret = flutterwaveWebhookSecret();
  if (!secretHash && !webhookSecret) {
    return { required: false, verified: false };
  }
  if (!header) {
    const error = new Error('Flutterwave webhook signature is required');
    error.status = 401;
    throw error;
  }
  if (secretHash && timingSafeEqualText(header, secretHash)) {
    return { required: true, verified: true, mode: 'secret_hash' };
  }
  if (webhookSecret) {
    const body = rawBody || safeJson(payload);
    const hex = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const base64 = crypto.createHmac('sha256', webhookSecret).update(body).digest('base64');
    if (timingSafeEqualText(header, hex) || timingSafeEqualText(header, base64)) {
      return { required: true, verified: true, mode: 'hmac_sha256' };
    }
  }
  const error = new Error('Flutterwave webhook signature is invalid');
  error.status = 401;
  throw error;
}

function extractPaymentWebhookReference(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const resource = payload.resource && typeof payload.resource === 'object' ? payload.resource : {};
  const purchaseUnit = Array.isArray(resource.purchase_units) ? resource.purchase_units[0] || {} : {};
  const related = Array.isArray(resource.supplementary_data?.related_ids)
    ? resource.supplementary_data.related_ids[0] || {}
    : {};
  return {
    reference: firstClean(
      data.tx_ref,
      payload.tx_ref,
      payload.providerReference,
      payload.provider_reference,
      payload.reference,
      payload.invoice_number,
      payload.invoiceNumber,
      resource.invoice_id,
      resource.invoice_number,
      resource.custom_id,
      resource.custom,
      purchaseUnit.invoice_id,
      purchaseUnit.custom_id,
      purchaseUnit.reference_id,
      related.order_id
    ),
    invoiceId: firstClean(meta.invoice_id, payload.invoiceId, payload.invoice_id),
    statusValue: firstClean(
      data.status,
      payload.status,
      payload.payment_status,
      payload.event,
      payload.event_type,
      resource.status,
      resource.state
    ),
    providerOrderId: firstClean(data.id, data.transaction_id, data.flw_ref, resource.id, payload.orderID, payload.order_id, related.order_id),
    amount: Number(data.amount || payload.amount || 0) || null,
    currency: firstClean(data.currency, payload.currency)
  };
}

async function updateCampaignPayment(db, campaignId, status, reference = null) {
  if (!campaignId) return null;
  const campaignStatus = status === 'paid' ? 'paid_pending_approval' : status === 'failed' ? 'awaiting_payment' : null;
  const paymentStatus = status === 'paid' ? 'paid' : status === 'failed' ? 'unpaid' : status;
  const result = await db.query(
    `UPDATE advertising_campaigns
     SET payment_status = $2,
         status = COALESCE($3, status),
         paid_amount_ugx = CASE
           WHEN $2 = 'paid' THEN GREATEST(COALESCE(paid_amount_ugx, 0), COALESCE(quoted_amount_ugx, 0))
           ELSE paid_amount_ugx
         END,
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
  rawBody = '',
  req = null
} = {}) {
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const normalizedProvider = normalizeProvider(provider);
  const signatureVerification = normalizedProvider === 'flutterwave'
    ? verifyFlutterwaveWebhookSignature({ signature, rawBody, payload: safePayload })
    : { required: false, verified: false };
  const extracted = extractPaymentWebhookReference(safePayload);
  const reference = extracted.reference;
  const invoiceId = extracted.invoiceId;
  let status = normalizePaymentStatus(extracted.statusValue);
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
  const expectedAmount = Number(invoice.amount || 0) || 0;
  const expectedCurrency = clean(invoice.currency || '').toUpperCase();
  const amountVerified = status !== 'paid'
    || !extracted.amount
    || !expectedAmount
    || Number(extracted.amount) + 0.5 >= expectedAmount;
  const currencyVerified = status !== 'paid'
    || !extracted.currency
    || !expectedCurrency
    || clean(extracted.currency).toUpperCase() === expectedCurrency;
  if (status === 'paid' && (!amountVerified || !currencyVerified)) {
    status = 'pending';
  }
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
    [invoice.id, invoiceStatus, normalizedProvider || 'manual', reference || null]
  );
  await db.query(
    `UPDATE payment_links
     SET status = $2,
         provider_reference = COALESCE($3, provider_reference),
         webhook_payload = $4::jsonb,
         paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
         updated_at = NOW()
     WHERE invoice_id = $1`,
    [invoice.id, status, reference || extracted.providerOrderId || null, JSON.stringify({
      provider: normalizedProvider,
      signature_present: Boolean(signature),
      signature_verified: Boolean(signatureVerification.verified),
      signature_mode: signatureVerification.mode || null,
      provider_order_id: extracted.providerOrderId || null,
      amount_verified: amountVerified,
      currency_verified: currencyVerified,
      payload: safePayload
    })]
  ).catch(() => {});
  if (invoice.campaign_id) {
    const updatedCampaign = await updateCampaignPayment(db, invoice.campaign_id, status, reference || invoice.invoice_number);
    if (status === 'paid' && updatedCampaign) {
      await sendAdvertisingLifecycleNotification(db, {
        trigger: 'payment_confirmed',
        campaign: updatedCampaign,
        context: {
          amount: extracted.amount || updatedCampaign.paid_amount_ugx || invoice.amount,
          currency: extracted.currency || invoice.currency,
          method: normalizedProvider === 'flutterwave' ? 'Flutterwave hosted checkout' : normalizedProvider,
          reference: reference || invoice.invoice_number,
          paidAt: new Date().toISOString()
        }
      }).catch(() => {});
    }
  }
  await writeAdminAudit(db, {
    action: 'payment_webhook_processed',
    targetType: 'invoice',
    targetId: invoice.id,
    metadata: {
      provider: normalizedProvider,
      status,
      reference: reference || null,
      configured: paymentProviderConfigured(normalizedProvider),
      signature_verified: Boolean(signatureVerification.verified),
      amount_verified: amountVerified,
      currency_verified: currencyVerified
    },
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
  createHostedPaymentLink,
  getPaymentStatus,
  handlePaymentWebhook,
  markInvoicePaidManually,
  normalizePaymentStatus,
  normalizeProvider,
  paymentProviderConfigured,
  requestAdvertisingCampaignRefund
};
