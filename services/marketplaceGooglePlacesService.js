'use strict';

const DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places';
const DEFAULT_REFERER = 'https://makaug.com/';
const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'plusCode',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'googleMapsUri',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'currentOpeningHours',
  'businessStatus'
].join(',');

const cache = new Map();
const inFlight = new Map();
let budget = { day: '', requests: 0 };

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cacheTtlMs() {
  return Math.max(30000, Number(process.env.MARKETPLACE_GOOGLE_DETAILS_TTL_MS || 300000));
}

function cacheMax() {
  return Math.max(25, Number(process.env.MARKETPLACE_GOOGLE_DETAILS_CACHE_MAX || 500));
}

function dailyCap() {
  return Math.max(1, Number(process.env.MARKETPLACE_GOOGLE_DETAILS_DAILY_CAP || 250));
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function consumeBudget() {
  const day = utcDay();
  if (budget.day !== day) budget = { day, requests: 0 };
  if (budget.requests >= dailyCap()) {
    const error = new Error('Google Place Details daily request cap reached.');
    error.code = 'MARKETPLACE_GOOGLE_DETAILS_BUDGET';
    error.status = 429;
    throw error;
  }
  budget.requests += 1;
}

function normalizeBusinessStatus(value = '') {
  const status = clean(value).toUpperCase();
  if (status === 'CLOSED_PERMANENTLY') return 'permanently_closed';
  if (status === 'CLOSED_TEMPORARILY') return 'temporarily_closed';
  return 'operational';
}

function normalizeGooglePlaceDetails(payload = {}) {
  const currentHours = payload.currentOpeningHours && typeof payload.currentOpeningHours === 'object'
    ? payload.currentOpeningHours
    : {};
  const regularHours = payload.regularOpeningHours && typeof payload.regularOpeningHours === 'object'
    ? payload.regularOpeningHours
    : {};
  return {
    place_id: clean(payload.id),
    name: clean(payload.displayName?.text || payload.displayName),
    rating: Number(payload.rating) || 0,
    review_count: Math.max(0, Number(payload.userRatingCount) || 0),
    formatted_address: clean(payload.formattedAddress),
    plus_code: clean(payload.plusCode?.globalCode || payload.plusCode?.compoundCode),
    international_phone: clean(payload.internationalPhoneNumber || payload.nationalPhoneNumber),
    website: clean(payload.websiteUri),
    google_maps_url: clean(payload.googleMapsUri),
    business_status: normalizeBusinessStatus(payload.businessStatus),
    open_now: typeof currentHours.openNow === 'boolean' ? currentHours.openNow : null,
    weekday_descriptions: Array.isArray(currentHours.weekdayDescriptions)
      ? currentHours.weekdayDescriptions.map(clean).filter(Boolean)
      : Array.isArray(regularHours.weekdayDescriptions)
        ? regularHours.weekdayDescriptions.map(clean).filter(Boolean)
        : [],
    attribution: 'Google',
    fetched_at: new Date().toISOString()
  };
}

async function fetchGooglePlaceDetails(placeId, options = {}) {
  const apiKey = options.apiKey || process.env.GOOGLE_MAPS_API_KEY || process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    const error = new Error('Google Place Details is not configured.');
    error.code = 'MARKETPLACE_GOOGLE_DETAILS_UNCONFIGURED';
    error.status = 503;
    throw error;
  }
  consumeBudget();
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.MARKETPLACE_GOOGLE_DETAILS_TIMEOUT_MS || 6500));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DETAILS_ENDPOINT}/${encodeURIComponent(placeId)}`, {
      headers: {
        Referer: options.referer || process.env.GOOGLE_PLACES_REFERER || DEFAULT_REFERER,
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DETAILS_FIELD_MASK
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Google Place Details returned HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.error?.status || 'MARKETPLACE_GOOGLE_DETAILS_FAILED';
      throw error;
    }
    return normalizeGooglePlaceDetails(payload);
  } finally {
    clearTimeout(timer);
  }
}

async function getGooglePlaceDetails(placeId, options = {}) {
  const key = clean(placeId);
  if (!key) return null;
  const cached = cache.get(key);
  if (!options.force && cached?.expiresAt > Date.now()) {
    return { ...cached.data, cache_status: 'hit' };
  }
  if (cached) cache.delete(key);
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = fetchGooglePlaceDetails(key, options)
    .then((data) => {
      if (cache.size >= cacheMax()) cache.delete(cache.keys().next().value);
      cache.set(key, { data, expiresAt: Date.now() + cacheTtlMs() });
      return { ...data, cache_status: 'miss' };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function googleDetailsStatus() {
  const day = utcDay();
  if (budget.day !== day) budget = { day, requests: 0 };
  return {
    configured: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.PUBLIC_GOOGLE_MAPS_API_KEY),
    cache_entries: cache.size,
    daily_cap: dailyCap(),
    requests_today: budget.requests,
    cache_ttl_ms: cacheTtlMs()
  };
}

function resetGoogleDetailsState() {
  cache.clear();
  inFlight.clear();
  budget = { day: '', requests: 0 };
}

module.exports = {
  DETAILS_FIELD_MASK,
  fetchGooglePlaceDetails,
  getGooglePlaceDetails,
  googleDetailsStatus,
  normalizeBusinessStatus,
  normalizeGooglePlaceDetails,
  resetGoogleDetailsState
};
