'use strict';

const {
  CATEGORY_SEO,
  canonicalLocationRouteSlug,
  canonicalLocationsForSeoRow,
  facetLocationSlug,
  priceInSeoBounds
} = require('./publicSeoService');
const { publicVisibleInventoryWhere } = require('./publicInventoryMetricsService');
const { SEO_FACET_MIN_LISTINGS, FACET_DEFINITIONS, COMMERCIAL_TRANSACTION_FACETS } = require('../utils/publicSeoFacets');
const { canonicalDisplayLocationForRow, canonicalLocationSearchScope } = require('../utils/locationRegistry');
const { tenantFor } = require('../packages/shared-country-core');
const { normalizePricePeriodForWrite } = require('../utils/propertyPriceCurrency');
const { pricePeriodSuffix: sharedPricePeriodSuffix } = require('../config/pricePeriods');
const { humanPropertyTypeLabel } = require('../utils/commercialClassification');
const { isThinFoundOnlineListing } = require('../utils/publicIndexability');
const { realHostedPhotoExistsSql } = require('../utils/realListingPhoto');
const { agentFirstOrderSql } = require('../utils/agentFirstRank');
const { compactUgx } = require('../utils/compactUgx');
const { foundOnlinePrimaryImageUrl, consentedStaffPrimaryImageLateralSql } = require('../utils/foundOnlinePublicImages');
const {
  buildThirdPartyPublicSummary,
  buildThirdPartyPublicTitle,
  cleanListingTitle,
  copyReviewState,
  isFoundOnlinePublicRow,
  foundOnlinePublicNotice,
  listingCopyExtraFromRaw,
  listingCopyExtraSql
} = require('./publicListingCopy');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const ACTIVE_TENANT = tenantFor(ACTIVE_COUNTRY_CODE);
const ACTIVE_BRAND = ACTIVE_TENANT.publicName || ACTIVE_TENANT.brandName;
const ACTIVE_COUNTRY_NAME = ACTIVE_TENANT.countryName;
const ACTIVE_CURRENCY = ACTIVE_TENANT.currencyCode;

const SEO_LISTING_CACHE_TTL_MS = Math.max(
  30 * 1000,
  Math.min(10 * 60 * 1000, Number(process.env.PUBLIC_SEO_LISTING_CACHE_TTL_MS || 180000) || 180000)
);
const SEO_LISTING_CACHE_MAX_ENTRIES = Math.max(
  50,
  Math.min(2000, Number(process.env.PUBLIC_SEO_LISTING_CACHE_MAX_ENTRIES || 500) || 500)
);
const listingCache = new Map();
const listingCacheInFlight = new Map();

const CATEGORY_GRID_IDS = Object.freeze({
  sale: 'sale-grid',
  rent: 'rent-grid',
  students: 'student-grid',
  commercial: 'commercial-grid',
  land: 'land-grid'
});

const CATEGORY_PAGE_IDS = Object.freeze({
  sale: 'page-sale',
  rent: 'page-rent',
  students: 'page-students',
  commercial: 'page-commercial',
  land: 'page-land'
});

const CATEGORY_H1_SUBJECTS = Object.freeze({
  sale: 'Houses and property for sale',
  rent: 'Houses for rent',
  students: 'Student accommodation',
  commercial: 'Commercial property',
  land: 'Land for sale'
});

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function plainText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseDuplicatePublicTransaction(value = '') {
  return plainText(value)
    .replace(/\bfor\s+sale\s+for\s+sale\b/gi, 'for sale')
    .replace(/\bfor\s+rent\s+for\s+rent\b/gi, 'for rent')
    .replace(/\bto\s+rent\s+for\s+rent\b/gi, 'to rent')
    .trim();
}

