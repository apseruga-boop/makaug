'use strict';

const crypto = require('crypto');

const { UG_REGION_DISTRICTS, districtForKnownArea, normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');

const MARKETPLACE_P1_MARKER = 'marketplace-p1-20260719';
const MARKETPLACE_REPORT_FIXES_MARKER = 'marketplace-report-fixes-20260719';
const MARKETPLACE_ENRICH_MARKER = 'marketplace-enrich-20260719';
const MARKETPLACE_REGJOURNEY_MARKER = 'marketplace-regjourney-20260719';
const MARKETPLACE_DIRECTORY_REDESIGN_MARKER = 'marketplace-directory-redesign-20261025';
const MARKETPLACE_STATS_TTL_MS = Math.max(15000, Number(process.env.MARKETPLACE_STATS_TTL_MS || 60000));
const MARKETPLACE_SEARCH_TTL_MS = Math.max(5000, Number(process.env.MARKETPLACE_SEARCH_TTL_MS || 30000));
const MARKETPLACE_SEARCH_CACHE_MAX = Math.max(25, Number(process.env.MARKETPLACE_SEARCH_CACHE_MAX || 200));

const MARKETPLACE_CATEGORIES = Object.freeze([
  { key: 'surveyors', label: 'Surveyors', icon: 'fa-ruler-combined', terms: ['surveyor', 'surveying', 'boundary'] },
  { key: 'brokers', label: 'Brokers & agents', icon: 'fa-user-tie', terms: ['broker', 'agent', 'real estate agent'] },
  { key: 'developers', label: 'Property developers', icon: 'fa-building', terms: ['developer', 'development'] },
  { key: 'property_lawyers', label: 'Property lawyers', icon: 'fa-scale-balanced', terms: ['lawyer', 'advocate', 'legal', 'conveyancing'] },
  { key: 'valuers', label: 'Valuers', icon: 'fa-chart-line', terms: ['valuer', 'valuation'] },
  { key: 'mortgage_providers', label: 'Mortgage providers', icon: 'fa-landmark', terms: ['mortgage', 'home loan', 'lender'] },
  { key: 'architects', label: 'Architects', icon: 'fa-compass-drafting', terms: ['architect', 'architecture'] },
  { key: 'builders', label: 'Builders & contractors', icon: 'fa-person-digging', terms: ['builder', 'contractor', 'construction'] },
  { key: 'electricians', label: 'Electricians', icon: 'fa-bolt', terms: ['electrician', 'electrical'] },
  { key: 'plumbers', label: 'Plumbers', icon: 'fa-faucet-drip', terms: ['plumber', 'plumbing'] },
  { key: 'painters', label: 'Painters', icon: 'fa-paint-roller', terms: ['painter', 'painting'] },
  { key: 'property_managers', label: 'Property managers', icon: 'fa-clipboard-check', terms: ['property manager', 'property management', 'facility manager'] },
  { key: 'insurance', label: 'Property insurance', icon: 'fa-shield-halved', terms: ['insurance', 'insurer'] },
  { key: 'movers', label: 'Movers', icon: 'fa-truck-moving', terms: ['mover', 'moving', 'relocation'] },
  { key: 'interior_design', label: 'Interior design', icon: 'fa-couch', terms: ['interior', 'decor'] },
  { key: 'borehole_water', label: 'Borehole & water', icon: 'fa-droplet', terms: ['borehole', 'water', 'drilling'] },
  { key: 'solar', label: 'Solar installers', icon: 'fa-solar-panel', terms: ['solar', 'inverter'] },
  { key: 'security', label: 'Security services', icon: 'fa-user-shield', terms: ['security', 'cctv', 'guard'] },
  { key: 'cleaning', label: 'Cleaning services', icon: 'fa-broom', terms: ['cleaner', 'cleaning'] },
  { key: 'loans_microfinance', label: 'Loans & microfinance', icon: 'fa-hand-holding-dollar', terms: ['microfinance', 'loan', 'sacco', 'credit'], sourcing: false },
  { key: 'commercial_services', label: 'Commercial property services', icon: 'fa-briefcase', terms: ['commercial property', 'office service', 'industrial service'] }
]);

// "What do you need help with?" panel. Every category belongs to exactly one group.
const MARKETPLACE_CATEGORY_GROUPS = Object.freeze([
  { key: 'buy_sell_legal', label: 'Buy, sell & legal', icon: 'fa-file-signature', categories: Object.freeze(['brokers', 'property_lawyers', 'surveyors', 'valuers', 'mortgage_providers', 'loans_microfinance']) },
  { key: 'build_design', label: 'Build & design', icon: 'fa-trowel-bricks', categories: Object.freeze(['builders', 'architects', 'developers', 'interior_design', 'painters']) },
  { key: 'power_water_security', label: 'Power, water & security', icon: 'fa-bolt', categories: Object.freeze(['electricians', 'solar', 'plumbers', 'borehole_water', 'security']) },
  { key: 'manage_move_insure', label: 'Manage, move & insure', icon: 'fa-key', categories: Object.freeze(['property_managers', 'insurance', 'movers', 'cleaning', 'commercial_services']) }
].map((group) => Object.freeze(group)));

// Default directory order: after tier and rating, take the best-filled business
// from each category in this order, then the second of each, and so on. This
// keeps core property services first instead of whichever category was
// refreshed last.
const MARKETPLACE_CORE_ORDER = Object.freeze([
  'brokers', 'property_lawyers', 'surveyors', 'builders', 'valuers', 'architects', 'developers',
  'mortgage_providers', 'property_managers', 'electricians', 'solar', 'plumbers', 'interior_design',
  'insurance', 'borehole_water', 'painters', 'security', 'movers', 'cleaning', 'loans_microfinance',
  'commercial_services'
]);

const DISTRICTS = Object.freeze([...new Set(Object.values(UG_REGION_DISTRICTS).flat())].sort((a, b) => a.localeCompare(b)));
const CATEGORY_KEYS = new Set(MARKETPLACE_CATEGORIES.map((item) => item.key));
const GROUP_KEYS = new Set(MARKETPLACE_CATEGORY_GROUPS.map((group) => group.key));
const COMPETITOR_PORTAL_TOKENS = Object.freeze([
  'property24', 'lamudi', 'realtor.ug', 'realmuloodi', 'jiji', 'jumia house', 'buyrentkenya', 'privateproperty'
]);

let statsCache = { expiresAt: 0, data: null };
const searchCache = new Map();

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(value = '') {
  const raw = clean(value).replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(raw)) return `+256${raw.slice(1)}`;
  if (/^256\d{9}$/.test(raw)) return `+${raw}`;
  return raw;
}

