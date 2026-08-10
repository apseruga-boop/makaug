'use strict';

const {
  CATEGORY_SEO,
  canonicalLocationRouteSlug,
  canonicalLocationsForSeoRow,
  facetLocationSlug
} = require('./publicSeoService');
const { publicVisibleInventoryWhere } = require('./publicInventoryMetricsService');
const { SEO_FACET_MIN_LISTINGS, FACET_DEFINITIONS, COMMERCIAL_TRANSACTION_FACETS } = require('../utils/publicSeoFacets');
const { canonicalDisplayLocationForRow, canonicalLocationSearchScope } = require('../utils/ugandaLocationRegistry');

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

function absoluteUrl(value = '', baseUrl = 'https://makaug.com') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const root = String(baseUrl || 'https://makaug.com').replace(/\/+$/, '');
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
    listingCache.delete(key);
    return null;
  }
  // Refresh insertion order so the first key remains the least recently used.
  listingCache.delete(key);
  listingCache.set(key, cached);
  return cached;
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

function locationPredicate(location, values, alias = 'p') {
  if (!location) return '';
  const scope = canonicalLocationSearchScope([location.canonical_key], 0);
  const canonicalKeys = scope.exact.map((item) => item.key);
  values.push(canonicalKeys.length ? canonicalKeys : [location.canonical_key]);
  return `AND LOWER(COALESCE(${alias}.extra_fields->>'canonical_location_id', '')) = ANY($${values.length}::text[])`;
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

function normalizeSeoListingRow(row = {}) {
  const foundOnline = ['true', '1', 'yes'].includes(String(row.found_online_candidate || '').toLowerCase());
  const canonicalDisplay = canonicalDisplayLocationForRow(row);
  return {
    id: String(row.id || ''),
    listing_type: String(row.listing_type || ''),
    title: collapseDuplicatePublicTransaction(row.title) || 'Uganda property',
    description: plainText(row.description),
    area: plainText(canonicalDisplay.area),
    district: plainText(canonicalDisplay.district),
    price: Number(row.price || 0) || 0,
    price_period: plainText(row.price_period),
    transaction_type: plainText(row.transaction_type),
    bedrooms: Number(row.bedrooms || 0) || 0,
    bathrooms: Number(row.bathrooms || 0) || 0,
    property_type: plainText(row.property_type),
    primary_image_url: foundOnline ? '' : String(row.primary_image_url || '').trim(),
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
  const cacheKey = `${key || 'all'}:${location?.canonical_key || 'uganda'}:${facetCacheKey}:${limit}`;
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
       p.created_at, p.updated_at, COUNT(*) OVER() AS seo_total,
       image.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT i.url
       FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) image ON TRUE
     WHERE ${publicVisibleInventoryWhere('p')}
       AND ${categoryWhere}
       ${locationWhere}
       ${facetWhere}
     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
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
       p.created_at, p.updated_at,
       image.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT i.url
       FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) image ON TRUE
     WHERE p.id::text = $1
       AND ${publicVisibleInventoryWhere('p')}
       LIMIT 1`,
      [safeId]
    );
    return { row: result.rows[0] ? normalizeSeoListingRow(result.rows[0]) : null };
  });
  return cached.row;
}

function priceLabel(listing = {}) {
  if (!(Number(listing.price) > 0)) return 'Price on application';
  const amount = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Number(listing.price));
  const period = String(listing.price_period || '').trim().toLowerCase();
  const suffix = period && !['once', 'sale'].includes(period) ? `/${period}` : '';
  return `USh ${amount}${suffix}`;
}

function propertySeoTitle(listing = {}) {
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
  const price = Number(listing.price || 0) > 0 ? ` — ${priceLabel(listing)}` : '';
  return `${bedrooms}${type}${intent}${location ? ` in ${location}` : ''}${price} | makaug.com`;
}

function propertySeoDescription(listing = {}) {
  const description = plainText(listing.description);
  const sentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || description.slice(0, 220).trim();
  if (sentence) return sentence.slice(0, 300);
  return `${[listing.area, listing.district].filter(Boolean).join(', ')} - ${priceLabel(listing)}. View this Uganda property on makaug.com.`;
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
      <img src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" class="w-full h-full object-cover" loading="${options.eager ? 'eager' : 'lazy'}">
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
  if (!meta.location) return `${subject} in Uganda`;
  const place = meta.location.level === 'district'
    ? meta.location.district
    : `${meta.location.location}, ${meta.location.district}`;
  return `${subject} in ${place}`;
}

function areaLinksForCategory(snapshot, categoryKey, currentLocation = null, limit = 12) {
  const counts = snapshot?.counts?.[categoryKey] || new Map();
  const config = CATEGORY_SEO[categoryKey];
  if (!config) return [];
  const { canonicalLocationOptions } = require('../utils/ugandaLocationRegistry');
  return canonicalLocationOptions()
    .map((location) => ({ ...location, count: Number(counts.get(location.canonical_key) || 0) }))
    .filter((location) => location.count >= SEO_FACET_MIN_LISTINGS && location.canonical_key !== currentLocation?.canonical_key)
    .sort((left, right) => {
      const leftNeighbor = currentLocation && left.district === currentLocation.district ? 1 : 0;
      const rightNeighbor = currentLocation && right.district === currentLocation.district ? 1 : 0;
      return rightNeighbor - leftNeighbor || right.count - left.count || left.location.localeCompare(right.location);
    })
    .slice(0, Math.max(0, limit))
    .map((location) => ({
      href: `${config.route}/${canonicalLocationRouteSlug(location)}`,
      label: location.level === 'district' ? location.district : `${location.location}, ${location.district}`,
      count: location.count
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
  return Object.keys(CATEGORY_SEO)
    .flatMap((categoryKey) => areaLinksForCategory(snapshot, categoryKey, null, limit).map((link) => ({ ...link, categoryKey })))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, Math.max(0, limit));
}

function renderAreaLinks(links = [], heading = 'Popular property areas') {
  if (!links.length) return '';
  return `<nav aria-label="${escapeHtml(heading)}" class="mb-6 rounded-2xl border border-green-100 bg-green-50 p-4" data-ssr-area-links="1">
    <h2 class="font-black text-green-950">${escapeHtml(heading)}</h2>
    <div class="mt-3 flex flex-wrap gap-2">${links.map((link) => `<a href="${escapeHtml(link.href)}" class="rounded-full border border-green-200 bg-white px-3 py-1.5 text-sm font-semibold text-green-800 hover:bg-green-100">${escapeHtml(link.label)} <span aria-label="${link.count} listings">(${link.count})</span></a>`).join('')}</div>
  </nav>`;
}

function renderFooterAreaLinks(links = []) {
  if (!links.length) return '';
  return `<section class="max-w-7xl mx-auto px-4 pb-6" data-ssr-footer-area-links="1"><h2 class="font-black text-white">Popular property areas</h2><div class="mt-3 flex flex-wrap gap-3">${links.map((link) => `<a href="${escapeHtml(link.href)}" class="text-sm text-green-100 hover:text-white hover:underline">${escapeHtml(link.label)}</a>`).join('')}</div></section>`;
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
  const intro = `${renderRouteState(meta.routeState)}${renderBreadcrumbs(items)}<p class="mb-4 text-gray-700" data-ssr-category-summary="1">${escapeHtml(meta.description)}</p>${renderAreaLinks(facetLinks, 'Refine this area')}${renderAreaLinks(areaLinks, meta.location ? 'Nearby and popular areas' : 'Popular areas')}`;
  const cards = listings.length
    ? listings.map((listing, index) => renderSeoListingCard(listing, { categoryKey: meta.key, baseUrl: options.baseUrl, eager: index < 2 })).join('')
    : `<div class="col-span-full rounded-2xl border border-gray-200 bg-gray-50 p-5"><h2 class="font-black">No live listings in this exact area yet</h2><p class="mt-2 text-sm text-gray-600">Browse nearby areas or return to ${escapeHtml(meta.config.label)} across Uganda.</p></div>`;
  let rendered = replacePageH1(html, pageId, h1);
  rendered = replaceElementInnerHtml(rendered, gridId, cards);
  rendered = insertBeforeElement(rendered, gridId, intro);
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
          isPartOf: { '@type': 'WebSite', name: 'makaug.com', url: absoluteUrl('/', options.baseUrl) }
        },
        breadcrumbStructuredData(items),
        itemList
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
        <img src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" class="h-72 w-full object-cover" fetchpriority="high">
        <div class="p-5">
          <h1 class="text-3xl font-bold text-gray-900 serif">${escapeHtml(listing.title)}</h1>
          <p class="mt-2 text-gray-600">${location ? `<a href="${escapeHtml(areaUrl)}" class="font-semibold text-green-700 hover:underline">${escapeHtml(locationLabel)}</a>` : escapeHtml(locationLabel)}</p>
          <p class="mt-4 text-3xl font-black text-green-700">${escapeHtml(priceLabel(listing))}</p>
          <p class="mt-3 text-gray-700">${[
            listing.bedrooms ? `${listing.bedrooms} ${listing.bedrooms === 1 ? 'bedroom' : 'bedrooms'}` : '',
            listing.bathrooms ? `${listing.bathrooms} ${listing.bathrooms === 1 ? 'bathroom' : 'bathrooms'}` : '',
            listing.property_type
          ].filter(Boolean).map(escapeHtml).join(' · ')}</p>
          <section class="mt-6"><h2 class="text-xl font-black text-gray-900">Property description</h2><p class="mt-2 whitespace-pre-line text-gray-700">${escapeHtml(listing.description || `View this property in ${locationLabel} on makaug.com.`)}</p></section>
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
      addressCountry: 'UG'
    },
    ...(listing.price > 0 ? {
      offers: {
        '@type': 'Offer',
        price: listing.price,
        priceCurrency: 'UGX',
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

function renderHomepageSeoHtml(html, options = {}) {
  const listings = options.listings || [];
  const areaLinks = popularAreaLinks(options.snapshot, 15);
  const cards = listings.map((listing, index) => renderSeoListingCard(listing, {
    categoryKey: listing.listing_type === 'student' ? 'students' : listing.listing_type,
    baseUrl: options.baseUrl,
    eager: index < 2
  })).join('');
  let rendered = cards ? replaceElementInnerHtml(html, 'home-grid', cards) : html;
  const popularAreas = renderAreaLinks(areaLinks, 'Popular property areas in Uganda');
  rendered = insertBeforeElement(rendered, 'home-grid', popularAreas);
  rendered = insertBeforeClosingTag(rendered, 'footer', renderFooterAreaLinks(areaLinks));
  return {
    html: rendered,
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: 'makaug.com',
          url: absoluteUrl('/', options.baseUrl),
          areaServed: { '@type': 'Country', name: 'Uganda' }
        },
        {
          '@type': 'WebSite',
          name: 'makaug.com',
          url: absoluteUrl('/', options.baseUrl),
          potentialAction: {
            '@type': 'SearchAction',
            target: `${absoluteUrl('/for-sale', options.baseUrl)}?area={search_term_string}`,
            'query-input': 'required name=search_term_string'
          }
        }
      ]
    }
  };
}

module.exports = {
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
  renderFooterAreaLinks,
  renderSeoListingCard,
  replaceElementInnerHtml,
  appendElementInnerHtml,
  insertBeforeClosingTag,
  renderCategorySeoHtml,
  renderPropertySeoHtml,
  renderHomepageSeoHtml,
  breadcrumbStructuredData,
  __seoListingCache: Object.freeze({
    clear: clearSeoListingCache,
    get: getSeoListingCacheEntry,
    set: setSeoListingCacheEntry,
    size: () => listingCache.size
  })
};
