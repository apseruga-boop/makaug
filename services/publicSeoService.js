const {
  canonicalizeUgandaLocation,
  canonicalLocationByKey,
  canonicalLocationOptions,
  canonicalLocationRollupCounts
} = require('../utils/ugandaLocationRegistry');
const { publicVisibleInventoryWhere } = require('./publicInventoryMetricsService');

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

function canonicalLocationsForSeoRow(row = {}) {
  const locations = [
    canonicalLocationByKey(row.canonical_location_id),
    canonicalizeUgandaLocation(row.area, row.district),
    canonicalizeUgandaLocation(row.city, row.district),
    canonicalizeUgandaLocation(row.neighborhood, row.district)
  ].filter(Boolean);
  return Array.from(new Map(locations.map((location) => [location.key, location])).values());
}

function buildPublicSeoSnapshot(rows = [], generatedAt = new Date().toISOString()) {
  const directCounts = emptyCounts();
  const properties = [];
  for (const row of rows) {
    const categories = publicCategoryKeysForRow(row);
    if (!categories.length) continue;
    for (const canonical of canonicalLocationsForSeoRow(row)) {
      for (const category of categories) {
        directCounts[category].set(canonical.key, Number(directCounts[category].get(canonical.key) || 0) + 1);
      }
    }
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
  return { counts, properties, generatedAt };
}

async function loadPublicSeoInventorySnapshot(db, options = {}) {
  const now = Date.now();
  if (!options.force && snapshotCache && now - snapshotCache.cachedAt < PUBLIC_SEO_CACHE_TTL_MS) {
    return snapshotCache.value;
  }
  try {
    const result = await db.query(
      `SELECT id, listing_type, students_welcome, area, district,
              extra_fields->>'canonical_location_id' AS canonical_location_id,
              extra_fields->>'city' AS city,
              extra_fields->>'neighborhood' AS neighborhood,
              updated_at, created_at
     FROM properties
     WHERE ${publicVisibleInventoryWhere('properties')}
       ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC`
    );
    const value = buildPublicSeoSnapshot(result.rows);
    snapshotCache = { cachedAt: now, value };
    return value;
  } catch (error) {
    if (snapshotCache?.value) return snapshotCache.value;
    throw error;
  }
}

function categoryPageSeoMeta(pathname = '/', snapshot = null, baseUrl = PUBLIC_SITE_URL) {
  const matched = categoryForPath(pathname);
  if (!matched) return null;
  const [key, config] = matched;
  const cleanPath = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const slug = cleanPath === config.route ? '' : cleanPath.slice(config.route.length + 1);
  const location = locationForRouteSlug(slug);
  const count = location ? Number(snapshot?.counts?.[key]?.get(location.canonical_key) || 0) : null;
  const locationLabel = location ? `${location.location}, ${location.district}` : 'Uganda';
  const countPrefix = Number.isFinite(count) && count > 0 ? `${count} ` : '';
  const title = location
    ? `${config.subject} in ${locationLabel}${count > 0 ? ` (${count})` : ''} | makaug.com`
    : config.title;
  const description = location
    ? `Browse ${countPrefix}${config.subject.toLowerCase()} in ${locationLabel}. Compare real Uganda listings, prices, photos and source information on makaug.com.`
    : `Browse ${config.subject.toLowerCase()} across Uganda. Compare real listings, prices, photos and source information on makaug.com.`;
  return {
    key,
    config,
    location,
    count,
    title,
    description,
    canonical: `${String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '')}${location ? `${config.route}/${canonicalLocationRouteSlug(location)}` : config.route}`,
    image: `${String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '')}${config.image}`
  };
}

function sitemapEntries(snapshot = {}, baseUrl = PUBLIC_SITE_URL) {
  const root = String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '');
  const entries = [
    { loc: `${root}/`, changefreq: 'daily', priority: '1.0' },
    ...Object.values(CATEGORY_SEO).map((config) => ({ loc: `${root}${config.route}`, changefreq: 'hourly', priority: '0.9' })),
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
      if (count <= 0) continue;
      entries.push({
        loc: `${root}${config.route}/${canonicalLocationRouteSlug(location)}`,
        changefreq: 'daily',
        priority: location.level === 'district' ? '0.8' : '0.7'
      });
    }
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
  categoryForPath,
  locationForRouteSlug,
  publicCategoryKeysForRow,
  canonicalLocationsForSeoRow,
  buildPublicSeoSnapshot,
  loadPublicSeoInventorySnapshot,
  categoryPageSeoMeta,
  sitemapEntries
};