function normalizeCategory(value = '') {
  const key = clean(value).toLowerCase().replace(/[\s/&-]+/g, '_').replace(/_+/g, '_');
  return CATEGORY_KEYS.has(key) ? key : '';
}

function normalizeCategoryGroup(value = '') {
  const key = clean(value).toLowerCase().replace(/[\s/&,-]+/g, '_').replace(/_+/g, '_');
  return GROUP_KEYS.has(key) ? key : '';
}

function categoryGroupByKey(value = '') {
  const key = normalizeCategoryGroup(value);
  return MARKETPLACE_CATEGORY_GROUPS.find((group) => group.key === key) || null;
}

function marketplaceGroupCounts(byCategory = {}) {
  return MARKETPLACE_CATEGORY_GROUPS.map((group) => {
    const categories = group.categories.map((key) => ({ key, count: Number(byCategory[key] || 0) }));
    return {
      key: group.key,
      count: categories.reduce((sum, item) => sum + item.count, 0),
      categories
    };
  });
}

// Prefix search so "survey" finds "Surveyors"; only letters and digits reach to_tsquery.
function marketplaceTextQuery(value = '') {
  const tokens = clean(value).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
    .filter((token) => token && !['in', 'near', 'around', 'at', 'the', 'a', 'an', 'and', 'of', 'for', 'i', 'need', 'my'].includes(token))
    .slice(0, 8);
  return tokens.map((token) => `${token}:*`).join(' & ');
}

function categoryByKey(value = '') {
  const key = normalizeCategory(value);
  return MARKETPLACE_CATEGORIES.find((item) => item.key === key) || null;
}

function slugify(value = '') {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'uganda-property-service';
}

function registrationReference() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `MP-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function claimReference() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `MC-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function isCompetitorPortal(input = {}) {
  const socialLinks = input.social_links && typeof input.social_links === 'object'
    ? Object.values(input.social_links)
    : [];
  const haystack = [input.name, input.website, input.description, input.source_url, ...socialLinks]
    .map((value) => clean(value).toLowerCase())
    .join(' ');
  return COMPETITOR_PORTAL_TOKENS.find((token) => haystack.includes(token)) || '';
}

function validateUgandaLocation({ district, area } = {}) {
  const cleanDistrict = clean(district);
  const cleanArea = clean(area);
  if (!DISTRICTS.includes(cleanDistrict)) {
    return { ok: false, error: 'Choose a district from the Uganda district list.' };
  }
  const normalized = normalizeReviewLocationHierarchy({ district: cleanDistrict, area: cleanArea });
  if (normalized.errors.length) {
    return { ok: false, error: normalized.errors[0] };
  }
  return { ok: true, district: cleanDistrict, area: cleanArea, region: normalized.region || '' };
}