function absoluteUrl(value = '', baseUrl = ACTIVE_TENANT.domain) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const root = String(baseUrl || ACTIVE_TENANT.domain).replace(/\/+$/, '');
  return `${root}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function regexEscape(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function postgresWordPattern(values = []) {
  const alternatives = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .map(regexEscape);
  return alternatives.length ? `\\m(?:${alternatives.join('|')})\\M` : '';
}

function facetTextExpressions(alias = 'p') {
  return [
    `LOWER(TRIM(COALESCE(${alias}.property_type, '')))`,
    `LOWER(TRIM(COALESCE(${alias}.title, '')))`,
    `LOWER(TRIM(COALESCE(${alias}.extra_fields->>'room_type', '')))`,
    `LOWER(TRIM(COALESCE(${alias}.extra_fields->>'commercial_type', '')))`
  ];
}

function regexAnyExpression(expressions, ref) {
  return `(${expressions.map((expression) => `${expression} ~* ${ref}`).join('\n        OR ')})`;
}

function getSeoListingCacheEntry(key, now = Date.now()) {
  const cached = listingCache.get(key);
  if (!cached) return null;
  if (now - cached.cachedAt >= SEO_LISTING_CACHE_TTL_MS) {
    return null;
  }
  return touchSeoListingCacheEntry(key, cached);
}

function touchSeoListingCacheEntry(key, cached = listingCache.get(key)) {
  if (!cached) return null;
  // Refresh insertion order so the first key remains the least recently used.
  listingCache.delete(key);
  listingCache.set(key, cached);
  return cached;
}

function getStaleSeoListingCacheEntry(key) {
  return touchSeoListingCacheEntry(key);
}

function setSeoListingCacheEntry(key, value, now = Date.now()) {
  listingCache.delete(key);
  listingCache.set(key, { ...value, cachedAt: now });
  while (listingCache.size > SEO_LISTING_CACHE_MAX_ENTRIES) {
    const oldestKey = listingCache.keys().next().value;
    if (oldestKey === undefined) break;
    listingCache.delete(oldestKey);
  }
}

function clearSeoListingCache() {
  listingCache.clear();
  listingCacheInFlight.clear();
}

async function loadSeoListingCacheEntry(key, loader, { force = false } = {}) {
  if (!force) {
    const cached = getSeoListingCacheEntry(key);
    if (cached) return cached;
    const pending = listingCacheInFlight.get(key);
    const stale = getStaleSeoListingCacheEntry(key);
    if (stale) {
      if (!pending) {
        const refresh = Promise.resolve()
          .then(loader)
          .then((value) => {
            setSeoListingCacheEntry(key, value);
            return getSeoListingCacheEntry(key);
          });
        listingCacheInFlight.set(key, refresh);
        refresh
          .catch(() => null)
          .finally(() => {
            if (listingCacheInFlight.get(key) === refresh) listingCacheInFlight.delete(key);
          });
      }
      return stale;
    }
    if (pending) return pending;
  }

  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      setSeoListingCacheEntry(key, value);
      return getSeoListingCacheEntry(key);
    });
  if (force) return pending;

  listingCacheInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (listingCacheInFlight.get(key) === pending) listingCacheInFlight.delete(key);
  }
}

function categoryPredicate(key, alias = 'p') {
  if (key === 'students') {
    return `(LOWER(COALESCE(${alias}.listing_type, '')) IN ('student', 'students') OR (LOWER(COALESCE(${alias}.listing_type, '')) = 'rent' AND ${alias}.students_welcome = TRUE))`;
  }
  const type = CATEGORY_SEO[key]?.listingType;
  return type ? `LOWER(COALESCE(${alias}.listing_type, '')) = '${type}'` : 'TRUE';
}

// Same scope as the snapshot (canonicalLocationsForSeoRow): a row without a
// canonical_location_id counts under its district, so a district page and the
// sitemap agree (pages in sitemap.xml rendered "0 Listings" before).
function locationPredicate(location, values, alias = 'p') {
  if (!location) return '';
  const scope = canonicalLocationSearchScope([location.canonical_key], 0);
  const canonicalKeys = scope.exact.map((item) => item.key);
  values.push(canonicalKeys.length ? canonicalKeys : [location.canonical_key]);
  const keysRef = `$${values.length}`;
  if (location.level !== 'district') {
    return `AND LOWER(COALESCE(${alias}.extra_fields->>'canonical_location_id', '')) = ANY(${keysRef}::text[])`;
  }
  // A district page counts every canonical area in the district (as the
  // snapshot's canonicalLocationRollupCounts does), plus rows without a
  // canonical id whose district matches.
  const { canonicalizeUgandaLocation } = require('../utils/locationRegistry');
  values.push(`${String(location.canonical_key || '').split(':')[0]}:%`);
  const prefixRef = `$${values.length}`;
  const districtNames = Array.from(new Set([location.district, location.location, ...(location.aliases || [])]
    .map((name) => String(name || '').trim().toLowerCase())
    .filter((name) => name && canonicalizeUgandaLocation('', name)?.district === location.district)));
  values.push(districtNames.length ? districtNames : [String(location.district || '').toLowerCase()]);
  return `AND (
    LOWER(COALESCE(${alias}.extra_fields->>'canonical_location_id', '')) = ANY(${keysRef}::text[])
    OR LOWER(COALESCE(${alias}.extra_fields->>'canonical_location_id', '')) LIKE ${prefixRef}
    OR (COALESCE(${alias}.extra_fields->>'canonical_location_id', '') = '' AND LOWER(TRIM(COALESCE(${alias}.district, ''))) = ANY($${values.length}::text[]))
  )`;
}

function facetPredicate(options, values, alias = 'p') {
  const definition = options.facet || null;
  if (options.university?.name) {
    const acronym = String(options.university.name).match(/\(([^)]+)\)/)?.[1] || '';
    const shortName = String(options.university.name)
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\buniversity\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const needles = [options.university.name, shortName, acronym, ...(options.university.aliases || [])];
    values.push(postgresWordPattern(needles));
    const ref = `$${values.length}`;
    return `AND ${regexAnyExpression([
      `LOWER(TRIM(COALESCE(${alias}.nearest_university, '')))`,
      `LOWER(TRIM(COALESCE(${alias}.extra_fields->>'nearest_university', '')))`,
      `LOWER(TRIM(COALESCE(${alias}.extra_fields->>'student_university', '')))`,
      `LOWER(TRIM(COALESCE(${alias}.extra_fields->>'student_campus', '')))`
    ], ref)}`;
  }
  if (!definition) return '';
  if (definition.kind === 'bedrooms') {
    values.push(Number(definition.value));
    return `AND ${alias}.bedrooms = $${values.length}`;
  }
  if (definition.kind === 'max_price') {
    values.push(Number(definition.value));
    const priceRef = `$${values.length}`;
    if (!definition.pattern) return `AND ${alias}.price > 0 AND ${alias}.price <= ${priceRef}`;
    values.push(`\\m(?:${definition.pattern})\\M`);
    return `AND ${alias}.price > 0 AND ${alias}.price <= ${priceRef}
      AND ${regexAnyExpression(facetTextExpressions(alias), `$${values.length}`)}`;
  }
  if (definition.kind === 'min_price') {
    values.push(Number(definition.value));
    const priceRef = `$${values.length}`;
    if (!definition.pattern) return `AND ${alias}.price >= ${priceRef}`;
    values.push(`\\m(?:${definition.pattern})\\M`);
    return `AND ${alias}.price >= ${priceRef}
      AND ${regexAnyExpression(facetTextExpressions(alias), `$${values.length}`)}`;
  }
  if (definition.kind === 'title_type') {
    values.push(postgresWordPattern([definition.value]));
    return `AND LOWER(TRIM(COALESCE(${alias}.title_type, ${alias}.extra_fields->>'title_type', ''))) ~* $${values.length}`;
  }
  if (definition.kind === 'transaction_type') {
    values.push(String(definition.value));
    const ref = `$${values.length}`;
    return `AND (
      LOWER(COALESCE(${alias}.transaction_type, ${alias}.extra_fields->>'transaction_type', '')) = ${ref}
      OR (${ref} = 'rent' AND LOWER(COALESCE(${alias}.price_period, '')) IN ('mo', 'month', 'monthly', 'per_month'))
      OR (${ref} = 'sale' AND LOWER(COALESCE(${alias}.price_period, '')) IN ('once', 'sale'))
    )`;
  }
  if (definition.kind === 'property_type') {
    values.push(`\\m(?:${definition.pattern})\\M`);
    return `AND ${regexAnyExpression(facetTextExpressions(alias), `$${values.length}`)}`;
  }
  return '';
}

// Title and description come from services/publicListingCopy.js, the same
// builders the JSON API uses, so /property/:id and the SPA never disagree.
function normalizeSeoListingRow(row = {}) {
  const copyExtra = listingCopyExtraFromRaw(row.copy_extra || {});
  const copyRow = { ...row, extra_fields: copyExtra };
  const foundOnlinePublic = isFoundOnlinePublicRow(copyRow, copyExtra);
  const foundOnline = foundOnlinePublic || ['true', '1', 'yes'].includes(String(row.found_online_candidate || '').toLowerCase());
  const review = copyReviewState(copyRow, copyExtra);
  const canonicalDisplay = canonicalDisplayLocationForRow(row);
  const title = foundOnlinePublic
    ? buildThirdPartyPublicTitle(copyRow, copyExtra)
    : (review.staffTitle ? collapseDuplicatePublicTransaction(row.title) : cleanListingTitle(row));
  const description = foundOnlinePublic
    ? buildThirdPartyPublicSummary(copyRow, copyExtra)
    : row.description;
  return {
    id: String(row.id || ''),
    listing_type: String(row.listing_type || ''),
    title: collapseDuplicatePublicTransaction(title) || `${ACTIVE_COUNTRY_NAME} property`,
    title_reviewed: review.staffTitle || (foundOnlinePublic && review.kingTitle),
    thin: row.has_real_photo === undefined ? false : isThinFoundOnlineListing({
      foundOnline: foundOnlinePublic,
      hasRealPhoto: row.has_real_photo === true,
      description: row.description,
      extra: copyExtra
    }),
    description: plainText(description),
    found_online_notice: foundOnlinePublic ? plainText(foundOnlinePublicNotice(copyRow, copyExtra)) : '',
    area: plainText(canonicalDisplay.area),
    district: plainText(canonicalDisplay.district),
    price: Number(row.price || 0) || 0,
    price_period: plainText(row.price_period),
    transaction_type: plainText(row.transaction_type),
    bedrooms: Number(row.bedrooms || 0) || 0,
    bathrooms: Number(row.bathrooms || 0) || 0,
    property_type: humanPropertyTypeLabel(plainText(row.property_type)),
    // Found online: only a photo staff uploaded with consent, never source media.
    primary_image_url: foundOnline ? String(foundOnlinePrimaryImageUrl(row) || '') : String(row.primary_image_url || '').trim(),
    canonical_location_id: String(row.canonical_location_id || '').trim(),
    city: plainText(row.city),
    neighborhood: plainText(row.neighborhood),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    seo_total: Number(row.seo_total || 0) || 0
  };
}

async function loadPublicSeoListings(db, options = {}) {
  const key = CATEGORY_SEO[options.categoryKey] ? options.categoryKey : '';
  const location = options.location || null;
  const limit = Math.max(1, Math.min(24, Number(options.limit || 12) || 12));
  const facetCacheKey = options.university?.slug || options.facetSlug || options.facet?.label || 'all';
  // landingRank: the money pages list agent-listed rows first (see utils/agentFirstRank).
  const landingRank = options.landingRank === true;
  const cacheKey = `${key || 'all'}:${location?.canonical_key || 'uganda'}:${facetCacheKey}:${limit}${landingRank ? ':agent_first' : ''}`;
  const cached = await loadSeoListingCacheEntry(cacheKey, async () => {
    const values = [];
    const categoryWhere = categoryPredicate(key, 'p');
    const locationWhere = locationPredicate(location, values, 'p');
    const facetWhere = facetPredicate(options, values, 'p');
    values.push(limit);
    const limitRef = `$${values.length}`;
    const result = await db.query(
      `SELECT
       p.id, p.listing_type, p.title, p.description, p.area, p.district,
       p.price, p.price_period, p.transaction_type, p.bedrooms, p.bathrooms, p.property_type,
       p.extra_fields->>'canonical_location_id' AS canonical_location_id,
       p.extra_fields->>'city' AS city,
       p.extra_fields->>'neighborhood' AS neighborhood,
       COALESCE(p.extra_fields->>'found_online_candidate', p.extra_fields->>'sourced_inventory_candidate') AS found_online_candidate,
       p.source, p.listed_via,
       ${listingCopyExtraSql('p')} AS copy_extra,
       p.created_at, p.updated_at, COUNT(*) OVER() AS seo_total,
       image.url AS primary_image_url,
       staff_img.url AS staff_primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT i.url
       FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) image ON TRUE
     ${consentedStaffPrimaryImageLateralSql('p')}
     WHERE ${publicVisibleInventoryWhere('p')}
       AND ${categoryWhere}
       ${locationWhere}
       ${facetWhere}
     ORDER BY ${landingRank
    ? agentFirstOrderSql('p', { homesBeforeLand: key === 'sale' })
    : 'p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC'}
       LIMIT ${limitRef}`,
      values
    );
    return { rows: result.rows.map(normalizeSeoListingRow) };
  }, { force: options.force });
  return cached.rows;
}

async function loadPublicSeoListing(db, propertyId) {
  const safeId = String(propertyId || '').trim();
  if (!safeId) return null;
  const cacheKey = `property:${safeId}`;
  const cached = await loadSeoListingCacheEntry(cacheKey, async () => {
    const result = await db.query(
      `SELECT
       p.id, p.listing_type, p.title, p.description, p.area, p.district,
       p.price, p.price_period, p.transaction_type, p.bedrooms, p.bathrooms, p.property_type,
       p.extra_fields->>'canonical_location_id' AS canonical_location_id,
       p.extra_fields->>'city' AS city,
       p.extra_fields->>'neighborhood' AS neighborhood,
       COALESCE(p.extra_fields->>'found_online_candidate', p.extra_fields->>'sourced_inventory_candidate') AS found_online_candidate,
       p.source, p.listed_via,
       ${listingCopyExtraSql('p')} AS copy_extra,
       p.created_at, p.updated_at,
       ${realHostedPhotoExistsSql('p')} AS has_real_photo,
       image.url AS primary_image_url,
       staff_img.url AS staff_primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT i.url
       FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) image ON TRUE
     ${consentedStaffPrimaryImageLateralSql('p')}
     WHERE p.id::text = $1
       AND ${publicVisibleInventoryWhere('p')}
       LIMIT 1`,
      [safeId]
    );
    return { row: result.rows[0] ? normalizeSeoListingRow(result.rows[0]) : null };
  });
  return cached.row;
}

// One currency spelling site-wide: UGX (it was USh in titles and cards but UGX in
// descriptions). South Africa keeps R.
function currencyLabelForSeo() {
  return ACTIVE_CURRENCY === 'ZAR' ? 'R' : ACTIVE_CURRENCY;
}

// "/month", "/week", "/year", "/acre", "/plot" in words, never the stored
// code (C20: it printed "UGX 700,000/wk"). One-off, negotiable and POA have no
// suffix. Shared table: config/pricePeriods.js.
function pricePeriodSuffix(listing = {}) {
  return sharedPricePeriodSuffix(normalizePricePeriodForWrite(String(listing.price_period || '').trim().toLowerCase()) || '');
}

// Full price for cards, detail pages and descriptions: UGX 80,000,000/month.
function priceLabel(listing = {}) {
  if (!(Number(listing.price) > 0)) return 'Price on application';
  const numberLocale = ACTIVE_COUNTRY_CODE === 'ZA' ? 'en-ZA' : 'en-UG';
  const amount = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(Number(listing.price));
  return `${currencyLabelForSeo()} ${amount}${pricePeriodSuffix(listing)}`;
}

// Short price for <title> and og:title, where long numbers get cut off in search
// results: UGX 30M, UGX 1.55B, UGX 1.8M/month. Never an ungrouped long number.
function titlePriceLabel(listing = {}) {
  if (!(Number(listing.price) > 0)) return 'Price on application';
  if (ACTIVE_CURRENCY !== 'UGX') return priceLabel(listing);
  return `${currencyLabelForSeo()} ${compactUgx(Number(listing.price))}${pricePeriodSuffix(listing)}`;
}

// The price is left out of <title> when it is outside the honest bounds
// (50ce7080 showed "— USh 2").
function titlePriceSuffix(listing = {}) {
  const category = ['student', 'students'].includes(String(listing.listing_type || '').toLowerCase()) ? 'students' : String(listing.listing_type || '').toLowerCase();
  return Number(listing.price || 0) > 0 && priceInSeoBounds(listing, category) ? ` — ${titlePriceLabel(listing)}` : '';
}

function propertySeoTitle(listing = {}) {
  if (listing.title_reviewed && listing.title) {
    const reviewedPrice = titlePriceSuffix(listing);
    return `${listing.title}${reviewedPrice} | ${ACTIVE_BRAND}`;
  }
  const listingType = String(listing.listing_type || '').toLowerCase();
  const transaction = String(listing.transaction_type || '').toLowerCase()
    || (listingType === 'rent' ? 'rent' : ['sale', 'land'].includes(listingType) ? 'sale' : '');
  const type = plainText(listing.property_type) || ({
    land: 'Land',
    commercial: 'Commercial Property',
    student: 'Student Accommodation',
    students: 'Student Accommodation'
  }[listingType] || 'Property');
  const bedrooms = Number(listing.bedrooms || 0) > 0 ? `${Number(listing.bedrooms)}bdrm ` : '';
  const intent = transaction === 'rent' ? ' for Rent' : transaction === 'sale' ? ' for Sale' : '';
  const location = [listing.area, listing.district].filter(Boolean).join(', ');
  const price = titlePriceSuffix(listing);
  return `${bedrooms}${type}${intent}${location ? ` in ${location}` : ''}${price} | ${ACTIVE_BRAND}`;
}

function propertySeoDescription(listing = {}) {
  const description = plainText(listing.description);
  const sentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || description.slice(0, 220).trim();
  if (sentence) return sentence.slice(0, 300);
  return `${[listing.area, listing.district].filter(Boolean).join(', ')} - ${priceLabel(listing)}. View this ${ACTIVE_COUNTRY_NAME} property on ${ACTIVE_BRAND}.`;
}

function listingAreaLocation(listing = {}) {
  return canonicalLocationsForSeoRow(listing).find((location) => location.level !== 'district')
    || canonicalLocationsForSeoRow(listing)[0]
    || null;
}

function renderListingLocationLink(listing, categoryKey) {
  const location = listingAreaLocation(listing);
  const config = CATEGORY_SEO[categoryKey] || CATEGORY_SEO[listing.listing_type] || null;
  if (!location || !config) return escapeHtml([listing.area, listing.district].filter(Boolean).join(', '));
  const href = `${config.route}/${canonicalLocationRouteSlug(location)}`;
  const label = [location.name || location.location, location.district].filter(Boolean).join(', ');
  return `<a href="${escapeHtml(href)}" class="font-semibold text-green-700 hover:underline">${escapeHtml(label)}</a>`;
}

function renderSeoListingCard(listing, options = {}) {
  const href = `/property/${encodeURIComponent(listing.id)}`;
  const image = absoluteUrl(listing.primary_image_url || CATEGORY_SEO[options.categoryKey]?.image || '/assets/house-ads-v3/home-hero.webp', options.baseUrl);
  return `<article class="bg-white rounded-xl border border-gray-100 overflow-hidden property-card" data-ssr-property-card="${escapeHtml(listing.id)}">
    <a href="${escapeHtml(href)}" class="block h-48 overflow-hidden" aria-label="View ${escapeHtml(listing.title)}">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" class="w-full h-full object-cover" width="640" height="384" decoding="async" loading="${options.eager ? 'eager' : 'lazy'}">
    </a>
    <div class="p-4">
      <h2 class="font-bold text-gray-900"><a href="${escapeHtml(href)}" class="hover:text-green-700 hover:underline">${escapeHtml(listing.title)}</a></h2>
      <p class="mt-1 text-sm text-gray-600">${renderListingLocationLink(listing, options.categoryKey)}</p>
      <p class="mt-3 text-lg font-black text-green-700">${escapeHtml(priceLabel(listing))}</p>
      <p class="mt-2 text-sm text-gray-600">${[
        listing.bedrooms ? `${listing.bedrooms} ${listing.bedrooms === 1 ? 'bedroom' : 'bedrooms'}` : '',
        listing.bathrooms ? `${listing.bathrooms} ${listing.bathrooms === 1 ? 'bathroom' : 'bathrooms'}` : '',
        listing.property_type
      ].filter(Boolean).map(escapeHtml).join(' · ')}</p>
    </div>
  </article>`;
}

function findElementBoundsById(html, id) {
  const source = String(html || '');
  const marker = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid=["']${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const opening = marker.exec(source);
  if (!opening) return null;
  const tag = opening[1];
  const openStart = opening.index;
  const contentStart = opening.index + opening[0].length;
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  tags.lastIndex = openStart;
  let depth = 0;
  let match;
  while ((match = tags.exec(source))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return { openStart, contentStart, contentEnd: match.index, end: tags.lastIndex };
    }
  }
  return null;
}

function replaceElementInnerHtml(html, id, content) {
  const bounds = findElementBoundsById(html, id);
  if (!bounds) return html;
  return `${String(html).slice(0, bounds.contentStart)}${content}${String(html).slice(bounds.contentEnd)}`;
}

function replacePageH1(html, pageId, h1) {
  const bounds = findElementBoundsById(html, pageId);
  if (!bounds) return html;
  const page = String(html).slice(bounds.contentStart, bounds.contentEnd);
  const nextPage = page.replace(/<h1\b([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1 data-ssr-seo-h1="1">${escapeHtml(h1)}</h1>`);
  return `${String(html).slice(0, bounds.contentStart)}${nextPage}${String(html).slice(bounds.contentEnd)}`;
}

