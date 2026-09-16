'use strict';

const crypto = require('crypto');

const logger = require('../config/logger');
const { shortTermEnabled } = require('../utils/shortTermFeatureFlags');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHORT_TERM_MARKER = 'short-term-discovery-v1';

// UGX 50,000 buys a 3 month run. One flat fee, no commission on any stay.
// Commission would put makaug inside the transaction, which breaks the
// intermediary position the whole section is built on.
const LISTING_FEE_UGX = 50000;
const LISTING_TERM_MONTHS = 3;

const MAX_SEARCH_LIMIT = 48;
const DEFAULT_SEARCH_LIMIT = 24;

const PUBLIC_STATUSES = ['approved'];

// Uganda-specific amenities matter more than the global Airbnb list here:
// backup power, a water tank and a borehole are the questions guests actually
// ask in Kampala.
const AMENITY_CATALOGUE = Object.freeze([
  { slug: 'wifi', label: 'Wi-Fi', group: 'essentials' },
  { slug: 'backup_power', label: 'Backup power / generator', group: 'essentials' },
  { slug: 'solar', label: 'Solar power', group: 'essentials' },
  { slug: 'water_tank', label: 'Water tank', group: 'essentials' },
  { slug: 'borehole', label: 'Borehole', group: 'essentials' },
  { slug: 'hot_water', label: 'Hot water', group: 'essentials' },
  { slug: 'air_conditioning', label: 'Air conditioning', group: 'comfort' },
  { slug: 'fan', label: 'Ceiling or standing fan', group: 'comfort' },
  { slug: 'mosquito_nets', label: 'Mosquito nets', group: 'comfort' },
  { slug: 'kitchen', label: 'Kitchen', group: 'comfort' },
  { slug: 'washing_machine', label: 'Washing machine', group: 'comfort' },
  { slug: 'tv', label: 'TV', group: 'comfort' },
  { slug: 'dstv', label: 'DStv', group: 'comfort' },
  { slug: 'workspace', label: 'Desk / workspace', group: 'comfort' },
  { slug: 'balcony', label: 'Balcony or terrace', group: 'comfort' },
  { slug: 'garden', label: 'Garden', group: 'comfort' },
  { slug: 'pool', label: 'Swimming pool', group: 'extras' },
  { slug: 'gym', label: 'Gym', group: 'extras' },
  { slug: 'bbq', label: 'BBQ / grill', group: 'extras' },
  { slug: 'lift', label: 'Lift', group: 'access' },
  { slug: 'step_free_access', label: 'Step-free access', group: 'access' },
  { slug: 'secure_parking', label: 'Secure parking', group: 'safety' },
  { slug: 'gated_security', label: 'Gated compound with security', group: 'safety' },
  { slug: 'cctv', label: 'CCTV', group: 'safety' },
  { slug: 'fire_extinguisher', label: 'Fire extinguisher', group: 'safety' },
  { slug: 'first_aid', label: 'First aid kit', group: 'safety' },
  { slug: 'self_check_in', label: 'Self check-in', group: 'service' },
  { slug: 'housekeeping', label: 'Housekeeping', group: 'service' },
  { slug: 'breakfast', label: 'Breakfast included', group: 'service' },
  { slug: 'airport_pickup', label: 'Airport pickup available', group: 'service' },
  { slug: 'pets_allowed', label: 'Pets allowed', group: 'rules' },
  { slug: 'smoking_allowed', label: 'Smoking allowed', group: 'rules' },
  { slug: 'events_allowed', label: 'Events allowed', group: 'rules' }
]);

const AMENITY_SLUGS = new Set(AMENITY_CATALOGUE.map((item) => item.slug));

const PLACE_TYPES = Object.freeze({
  entire_place: 'Entire place',
  private_room: 'Private room',
  shared_room: 'Shared room'
});

const CANCELLATION_POLICIES = Object.freeze({
  flexible: 'Flexible - full refund up to 24 hours before check-in',
  moderate: 'Moderate - full refund up to 5 days before check-in',
  strict: 'Strict - 50% refund up to 7 days before check-in',
  no_refund: 'No refund once the stay is agreed'
});

const PAYMENT_METHODS = Object.freeze({
  mtn_mobile_money: 'MTN Mobile Money',
  airtel_money: 'Airtel Money',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  card: 'Card',
  other: 'Other'
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBigIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? '').replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value, maxLength = 2000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 8000) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

