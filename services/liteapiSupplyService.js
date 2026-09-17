'use strict';

// ---------------------------------------------------------------------------
// LiteAPI (Nuitée) partner supply.
//
// This replaces Hotelbeds as the source that fills a short-stay search when no
// host listings match. The comparison was not close, and it was measured rather
// than argued:
//
//                        Hotelbeds        LiteAPI
//   Uganda properties        214           2,000+ (did not cap out)
//   self-catering          almost none     over half the sample
//   photos                 separate call   in the content response
//   guest review score     none            rating + reviewCount
//   rates returned         1 hotel in 24   200 room types on one hotel
//   the property's phone   never           yes
//
// That last row is the one that matters most here. makaug is a discovery
// platform: it shows the place and the phone number and steps out of the way.
// Hotelbeds rows could not do that - they carried no phone, so they had to link
// out to a hotel website that existed on three in five of them, and the hero
// promise had to be narrowed to host listings only. A LiteAPI row carries the
// property's own number, so it behaves like every other row on the site.
//
// EVERY FIELD NAME BELOW WAS READ OFF A REAL RESPONSE, not off the docs. That
// is deliberate: the Hotelbeds mapping was written from documentation, shipped
// rows that rendered completely blank, and had a test that agreed with the bug
// because the test used the same guessed shape.
// ---------------------------------------------------------------------------

const BASE = 'https://api.liteapi.travel/v3.0';
const COUNTRY = 'UG';

// The content barely changes and the plan is metered, so it is held for six
// hours. Detail (the phone) is held longer: a hotel's landline outlives its
// nightly rate by some margin.
const LIST_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
const FX_TTL_MS = 12 * 60 * 60 * 1000;
const FX_SOURCE = 'https://open.er-api.com/v6/latest/USD';

// How many properties to pull into the cache. The API returned 2,000 without
// reaching its ceiling; there is no reason to hold all of them in memory to
// fill a page of two dozen cards.
const MAX_PROPERTIES = 400;

let listCache = { at: 0, rows: [] };
let detailCache = new Map();
let fxCache = { at: 0, rate: 0 };

function apiKey(env = process.env) {
  return String(env.LITEAPI_KEY || '').trim();
}

function isConfigured(env = process.env) {
  return Boolean(apiKey(env));
}

// Two switches, deliberately. The section's own flag governs everything under
// it; this one governs partner supply alone. Neither implies the other.
function partnerSupplyEnabled(env = process.env) {
  const section = String(env.SHORT_TERM_ENABLED || '').trim().toLowerCase() === 'true';
  const partner = String(env.LITEAPI_ENABLED || '').trim().toLowerCase() === 'true';
  return section && partner;
}

// Partner rows fill an empty result and nothing else. One real host listing and
// they are gone - the hosts are the product, this is the fallback.
function shouldOfferPartnerSupply(hostResults, env = process.env) {
  if (!partnerSupplyEnabled(env)) return false;
  if (!isConfigured(env)) return false;
  const count = Array.isArray(hostResults) ? hostResults.length : Number(hostResults || 0);
  return count === 0;
}

function headers(env = process.env) {
  const key = apiKey(env);
  if (!key) return null;
  return { accept: 'application/json', 'X-API-Key': key };
}

// ---------------------------------------------------------------------------
// Money.
//
// LiteAPI quotes in USD. This section prices in UGX - the filter says UGX, the
// Luganda says buli kiro - so a dollar figure beside host prices is unusable and
// sorting by price would compare dollars against shillings.
//
// A missing or implausible rate means NO PRICE, never a guessed one. A card
// with no price is a worse card; a card with a wrong price is a lie about what
// a room costs.
// ---------------------------------------------------------------------------
async function usdToUgxRate(env = process.env, now = Date.now()) {
  const configured = Number(String(env.USD_TO_UGX_RATE || '').trim());
  if (Number.isFinite(configured) && configured > 0) return configured;

  if (fxCache.rate && (now - fxCache.at) < FX_TTL_MS) return fxCache.rate;

  try {
    const response = await fetch(FX_SOURCE, { headers: { Accept: 'application/json' } });
    if (!response.ok) return fxCache.rate || 0;
    const body = await response.json();
    const rate = Number(body && body.rates && body.rates.UGX);
    // A plausibility floor. USD:UGX has not been under 1,000 in living memory
    // and is not about to be, so anything smaller is a malformed response
    // rather than a cheap dollar.
    if (Number.isFinite(rate) && rate > 1000) {
      fxCache = { at: now, rate };
      return rate;
    }
    return fxCache.rate || 0;
  } catch (_error) {
    return fxCache.rate || 0;
  }
}