function insertBeforeElement(html, id, content) {
  const bounds = findElementBoundsById(html, id);
  if (!bounds) return html;
  return `${String(html).slice(0, bounds.openStart)}${content}${String(html).slice(bounds.openStart)}`;
}

function insertAfterElement(html, id, content) {
  const bounds = findElementBoundsById(html, id);
  if (!bounds || !content) return html;
  return `${String(html).slice(0, bounds.end)}${content}${String(html).slice(bounds.end)}`;
}

function appendElementInnerHtml(html, id, content) {
  const bounds = findElementBoundsById(html, id);
  if (!bounds || !content) return html;
  return `${String(html).slice(0, bounds.contentEnd)}${content}${String(html).slice(bounds.contentEnd)}`;
}

function insertBeforeClosingTag(html, tagName, content) {
  const source = String(html || '');
  const marker = `</${String(tagName || '').toLowerCase()}>`;
  const index = source.toLowerCase().lastIndexOf(marker);
  if (index === -1 || !content) return html;
  return `${source.slice(0, index)}${content}${source.slice(index)}`;
}

function categoryH1(meta = {}) {
  const subject = CATEGORY_H1_SUBJECTS[meta.key] || meta.config?.subject || 'Property';
  if (!meta.location) return `${subject} in ${ACTIVE_COUNTRY_NAME}`;
  const place = meta.location.level === 'district'
    ? meta.location.district
    : `${meta.location.location}, ${meta.location.district}`;
  return `${subject} in ${place}`;
}

