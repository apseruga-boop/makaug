'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const attributionStorage = new AsyncLocalStorage();

const TEXT_LIMITS = Object.freeze({
  utm_source: 120,
  utm_medium: 120,
  utm_campaign: 240,
  utm_content: 240,
  utm_term: 240,
  oppref: 512,
  oppref_source_param: 32,
  landing_page: 1024
});

const CAMPAIGN_FIELDS = Object.freeze([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'landing_page'
]);

const ADVERTISING_FIELDS = Object.freeze([
  'oppref',
  'oppref_source_param'
]);

function cleanAttributionText(value, maxLength) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function normalizeLeadAttribution(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const normalized = {};
  for (const [key, maxLength] of Object.entries(TEXT_LIMITS)) {
    const cleaned = cleanAttributionText(value[key], maxLength);
    if (cleaned) normalized[key] = cleaned;
  }

  const consent = value.measurement_consent;
  if (consent && typeof consent === 'object' && !Array.isArray(consent)) {
    const analytics = booleanOrNull(consent.analytics);
    const advertising = booleanOrNull(consent.advertising);
    normalized.measurement_consent = {
      ...(analytics == null ? {} : { analytics }),
      ...(advertising == null ? {} : { advertising }),
      version: cleanAttributionText(consent.version || '1', 16) || '1'
    };
  }

  if (!Object.keys(normalized).length) return null;
  return normalized;
}

function enforceLeadAttributionConsent(value) {
  const normalized = normalizeLeadAttribution(value);
  if (!normalized) return null;

  const consent = normalized.measurement_consent;
  const analyticsAllowed = consent?.analytics === true;
  const advertisingAllowed = consent?.advertising === true;
  const permitted = {};

  if (consent) permitted.measurement_consent = consent;
  if (analyticsAllowed || advertisingAllowed) {
    for (const key of CAMPAIGN_FIELDS) {
      if (normalized[key]) permitted[key] = normalized[key];
    }
  }
  if (advertisingAllowed) {
    for (const key of ADVERTISING_FIELDS) {
      if (normalized[key]) permitted[key] = normalized[key];
    }
  }

  return Object.keys(permitted).length ? permitted : null;
}

function attributionFromHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || String(raw).length > 12_000) return null;
  try {
    return JSON.parse(decodeURIComponent(String(raw)));
  } catch (_error) {
    return null;
  }
}

function leadAttributionContext(req, _res, next) {
  const candidate = attributionFromHeader(req.headers?.['x-makaug-lead-attribution'])
    || req.body?._lead_attribution
    || req.body?.lead_attribution
    || null;
  const leadAttribution = enforceLeadAttributionConsent(candidate);
  return attributionStorage.run({ leadAttribution }, next);
}

function currentLeadAttribution() {
  return attributionStorage.getStore()?.leadAttribution || null;
}

module.exports = {
  currentLeadAttribution,
  enforceLeadAttributionConsent,
  leadAttributionContext,
  normalizeLeadAttribution
};
