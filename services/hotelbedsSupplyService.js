'use strict';

// Hotelbeds (HBX Group) partner supply for the Short Term section.
//
// WHAT THIS IS FOR, and its limits, because they matter:
//
// makaug's Short Term section is built around private hosts - the whole promise
// is that a guest gets the host's own phone number and deals with them
// directly. A Hotelbeds record is not that. It is bedbank hotel inventory with
// no host, no direct phone number, and a rate that is only bookable through
// their Booking API.
//
// So this is deliberately a FALLBACK, never a peer. Partner rows are only ever
// shown when a search returns no host results, and they disappear the moment a
// real host matches. Hosts always win. See shouldOfferPartnerSupply().
//
// It also never books. The evaluation plan does not support live bookings, and
// more importantly makaug's stated position - repeated in the disclaimer on
// every short term page - is that it does not take bookings and does not handle
// money. Partner rows link out. If that ever changes it is a legal decision,
// not a technical one, and it is not made in this file.

const crypto = require('crypto');

const TEST_BASE = 'https://api.test.hotelbeds.com';
const LIVE_BASE = 'https://api.hotelbeds.com';

// Uganda. This service never asks for anything else - there is no reason for
// makaug to be pulling hotel inventory for other countries, and a wrong country
// code here would burn the request quota on records that can never be shown.
const COUNTRY_CODE = 'UG';

// The evaluation plan is rate limited and the quota is small. Anything that
// would loop over destinations needs to respect this.
const MAX_HOTELS_PER_REQUEST = 100;

// Images come back as bare paths; this is the host they hang off.
const PHOTO_BASE = 'https://photos.hotelbeds.com/giata/bigger/';

// Only the fields that are actually used. Asking for everything drags back
// rooms, facilities and wildcards for every hotel, which is a lot of payload
// on a metered plan for data that is never rendered.
const CONTENT_FIELDS = [
  'code', 'name', 'city', 'coordinates', 'categoryCode', 'images', 'web', 'address'
].join(',');

function credentials(env = process.env) {
  const key = String(env.HOTELBEDS_API_KEY || '').trim();
  const secret = String(env.HOTELBEDS_SECRET || '').trim();
  return { key, secret };
}

function isConfigured(env = process.env) {
  const { key, secret } = credentials(env);
  return Boolean(key && secret);
}

function baseUrl(env = process.env) {
  return String(env.HOTELBEDS_ENV || 'test').trim().toLowerCase() === 'live'
    ? LIVE_BASE
    : TEST_BASE;
}

// Hotelbeds signs every request with SHA-256 of apiKey + secret + unix seconds.
// The signature is only valid for a short window, so it is computed per request
// rather than cached.
function signature(env = process.env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const { key, secret } = credentials(env);
  if (!key || !secret) return null;
  return crypto.createHash('sha256').update(key + secret + nowSeconds).digest('hex');
}

function requestHeaders(env = process.env) {
  const { key } = credentials(env);
  const sig = signature(env);
  if (!key || !sig) return null;
  return {
    'Api-key': key,
    'X-Signature': sig,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip'
  };
}

// ---------------------------------------------------------------------------
// The rule that keeps the product honest.
//
// Partner inventory is a fallback for an empty result, not extra rows next to
// host listings. A visitor who searched Kololo and got three host places must
// not also be shown four hotels - that is the point at which "every listing
// carries the host's own phone number" stops being true of the page.
// ---------------------------------------------------------------------------
function shouldOfferPartnerSupply(hostResults, env = process.env) {
  if (!partnerSupplyEnabled(env)) return false;
  if (!isConfigured(env)) return false;
  const count = Array.isArray(hostResults) ? hostResults.length : Number(hostResults || 0);
  return count === 0;
}

function partnerSupplyEnabled(env = process.env) {
  // Dark by default, and dark unless the whole section is on. Turning
  // SHORT_TERM_ENABLED off takes this with it, which keeps the rollback
  // procedure a single switch.
  const on = /^(1|true|yes|on)$/i;
  if (!on.test(String(env.SHORT_TERM_ENABLED || '').trim())) return false;
  return on.test(String(env.HOTELBEDS_ENABLED || '').trim());
}

// ---------------------------------------------------------------------------
// Mapping into the shape the section already renders.
//
// Deliberately incomplete until a real response has been seen. Hotelbeds'
// content payload is large and its field names are not worth guessing at from
// documentation - the remaining fields get filled in against an actual
// sandbox response rather than from memory.
// ---------------------------------------------------------------------------
// "KAMPALA" is how the API sends a city. Shouting it on a card is not.
function titleCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-z])/g, (whole, lead, letter) => lead + letter.toUpperCase());
}