function areaLinksForCategory(snapshot, categoryKey, currentLocation = null, limit = 12) {
  const counts = snapshot?.directCounts?.[categoryKey] || snapshot?.counts?.[categoryKey] || new Map();
  const config = CATEGORY_SEO[categoryKey];
  if (!config) return [];
  const { canonicalLocationOptions } = require('../utils/locationRegistry');
  return canonicalLocationOptions()
    .map((location) => ({ ...location, count: Number(counts.get(location.canonical_key) || 0) }))
    .filter((location) => (
      !['district', 'region'].includes(location.level)
      && location.count >= SEO_FACET_MIN_LISTINGS
      && location.canonical_key !== currentLocation?.canonical_key
    ))
    .sort((left, right) => {
      const leftNeighbor = currentLocation && left.district === currentLocation.district ? 1 : 0;
      const rightNeighbor = currentLocation && right.district === currentLocation.district ? 1 : 0;
      return rightNeighbor - leftNeighbor || right.count - left.count || left.location.localeCompare(right.location);
    })
    .slice(0, Math.max(0, limit))
    .map((location) => ({
      href: `${config.route}/${canonicalLocationRouteSlug(location)}`,
      label: location.level === 'district' ? location.district : `${location.location}, ${location.district}`,
      area: location.location,
      district: location.district,
      canonicalKey: location.canonical_key,
      count: location.count,
      level: location.level
    }));
}