// Zero unless someone sets it on purpose. makaug does not collect the guest's
// money, so a markup here is added to a number it never sees, on a stay it
// never books, and the guest sees the real price the moment they click through.
function markupPercent(env = process.env) {
  const raw = Number(String(env.LITEAPI_MARKUP_PERCENT || '').trim());
  if (!isFinite(raw) || raw < 0) return 0;
  // 200 is far likelier to be 2.00 mistyped than an intention, and it would be
  // shown to a guest.
  return Math.min(raw, 25);
}

function applyMarkup(amount, env = process.env) {
  const value = Number(amount);
  if (!isFinite(value) || value <= 0) return null;
  return Math.round(value * (1 + markupPercent(env) / 100));
}

function nightsBetween(checkIn, checkOut) {
  const from = Date.parse(String(checkIn) + 'T00:00:00Z');
  const to = Date.parse(String(checkOut) + 'T00:00:00Z');
  if (!isFinite(from) || !isFinite(to) || to <= from) return 0;
  return Math.round((to - from) / 86400000);
}

// ---------------------------------------------------------------------------
// Content.
// ---------------------------------------------------------------------------

// Callers get their own copies, always. Handing out the cache's own objects is
// how the Hotelbeds integration leaked prices between requests: the route
// writes onto the rows it is about to send, so a shared object meant one dated
// search stamped its prices into the cache and every later search served them
// back - dateless ones included.
function handOut(rows, limit) {
  return rows.slice(0, limit).map((row) => {
    const copy = Object.assign({}, row);
    if (Array.isArray(row.image_candidates)) copy.image_candidates = row.image_candidates.slice();
    return copy;
  });
}

async function fetchUgandaProperties({ limit = 24, env = process.env, now = Date.now() } = {}) {
  if (!isConfigured(env)) return [];

  if (listCache.rows.length && (now - listCache.at) < LIST_TTL_MS) {
    return handOut(listCache.rows, limit);
  }

  const head = headers(env);
  if (!head) return [];

  try {
    const url = BASE + '/data/hotels?countryCode=' + COUNTRY + '&limit=' + MAX_PROPERTIES;
    const response = await fetch(url, { headers: head });
    if (!response.ok) return handOut(listCache.rows, limit);

    const body = await response.json();
    const list = Array.isArray(body && body.data) ? body.data : [];

    const rows = list
      .map(toListingCard)
      // A row with no name or no position is no use on a card or a map.
      .filter((row) => row.title && row.latitude != null);

    if (rows.length) listCache = { at: now, rows };
    return handOut(rows, limit);
  } catch (_error) {
    // Partner supply is a nicety. It must never take the search down with it.
    return handOut(listCache.rows, limit);
  }
}

function toListingCard(hotel = {}) {
  const lat = Number(hotel.latitude);
  const lng = Number(hotel.longitude);
  const photos = [hotel.main_photo, hotel.thumbnail]
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  return {
    // Namespaced so a partner row can never collide with a host listing id, and
    // so it is obvious in logs and in the admin where a row came from.
    reference: 'la-' + String(hotel.id || '').trim(),
    source: 'liteapi',
    is_private_listing: false,

    title: String(hotel.name || '').trim(),
    // The street address is real on these records - "Plot 72 Kira Road" - not
    // the PO box that made the Hotelbeds address field unusable.
    area: String(hotel.address || '').trim() || null,
    district: String(hotel.city || '').trim() || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,

    primary_image: photos[0] || null,
    image_candidates: photos,
    star_rating: Number.isFinite(Number(hotel.stars)) ? Number(hotel.stars) : null,

    // Hotelbeds had no equivalent. A guest score out of ten, with the number of
    // reviews behind it, is worth more to someone choosing a room than a star
    // rating awarded by a tourism board.
    review_score: Number.isFinite(Number(hotel.rating)) ? Number(hotel.rating) : null,
    review_count: Number.isFinite(Number(hotel.reviewCount)) ? Number(hotel.reviewCount) : null,

    // Filled by enrichWithContact(). Left null here so a row that never gets
    // enriched is honest about having no number rather than pretending.
    host_phone: null,
    host_name: null,

    // Set from the rates call, not from content. Left null so a card with no
    // price renders as "price on request" rather than as free.
    price_per_night: null,

    // Never a makaug detail page: there is nothing of ours to show, and a
    // makaug URL would imply we stand behind the stay.
    url: null,
    external_url: null,
    external_only: true
  };
}

