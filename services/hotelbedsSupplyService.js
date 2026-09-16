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
function toListingCard(hotel = {}) {
  const name = String(hotel.name && hotel.name.content ? hotel.name.content : hotel.name || '').trim();
  const lat = Number(hotel.coordinates && hotel.coordinates.latitude);
  const lng = Number(hotel.coordinates && hotel.coordinates.longitude);

  return {
    // Namespaced so a partner row can never collide with a host listing id,
    // and so it is obvious in logs and in the admin where a row came from.
    reference: 'hb-' + String(hotel.code || '').trim(),
    source: 'hotelbeds',
    is_private_listing: false,

    title: name,
    district: String(hotel.destinationName && hotel.destinationName.content
      ? hotel.destinationName.content
      : hotel.destinationName || '').trim(),
    area: String(hotel.zoneName || '').trim(),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,

    // A partner row has no host to ring. The section must not pretend it does.
    host_phone: null,
    host_name: null,

    // Set from the Cache/Booking API, not from content. Left null so a card
    // with no price renders as "price on request" rather than as free.
    price_per_night: null,

    // Never a makaug detail page: there is nothing of ours to show, and a
    // makaug URL would imply we stand behind the stay.
    url: null,
    external_only: true
  };
}

module.exports = {
  COUNTRY_CODE,
  MAX_HOTELS_PER_REQUEST,
  baseUrl,
  credentials,
  isConfigured,
  partnerSupplyEnabled,
  requestHeaders,
  shouldOfferPartnerSupply,
  signature,
  toListingCard
};