function facetLinksForArea(snapshot, meta) {
  if (!meta?.location) return [];
  const locationKey = meta.location.canonical_key;
  const locationSlug = facetLocationSlug(meta.location);
  const config = CATEGORY_SEO[meta.key];
  const links = Object.entries(FACET_DEFINITIONS[meta.key] || {}).map(([slug, definition]) => ({
    href: `${config.route}/${locationSlug}/${slug}`,
    label: definition.label,
    count: Number(snapshot?.facetCounts?.[meta.key]?.get(`${locationKey}|${slug}`) || 0)
  }));
  if (meta.key === 'commercial') {
    for (const [slug, definition] of Object.entries(COMMERCIAL_TRANSACTION_FACETS)) {
      links.push({
        href: `/commercial/${slug}/${locationSlug}`,
        label: definition.label,
        count: Number(snapshot?.commercialTransactionCounts?.get(`${locationKey}|${slug}`) || 0)
      });
    }
  }
  return links.filter((link) => link.count >= SEO_FACET_MIN_LISTINGS);
}

function popularAreaLinks(snapshot, limit = 15) {
  const candidates = Object.keys(CATEGORY_SEO)
    .flatMap((categoryKey) => areaLinksForCategory(snapshot, categoryKey, null, limit).map((link) => ({ ...link, categoryKey })))
    .filter((link) => !['district', 'region'].includes(String(link.level || '').toLowerCase()))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const deduped = new Map();
  for (const link of candidates) {
    const key = link.canonicalKey || `${link.area}|${link.district}`.toLowerCase();
    if (!deduped.has(key)) {
      // Keep the strongest category destination so the displayed count is the
      // exact count users receive after clicking its clean SEO URL.
      deduped.set(key, { ...link, label: link.area || link.label });
    }
  }
  return Array.from(deduped.values()).slice(0, Math.max(0, limit));
}