// ---------------------------------------------------------------------------
// The phone number.
//
// It is on the single-property endpoint, not the bulk list, so this is one call
// per property shown. Cached for a day, and only ever made for the handful of
// rows actually on screen.
// ---------------------------------------------------------------------------
async function fetchContact(hotelId, env = process.env, now = Date.now()) {
  const id = String(hotelId || '').trim();
  if (!id || !isConfigured(env)) return null;

  const hit = detailCache.get(id);
  if (hit && (now - hit.at) < DETAIL_TTL_MS) return hit.contact;

  const head = headers(env);
  if (!head) return null;

  try {
    const response = await fetch(BASE + '/data/hotel?hotelId=' + encodeURIComponent(id), { headers: head });
    if (!response.ok) return null;
    const body = await response.json();
    const data = (body && body.data) || body || {};

    const contact = {
      phone: String(data.phone || '').trim() || null,
      email: String(data.email || '').trim() || null,
      checkin: (data.checkinCheckoutTimes && data.checkinCheckoutTimes.checkin_start) || null,
      checkout: (data.checkinCheckoutTimes && data.checkinCheckoutTimes.checkout) || null
    };

    detailCache.set(id, { at: now, contact });
    return contact;
  } catch (_error) {
    return null;
  }
}

// Attaches phone numbers to rows, in parallel, without letting one slow or
// missing record hold up the rest.
async function enrichWithContact(rows, env = process.env) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  await Promise.all(rows.map(async (row) => {
    const id = String(row.reference || '').replace(/^la-/, '');
    const contact = await fetchContact(id, env);
    if (!contact) return;
    row.host_phone = contact.phone;
    row.check_in_from = contact.checkin;
    row.check_out_by = contact.checkout;
  }));
  return rows;
}

// ---------------------------------------------------------------------------
// Rates.
// ---------------------------------------------------------------------------
async function fetchRates({
  hotelIds = [],
  checkIn,
  checkOut,
  adults = 2,
  env = process.env
} = {}) {
  const ids = (Array.isArray(hotelIds) ? hotelIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, 50);

  // Prices are per stay, not per hotel. Without dates there is nothing true to
  // put on a card, and inventing a sample window would answer a question nobody
  // asked while spending a metered call to do it.
  if (!ids.length || !checkIn || !checkOut || !isConfigured(env)) return {};

  const nights = nightsBetween(checkIn, checkOut);
  if (!nights) return {};

  const head = headers(env);
  if (!head) return {};

  try {
    const response = await fetch(BASE + '/hotels/rates', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, head),
      body: JSON.stringify({
        hotelIds: ids,
        checkin: String(checkIn),
        checkout: String(checkOut),
        occupancies: [{ adults: Math.max(1, Number(adults) || 2) }],
        currency: 'USD',
        guestNationality: 'UG'
      })
    });

    if (!response.ok) return {};
    const body = await response.json();
    const list = Array.isArray(body && body.data) ? body.data : [];

    // One FX lookup for the whole batch, not one per hotel.
    const ugxRate = await usdToUgxRate(env);
    if (!ugxRate) return {};

    const out = {};
    list.forEach((entry) => {
      const rooms = Array.isArray(entry && entry.roomTypes) ? entry.roomTypes : [];
      if (!rooms.length) return;

      // The cheapest room on offer, by the retail rate - the price a guest
      // would actually pay. offerRetailRate is the honest field here;
      // suggestedSellingPrice is a marked-up figure meant for resellers, and
      // makaug is not reselling anything.
      let cheapest = null;
      rooms.forEach((room) => {
        const amount = Number(room && room.offerRetailRate && room.offerRetailRate.amount);
        const currency = String(room && room.offerRetailRate && room.offerRetailRate.currency || '').toUpperCase();
        if (!isFinite(amount) || amount <= 0 || currency !== 'USD') return;
        if (!cheapest || amount < cheapest) cheapest = amount;
      });
      if (!cheapest) return;

      out['la-' + String(entry.hotelId || '').trim()] = {
        currency: 'UGX',
        per_night: applyMarkup((cheapest / nights) * ugxRate, env),
        total: applyMarkup(cheapest * ugxRate, env),
        nights: nights,
        // Kept so it is always possible to see what was quoted, at what rate,
        // and what was added - without which a wrong price is unarguable.
        source_currency: 'USD',
        source_total: Math.round(cheapest * 100) / 100,
        fx_rate: Math.round(ugxRate),
        markup_percent: markupPercent(env)
      };
    });
    return out;
  } catch (_error) {
    // No prices is a worse card, not a broken page.
    return {};
  }
}

function __resetCachesForTests() {
  listCache = { at: 0, rows: [] };
  detailCache = new Map();
  fxCache = { at: 0, rate: 0 };
}

function __setFxForTests(rate, at) {
  fxCache = { at: at == null ? Date.now() : at, rate: rate };
}

module.exports = {
  __resetCachesForTests,
  __setFxForTests,
  applyMarkup,
  enrichWithContact,
  fetchContact,
  fetchRates,
  fetchUgandaProperties,
  isConfigured,
  markupPercent,
  nightsBetween,
  partnerSupplyEnabled,
  shouldOfferPartnerSupply,
  toListingCard,
  usdToUgxRate,
  BASE,
  COUNTRY,
  MAX_PROPERTIES
};
