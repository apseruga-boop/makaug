'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

const { writeAdminAudit, mirrorLegacyAudit } = require('./adminSecurityService');

const MONETIZATION_SPINE_MARKER = 'monetization-spine-v1-20260715';
const paymentEvents = new EventEmitter();

function clean(value) {
  return String(value || '').trim();
}

function paymentProviderConfigured() {
  return Boolean(
    process.env.FLUTTERWAVE_SECRET_KEY
    || process.env.PAYMENT_LINK_BASE_URL
    || process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET
    || process.env.PAYMENT_PROVIDER_API_KEY
  );
}

function normalizeCurrency(value = 'UGX') {
  return clean(value || 'UGX').toUpperCase().slice(0, 8) || 'UGX';
}

function normalizePurpose(value = 'payment') {
  return clean(value || 'payment').toLowerCase().replace(/[^a-z0-9_:-]/g, '_').slice(0, 80) || 'payment';
}

function normalizeAmount(value) {
  const amount = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function providerName(value = process.env.UGANDA_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'flutterwave') {
  return clean(value || 'flutterwave').toLowerCase();
}

function buildCheckoutReference(purpose = 'payment') {
  const prefix = normalizePurpose(purpose).replace(/_/g, '-').slice(0, 24).toUpperCase() || 'PAYMENT';
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `MK-${prefix}-${stamp}-${random}`;
}

function publicBaseUrl() {
  return clean(process.env.PUBLIC_BASE_URL || process.env.HOME_URL || process.env.SITE_URL || 'https://makaug.com').replace(/\/$/, '');
}

function payerPayload(payer = {}) {
  return {
    id: payer.id || payer.user_id || payer.payer_id || null,
    name: clean(payer.name || payer.full_name || [payer.first_name, payer.last_name].filter(Boolean).join(' ')) || null,
    email: clean(payer.email).toLowerCase() || null,
    phone: clean(payer.phone || payer.whatsapp || payer.msisdn) || null
  };
}

function buildFlutterwavePaymentPayload({
  reference,
  amount,
  currency,
  payer,
  purpose,
  metadata = {},
  redirectUrl = ''
} = {}) {
  const safePayer = payerPayload(payer);
  return {
    tx_ref: reference,
    amount,
    currency: normalizeCurrency(currency),
    redirect_url: redirectUrl || `${publicBaseUrl()}/payment-status?ref=${encodeURIComponent(reference)}`,
    customer: {
      email: safePayer.email || 'payments@makaug.com',
      phonenumber: safePayer.phone || '',
      name: safePayer.name || 'makaug customer'
    },
    customizations: {
      title: 'makaug.com',
      description: `${normalizePurpose(purpose).replace(/_/g, ' ')} payment`,
      logo: `${publicBaseUrl()}/assets/makaug-logo.png`
    },
    meta: {
      purpose: normalizePurpose(purpose),
      payment_reference: reference,
      ...metadata
    }
  };
}

async function postFlutterwaveHostedPayment(payload, env = process.env) {
  const secretKey = clean(env.FLUTTERWAVE_SECRET_KEY || env.PAYMENT_PROVIDER_API_KEY);
  if (!secretKey) {
    const error = new Error('Flutterwave secret key is not configured');
    error.status = 503;
    error.code = 'payment_provider_missing';
    throw error;
  }
  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || `Flutterwave payment creation failed (${response.status})`);
    error.status = response.status;
    error.providerResponse = data;
    throw error;
  }
  return data;
}

function hostedCheckoutUrlFromProviderResponse(providerResponse = {}) {
  return providerResponse?.data?.link
    || providerResponse?.data?.checkout_url
    || providerResponse?.link
    || providerResponse?.checkout_url
    || null;
}