// Amenity slugs are keys, not URL segments. slugify() would turn
// backup_power into backup-power and the value would then fail the catalogue
// check and be dropped without a word. Keys get their own normaliser.
function normaliseAmenitySlug(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function hashContact(value) {
  const normalised = String(value ?? '').replace(/\s+/g, '').toLowerCase();
  if (!normalised) return null;
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

// Uganda numbers arrive as 0780..., +256780..., 256780... Normalise to E.164
// so a host who typed it three different ways still gets one working link.
function normalisePhone(value) {
  const raw = String(value ?? '').replace(/[^\d+]/g, '');
  if (!raw) return '';
  let digits = raw.replace(/\+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `256${digits.slice(1)}`;
  if (digits.length === 9) digits = `256${digits}`;
  return `+${digits}`;
}

function isValidUgandaPhone(value) {
  return /^\+256\d{9}$/.test(normalisePhone(value));
}

function isValidEmail(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return true; // email is optional throughout
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) && raw.length <= 200;
}

function parseDate(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function dateToUtc(value) {
  return new Date(`${value}T00:00:00Z`);
}

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const ms = dateToUtc(checkOut).getTime() - dateToUtc(checkIn).getTime();
  if (ms <= 0) return 0;
  return Math.round(ms / 86400000);
}

// Walks the nights of a stay. Check-out is exclusive: a guest arriving on the
// 4th and leaving on the 6th pays for the 4th and the 5th, two nights. Getting
// this wrong by one is the classic calendar bug, so it lives in one function.
function eachNight(checkIn, checkOut) {
  const nights = [];
  const total = nightsBetween(checkIn, checkOut);
  if (!total) return nights;
  const cursor = dateToUtc(checkIn);
  for (let i = 0; i < total; i += 1) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

function formatUgx(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 'UGX 0';
  return `UGX ${Math.round(value).toLocaleString('en-UG')}`;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function nightlyRateFor(night, baseNightly, overrides = []) {
  for (const override of overrides) {
    if (night >= override.starts_on && night <= override.ends_on) {
      return Number(override.nightly_ugx);
    }
  }
  return Number(baseNightly);
}

/**
 * Works out what a stay costs. Returns null when the dates are missing or
 * nonsensical, so callers can fall back to showing the nightly rate alone.
 *
 * Every figure returned here is the HOST'S price. makaug adds nothing and
 * takes nothing from it.
 */
function quoteStay(listing, { checkIn, checkOut, guests } = {}) {
  const from = parseDate(checkIn);
  const to = parseDate(checkOut);
  if (!from || !to) return null;

  const nights = nightsBetween(from, to);
  if (nights <= 0) return null;

  const overrides = Array.isArray(listing.rate_overrides) ? listing.rate_overrides : [];
  const base = Number(listing.base_nightly_ugx || 0);

  const breakdown = eachNight(from, to).map((night) => ({
    night,
    nightly_ugx: nightlyRateFor(night, base, overrides)
  }));

  const nightsSubtotal = breakdown.reduce((sum, row) => sum + row.nightly_ugx, 0);

  let discountPct = 0;
  let discountLabel = null;
  if (nights >= 28 && Number(listing.monthly_discount_pct || 0) > 0) {
    discountPct = Number(listing.monthly_discount_pct);
    discountLabel = 'Monthly stay discount';
  } else if (nights >= 7 && Number(listing.weekly_discount_pct || 0) > 0) {
    discountPct = Number(listing.weekly_discount_pct);
    discountLabel = 'Weekly stay discount';
  }

  const discountAmount = Math.round((nightsSubtotal * discountPct) / 100);
  const cleaning = Number(listing.cleaning_fee_ugx || 0);
  const total = Math.max(0, nightsSubtotal - discountAmount + cleaning);

  const partySize = toInt(guests, 0);
  const overCapacity = partySize > 0 && partySize > Number(listing.max_guests || 0);

  return {
    check_in: from,
    check_out: to,
    nights,
    guests: partySize || null,
    over_capacity: overCapacity,
    meets_min_nights: nights >= Number(listing.min_nights || 1),
    min_nights: Number(listing.min_nights || 1),
    currency: 'UGX',
    nights_subtotal_ugx: nightsSubtotal,
    average_nightly_ugx: Math.round(nightsSubtotal / nights),
    discount_pct: discountPct,
    discount_label: discountLabel,
    discount_ugx: discountAmount,
    cleaning_fee_ugx: cleaning,
    security_deposit_ugx: Number(listing.security_deposit_ugx || 0),
    total_ugx: total,
    total_display: formatUgx(total),
    per_night_display: formatUgx(Math.round(nightsSubtotal / nights)),
    breakdown,
    // Said plainly because guests will read this figure as a booking price if
    // we let them. It is not one.
    disclaimer: 'This is the host\'s published rate, worked out from the dates you entered. It is an estimate, not a booking and not a quote from makaug. Agree the final price directly with the host.'
  };
}

/**
 * True when every night of the stay sits inside a published available window
 * and outside every blocked window. A listing with no availability rows at all
 * is treated as "ask the host" rather than "available", because we will not
 * imply a free calendar the host never published.
 */
function isStayAvailable(availability = [], checkIn, checkOut) {
  const nights = eachNight(parseDate(checkIn), parseDate(checkOut));
  if (!nights.length) return { available: null, reason: 'no_dates' };
  if (!availability.length) return { available: null, reason: 'no_calendar_published' };

  const open = availability.filter((row) => row.is_available !== false);
  const blocked = availability.filter((row) => row.is_available === false);

  for (const night of nights) {
    const isOpen = open.some((row) => night >= row.starts_on && night <= row.ends_on);
    if (!isOpen) return { available: false, reason: 'outside_published_dates', night };
    const isBlocked = blocked.some((row) => night >= row.starts_on && night <= row.ends_on);
    if (isBlocked) return { available: false, reason: 'blocked', night };
  }
  return { available: true, reason: 'open' };
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

function contactLinks(row) {
  const phone = normalisePhone(row.host_phone);
  const whatsapp = normalisePhone(row.host_whatsapp || row.host_phone);
  return {
    phone: phone || null,
    phone_display: phone ? phone.replace(/^\+256/, '0') : null,
    tel_href: phone ? `tel:${phone}` : null,
    whatsapp_href: whatsapp ? `https://wa.me/${whatsapp.replace(/^\+/, '')}` : null,
    email: row.host_email || null
  };
}

function normalizeShortTermListing(row = {}, options = {}) {
  if (!row || !row.id) return null;
  const includeContact = options.includeContact !== false;
  const media = Array.isArray(row.media) ? row.media : [];
  const primary = media.find((item) => item.is_primary) || media[0] || null;

  const listing = {
    id: String(row.id),
    reference: row.reference || null,
    slug: row.slug || null,
    url: row.slug ? `/short-term/${row.slug}` : null,
    title: row.title || '',
    description: row.description || '',
    district: row.district || '',
    area: row.area || '',
    address: row.address || null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    place_type: row.place_type || 'entire_place',
    place_type_label: PLACE_TYPES[row.place_type] || PLACE_TYPES.entire_place,
    property_type: row.property_type || null,
    bedrooms: toInt(row.bedrooms, 0),
    beds: toInt(row.beds, 0),
    bathrooms: toInt(row.bathrooms, 0),
    max_guests: toInt(row.max_guests, 0),
    currency: 'UGX',
    nightly_ugx: Number(row.base_nightly_ugx || 0),
    nightly_display: formatUgx(row.base_nightly_ugx),
    cleaning_fee_ugx: Number(row.cleaning_fee_ugx || 0),
    security_deposit_ugx: Number(row.security_deposit_ugx || 0),
    weekly_discount_pct: toInt(row.weekly_discount_pct, 0),
    monthly_discount_pct: toInt(row.monthly_discount_pct, 0),
    min_nights: toInt(row.min_nights, 1),
    max_nights: row.max_nights == null ? null : toInt(row.max_nights, 0),
    check_in_from: row.check_in_from || null,
    check_out_by: row.check_out_by || null,
    house_rules: row.house_rules || null,
    terms_text: row.terms_text || null,
    cancellation_policy: row.cancellation_policy || 'moderate',
    cancellation_policy_label: CANCELLATION_POLICIES[row.cancellation_policy]
      || CANCELLATION_POLICIES.moderate,
    amenities: Array.isArray(row.amenities) ? row.amenities.filter(Boolean) : [],
    images: media.map((item) => ({
      url: item.url,
      caption: item.caption || null,
      is_primary: Boolean(item.is_primary)
    })),
    primary_image: primary ? primary.url : null,
    availability: Array.isArray(row.availability) ? row.availability : [],
    rate_overrides: Array.isArray(row.rate_overrides) ? row.rate_overrides : [],
    host_name: row.host_name || null,
    host_type: row.host_type || 'owner',
    source: row.source || 'direct',
    partner_name: row.partner_name || null,
    external_booking_url: row.external_booking_url || null,
    review_count: toInt(row.review_count, 0),
    review_average: row.review_average == null ? null : Number(Number(row.review_average).toFixed(2)),
    listed_at: row.listed_at || null,
    expires_at: row.expires_at || null,
    // Every private listing carries this. It is what makes the comment and
    // score section under it fair, and what tells a guest who they are dealing
    // with before they pick up the phone.
    is_private_listing: (row.source || 'direct') === 'direct',
    verified: Boolean(row.right_to_let_declared)
  };

  if (includeContact) listing.contact = contactLinks(row);
  return listing;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const LIVE_LISTING_SQL = `
  l.status = ANY($LIVE_STATUSES$)
  AND (l.expires_at IS NULL OR l.expires_at > NOW())
`.replace('$LIVE_STATUSES$', `'{${PUBLIC_STATUSES.join(',')}}'::text[]`);

function buildSearchFilters(query = {}) {
  const where = [LIVE_LISTING_SQL];
  const values = [];

  const district = cleanText(query.district, 120);
  if (district) {
    values.push(district.toLowerCase());
    where.push(`LOWER(l.district) = $${values.length}`);
  }

  const area = cleanText(query.area, 120);
  if (area) {
    values.push(`%${area.toLowerCase()}%`);
    where.push(`LOWER(l.area) LIKE $${values.length}`);
  }

  const q = cleanText(query.q, 120);
  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    where.push(`(LOWER(l.title) LIKE $${values.length}
      OR LOWER(l.area) LIKE $${values.length}
      OR LOWER(l.district) LIKE $${values.length}
      OR LOWER(COALESCE(l.description, '')) LIKE $${values.length})`);
  }

  const guests = toInt(query.guests, 0);
  if (guests > 0) {
    values.push(guests);
    where.push(`l.max_guests >= $${values.length}`);
  }

  const bedrooms = toInt(query.bedrooms, 0);
  if (bedrooms > 0) {
    values.push(bedrooms);
    where.push(`l.bedrooms >= $${values.length}`);
  }

  const minPrice = toBigIntSafe(query.min_price, 0);
  if (minPrice > 0) {
    values.push(minPrice);
    where.push(`l.base_nightly_ugx >= $${values.length}`);
  }

  const maxPrice = toBigIntSafe(query.max_price, 0);
  if (maxPrice > 0) {
    values.push(maxPrice);
    where.push(`l.base_nightly_ugx <= $${values.length}`);
  }

  const placeType = cleanText(query.place_type, 30);
  if (PLACE_TYPES[placeType]) {
    values.push(placeType);
    where.push(`l.place_type = $${values.length}`);
  }

  const amenities = String(query.amenities || '')
    .split(',')
    .map((slug) => normaliseAmenitySlug(slug))
    .filter((slug) => AMENITY_SLUGS.has(slug))
    .slice(0, 10);
  if (amenities.length) {
    values.push(amenities);
    where.push(`(
      SELECT COUNT(DISTINCT a.amenity_slug)
      FROM st_listing_amenity a
      WHERE a.listing_id = l.id AND a.amenity_slug = ANY($${values.length}::text[])
    ) = ${amenities.length}`);
  }

  return { where: where.join(' AND '), values, amenities };
}

function orderByFor(sort) {
  switch (String(sort || '').trim()) {
    case 'price_asc': return 'l.base_nightly_ugx ASC, l.created_at DESC';
    case 'price_desc': return 'l.base_nightly_ugx DESC, l.created_at DESC';
    case 'newest': return 'l.listed_at DESC NULLS LAST, l.created_at DESC';
    case 'rating': return 'review_average DESC NULLS LAST, review_count DESC, l.created_at DESC';
    default: return 'l.listed_at DESC NULLS LAST, l.created_at DESC';
  }
}

async function searchShortTermListings(db, query = {}) {
  const { where, values } = buildSearchFilters(query);
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, toInt(query.limit, DEFAULT_SEARCH_LIMIT)));
  const page = Math.max(1, toInt(query.page, 1));
  const offset = (page - 1) * limit;

  const sql = `
    SELECT
      l.*,
      COALESCE(media.items, '[]'::json) AS media,
      COALESCE(amen.slugs, '{}'::text[]) AS amenities,
      COALESCE(rev.review_count, 0) AS review_count,
      rev.review_average,
      COUNT(*) OVER()::int AS total_matches
    FROM st_listing l
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'url', m.url, 'caption', m.caption, 'is_primary', m.is_primary
      ) ORDER BY m.is_primary DESC, m.sort_order ASC) AS items
      FROM st_listing_media m WHERE m.listing_id = l.id
    ) media ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(a.amenity_slug ORDER BY a.amenity_slug) AS slugs
      FROM st_listing_amenity a WHERE a.listing_id = l.id
    ) amen ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS review_count, AVG(r.rating)::numeric AS review_average
      FROM st_review r WHERE r.listing_id = l.id AND r.status = 'published'
    ) rev ON TRUE
    WHERE ${where}
    ORDER BY ${orderByFor(query.sort)}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await db.query(sql, values);
  const total = result.rows.length ? Number(result.rows[0].total_matches || 0) : 0;
  const listings = result.rows.map((row) => normalizeShortTermListing(row)).filter(Boolean);

  return {
    listings,
    total,
    page,
    limit,
    pages: limit > 0 ? Math.ceil(total / limit) : 0,
    marker: SHORT_TERM_MARKER
  };
}

async function getShortTermListing(db, slugOrId) {
  const key = String(slugOrId || '').trim();
  if (!key) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

  const result = await db.query(
    `SELECT
       l.*,
       COALESCE(media.items, '[]'::json) AS media,
       COALESCE(amen.slugs, '{}'::text[]) AS amenities,
       COALESCE(avail.items, '[]'::json) AS availability,
       COALESCE(rates.items, '[]'::json) AS rate_overrides,
       COALESCE(rev.review_count, 0) AS review_count,
       rev.review_average
     FROM st_listing l
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'url', m.url, 'caption', m.caption, 'is_primary', m.is_primary
       ) ORDER BY m.is_primary DESC, m.sort_order ASC) AS items
       FROM st_listing_media m WHERE m.listing_id = l.id
     ) media ON TRUE
     LEFT JOIN LATERAL (
       SELECT array_agg(a.amenity_slug ORDER BY a.amenity_slug) AS slugs
       FROM st_listing_amenity a WHERE a.listing_id = l.id
     ) amen ON TRUE
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'starts_on', to_char(v.starts_on, 'YYYY-MM-DD'),
         'ends_on', to_char(v.ends_on, 'YYYY-MM-DD'),
         'is_available', v.is_available,
         'note', v.note
       ) ORDER BY v.starts_on ASC) AS items
       FROM st_availability v
       WHERE v.listing_id = l.id AND v.ends_on >= CURRENT_DATE - 1
     ) avail ON TRUE
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'starts_on', to_char(o.starts_on, 'YYYY-MM-DD'),
         'ends_on', to_char(o.ends_on, 'YYYY-MM-DD'),
         'nightly_ugx', o.nightly_ugx,
         'label', o.label
       ) ORDER BY o.starts_on ASC) AS items
       FROM st_rate_override o
       WHERE o.listing_id = l.id AND o.ends_on >= CURRENT_DATE - 1
     ) rates ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS review_count, AVG(r.rating)::numeric AS review_average
       FROM st_review r WHERE r.listing_id = l.id AND r.status = 'published'
     ) rev ON TRUE
     WHERE ${LIVE_LISTING_SQL}
       AND ${isUuid ? 'l.id = $1::uuid' : 'l.slug = $1'}
     LIMIT 1`,
    [key]
  );

  return normalizeShortTermListing(result.rows[0]);
}

async function listPublishedReviews(db, listingId, limit = 30) {
  const result = await db.query(
    `SELECT id, reviewer_name, rating, comment, stayed_on, published_at, created_at
     FROM st_review
     WHERE listing_id = $1::uuid AND status = 'published'
     ORDER BY COALESCE(published_at, created_at) DESC
     LIMIT $2`,
    [listingId, Math.min(100, Math.max(1, toInt(limit, 30)))]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    reviewer_name: row.reviewer_name,
    rating: toInt(row.rating, 0),
    comment: row.comment || '',
    stayed_on: row.stayed_on ? String(row.stayed_on).slice(0, 10) : null,
    published_at: row.published_at || row.created_at
  }));
}

/**
 * Short term rows that belong in the site-wide property total.
 *
 * Guarded twice over: the feature flag, and to_regclass so a database that has
 * not run migration 132 returns 0 instead of throwing. The existing count must
 * never be able to fail because of anything in here.
 */
async function loadShortTermPublicCount(db, { timeoutMs = 900 } = {}) {
  if (!shortTermEnabled()) return 0;
  try {
    const result = await db.query(
      `SELECT CASE
                WHEN to_regclass('public.st_listing') IS NULL THEN 0
                ELSE (
                  SELECT COUNT(*)::int FROM st_listing l
                  WHERE ${LIVE_LISTING_SQL}
                )
              END AS total`
    );
    return Number(result.rows[0]?.total || 0);
  } catch (error) {
    logger.warn('Short term count unavailable; site-wide total is continuing without it', {
      marker: SHORT_TERM_MARKER,
      code: error?.code,
      message: error?.message,
      timeoutMs
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function validateListingSubmission(payload = {}) {
  const errors = [];
  const title = cleanText(payload.title, 160);
  const description = cleanMultiline(payload.description, 6000);
  const district = cleanText(payload.district, 120);
  const area = cleanText(payload.area, 120);
  const hostName = cleanText(payload.host_name, 120);
  const hostPhone = normalisePhone(payload.host_phone);
  const nightly = toBigIntSafe(payload.base_nightly_ugx, 0);

  if (title.length < 8) errors.push('Give the place a title of at least 8 characters.');
  if (description.length < 40) errors.push('Describe the place in at least 40 characters.');
  if (!district) errors.push('District is required.');
  if (!area) errors.push('Area or neighbourhood is required.');
  if (!hostName) errors.push('We need the name guests should ask for.');
  if (!isValidUgandaPhone(hostPhone)) errors.push('A reachable Ugandan phone number is required, for example 0780 863 394.');
  if (!isValidEmail(payload.host_email)) errors.push('That email address does not look right.');
  if (nightly <= 0) errors.push('Set a nightly price in Uganda Shillings.');
  if (nightly > 50000000) errors.push('That nightly price looks wrong. Check the figure.');

  // The two declarations that carry the liability. Without them we do not
  // publish, full stop.
  if (payload.right_to_let_declared !== true && String(payload.right_to_let_declared) !== 'true') {
    errors.push('You must confirm you have the right to let this place out.');
  }
  if (payload.terms_accepted !== true && String(payload.terms_accepted) !== 'true') {
    errors.push('You must accept the makaug listing terms.');
  }

  const placeType = cleanText(payload.place_type, 30) || 'entire_place';
  if (!PLACE_TYPES[placeType]) errors.push('Choose entire place, private room or shared room.');

  const cancellation = cleanText(payload.cancellation_policy, 30) || 'moderate';
  if (!CANCELLATION_POLICIES[cancellation]) errors.push('Choose a cancellation policy.');

  const payment = cleanText(payload.preferred_payment_method, 30);
  if (payment && !PAYMENT_METHODS[payment]) errors.push('Choose a payment method we support.');

  const amenities = Array.isArray(payload.amenities)
    ? Array.from(new Set(
      payload.amenities.map((slug) => normaliseAmenitySlug(slug)).filter((slug) => AMENITY_SLUGS.has(slug))
    ))
    : [];

  const availability = Array.isArray(payload.availability) ? payload.availability : [];
  const windows = [];
  for (const window of availability.slice(0, 60)) {
    const from = parseDate(window?.starts_on);
    const to = parseDate(window?.ends_on);
    if (!from || !to) {
      errors.push('Availability dates must be real dates in YYYY-MM-DD form.');
      break;
    }
    if (nightsBetween(from, to) < 0 || to < from) {
      errors.push('An availability window ends before it starts.');
      break;
    }
    windows.push({
      starts_on: from,
      ends_on: to,
      is_available: window?.is_available !== false,
      note: cleanText(window?.note, 200) || null
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      title,
      description,
      district,
      area,
      address: cleanText(payload.address, 240) || null,
      latitude: payload.latitude == null || payload.latitude === '' ? null : Number(payload.latitude),
      longitude: payload.longitude == null || payload.longitude === '' ? null : Number(payload.longitude),
      place_type: placeType,
      property_type: cleanText(payload.property_type, 80) || null,
      bedrooms: Math.max(0, toInt(payload.bedrooms, 1)),
      beds: Math.max(1, toInt(payload.beds, 1)),
      bathrooms: Math.max(0, toInt(payload.bathrooms, 1)),
      max_guests: Math.max(1, toInt(payload.max_guests, 2)),
      base_nightly_ugx: nightly,
      cleaning_fee_ugx: Math.max(0, toBigIntSafe(payload.cleaning_fee_ugx, 0)),
      security_deposit_ugx: Math.max(0, toBigIntSafe(payload.security_deposit_ugx, 0)),
      weekly_discount_pct: Math.min(90, Math.max(0, toInt(payload.weekly_discount_pct, 0))),
      monthly_discount_pct: Math.min(90, Math.max(0, toInt(payload.monthly_discount_pct, 0))),
      min_nights: Math.max(1, toInt(payload.min_nights, 1)),
      max_nights: payload.max_nights ? Math.max(1, toInt(payload.max_nights, 0)) : null,
      check_in_from: cleanText(payload.check_in_from, 10) || '14:00',
      check_out_by: cleanText(payload.check_out_by, 10) || '10:00',
      host_name: hostName,
      host_phone: hostPhone,
      host_whatsapp: normalisePhone(payload.host_whatsapp) || hostPhone,
      host_email: cleanText(payload.host_email, 200) || null,
      host_type: ['owner', 'manager', 'agent'].includes(payload.host_type) ? payload.host_type : 'owner',
      house_rules: cleanMultiline(payload.house_rules, 4000) || null,
      terms_text: cleanMultiline(payload.terms_text, 8000) || null,
      cancellation_policy: cancellation,
      right_to_let_declared: true,
      right_to_let_reference: cleanText(payload.right_to_let_reference, 120) || null,
      local_hotel_tax_ack: payload.local_hotel_tax_ack === true || String(payload.local_hotel_tax_ack) === 'true',
      preferred_payment_method: payment || null,
      payout_note: cleanText(payload.payout_note, 300) || null,
      amenities,
      availability: windows
    }
  };
}

async function createShortTermListing(db, payload = {}, context = {}) {
  const validation = validateListingSubmission(payload);
  if (!validation.ok) {
    const error = new Error('Listing submission is not valid');
    error.status = 400;
    error.details = validation.errors;
    throw error;
  }
  const value = validation.value;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const refResult = await client.query("SELECT nextval('st_listing_reference_seq') AS n");
    const reference = `ST-${String(refResult.rows[0].n).padStart(6, '0')}`;
    const slugBase = slugify(`${value.title}-${value.area}`) || 'short-stay';
    const slug = `${slugBase}-${reference.toLowerCase()}`;

    const inserted = await client.query(
      `INSERT INTO st_listing (
         reference, slug, title, description, district, area, address, latitude, longitude,
         place_type, property_type, bedrooms, beds, bathrooms, max_guests,
         base_nightly_ugx, cleaning_fee_ugx, security_deposit_ugx,
         weekly_discount_pct, monthly_discount_pct, min_nights, max_nights,
         check_in_from, check_out_by,
         host_name, host_phone, host_whatsapp, host_email, host_type, host_user_id,
         house_rules, terms_text, cancellation_policy,
         right_to_let_declared, right_to_let_reference, local_hotel_tax_ack,
         terms_accepted_at, terms_accepted_ip,
         status, listing_fee_ugx, listing_fee_status, listing_term_months,
         preferred_payment_method, payout_note, source
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,
         $16,$17,$18,
         $19,$20,$21,$22,
         $23,$24,
         $25,$26,$27,$28,$29,$30,
         $31,$32,$33,
         $34,$35,$36,
         NOW(),$37,
         'pending',$38,'unpaid',$39,
         $40,$41,'direct'
       )
       RETURNING id, reference, slug, status`,
      [
        reference, slug, value.title, value.description, value.district, value.area,
        value.address, value.latitude, value.longitude,
        value.place_type, value.property_type, value.bedrooms, value.beds, value.bathrooms, value.max_guests,
        value.base_nightly_ugx, value.cleaning_fee_ugx, value.security_deposit_ugx,
        value.weekly_discount_pct, value.monthly_discount_pct, value.min_nights, value.max_nights,
        value.check_in_from, value.check_out_by,
        value.host_name, value.host_phone, value.host_whatsapp, value.host_email, value.host_type,
        context.hostUserId || null,
        value.house_rules, value.terms_text, value.cancellation_policy,
        value.right_to_let_declared, value.right_to_let_reference, value.local_hotel_tax_ack,
        context.ip || null,
        LISTING_FEE_UGX, LISTING_TERM_MONTHS,
        value.preferred_payment_method, value.payout_note
      ]
    );

    const listingId = inserted.rows[0].id;

    for (const slugValue of value.amenities) {
      await client.query(
        `INSERT INTO st_listing_amenity (listing_id, amenity_slug)
         VALUES ($1, $2) ON CONFLICT (listing_id, amenity_slug) DO NOTHING`,
        [listingId, slugValue]
      );
    }

    for (const window of value.availability) {
      await client.query(
        `INSERT INTO st_availability (listing_id, starts_on, ends_on, is_available, note, source)
         VALUES ($1, $2::date, $3::date, $4, $5, 'host')`,
        [listingId, window.starts_on, window.ends_on, window.is_available, window.note]
      );
    }

    // The fee is raised as an unpaid record so it is visible to staff from the
    // moment the listing exists. Nothing is charged here, and makaug never
    // touches guest money at any point.
    await client.query(
      `INSERT INTO st_listing_payment (listing_id, amount_ugx, method, status, covers_from, covers_to, notes)
       VALUES ($1, $2, $3, 'initiated', CURRENT_DATE, CURRENT_DATE + INTERVAL '3 months', $4)`,
      [
        listingId,
        LISTING_FEE_UGX,
        value.preferred_payment_method || 'mtn_mobile_money',
        'Flat listing fee, UGX 50,000 for a 3 month run. No commission on any stay.'
      ]
    );

    await client.query('COMMIT');

    logger.info('Short term listing submitted', {
      marker: SHORT_TERM_MARKER,
      listingId,
      reference: inserted.rows[0].reference
    });

    return {
      id: String(listingId),
      reference: inserted.rows[0].reference,
      slug: inserted.rows[0].slug,
      status: inserted.rows[0].status,
      listing_fee_ugx: LISTING_FEE_UGX,
      listing_fee_display: formatUgx(LISTING_FEE_UGX),
      listing_term_months: LISTING_TERM_MONTHS
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function validateLead(payload = {}) {
  const errors = [];
  const guestName = cleanText(payload.guest_name, 120);
  const guestPhone = cleanText(payload.guest_phone, 30);
  const guestEmail = cleanText(payload.guest_email, 200);

  if (guestName.length < 2) errors.push('Tell the host your name.');
  if (!guestPhone && !guestEmail) errors.push('Leave a phone number or an email so the host can reply.');
  if (!isValidEmail(guestEmail)) errors.push('That email address does not look right.');

  const checkIn = parseDate(payload.check_in);
  const checkOut = parseDate(payload.check_out);
  if (checkIn && checkOut && nightsBetween(checkIn, checkOut) <= 0) {
    errors.push('Check-out must be after check-in.');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      guest_name: guestName,
      guest_phone: guestPhone ? normalisePhone(guestPhone) : null,
      guest_email: guestEmail || null,
      party_size: payload.party_size ? Math.max(1, toInt(payload.party_size, 1)) : null,
      check_in: checkIn,
      check_out: checkOut,
      message: cleanMultiline(payload.message, 2000) || null,
      channel: ['web', 'whatsapp', 'phone', 'email'].includes(payload.channel) ? payload.channel : 'web'
    }
  };
}

/**
 * Records that a guest asked about a place, then hands back the host's own
 * contact details so the guest can go straight to them.
 *
 * makaug does not message the host on the guest's behalf, does not chase a
 * reply, and does not show the guest whether the host answered. That is the
 * line between a discovery platform and a booking platform, and we stay on the
 * discovery side of it deliberately.
 */
async function recordShortTermLead(db, listingId, payload = {}) {
  const validation = validateLead(payload);
  if (!validation.ok) {
    const error = new Error('Enquiry is not valid');
    error.status = 400;
    error.details = validation.errors;
    throw error;
  }
  const value = validation.value;

  const result = await db.query(
    `INSERT INTO st_lead (
       listing_id, guest_name, guest_phone, guest_email, party_size,
       check_in, check_out, message, channel, consent_share_with_host
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6::date,$7::date,$8,$9,TRUE)
     RETURNING id, created_at`,
    [
      listingId, value.guest_name, value.guest_phone, value.guest_email,
      value.party_size, value.check_in, value.check_out, value.message, value.channel
    ]
  );

  await db.query(
    'UPDATE st_listing SET enquiry_count = enquiry_count + 1 WHERE id = $1::uuid',
    [listingId]
  );

  return {
    id: String(result.rows[0].id),
    created_at: result.rows[0].created_at
  };
}

function validateReview(payload = {}) {
  const errors = [];
  const reviewerName = cleanText(payload.reviewer_name, 120);
  const rating = toInt(payload.rating, 0);
  const comment = cleanMultiline(payload.comment, 3000);

  if (reviewerName.length < 2) errors.push('Add the name to show with your review.');
  if (rating < 1 || rating > 5) errors.push('Score the place from 1 to 5.');
  if (comment.length < 15) errors.push('Write at least a sentence about your stay.');

  const contact = cleanText(payload.reviewer_contact, 200);
  if (contact && !isValidUgandaPhone(contact) && !isValidEmail(contact)) {
    errors.push('Leave a phone number or email we can use to check the review is real.');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      reviewer_name: reviewerName,
      reviewer_contact_hash: hashContact(contact),
      rating,
      comment,
      stayed_on: parseDate(payload.stayed_on)
    }
  };
}

/**
 * Reviews land as 'pending'. Nothing a stranger types appears under someone's
 * house until a human has looked at it. That protects the host from a
 * competitor and the guest from a fake five star wall.
 */
async function submitShortTermReview(db, listingId, payload = {}) {
  const validation = validateReview(payload);
  if (!validation.ok) {
    const error = new Error('Review is not valid');
    error.status = 400;
    error.details = validation.errors;
    throw error;
  }
  const value = validation.value;

  if (value.reviewer_contact_hash) {
    const duplicate = await db.query(
      `SELECT id FROM st_review
       WHERE listing_id = $1::uuid AND reviewer_contact_hash = $2
         AND created_at > NOW() - INTERVAL '180 days'
       LIMIT 1`,
      [listingId, value.reviewer_contact_hash]
    );
    if (duplicate.rows.length) {
      const error = new Error('You have already reviewed this place recently');
      error.status = 409;
      error.details = ['A review from this contact is already on file for this place.'];
      throw error;
    }
  }

  const result = await db.query(
    `INSERT INTO st_review (
       listing_id, reviewer_name, reviewer_contact_hash, rating, comment, stayed_on, status
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6::date,'pending')
     RETURNING id, created_at`,
    [listingId, value.reviewer_name, value.reviewer_contact_hash, value.rating, value.comment, value.stayed_on]
  );

  return {
    id: String(result.rows[0].id),
    status: 'pending',
    created_at: result.rows[0].created_at
  };
}

async function reportShortTermListing(db, listingId, payload = {}) {
  const reason = cleanText(payload.reason, 120);
  const details = cleanMultiline(payload.details, 2000);
  if (!reason) {
    const error = new Error('Tell us what is wrong with this listing');
    error.status = 400;
    error.details = ['A reason is required.'];
    throw error;
  }
  const result = await db.query(
    `INSERT INTO st_report (listing_id, reason, details, reporter_contact)
     VALUES ($1::uuid,$2,$3,$4) RETURNING id, created_at`,
    [listingId, reason, details || null, cleanText(payload.reporter_contact, 200) || null]
  );
  return { id: String(result.rows[0].id), created_at: result.rows[0].created_at };
}

module.exports = {
  AMENITY_CATALOGUE,
  AMENITY_SLUGS,
  CANCELLATION_POLICIES,
  DEFAULT_SEARCH_LIMIT,
  LISTING_FEE_UGX,
  LISTING_TERM_MONTHS,
  MAX_SEARCH_LIMIT,
  PAYMENT_METHODS,
  PLACE_TYPES,
  PUBLIC_STATUSES,
  SHORT_TERM_MARKER,
  createShortTermListing,
  eachNight,
  formatUgx,
  getShortTermListing,
  isStayAvailable,
  isValidUgandaPhone,
  listPublishedReviews,
  loadShortTermPublicCount,
  nightsBetween,
  normaliseAmenitySlug,
  normalisePhone,
  normalizeShortTermListing,
  parseDate,
  quoteStay,
  recordShortTermLead,
  reportShortTermListing,
  searchShortTermListings,
  slugify,
  submitShortTermReview,
  validateLead,
  validateListingSubmission,
  validateReview
};
