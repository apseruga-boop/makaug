'use strict';

/**
 * Revolut Merchant API (WHISPERS GLOBAL LTD's Revolut Business account).
 *
 * Only the secret key lives in the environment (REVOLUT_MERCHANT_SECRET_KEY).
 * Every payment is confirmed by asking Revolut for the order itself, so a
 * webhook can wake us up but can never mark anything paid on its own word.
 */

const crypto = require('crypto');

function secretKey(env = process.env) {
  return String(env.REVOLUT_MERCHANT_SECRET_KEY || env.REVOLUT_SECRET_KEY || '').trim();
}

function isConfigured(env = process.env) {
  return Boolean(secretKey(env));
}

function baseUrl(env = process.env) {
  if (env.REVOLUT_MERCHANT_BASE_URL) return String(env.REVOLUT_MERCHANT_BASE_URL).replace(/\/+$/, '');
  const sandbox = String(env.REVOLUT_MERCHANT_ENV || '').toLowerCase() === 'sandbox'
    || secretKey(env).startsWith('sk_sandbox');
  return sandbox ? 'https://sandbox-merchant.revolut.com' : 'https://merchant.revolut.com';
}

function apiVersion(env = process.env) {
  return String(env.REVOLUT_API_VERSION || '2024-09-01').trim();
}

function providerError(message, status = 502, details = null) {
  return Object.assign(new Error(message), { status, code: 'revolut_error', details });
}

async function call(path, { method = 'GET', body, versioned = true, env = process.env, fetchImpl = fetch } = {}) {
  const key = secretKey(env);
  if (!key) throw Object.assign(new Error('Card payments are not switched on yet (Revolut key missing).'), { status: 503, code: 'revolut_not_configured' });
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (versioned) headers['Revolut-Api-Version'] = apiVersion(env);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetchImpl(`${baseUrl(env)}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    throw providerError(`Revolut said ${response.status}: ${data.message || data.error || data.raw || 'request failed'}`, response.status >= 500 ? 502 : 400, data);
  }
  return data;
}

/** Create a hosted-checkout order. amountMinor is in cents. */
async function createOrder({ amountMinor, currency, description, reference, redirectUrl, customerEmail, customerPhone, customerName }, opts = {}) {
  const body = {
    amount: Math.round(Number(amountMinor)),
    currency: String(currency || 'USD').toUpperCase(),
    description: String(description || 'makaug.com payment').slice(0, 1024),
    merchant_order_data: { reference: String(reference || '').slice(0, 100) },
    redirect_url: redirectUrl
  };
  const customer = {};
  if (customerEmail) customer.email = customerEmail;
  if (customerPhone) customer.phone = `+${String(customerPhone).replace(/\D+/g, '')}`;
  if (customerName) customer.full_name = String(customerName).slice(0, 120);
  if (Object.keys(customer).length) body.customer = customer;
  const order = await call('/api/orders', { method: 'POST', body, ...opts });
  if (!order.id || !order.checkout_url) throw providerError('Revolut did not return a checkout link', 502, order);
  return order;
}

async function getOrder(orderId, opts = {}) {
  return call(`/api/orders/${encodeURIComponent(orderId)}`, opts);
}

/** "completed" is money taken; "authorised" means it will be captured automatically. */
function orderIsPaid(order = {}) {
  return String(order.state || '').toLowerCase() === 'completed';
}

async function listWebhooks(opts = {}) {
  return call('/api/1.0/webhooks', { versioned: false, ...opts });
}

async function createWebhook(url, events = ['ORDER_COMPLETED', 'ORDER_AUTHORISED', 'ORDER_CANCELLED', 'ORDER_FAILED'], opts = {}) {
  return call('/api/1.0/webhooks', { method: 'POST', body: { url, events }, versioned: false, ...opts });
}

async function getWebhook(id, opts = {}) {
  return call(`/api/1.0/webhooks/${encodeURIComponent(id)}`, { versioned: false, ...opts });
}

/** Revolut-Signature: v1=<hex>[,v1=<hex>] over "v1.<timestamp>.<raw body>". */
function verifySignature({ rawBody, signatureHeader, timestampHeader, secret, now = Date.now(), toleranceMs = 5 * 60_000 }) {
  if (!secret || !rawBody || !signatureHeader || !timestampHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceMs) return false;
  const expected = `v1=${crypto.createHmac('sha256', secret).update(`v1.${timestampHeader}.${rawBody}`).digest('hex')}`;
  return String(signatureHeader).split(',').map((s) => s.trim()).some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

module.exports = {
  isConfigured,
  baseUrl,
  createOrder,
  getOrder,
  orderIsPaid,
  listWebhooks,
  createWebhook,
  getWebhook,
  verifySignature
};
