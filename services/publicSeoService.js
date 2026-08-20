const {
  canonicalizeUgandaLocation,
  canonicalLocationByKey,
  canonicalLocationOptions,
  canonicalLocationRollupCounts,
  canonicalLocationSearchScope
} = require('../utils/locationRegistry');
const { publicVisibleInventoryWhere } = require('./publicInventoryMetricsService');
const {
  SEO_FACET_MIN_LISTINGS,
  FACET_DEFINITIONS,
  facetSlugsForRow,
  commercialTransactionSlugsForRow,
  universityLandingForRow
} = require('../utils/publicSeoFacets');

const PUBLIC_SITE_URL = 'https://makaug.com';
const PUBLIC_SEO_CACHE_TTL_MS = 5 * 60 * 1000;

const CATEGORY_SEO = Object.freeze({
  sale: {
    route: '/for-sale',
    listingType: 'sale',
    label: 'For Sale',
    subject: 'Houses and property for sale',
    title: 'Houses and Property for Sale in Uganda | makaug.com',
    image: '/assets/house-ads-v3/sale.webp'
  },
  rent: {
    route: '/to-rent',
    listingType: 'rent',
    label: 'To Rent',
    subject: 'Houses and property to rent',
    title: 'Houses and Property to Rent in Uganda | makaug.com',
    image: '/assets/house-ads-v3/rent.webp'
  },
  land: {
    route: '/land',
    listingType: 'land',
    label: 'Land',
    subject: 'Land for sale',
    title: 'Land for Sale in Uganda | makaug.com',
    image: '/assets/house-ads-v3/land.webp'
  },
  commercial: {
    route: '/commercial',
    listingType: 'commercial',
    label: 'Commercial',
    subject: 'Commercial property',
    title: 'Commercial Property in Uganda | makaug.com',
    image: '/assets/house-ads-v3/commercial.webp'
  },
  students: {
    route: '/student-accommodation',
    listingType: 'students',
    label: 'Student Accommodation',
    subject: 'Student accommodation',
    title: 'Student Accommodation in Uganda | makaug.com',
    image: '/assets/house-ads-v3/students.webp'
  }
});

let snapshotCache = null;
let snapshotCacheInFlight = null;

function clearPublicSeoSnapshotCache() {
  snapshotCache = null;
  snapshotCacheInFlight = null;
}

function slugifySeoPart(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function canonicalLocationRouteSlug(location = {}) {
  const area = slugifySeoPart(location.location || location.name || '');
  const district = slugifySeoPart(location.district || '');
  return [area, district].filter(Boolean).join('-');
}

function categoryForPath(pathname = '') {
  const cleanPath = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  return Object.entries(CATEGORY_SEO).find(([, config]) => (
    cleanPath === config.route || cleanPath.startsWith(`${config.route}/`)
  )) || null;
}

function locationForRouteSlug(slug = '') {
  const normalized = slugifySeoPart(slug);
  if (!normalized) return null;
  return canonicalLocationOptions().find((location) => canonicalLocationRouteSlug(location) === normalized) || null;
}

function publicCategoryKeysForRow(row = {}) {
  const type = String(row.listing_type || '').trim().toLowerCase();
  const keys = [];
  if (type === 'sale') keys.push('sale');
  if (type === 'rent') keys.push('rent');
  if (type === 'land') keys.push('land');
  if (type === 'commercial') keys.push('commercial');
  if (type === 'student' || type === 'students' || (type === 'rent' && row.students_welcome === true)) keys.push('students');
  return keys;
}

function emptyCounts() {
  return Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, new Map()]));
}

function incrementMapCount(map, key) {
  map.set(key, Number(map.get(key) || 0) + 1);
}

function setMinimumPrice(map, key, value) {
  const price = Number(value || 0);
  if (!(price > 0)) return;
  const current = Number(map.get(key) || 0);
  if (!(current > 0) || price < current) map.set(key, price);
}

function rollupLocationMinimumPrices(values = new Map()) {
  const direct = values instanceof Map ? values : new Map(Object.entries(values || {}));
  const rolled = new Map(direct);
  for (const location of canonicalLocationOptions()) {
    if (!['city', 'district'].includes(location.level)) continue;
    const scope = canonicalLocationSearchScope([location.canonical_key], 0);
    const prices = scope.exact.map((child) => Number(direct.get(child.key) || 0)).filter((price) => price > 0);
    if (prices.length) rolled.set(location.canonical_key, Math.min(...prices));
  }
  return rolled;
}