function neighborhoodAreaLinks(links = []) {
  return links.filter((link) => !['district', 'region'].includes(String(link?.level || '').toLowerCase()));
}

function renderAreaLinks(links = [], heading = 'Popular property areas') {
  const safeLinks = neighborhoodAreaLinks(links);
  if (!safeLinks.length) return '';
  return `<nav aria-label="${escapeHtml(heading)}" class="mb-6 rounded-2xl border border-green-100 bg-green-50 p-4" data-ssr-area-links="1">
    <h2 class="font-black text-green-950">${escapeHtml(heading)}</h2>
    <div class="mt-3 flex flex-wrap gap-2">${safeLinks.map((link) => `<a href="${escapeHtml(link.href)}" data-canonical-location-id="${escapeHtml(link.canonicalKey || '')}" title="${escapeHtml([link.area || link.label, link.district].filter(Boolean).join(', '))}" class="rounded-full border border-green-200 bg-white px-3 py-1.5 text-sm font-semibold text-green-800 hover:bg-green-100">${escapeHtml(link.label)} <span aria-label="${link.count} listings">(${link.count})</span></a>`).join('')}</div>
  </nav>`;
}

function renderFooterAreaLinks(links = []) {
  const safeLinks = neighborhoodAreaLinks(links);
  if (!safeLinks.length) return '';
  return `<section class="max-w-7xl mx-auto px-4 pb-6" data-ssr-footer-area-links="1"><h2 class="font-black text-white">Popular property areas</h2><div class="mt-3 flex flex-wrap gap-3">${safeLinks.map((link) => `<a href="${escapeHtml(link.href)}" data-canonical-location-id="${escapeHtml(link.canonicalKey || '')}" title="${escapeHtml([link.area || link.label, link.district].filter(Boolean).join(', '))}" class="text-sm text-green-100 hover:text-white hover:underline">${escapeHtml(link.label)}</a>`).join('')}</div></section>`;
}

function breadcrumbItems(meta, baseUrl) {
  if (Array.isArray(meta.breadcrumbs) && meta.breadcrumbs.length) return meta.breadcrumbs;
  const items = [
    { name: 'Home', url: absoluteUrl('/', baseUrl) },
    { name: meta.config.label, url: absoluteUrl(meta.config.route, baseUrl) }
  ];
  if (meta.location) items.push({ name: meta.location.location, url: meta.canonical });
  return items;
}

function renderRouteState(state = null) {
  if (!state) return '';
  const attributes = Object.entries(state)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => ` data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeHtml(value)}"`)
    .join('');
  return `<div id="makaug-seo-route-state" class="hidden" aria-hidden="true" data-preserve-path="1"${attributes}></div>`;
}

function breadcrumbStructuredData(items = []) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

function renderBreadcrumbs(items = []) {
  return `<nav aria-label="Breadcrumb" class="mb-4 text-sm text-gray-600" data-ssr-breadcrumbs="1"><ol class="flex flex-wrap gap-2">${items.map((item, index) => `<li>${index ? '<span aria-hidden="true">/</span> ' : ''}<a href="${escapeHtml(item.url)}" class="hover:text-green-700 hover:underline">${escapeHtml(item.name)}</a></li>`).join('')}</ol></nav>`;
}

