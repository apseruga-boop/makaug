'use strict';

const BASE_URLS = Object.freeze({
  sandbox: 'https://cybqa.pesapal.com/pesapalv3/api/',
  live: 'https://pay.pesapal.com/v3/api/'
});
const REDIRECT_HOSTS = Object.freeze({ sandbox: 'cybqa.pesapal.com', live: 'pay.pesapal.com' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^[A-Za-z0-9_.:-]{1,50}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

class PesapalError extends Error {
  constructor(code, { outcome = 'unavailable', retryable = false, httpStatus } = {}) {
    super(`Pesapal request failed (${code}).`);
    this.name = 'PesapalError';
    this.code = code;
    this.outcome = outcome;
    this.retryable = retryable;
    if (httpStatus) this.httpStatus = httpStatus;
  }
}

function invalid(code = 'invalid_request') {
  return new PesapalError(code, { outcome: 'rejected' });
}

/** UGX is integral. Never round provider money or coerce missing/unsafe values. */
function parseWholeUgx(value) {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value;
    throw invalid('invalid_amount');
  }
  if (typeof value === 'bigint') {
    if (value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    throw invalid('invalid_amount');
  }
  if (typeof value !== 'string' || !/^[0-9]+(?:\.0+)?$/.test(value) || value.length > 64) {
    throw invalid('invalid_amount');
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid('invalid_amount');
  return amount;
}

function readiness(env = process.env) {
  const enabled = env.PESAPAL_ENABLED === 'true';
  const environment = Object.hasOwn(BASE_URLS, env.PESAPAL_ENV) ? env.PESAPAL_ENV : null;
  const countryCode = String(env.COUNTRY_CODE || 'UG').trim().toUpperCase();
  const merchantApproved = env.PESAPAL_MERCHANT_APPROVED === 'true';
  const credentialsConfigured = Boolean(String(env.PESAPAL_CONSUMER_KEY || '').trim() && String(env.PESAPAL_CONSUMER_SECRET || '').trim());
  const notificationConfigured = UUID.test(env.PESAPAL_IPN_ID || '');
  const production = env.NODE_ENV === 'production';
  const merchantProfile = String(env.PESAPAL_MERCHANT_PROFILE || 'makaug_uganda').trim();
  let publicOrigin = null;
  try {
    const origin = new URL(env.PUBLIC_BASE_URL || env.HOME_URL || env.SITE_URL);
    if (origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/') publicOrigin = origin.origin;
  } catch { /* Invalid public configuration is reported as a readiness reason. */ }
  const reasons = [];
  if (!enabled) reasons.push('disabled');
  if (!environment) reasons.push('environment_not_selected');
  if (countryCode !== 'UG') reasons.push('wrong_tenant');
  if (!credentialsConfigured) reasons.push('credentials_missing');
  if (!notificationConfigured) reasons.push('notification_missing');
  if (!publicOrigin) reasons.push('public_origin_missing');
  if (!merchantProfile || merchantProfile.length > 64 || /[\u0000-\u001f\u007f]/.test(merchantProfile)) reasons.push('merchant_profile_invalid');
  if (production && environment === 'sandbox') reasons.push('sandbox_in_production');
  if (environment === 'live' && !merchantApproved) reasons.push('merchant_not_approved');
  return { enabled, environment, countryCode, merchantApproved, credentialsConfigured, notificationConfigured, publicOrigin, production, merchantProfile, ready: reasons.length === 0, reasons };
}

function text(value, { max = 100, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalid();
  return value.trim();
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid('invalid_tracking_id');
  return value.toLowerCase();
}

function reference(value) {
  if (typeof value !== 'string' || !REFERENCE.test(value)) throw invalid('invalid_reference');
  return value;
}

function publicUrl(value, testMode) {
  let url;
  try { url = new URL(value); } catch { throw invalid('invalid_url'); }
  if (url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && !(testMode && url.protocol === 'http:' && LOOPBACK.has(url.hostname)))) throw invalid('invalid_url');
  return url.href;
}

function hasProviderError(error) {
  if (error == null || error === '') return false;
  if (typeof error === 'object') return Object.values(error).some(value => value !== null && value !== undefined && value !== '');
  return true;
}

function success(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    (body.status === '200' || body.status === 200) && !hasProviderError(body.error);
}

function rejectedStatus(status) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function providerFailure(body, mutation) {
  const status = Number(body && body.status);
  return new PesapalError('provider_rejected', {
    outcome: mutation && !rejectedStatus(status) ? 'unknown' : 'rejected',
    retryable: !mutation && (!Number.isFinite(status) || status >= 500 || status === 429)
  });
}

// JSON.parse rounds numeric tokens. Retain the exact top-level money token so a
// fractional or unsafe provider amount cannot round into an accepted whole UGX.
function parseJson(raw) {
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  let index = raw.indexOf('{') + 1;
  const seen = new Set();
  const whitespace = () => { while (/\s/.test(raw[index] || '') && index < raw.length) index++; };
  while (index < raw.length) {
    whitespace();
    if (raw[index] === '}') break;
    const keyStart = index++;
    while (index < raw.length) {
      if (raw[index] === '\\') { index += 2; continue; }
      if (raw[index++] === '"') break;
    }
    const key = JSON.parse(raw.slice(keyStart, index));
    if (seen.has(key)) throw new PesapalError('invalid_response');
    seen.add(key);
    whitespace();
    index++; // JSON.parse already checked the colon and complete syntax.
    whitespace();
    const valueStart = index;
    let depth = 0;
    let inString = false;
    while (index < raw.length) {
      const character = raw[index];
      if (inString) {
        if (character === '\\') { index += 2; continue; }
        if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === '{' || character === '[') depth++;
      else if (character === '}' || character === ']') {
        if (depth === 0) break;
        depth--;
      } else if (character === ',' && depth === 0) break;
      index++;
    }
    if (key === 'amount' && typeof body.amount === 'number') body.amount = raw.slice(valueStart, index).trim();
    if (raw[index] === '}') break;
    index++;
  }
  return body;
}

async function boundedBody(response) {
  const limit = 64 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
    throw new PesapalError('response_too_large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = await response.text();
    if (Buffer.byteLength(body) > limit) throw new PesapalError('response_too_large');
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PesapalError('response_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

/** Explicit constructor. A loopback provider override is accepted only in tests. */
function createPesapalClient({ environment, consumerKey, consumerSecret, notificationId = null,
  merchantProfile = 'makaug_uganda', fetch: fetchImpl = global.fetch, now = Date.now, timeoutMs = 10000, testBaseUrl } = {}) {
  if (!Object.hasOwn(BASE_URLS, environment)) throw invalid('environment_not_selected');
  if (typeof consumerKey !== 'string' || !consumerKey.trim() || typeof consumerSecret !== 'string' || !consumerSecret.trim()) throw invalid('credentials_missing');
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw invalid('invalid_configuration');
  if (notificationId !== null) notificationId = uuid(notificationId);
  merchantProfile = text(merchantProfile, { max: 64 });
  const testMode = process.env.NODE_ENV === 'test';
  let baseUrl = BASE_URLS[environment];
  if (testBaseUrl !== undefined) {
    let candidate;
    try { candidate = new URL(testBaseUrl); } catch { throw invalid('invalid_test_url'); }
    if (!testMode || candidate.protocol !== 'http:' || !LOOPBACK.has(candidate.hostname) || candidate.username || candidate.password || candidate.search || candidate.hash) throw invalid('invalid_test_url');
    baseUrl = candidate.href.endsWith('/') ? candidate.href : `${candidate.href}/`;
  }

  let cachedToken = null;
  let tokenPromise = null;

  async function request(path, { method = 'GET', payload, token, mutation = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, baseUrl).href, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
      });
      if (!response.ok) {
        if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
        throw new PesapalError('http_error', {
          outcome: mutation && !rejectedStatus(response.status) ? 'unknown' : 'rejected',
          retryable: !mutation && (response.status >= 500 || [408, 425, 429].includes(response.status)),
          httpStatus: response.status
        });
      }
      if (!/application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('content-type') || '')) throw new PesapalError('invalid_response');
      let body;
      try { body = parseJson(await boundedBody(response)); } catch (error) {
        if (error instanceof PesapalError) throw error;
        throw new PesapalError('invalid_response');
      }
      return body;
    } catch (error) {
      if (error instanceof PesapalError) {
        if (mutation && error.outcome === 'unavailable') error.outcome = 'unknown';
        throw error;
      }
      throw new PesapalError(controller.signal.aborted ? 'timeout' : 'transport_error', {
        outcome: mutation ? 'unknown' : 'unavailable', retryable: !mutation
      });
    } finally { clearTimeout(timer); }
  }

  async function getToken() {
    if (cachedToken && cachedToken.expiresAt > now() + 30000) return cachedToken.token;
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const body = await request('Auth/RequestToken', { method: 'POST', payload: { consumer_key: consumerKey, consumer_secret: consumerSecret } });
        if (!success(body)) throw providerFailure(body, false);
        const token = text(body.token, { max: 16000 });
        const expiry = typeof body.expiryDate === 'string' ? body.expiryDate : '';
        const expiresAt = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(expiry) ? expiry : `${expiry}Z`);
        if (!Number.isFinite(expiresAt) || expiresAt <= now() + 30000) throw new PesapalError('invalid_token_response');
        cachedToken = { token, expiresAt: Math.min(expiresAt, now() + 5 * 60 * 1000) };
        return token;
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  async function authenticated(path, options = {}) {
    let token;
    try { token = await getToken(); } catch (error) {
      // No mutation request has been transmitted. The same token promise may
      // serve readers too, so wrap its error rather than changing shared state.
      if (options.mutation) {
        throw new PesapalError(error instanceof PesapalError ? error.code : 'authentication_unavailable', {
          outcome: 'unavailable', retryable: error?.retryable === true, httpStatus: error?.httpStatus
        });
      }
      throw error;
    }
    try {
      const body = await request(path, { ...options, token });
      if (!options.mutation && body && !Array.isArray(body) && Number(body.status) === 401) {
        throw new PesapalError('authentication_expired', { outcome: 'rejected', httpStatus: 401 });
      }
      return body;
    } catch (error) {
      if (!options.mutation && error instanceof PesapalError && error.httpStatus === 401) {
        if (cachedToken && cachedToken.token === token) cachedToken = null;
        return request(path, { ...options, token: await getToken() });
      }
      throw error;
    }
  }

  function parseResponse(parse, mutation) {
    try { return parse(); } catch (error) {
      if (error instanceof PesapalError && ['provider_rejected', 'notification_method_unverified'].includes(error.code)) throw error;
      throw new PesapalError('invalid_provider_response', { outcome: mutation ? 'unknown' : 'unavailable' });
    }
  }

  function checkoutUrl(value) {
    const url = new URL(value);
    const fakeOrigin = testBaseUrl === undefined ? null : new URL(baseUrl).origin;
    const official = url.protocol === 'https:' && url.hostname === REDIRECT_HOSTS[environment] && (!url.port || url.port === '443');
    if (url.username || url.password || url.hash || (!official && (!fakeOrigin || url.origin !== fakeOrigin))) throw invalid('invalid_redirect');
    return url.href;
  }

  return Object.freeze({
    environment, merchantProfile, notificationId,
    async submit({ reference: orderReference, amountUgx, description, callbackUrl, notificationId: orderNotificationId = notificationId, customer } = {}) {
      orderReference = reference(orderReference);
      const amount = parseWholeUgx(amountUgx);
      const phone = text(customer && customer.phone, { max: 32, optional: true });
      const email = text(customer && customer.email, { max: 254, optional: true });
      if ((!phone && !email) || (phone && !/^\+?[0-9]{7,15}$/.test(phone)) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw invalid('invalid_customer');
      const payload = {
        id: orderReference, currency: 'UGX', amount,
        description: text(description), callback_url: publicUrl(callbackUrl, testMode),
        notification_id: uuid(orderNotificationId),
        billing_address: {
          ...(phone ? { phone_number: phone } : {}), ...(email ? { email_address: email } : {}), country_code: 'UG',
          ...(customer.firstName ? { first_name: text(customer.firstName, { max: 80 }) } : {}),
          ...(customer.lastName ? { last_name: text(customer.lastName, { max: 80 }) } : {})
        }
      };
      const body = await authenticated('Transactions/SubmitOrderRequest', { method: 'POST', payload, mutation: true });
      return parseResponse(() => {
        if (!success(body)) throw providerFailure(body, true);
        const returnedReference = reference(body.merchant_reference);
        if (returnedReference !== orderReference) throw invalid('reference_mismatch');
        return { trackingId: uuid(body.order_tracking_id), reference: returnedReference, checkoutUrl: checkoutUrl(body.redirect_url) };
      }, true);
    },
    async status(trackingId) {
      trackingId = uuid(trackingId);
      const body = await authenticated(`Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`);
      return parseResponse(() => {
        if (!success(body)) throw providerFailure(body, false);
        if (![0, 1, 2, 3].includes(body.status_code)) throw invalid();
        const currency = text(body.currency, { max: 3 }).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw invalid();
        let paidAt = null;
        if (body.created_date) {
          const date = text(body.created_date, { max: 40 });
          if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)?$/.test(date)) throw invalid();
          const timestamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(date) ? date : `${date}Z`);
          if (!Number.isFinite(timestamp)) throw invalid();
          paidAt = new Date(timestamp).toISOString();
        }
        return {
          requestedTrackingId: trackingId, reference: reference(body.merchant_reference), amountUgx: parseWholeUgx(body.amount),
          currency, statusCode: body.status_code, method: text(body.payment_method, { max: 60, optional: true }),
          confirmationCode: text(body.confirmation_code, { max: 100, optional: true }), paidAt
        };
      }, false);
    },
    async ensureNotification({ url } = {}) {
      url = publicUrl(url, testMode);
      const registrations = await authenticated('URLSetup/GetIpnList');
      if (!Array.isArray(registrations)) throw new PesapalError('invalid_provider_response');
      const matching = registrations.filter(item => item && item.url === url);
      if (matching.length) {
        return parseResponse(() => {
          const item = matching.find(value => value.ipn_status === 1 && value.ipn_notification_type_description === 'POST');
          if (!item) throw new PesapalError('notification_method_unverified');
          if (!success(item)) throw providerFailure(item, false);
          return { notificationId: uuid(item.ipn_id), url, method: 'POST', active: true, created: false };
        }, false);
      }
      const body = await authenticated('URLSetup/RegisterIPN', { method: 'POST', payload: { url, ipn_notification_type: 'POST' }, mutation: true });
      return parseResponse(() => {
        if (!success(body)) throw providerFailure(body, true);
        if (body.url !== url || body.ipn_status !== 1 || body.ipn_notification_type_description !== 'POST') throw invalid();
        return { notificationId: uuid(body.ipn_id), url, method: 'POST', active: true, created: true };
      }, true);
    }
  });
}

/** Disabled new checkout still permits reconciliation with existing credentials. */
function fromEnvironment(env = process.env, options = {}) {
  if (String(env.COUNTRY_CODE || 'UG').trim().toUpperCase() !== 'UG') throw invalid('wrong_tenant');
  return createPesapalClient({
    ...options, environment: env.PESAPAL_ENV,
    consumerKey: env.PESAPAL_CONSUMER_KEY, consumerSecret: env.PESAPAL_CONSUMER_SECRET,
    notificationId: env.PESAPAL_IPN_ID || null, merchantProfile: env.PESAPAL_MERCHANT_PROFILE || 'makaug_uganda'
  });
}

module.exports = { createPesapalClient, fromEnvironment, readiness, parseWholeUgx, PesapalError };