function rollupFacetCountMap(values = new Map(), facetSlugs = []) {
  const rolled = new Map();
  for (const facetSlug of facetSlugs) {
    const direct = new Map();
    for (const [compositeKey, count] of values) {
      const separator = compositeKey.lastIndexOf('|');
      if (separator === -1 || compositeKey.slice(separator + 1) !== facetSlug) continue;
      direct.set(compositeKey.slice(0, separator), Number(count || 0));
    }
    for (const [locationKey, count] of canonicalLocationRollupCounts(direct)) {
      rolled.set(`${locationKey}|${facetSlug}`, count);
    }
  }
  return rolled;
}

function facetLocationSlug(location = {}) {
  if (location.level === 'district') return slugifySeoPart(location.district || location.location || location.name);
  return canonicalLocationRouteSlug(location);
}

function canonicalLocationsForSeoRow(row = {}) {
  const canonical = canonicalLocationByKey(row.canonical_location_id || row?.extra_fields?.canonical_location_id)
    || canonicalizeUgandaLocation('', row.district);
  return canonical ? [canonical] : [];
}

function buildPublicSeoSnapshot(rows = [], generatedAt = new Date().toISOString()) {
  const directCounts = emptyCounts();
  const directPriceFloors = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, new Map()]));
  const categoryTotals = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, 0]));
  const categoryPriceFloors = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, 0]));
  const facetCounts = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, new Map()]));
  const commercialTransactionCounts = new Map();
  const universityCounts = new Map();
  const properties = [];
  if (!rows.length) {
    return {
      directCounts,
      counts: emptyCounts(),
      categoryTotals,
      categoryPriceFloors,
      locationPriceFloors: directPriceFloors,
      facetCounts,
      commercialTransactionCounts,
      universityCounts,
      properties,
      generatedAt
    };
  }
  for (const row of rows) {
    const categories = publicCategoryKeysForRow(row);
    if (!categories.length) continue;
    const locations = canonicalLocationsForSeoRow(row);
    for (const category of categories) {
      categoryTotals[category] += 1;
      const price = Number(row.price || 0);
      if (price > 0 && (!(categoryPriceFloors[category] > 0) || price < categoryPriceFloors[category])) {
        categoryPriceFloors[category] = price;
      }
    }
    for (const canonical of locations) {
      for (const category of categories) {
        directCounts[category].set(canonical.key, Number(directCounts[category].get(canonical.key) || 0) + 1);
        setMinimumPrice(directPriceFloors[category], canonical.key, row.price);
        for (const facetSlug of facetSlugsForRow(category, row)) {
          incrementMapCount(facetCounts[category], `${canonical.key}|${facetSlug}`);
        }
        if (category === 'commercial') {
          for (const transactionSlug of commercialTransactionSlugsForRow(row)) {
            incrementMapCount(commercialTransactionCounts, `${canonical.key}|${transactionSlug}`);
          }
        }
      }
    }
    const university = categories.includes('students') ? universityLandingForRow(row) : null;
    if (university) incrementMapCount(universityCounts, university.slug);
    if (row.id) {
      properties.push({
        id: String(row.id),
        lastmod: row.updated_at || row.created_at || null
      });
    }
  }
  const counts = Object.fromEntries(
    Object.entries(directCounts).map(([key, values]) => [key, canonicalLocationRollupCounts(values)])
  );
  const locationPriceFloors = Object.fromEntries(
    Object.entries(directPriceFloors).map(([key, values]) => [key, rollupLocationMinimumPrices(values)])
  );
  const rolledFacetCounts = Object.fromEntries(
    Object.entries(facetCounts).map(([key, values]) => [key, rollupFacetCountMap(values, Object.keys(FACET_DEFINITIONS[key] || {}))])
  );
  const rolledCommercialTransactionCounts = rollupFacetCountMap(commercialTransactionCounts, ['for-rent', 'for-sale']);
  return {
    directCounts,
    counts,
    categoryTotals,
    categoryPriceFloors,
    locationPriceFloors,
    facetCounts: rolledFacetCounts,
    commercialTransactionCounts: rolledCommercialTransactionCounts,
    universityCounts,
    properties,
    generatedAt
  };
}