function parseMarketplaceQuery(message = '') {
  const text = clean(message);
  const lower = text.toLowerCase();
  let category = '';
  for (const item of MARKETPLACE_CATEGORIES) {
    if (item.terms.some((term) => lower.includes(term))) {
      category = item.key;
      break;
    }
  }
  let district = DISTRICTS.find((item) => lower.includes(item.toLowerCase())) || '';
  let area = '';
  if (!district) {
    const words = text.split(/[,.;]|\b(?:in|near|around|at)\b/i).map(clean).filter(Boolean).reverse();
    for (const candidate of words) {
      const knownDistrict = districtForKnownArea(candidate);
      if (knownDistrict) {
        district = knownDistrict;
        area = candidate;
        break;
      }
    }
  }
  return { query: text, category, district, area };
}

function invalidateMarketplaceStats() {
  statsCache = { expiresAt: 0, data: null };
  searchCache.clear();
}

async function getMarketplaceStats(db, { force = false } = {}) {
  if (!force && statsCache.data && statsCache.expiresAt > Date.now()) return statsCache.data;
  const result = await db.query(
    `SELECT category, COUNT(*)::int AS count
     FROM marketplace_businesses
     WHERE status = 'live'
     GROUP BY category
     ORDER BY category`
  );
  const counts = Object.fromEntries(MARKETPLACE_CATEGORIES.map((item) => [item.key, 0]));
  result.rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(counts, row.category)) counts[row.category] = Number(row.count) || 0;
  });
  const data = {
    marker: MARKETPLACE_P1_MARKER,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    by_category: counts,
    by_group: marketplaceGroupCounts(counts),
    cached_at: new Date().toISOString()
  };
  statsCache = { data, expiresAt: Date.now() + MARKETPLACE_STATS_TTL_MS };
  return data;
}

function buildSearchFilters(input = {}) {
  return {
    query: clean(input.query || input.q),
    category: normalizeCategory(input.category),
    group: normalizeCategoryGroup(input.group),
    district: clean(input.district),
    area: clean(input.area),
    tier: ['verified', 'private', 'found_online'].includes(clean(input.tier).toLowerCase()) ? clean(input.tier).toLowerCase() : '',
    minRating: Math.max(0, Math.min(5, Number(input.min_rating || input.minRating) || 0)),
    page: Math.max(1, parseInt(input.page || '1', 10) || 1),
    limit: Math.max(1, Math.min(50, parseInt(input.limit || '20', 10) || 20))
  };
}

function validateMarketplaceFilters(input = {}) {
  const errors = [];
  const category = clean(input.category);
  const district = clean(input.district);
  const tier = clean(input.tier).toLowerCase();
  const minRatingRaw = clean(input.min_rating ?? input.minRating);
  const pageRaw = clean(input.page);
  const limitRaw = clean(input.limit);
  if (category && !normalizeCategory(category)) errors.push('Unknown marketplace service category.');
  if (clean(input.group) && !normalizeCategoryGroup(input.group)) errors.push('Unknown marketplace service group.');
  if (district && !DISTRICTS.includes(district)) errors.push('Unknown Uganda district.');
  if (tier && !['verified', 'private', 'found_online'].includes(tier)) errors.push('Unknown marketplace listing tier.');
  if (minRatingRaw && (!Number.isFinite(Number(minRatingRaw)) || Number(minRatingRaw) < 0 || Number(minRatingRaw) > 5)) {
    errors.push('Minimum rating must be between 0 and 5.');
  }
  if (pageRaw && (!/^\d+$/.test(pageRaw) || Number(pageRaw) < 1)) errors.push('Page must be a positive integer.');
  if (limitRaw && (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 50)) {
    errors.push('Limit must be between 1 and 50.');
  }
  return { ok: errors.length === 0, errors };
}