// categoryCode is "5EST", "4EST", "3LL" and so on. The leading digit is the
// only part worth showing, and anything without one is simply unrated.
function starRating(categoryCode) {
  const match = /^(\d)/.exec(String(categoryCode || '').trim());
  return match ? Number(match[1]) : null;
}

// Pick the picture a person would recognise the place by. GEN is the general
// exterior view; visualOrder is their own ranking, lowest first.
function primaryImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const ranked = images.slice().sort((a, b) => {
    const aGen = a && a.imageTypeCode === 'GEN' ? 0 : 1;
    const bGen = b && b.imageTypeCode === 'GEN' ? 0 : 1;
    if (aGen !== bGen) return aGen - bGen;
    return Number(a && a.visualOrder || 1e9) - Number(b && b.visualOrder || 1e9);
  });
  const path = String(ranked[0] && ranked[0].path || '').trim();
  return path ? PHOTO_BASE + path : null;
}

function toListingCard(hotel = {}) {
  const name = String(hotel.name && hotel.name.content ? hotel.name.content : hotel.name || '').trim();
  const lat = Number(hotel.coordinates && hotel.coordinates.latitude);
  const lng = Number(hotel.coordinates && hotel.coordinates.longitude);

  // The hotel's own website. It is the only honest thing to send a visitor to:
  // makaug does not book, and there is no makaug page for a partner row, so a
  // card with nowhere to go is just decoration.
  const web = String(hotel.web || '').trim();

  return {
    // Namespaced so a partner row can never collide with a host listing id,
    // and so it is obvious in logs and in the admin where a row came from.
    reference: 'hb-' + String(hotel.code || '').trim(),
    source: 'hotelbeds',
    is_private_listing: false,

    title: name,
    // city.content is what the API returns. destinationName and zoneName do
    // not exist on this response - it sends destinationCode and zoneCode,
    // which need a second lookup, which is why every row was blank before.
    district: titleCase(hotel.city && hotel.city.content),
    // Deliberately null. The address field is a PO box on most of these
    // records, and a PO box is not an area - showing one would be worse than
    // showing nothing.
    area: null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,

    primary_image: primaryImage(hotel.images),
    star_rating: starRating(hotel.categoryCode),

    // A partner row has no host to ring. The section must not pretend it does.
    host_phone: null,
    host_name: null,

    // Set from the Cache/Booking API, not from content. Left null so a card
    // with no price renders as "price on request" rather than as free.
    price_per_night: null,

    // Never a makaug detail page: there is nothing of ours to show, and a
    // makaug URL would imply we stand behind the stay.
    url: null,
    external_url: /^https?:\/\//i.test(web) ? web : null,
    external_only: true
  };
}

// The content barely changes and the evaluation plan is metered, so this is
// cached in memory rather than fetched per search. A cold instance pays for
// one request; everything after that is free until the TTL expires.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = { at: 0, rows: [] };

async function fetchUgandaHotels({ limit = 24, env = process.env, now = Date.now() } = {}) {
  if (!isConfigured(env)) return [];

  if (cache.rows.length && (now - cache.at) < CACHE_TTL_MS) {
    return cache.rows.slice(0, limit);
  }

  const headers = requestHeaders(env);
  if (!headers) return [];

  const url = baseUrl(env)
    + '/hotel-content-api/1.0/hotels'
    + '?fields=' + CONTENT_FIELDS
    + '&countryCode=' + COUNTRY_CODE
    + '&from=1&to=' + MAX_HOTELS_PER_REQUEST
    + '&language=ENG';

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return cache.rows.slice(0, limit);
    const body = await response.json();
    const hotels = Array.isArray(body && body.hotels) ? body.hotels : [];
    // A row with no name or no position is no use on a card or a map.
    const rows = hotels
      .map(toListingCard)
      .filter((row) => row.title && row.latitude != null);
    if (rows.length) cache = { at: now, rows };
    return rows.slice(0, limit);
  } catch (_error) {
    // Partner supply is a nicety. It must never take the search down with it.
    return cache.rows.slice(0, limit);
  }
}

function __resetCacheForTests() {
  cache = { at: 0, rows: [] };
}

module.exports = {
  __resetCacheForTests,
  fetchUgandaHotels,
  CONTENT_FIELDS,
  COUNTRY_CODE,
  MAX_HOTELS_PER_REQUEST,
  PHOTO_BASE,
  primaryImage,
  starRating,
  titleCase,
  baseUrl,
  credentials,
  isConfigured,
  partnerSupplyEnabled,
  requestHeaders,
  shouldOfferPartnerSupply,
  signature,
  toListingCard
};