async function refreshPublicSeoInventorySnapshot(db) {
  const result = await db.query(
    `SELECT id, listing_type, students_welcome, area, district,
            title, description, price, price_period, bedrooms, property_type,
            transaction_type, title_type, nearest_university,
            jsonb_strip_nulls(jsonb_build_object(
              'room_type', extra_fields->>'room_type',
              'commercial_type', extra_fields->>'commercial_type',
              'title_type', extra_fields->>'title_type',
              'transaction_type', extra_fields->>'transaction_type',
              'nearest_university', extra_fields->>'nearest_university',
              'student_university', extra_fields->>'student_university',
              'student_campus', extra_fields->>'student_campus'
            )) AS extra_fields,
            extra_fields->>'canonical_location_id' AS canonical_location_id,
            extra_fields->>'city' AS city,
            extra_fields->>'neighborhood' AS neighborhood,
            updated_at, created_at
     FROM properties
     WHERE ${publicVisibleInventoryWhere('properties')}
     ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC`
  );
  const value = buildPublicSeoSnapshot(result.rows);
  snapshotCache = { cachedAt: Date.now(), value };
  return value;
}

async function loadPublicSeoInventorySnapshot(db, options = {}) {
  const now = Date.now();
  if (!options.force && snapshotCache && now - snapshotCache.cachedAt < PUBLIC_SEO_CACHE_TTL_MS) {
    return snapshotCache.value;
  }

  // Once a valid snapshot exists, never make a visitor wait for the full
  // inventory scan. Refresh it in the background and serve the last-known-good
  // value immediately. Initial startup still awaits the first snapshot.
  if (!options.force && snapshotCache?.value) {
    if (!snapshotCacheInFlight) {
      const staleRefresh = refreshPublicSeoInventorySnapshot(db);
      snapshotCacheInFlight = staleRefresh;
      staleRefresh
        .catch(() => null)
        .finally(() => {
          if (snapshotCacheInFlight === staleRefresh) snapshotCacheInFlight = null;
        });
    }
    return snapshotCache.value;
  }

  if (!options.force && snapshotCacheInFlight) return snapshotCacheInFlight;

  const pending = refreshPublicSeoInventorySnapshot(db);

  if (!options.force) snapshotCacheInFlight = pending;
  try {
    return await pending;
  } catch (error) {
    if (snapshotCache?.value) return snapshotCache.value;
    throw error;
  } finally {
    if (snapshotCacheInFlight === pending) snapshotCacheInFlight = null;
  }
}

function categoryPageSeoMeta(pathname = '/', snapshot = null, baseUrl = PUBLIC_SITE_URL) {
  const matched = categoryForPath(pathname);
  if (!matched) return null;
  const [key, config] = matched;
  const cleanPath = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const slug = cleanPath === config.route ? '' : cleanPath.slice(config.route.length + 1);
  const location = locationForRouteSlug(slug);
  const locationCounts = location?.level === 'district'
    ? snapshot?.counts?.[key]
    : (snapshot?.directCounts?.[key] || snapshot?.counts?.[key]);
  const count = location ? Number(locationCounts?.get(location.canonical_key) || 0) : null;
  const total = Number(snapshot?.categoryTotals?.[key]);
  const listingCount = location ? count : (Number.isFinite(total) ? total : null);
  const priceFloor = location
    ? Number(snapshot?.locationPriceFloors?.[key]?.get(location.canonical_key) || 0)
    : Number(snapshot?.categoryPriceFloors?.[key] || 0);
  const locationLabel = location ? `${location.location}, ${location.district}` : 'Uganda';
  const countPrefix = Number.isFinite(listingCount) && listingCount > 0 ? `${listingCount} ` : '';
  const freshnessDate = new Date(snapshot?.generatedAt || '');
  const freshness = Number.isNaN(freshnessDate.getTime())
    ? ''
    : new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(freshnessDate);
  const listingLabel = Number.isFinite(listingCount) ? `${listingCount} ${listingCount === 1 ? 'Listing' : 'Listings'}` : '';
  const title = location
    ? `${config.subject} in ${locationLabel}${listingLabel ? ` — ${listingLabel}` : ''} | makaug.com`
    : (listingLabel && freshness ? `${config.subject} in Uganda — ${listingLabel}, ${freshness} | makaug.com` : config.title);
  const floorCopy = priceFloor > 0
    ? ` Prices start from USh ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(priceFloor)}.`
    : '';
  const description = `Browse ${countPrefix}${config.subject.toLowerCase()} ${location ? `in ${locationLabel}` : 'across Uganda'}.${floorCopy} Compare reviewed listings, photos, maps and source information on makaug.com.`;
  return {
    key,
    config,
    location,
    count,
    total: listingCount,
    priceFloor,
    title,
    description,
    canonical: `${String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '')}${location ? `${config.route}/${canonicalLocationRouteSlug(location)}` : config.route}`,
    image: `${String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '')}${config.image}`
  };
}