async function createHostedPayment(db, {
  purpose,
  amount,
  currency = 'UGX',
  payer = {},
  metadata = {},
  redirectUrl = '',
  gateway = null
} = {}, options = {}) {
  if (!db) {
    const error = new Error('db is required');
    error.status = 500;
    throw error;
  }
  const normalizedPurpose = normalizePurpose(purpose);
  const normalizedAmount = normalizeAmount(amount);
  if (!normalizedPurpose) {
    const error = new Error('purpose is required');
    error.status = 400;
    throw error;
  }
  if (!normalizedAmount) {
    const error = new Error('amount must be greater than zero');
    error.status = 400;
    throw error;
  }
  const normalizedGateway = providerName(gateway);
  const reference = buildCheckoutReference(normalizedPurpose);
  const safePayer = payerPayload(payer);
  const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

  const inserted = await db.query(
    `INSERT INTO payments (
       purpose, gateway, checkout_reference, amount, currency,
       payer_id, payer_name, payer_email, payer_phone, status, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10::jsonb)
     RETURNING *`,
    [
      normalizedPurpose,
      normalizedGateway,
      reference,
      normalizedAmount,
      normalizeCurrency(currency),
      safePayer.id,
      safePayer.name,
      safePayer.email,
      safePayer.phone,
      JSON.stringify(safeMetadata)
    ]
  );

  const payment = inserted.rows[0];
  const requestPayload = buildFlutterwavePaymentPayload({
    reference,
    amount: normalizedAmount,
    currency,
    payer: safePayer,
    purpose: normalizedPurpose,
    metadata: safeMetadata,
    redirectUrl
  });

  try {
    const client = options.providerClient || postFlutterwaveHostedPayment;
    const providerResponse = await client(requestPayload, options.env || process.env);
    const checkoutUrl = hostedCheckoutUrlFromProviderResponse(providerResponse);
    const updated = await db.query(
      `UPDATE payments
       SET checkout_url = $2,
           status = $3,
           raw_response = $4::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        payment.id,
        checkoutUrl,
        checkoutUrl ? 'created' : 'pending',
        JSON.stringify({ request: requestPayload, response: providerResponse })
      ]
    );
    return {
      ok: true,
      provider: normalizedGateway,
      providerConfigured: true,
      payment: updated.rows[0],
      checkoutUrl
    };
  } catch (error) {
    await db.query(
      `UPDATE payments
       SET status = $2,
           raw_response = COALESCE(raw_response, '{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        payment.id,
        error.code === 'payment_provider_missing' ? 'provider_missing' : 'failed',
        JSON.stringify({ request: requestPayload, error: error.message, provider_status: error.status || null })
      ]
    ).catch(() => {});
    if (options.allowProviderMissing && error.code === 'payment_provider_missing') {
      return {
        ok: false,
        provider: normalizedGateway,
        providerConfigured: false,
        payment: { ...payment, status: 'provider_missing' },
        checkoutUrl: null,
        error: error.message
      };
    }
    throw error;
  }
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

function normalizeGenericPaymentWebhookPayload(payload = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const reference = clean(data.tx_ref || data.txRef || data.reference || data.checkout_reference || payload.tx_ref || payload.reference);
  const gatewayTxnId = clean(data.id || data.transaction_id || data.flw_ref || data.gateway_txn_id || payload.id || payload.transaction_id);
  const rawStatus = data.status || data.payment_status || payload.status || payload.event;
  const status = normalizePaymentStatus(rawStatus);
  return { data, reference, gatewayTxnId, status };
}

function verifyGenericPaymentWebhook({ provider = 'flutterwave', signature = '', env = process.env } = {}) {
  const normalizedProvider = providerName(provider);
  if (!normalizedProvider.includes('flutterwave')) return true;
  const secret = clean(env.FLUTTERWAVE_WEBHOOK_SECRET || env.PAYMENT_PROVIDER_WEBHOOK_SECRET);
  if (!secret) return true;
  return clean(signature) === secret;
}

async function grantEntitlementForPayment(db, payment = {}) {
  if (!db || !payment?.id || payment.status !== 'paid') return null;
  const metadata = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {};
  const productKey = clean(metadata.product_key || metadata.productKey || (payment.purpose === 'listing_boost' ? 'listing_boost_basic' : ''));
  const accountId = payment.payer_id || metadata.account_id || metadata.accountId || null;
  if (!productKey || !accountId) return null;
  const productResult = await db.query(`SELECT * FROM products WHERE key = $1 LIMIT 1`, [productKey]);
  const product = productResult.rows[0] || null;
  if (!product) return null;
  const durationDays = Number(product.metadata?.duration_days || metadata.duration_days || 0) || 0;
  const expiresAt = durationDays > 0
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const entitlement = await db.query(
    `INSERT INTO account_entitlements (
       account_id, product_key, status, expires_at, quantity, payment_id, metadata
     )
     VALUES ($1,$2,'active',$3,$4,$5,$6::jsonb)
     RETURNING *`,
    [
      accountId,
      productKey,
      expiresAt,
      Number(metadata.quantity || 1) || 1,
      payment.id,
      JSON.stringify({ payment_reference: payment.checkout_reference, payment_purpose: payment.purpose, ...metadata })
    ]
  );
  const listingId = clean(metadata.listing_id || metadata.listingId);
  if (payment.purpose === 'listing_boost' && listingId) {
    await db.query(
      `UPDATE properties
       SET boost_tier = COALESCE(NULLIF($2, ''), boost_tier, 'basic'),
           featured_until = COALESCE($3::timestamptz, featured_until, NOW() + INTERVAL '7 days'),
           updated_at = NOW()
       WHERE id = $1`,
      [listingId, clean(product.metadata?.boost_tier || metadata.boost_tier || 'basic'), expiresAt]
    ).catch(() => {});
  }
  return entitlement.rows[0] || null;
}

async function handleGenericPaymentWebhook(db, {
  provider = process.env.UGANDA_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'flutterwave',
  payload = {},
  signature = '',
  req = null
} = {}) {
  if (!verifyGenericPaymentWebhook({ provider, signature })) {
    const error = new Error('Invalid payment webhook signature');
    error.status = 401;
    throw error;
  }
  const normalized = normalizeGenericPaymentWebhookPayload(payload);
  if (!normalized.reference && !normalized.gatewayTxnId) {
    const error = new Error('Webhook payload is missing payment reference');
    error.status = 400;
    throw error;
  }
  const values = [];
  const clauses = [];
  if (normalized.reference) {
    values.push(normalized.reference);
    clauses.push(`checkout_reference = $${values.length}`);
  }
  if (normalized.gatewayTxnId) {
    values.push(normalized.gatewayTxnId);
    clauses.push(`gateway_txn_id = $${values.length}`);
  }
  const found = await db.query(`SELECT * FROM payments WHERE ${clauses.join(' OR ')} LIMIT 1`, values);
  if (!found.rows.length) {
    const error = new Error('Payment not found for webhook');
    error.status = 404;
    throw error;
  }
  const existing = found.rows[0];
  const nextStatus = normalized.status === 'paid' ? 'paid' : normalized.status === 'failed' ? 'failed' : 'pending';
  const updated = await db.query(
    `UPDATE payments
     SET status = $2,
         gateway_txn_id = COALESCE($3, gateway_txn_id),
         raw_response = COALESCE(raw_response, '{}'::jsonb) || $4::jsonb,
         paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      existing.id,
      nextStatus,
      normalized.gatewayTxnId || null,
      JSON.stringify({ webhook: payload, provider, event_status: normalized.status })
    ]
  );
  const payment = updated.rows[0] || null;
  if (payment?.status === 'paid') {
    await grantEntitlementForPayment(db, payment).catch(() => null);
    const campaignId = payment.metadata?.campaign_id || payment.metadata?.campaignId || null;
    if (campaignId) {
      await updateCampaignPayment(db, campaignId, 'paid', payment.checkout_reference).catch(() => null);
    }
  }
  const eventName = payment?.status === 'paid'
    ? 'payment.succeeded'
    : payment?.status === 'failed'
      ? 'payment.failed'
      : 'payment.pending';
  paymentEvents.emit(eventName, payment);
  await writeAdminAudit(db, {
    action: 'generic_payment_webhook_processed',
    targetType: 'payment',
    targetId: payment?.id || existing.id,
    metadata: { provider, status: payment?.status, event_name: eventName, reference: normalized.reference || null },
    req
  }).catch(() => {});
  return payment;
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
  try {
    return await handleGenericPaymentWebhook(db, { provider, payload, signature, req });
  } catch (error) {
    if (!['42P01', '42703', '404'].includes(String(error.code || error.status || ''))) {
      if (error.status !== 404) throw error;
    }
  }
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
  MONETIZATION_SPINE_MARKER,
  buildCheckoutReference,
  buildFlutterwavePaymentPayload,
  createHostedPayment,
  getPaymentStatus,
  grantEntitlementForPayment,
  handleGenericPaymentWebhook,
  handlePaymentWebhook,
  markInvoicePaidManually,
  normalizePaymentStatus,
  paymentEvents,
  paymentProviderConfigured
};