function renderCategorySeoHtml(html, options = {}) {
  const meta = options.meta;
  if (!meta) return { html, structuredData: null };
  const listings = options.listings || [];
  const gridId = CATEGORY_GRID_IDS[meta.key];
  const pageId = CATEGORY_PAGE_IDS[meta.key];
  const h1 = meta.h1 || categoryH1(meta);
  const items = breadcrumbItems(meta, options.baseUrl);
  const areaLinks = areaLinksForCategory(options.snapshot, meta.key, meta.location, 12);
  const facetLinks = options.siblingLinks || facetLinksForArea(options.snapshot, meta);
  // Marketing's intro (when the page has landing copy) replaces the summary.
  const summary = meta.landingIntroHtml || `<p class="mb-4 text-gray-700" data-ssr-category-summary="1">${escapeHtml(meta.description)}</p>`;
  const intro = `${renderRouteState(meta.routeState)}${renderBreadcrumbs(items)}${summary}${renderAreaLinks(facetLinks, 'Refine this area')}${renderAreaLinks(areaLinks, meta.location ? 'Nearby and popular areas' : 'Popular areas')}`;
  const cards = listings.length
    ? listings.map((listing, index) => renderSeoListingCard(listing, { categoryKey: meta.key, baseUrl: options.baseUrl, eager: index < 2 })).join('')
    : `<div class="col-span-full rounded-2xl border border-gray-200 bg-gray-50 p-5"><h2 class="font-black">No live listings in this exact area yet</h2><p class="mt-2 text-sm text-gray-600">Browse nearby areas or return to ${escapeHtml(meta.config.label)} across ${escapeHtml(ACTIVE_COUNTRY_NAME)}.</p></div>`;
  let rendered = replacePageH1(html, pageId, h1);
  rendered = replaceElementInnerHtml(rendered, gridId, cards);
  rendered = insertBeforeElement(rendered, gridId, intro);
  // Landing body + FAQ go after the grid, outside it, so SPA hydration (which
  // rewrites the grid) cannot wipe them.
  if (meta.landingBodyHtml) rendered = insertAfterElement(rendered, gridId, meta.landingBodyHtml);
  rendered = insertBeforeClosingTag(rendered, 'footer', renderFooterAreaLinks(popularAreaLinks(options.snapshot, 15)));
  const itemList = {
    '@type': 'ItemList',
    name: h1,
    numberOfItems: listings.length,
    itemListElement: listings.map((listing, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: absoluteUrl(`/property/${encodeURIComponent(listing.id)}`, options.baseUrl),
      name: listing.title
    }))
  };
  return {
    html: rendered,
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          name: h1,
          description: meta.description,
          url: meta.canonical,
          isPartOf: { '@type': 'WebSite', name: ACTIVE_BRAND, url: absoluteUrl('/', options.baseUrl) }
        },
        breadcrumbStructuredData(items),
        itemList,
        ...(meta.landingFaq ? [meta.landingFaq] : [])
      ]
    }
  };
}