function sitemapEntries(snapshot = {}, baseUrl = PUBLIC_SITE_URL) {
  const root = String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '');
  const generatedDate = new Date(snapshot?.generatedAt || '');
  const inventoryLastmod = Number.isNaN(generatedDate.getTime()) ? '' : generatedDate.toISOString();
  const entries = [
    { loc: `${root}/`, changefreq: 'daily', priority: '1.0' },
    ...Object.values(CATEGORY_SEO).map((config) => ({ loc: `${root}${config.route}`, lastmod: inventoryLastmod, changefreq: 'hourly', priority: '0.9' })),
    { loc: `${root}/marketplace`, changefreq: 'daily', priority: '0.8' },
    { loc: `${root}/valuation`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${root}/mortgage`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${root}/brokers`, changefreq: 'daily', priority: '0.7' },
    { loc: `${root}/list-property`, changefreq: 'weekly', priority: '0.7' }
  ];
  for (const [key, config] of Object.entries(CATEGORY_SEO)) {
    const counts = snapshot?.counts?.[key] || new Map();
    for (const location of canonicalLocationOptions()) {
      const count = Number(counts.get(location.canonical_key) || 0);
      if (count < SEO_FACET_MIN_LISTINGS) continue;
      entries.push({
        loc: `${root}${config.route}/${canonicalLocationRouteSlug(location)}`,
        lastmod: inventoryLastmod,
        changefreq: 'daily',
        priority: location.level === 'district' ? '0.8' : '0.7'
      });
    }
  }
  for (const [key, config] of Object.entries(CATEGORY_SEO)) {
    const counts = snapshot?.facetCounts?.[key] || new Map();
    for (const location of canonicalLocationOptions()) {
      const locationSlug = facetLocationSlug(location);
      for (const facetSlug of Object.keys(FACET_DEFINITIONS[key] || {})) {
        const count = Number(counts.get(`${location.canonical_key}|${facetSlug}`) || 0);
        if (count < SEO_FACET_MIN_LISTINGS) continue;
        entries.push({
          loc: `${root}${config.route}/${locationSlug}/${facetSlug}`,
          lastmod: inventoryLastmod,
          changefreq: 'daily',
          priority: '0.7'
        });
      }
    }
  }
  for (const location of canonicalLocationOptions()) {
    for (const transactionSlug of ['for-rent', 'for-sale']) {
      const count = Number(snapshot?.commercialTransactionCounts?.get(`${location.canonical_key}|${transactionSlug}`) || 0);
      if (count < SEO_FACET_MIN_LISTINGS) continue;
      entries.push({
        loc: `${root}/commercial/${transactionSlug}/${facetLocationSlug(location)}`,
        lastmod: inventoryLastmod,
        changefreq: 'daily',
        priority: '0.8'
      });
    }
  }
  for (const [universitySlug, countValue] of snapshot?.universityCounts || new Map()) {
    if (Number(countValue || 0) < SEO_FACET_MIN_LISTINGS) continue;
    entries.push({
      loc: `${root}/student-accommodation/university/${universitySlug}`,
      lastmod: inventoryLastmod,
      changefreq: 'daily',
      priority: '0.8'
    });
  }
  for (const property of snapshot?.properties || []) {
    entries.push({
      loc: `${root}/property/${encodeURIComponent(property.id)}`,
      lastmod: property.lastmod ? new Date(property.lastmod).toISOString() : '',
      changefreq: 'weekly',
      priority: '0.6'
    });
  }
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
}

module.exports = {
  CATEGORY_SEO,
  PUBLIC_SEO_CACHE_TTL_MS,
  slugifySeoPart,
  canonicalLocationRouteSlug,
  facetLocationSlug,
  categoryForPath,
  locationForRouteSlug,
  publicCategoryKeysForRow,
  canonicalLocationsForSeoRow,
  buildPublicSeoSnapshot,
  loadPublicSeoInventorySnapshot,
  categoryPageSeoMeta,
  sitemapEntries,
  __seoSnapshotCache: Object.freeze({
    clear: clearPublicSeoSnapshotCache,
    hasValue: () => Boolean(snapshotCache?.value),
    inFlight: () => Boolean(snapshotCacheInFlight)
  })
};