async function searchMarketplace(db, input = {}) {
  const filters = buildSearchFilters(input);
  const cacheKey = JSON.stringify(filters);
  const cached = searchCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.data;
  if (cached) searchCache.delete(cacheKey);
  const where = [`status = 'live'`];
  let textMatch = 'TRUE';
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.query) {
    const textQuery = marketplaceTextQuery(filters.query);
    // "Who do you need?" accepts a trade ("surveyor", "land lawyer"): match the category as well as the text.
    const hint = filters.category ? {} : parseMarketplaceQuery(filters.query);
    const text = textQuery
      ? `to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(district, '') || ' ' || COALESCE(area, '')) @@ to_tsquery('simple', ${add(textQuery)})`
      : 'FALSE';
    where.push(hint.category ? `(category = ${add(hint.category)} OR ${text})` : `(${text})`);
    // Businesses whose own text matches rank above ones that only share the hinted category.
    if (hint.category) textMatch = text;
    if (hint.category && hint.district && !filters.district) filters.district = hint.district;
  }
  if (filters.category) where.push(`category = ${add(filters.category)}`);
  if (filters.group) where.push(`category = ANY(${add([...categoryGroupByKey(filters.group).categories])}::text[])`);
  if (filters.district) {
    const p = add(filters.district);
    // A grouped business also matches the districts of its folded-in branches (migration 181).
    where.push(`(district = ${p} OR ${p} = ANY(serves_regions) OR (branch_group_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM marketplace_businesses branch
      WHERE branch.branch_group_key = marketplace_businesses.branch_group_key AND branch.status = 'hidden' AND branch.district = ${p})))`);
  }
  if (filters.area) where.push(`LOWER(COALESCE(area, '')) LIKE LOWER(${add(`%${filters.area}%`)})`);
  if (filters.tier) where.push(`tier = ${add(filters.tier)}`);
  if (filters.minRating) where.push(`rating_avg >= ${add(filters.minRating)}`);
  const offset = (filters.page - 1) * filters.limit;
  const coreOrderParam = add([...MARKETPLACE_CORE_ORDER]);
  const limitParam = add(filters.limit);
  const offsetParam = add(offset);
  const result = await db.query(
    `WITH filtered AS (
       SELECT id, name, slug, category, description, district, area, serves_regions,
              phone, whatsapp, email, website, social_links, profile_images, ursb_number, tier,
              rating_avg, rating_count, source_type, source, source_url,
              first_seen, last_refreshed, updated_at, branch_group_key,
              (${textMatch}) AS text_match,
              ROW_NUMBER() OVER (PARTITION BY category ORDER BY (COALESCE(website, '') <> '') DESC, (COALESCE(area, '') <> '') DESC, name ASC) AS category_rank
       FROM marketplace_businesses
       WHERE ${where.join(' AND ')}
     )
     , counted AS (
       SELECT COUNT(*)::int AS total_count FROM filtered
     ), paged AS (
       SELECT filtered.*, COALESCE(branches.branch_count, 1)::int AS branch_count
       FROM filtered
       LEFT JOIN LATERAL (
         -- the live card plus the branches folded into it (status 'hidden', same branch_group_key)
         SELECT COUNT(*)::int AS branch_count
         FROM marketplace_businesses branch
         WHERE filtered.branch_group_key IS NOT NULL
           AND branch.branch_group_key = filtered.branch_group_key
           AND branch.status IN ('live', 'hidden')
       ) branches ON TRUE
       ORDER BY
         text_match DESC,
         CASE tier WHEN 'verified' THEN 0 WHEN 'private' THEN 1 ELSE 2 END ASC,
         rating_avg DESC,
         rating_count DESC,
         -- interleave categories (core property services first) instead of letting the most recently refreshed category win
         category_rank ASC,
         array_position(${coreOrderParam}::text[], category) ASC NULLS LAST,
         name ASC
       LIMIT ${limitParam} OFFSET ${offsetParam}
     )
     SELECT paged.*, counted.total_count
     FROM counted
     LEFT JOIN paged ON TRUE`,
    params
  );
  const data = {
    marker: MARKETPLACE_P1_MARKER,
    businesses: result.rows.filter((row) => row.id).map(({ total_count: _total, category_rank: _rank, branch_group_key: _group, text_match: _match, ...row }) => row),
    total: Number(result.rows[0]?.total_count || 0),
    page: filters.page,
    limit: filters.limit,
    filters
  };
  if (searchCache.size >= MARKETPLACE_SEARCH_CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value);
  }
  searchCache.set(cacheKey, { data, expiresAt: Date.now() + MARKETPLACE_SEARCH_TTL_MS });
  return data;
}

async function recordMarketplaceEvent(db, entry = {}) {
  const result = await db.query(
    `INSERT INTO marketplace_events (business_id, lead_id, actor_user_id, event_type, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     RETURNING id, created_at`,
    [entry.businessId || null, entry.leadId || null, entry.actorUserId || null, clean(entry.eventType) || 'event', JSON.stringify(entry.metadata || {})]
  );
  return result.rows[0] || null;
}

module.exports = {
  DISTRICTS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_GROUPS,
  MARKETPLACE_CORE_ORDER,
  MARKETPLACE_DIRECTORY_REDESIGN_MARKER,
  MARKETPLACE_ENRICH_MARKER,
  MARKETPLACE_REGJOURNEY_MARKER,
  MARKETPLACE_P1_MARKER,
  MARKETPLACE_REPORT_FIXES_MARKER,
  buildSearchFilters,
  categoryByKey,
  categoryGroupByKey,
  claimReference,
  clean,
  getMarketplaceStats,
  invalidateMarketplaceStats,
  isCompetitorPortal,
  marketplaceGroupCounts,
  marketplaceTextQuery,
  normalizeCategory,
  normalizeCategoryGroup,
  normalizePhone,
  parseMarketplaceQuery,
  recordMarketplaceEvent,
  registrationReference,
  searchMarketplace,
  slugify,
  validateMarketplaceFilters,
  validateUgandaLocation
};