function renderPropertySeoHtml(html, listing, options = {}) {
  const categoryKey = listing.listing_type === 'student' ? 'students' : listing.listing_type;
  const config = CATEGORY_SEO[categoryKey] || CATEGORY_SEO.sale;
  const propertyUrl = absoluteUrl(`/property/${encodeURIComponent(listing.id)}`, options.baseUrl);
  const image = absoluteUrl(listing.primary_image_url || config.image || '/assets/house-ads-v3/home-hero.webp', options.baseUrl);
  const location = listingAreaLocation(listing);
  const areaUrl = location ? absoluteUrl(`${config.route}/${canonicalLocationRouteSlug(location)}`, options.baseUrl) : absoluteUrl(config.route, options.baseUrl);
  const locationLabel = [listing.area, listing.district].filter(Boolean).join(', ');
  const items = [
    { name: 'Home', url: absoluteUrl('/', options.baseUrl) },
    { name: config.label, url: absoluteUrl(config.route, options.baseUrl) },
    ...(location ? [{ name: location.name, url: areaUrl }] : []),
    { name: listing.title, url: propertyUrl }
  ];
  const content = `<article class="grid lg:grid-cols-3 gap-6" data-ssr-property-detail="${escapeHtml(listing.id)}">
    <div class="lg:col-span-2">
      ${renderBreadcrumbs(items)}
      <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" class="h-72 w-full object-cover" width="1200" height="675" decoding="async" fetchpriority="high">
        <div class="p-5">
          <h1 class="text-3xl font-bold text-gray-900 serif">${escapeHtml(listing.title)}</h1>
          <p class="mt-2 text-gray-600">${location ? `<a href="${escapeHtml(areaUrl)}" class="font-semibold text-green-700 hover:underline">${escapeHtml(locationLabel)}</a>` : escapeHtml(locationLabel)}</p>
          <p class="mt-4 text-3xl font-black text-green-700">${escapeHtml(priceLabel(listing))}</p>
          <p class="mt-3 text-gray-700">${[
            listing.bedrooms ? `${listing.bedrooms} ${listing.bedrooms === 1 ? 'bedroom' : 'bedrooms'}` : '',
            listing.bathrooms ? `${listing.bathrooms} ${listing.bathrooms === 1 ? 'bathroom' : 'bathrooms'}` : '',
            listing.property_type
          ].filter(Boolean).map(escapeHtml).join(' · ')}</p>
          <section class="mt-6"><h2 class="text-xl font-black text-gray-900">Property description</h2><p class="mt-2 whitespace-pre-line text-gray-700">${escapeHtml(listing.description || `View this property in ${locationLabel} on ${ACTIVE_BRAND}.`)}</p></section>
          ${listing.found_online_notice ? `<section class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900" data-found-online-notice>${escapeHtml(listing.found_online_notice)}</section>` : ''}
        </div>
      </div>
    </div>
  </article>`;
  const description = propertySeoDescription(listing);
  const product = {
    '@type': ['Product', 'RealEstateListing'],
    name: listing.title,
    description,
    url: propertyUrl,
    image,
    category: listing.property_type || config.label,
    address: {
      '@type': 'PostalAddress',
      addressLocality: listing.area || '',
      addressRegion: listing.district || '',
      addressCountry: ACTIVE_COUNTRY_CODE
    },
    ...(listing.price > 0 ? {
      offers: {
        '@type': 'Offer',
        price: listing.price,
        priceCurrency: ACTIVE_CURRENCY,
        url: propertyUrl,
        availability: 'https://schema.org/InStock'
      }
    } : {})
  };
  let rendered = replaceElementInnerHtml(html, 'detail-content', content);
  rendered = insertBeforeClosingTag(rendered, 'footer', renderFooterAreaLinks(popularAreaLinks(options.snapshot, 15)));
  return {
    html: rendered,
    meta: {
      title: propertySeoTitle(listing),
      description,
      canonical: propertyUrl,
      image,
      ogType: 'article'
    },
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [breadcrumbStructuredData(items), product]
    }
  };
}

// The three money-page searches, as plain anchors in the homepage HTML.
// Uganda only: these hub routes exist for the Uganda tenant.
const POPULAR_SEARCHES = Object.freeze([
  { href: '/for-sale', label: 'Houses for Sale in Uganda' },
  { href: '/land', label: 'Land for Sale in Uganda' },
  { href: '/to-rent/kampala-kampala', label: 'Houses for Rent in Kampala' }
]);

function renderPopularSearches() {
  if (String(ACTIVE_COUNTRY_CODE || '').toUpperCase() !== 'UG') return '';
  return `<nav aria-label="Popular searches" class="mb-6 rounded-2xl border border-green-100 bg-green-50 p-4" data-ssr-popular-searches="1">
    <h2 class="font-black text-green-950">Popular searches</h2>
    <div class="mt-3 flex flex-wrap gap-2">${POPULAR_SEARCHES.map((item) => `<a href="${escapeHtml(item.href)}" class="rounded-full border border-green-200 bg-white px-3 py-1.5 text-sm font-semibold text-green-800 hover:bg-green-100">${escapeHtml(item.label)}</a>`).join('')}</div>
  </nav>`;
}

function renderHomepageSeoHtml(html, options = {}) {
  const listings = options.listings || [];
  const areaLinks = popularAreaLinks(options.snapshot, 15);
  const cards = listings.map((listing, index) => renderSeoListingCard(listing, {
    categoryKey: listing.listing_type === 'student' ? 'students' : listing.listing_type,
    baseUrl: options.baseUrl,
    eager: index < 2
  })).join('');
  let rendered = cards ? replaceElementInnerHtml(html, 'home-grid', cards) : html;
  const popularAreas = renderAreaLinks(areaLinks, `Popular property areas in ${ACTIVE_COUNTRY_NAME}`);
  rendered = insertBeforeElement(rendered, 'home-grid', renderPopularSearches() + popularAreas);
  rendered = insertBeforeClosingTag(rendered, 'footer', renderFooterAreaLinks(areaLinks));
  return {
    html: rendered,
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': homepageBrandGraph(options.baseUrl)
    }
  };
}

// Organization + WebSite for the homepage. A tenant with `schemaOrg` config
// (Uganda) gets the full brand entity (name, alternate names, logo, sameAs,
// contactPoint); any other tenant keeps the plain name/url nodes.
function homepageBrandGraph(baseUrl) {
  const home = absoluteUrl('/', baseUrl);
  const config = ACTIVE_TENANT.schemaOrg;
  const organization = {
    '@type': 'Organization',
    name: ACTIVE_BRAND,
    url: home,
    areaServed: { '@type': 'Country', name: ACTIVE_COUNTRY_NAME }
  };
  const website = {
    '@type': 'WebSite',
    name: ACTIVE_BRAND,
    url: home,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${absoluteUrl('/for-sale', baseUrl)}?area={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  };
  if (!config) return [organization, website];
  const organizationId = `${home}#organization`;
  Object.assign(organization, {
    '@id': organizationId,
    name: config.name,
    alternateName: [...config.alternateName],
    logo: absoluteUrl(config.logoPath, baseUrl),
    sameAs: [...config.sameAs],
    areaServed: { '@type': 'Country', name: ACTIVE_COUNTRY_NAME, identifier: ACTIVE_COUNTRY_CODE }
  });
  if (ACTIVE_TENANT.phoneE164) {
    organization.contactPoint = {
      '@type': 'ContactPoint',
      telephone: ACTIVE_TENANT.phoneE164,
      contactType: config.contactPoint.contactType,
      areaServed: config.contactPoint.areaServed,
      availableLanguage: [...config.contactPoint.availableLanguage]
    };
  }
  Object.assign(website, {
    '@id': `${home}#website`,
    name: config.name,
    alternateName: [...config.alternateName],
    publisher: { '@id': organizationId }
  });
  return [organization, website];
}

module.exports = {
  clearSeoListingCache,
  SEO_LISTING_CACHE_TTL_MS,
  SEO_LISTING_CACHE_MAX_ENTRIES,
  CATEGORY_GRID_IDS,
  CATEGORY_PAGE_IDS,
  escapeHtml,
  plainText,
  collapseDuplicatePublicTransaction,
  normalizeSeoListingRow,
  loadPublicSeoListings,
  loadPublicSeoListing,
  priceLabel,
  propertySeoTitle,
  propertySeoDescription,
  areaLinksForCategory,
  popularAreaLinks,
  facetLinksForArea,
  neighborhoodAreaLinks,
  renderAreaLinks,
  renderFooterAreaLinks,
  renderSeoListingCard,
  replaceElementInnerHtml,
  appendElementInnerHtml,
  insertBeforeClosingTag,
  renderCategorySeoHtml,
  renderPropertySeoHtml,
  renderHomepageSeoHtml,
  renderPopularSearches,
  homepageBrandGraph,
  breadcrumbStructuredData,
  __seoListingCache: Object.freeze({
    clear: clearSeoListingCache,
    get: getSeoListingCacheEntry,
    set: setSeoListingCacheEntry,
    size: () => listingCache.size,
    inFlight: (key) => listingCacheInFlight.get(key) || null
  })
};
