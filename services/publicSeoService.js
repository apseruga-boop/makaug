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
const { normalizePricePeriodForWrite } = require('../utils/propertyPriceCurrency');
const { compactUgx } = require('../utils/compactUgx');
const { isFoundOnlinePublicRow } = require('./publicListingCopy');
const { isThinFoundOnlineListing } = require('../utils/publicIndexability');
const { realHostedPhotoExistsSql } = require('../utils/realListingPhoto');

const PUBLIC_SITE_URL = 'https://makaug.com';
const PUBLIC_SEO_CACHE_TTL_MS = 5 * 60 * 1000;

// Title, description (≤155 chars), self-canonical and robots for the app pages
// that used to ship the generic shell (canonical → "/"). Rows 1–6 are
// Marketing's (8 Oct 2026); the rest are drafts Marketing may edit.
const PUBLIC_PAGE_SEO = Object.freeze({
  '/how-it-works': {
    title: 'How makaug works: every Uganda property in one search',
    description: 'Search every house, plot and rental we can find online in Uganda, reviewed before it goes live. Contact owners and agents directly, free.'
  },
  '/safety': {
    title: 'Property safety tips for Uganda: renters, buyers, land, diaspora',
    description: 'How to avoid property scams in Uganda: view before paying, check the land title, use a lawyer and pay only through traceable channels.'
  },
  '/mortgage': {
    title: 'Mortgage calculator Uganda: compare bank repayments',
    description: 'Estimate monthly mortgage repayments and compare home-loan rates from Ugandan banks, then send an enquiry to the lender.'
  },
  '/valuation': {
    title: "What's my property worth? Uganda price guide from live listings",
    description: "Estimate a property's value from live asking prices of similar homes, plots and rentals in the same Uganda area."
  },
  '/brokers': {
    title: 'Find a property broker in Uganda',
    description: 'Browse property brokers and agents across Uganda by area, see their live listings and contact them directly.'
  },
  '/list-property': {
    title: 'List your property in Uganda: 7 days free',
    description: 'List a house, rental, plot or commercial space on makaug.com. Free for {{FREE:lister}} days, then {{PRICE:lister}} per listing, per month. Reviewed before it goes live.'
  },
  '/help': {
    title: 'Help centre: makaug.com questions answered',
    description: 'Answers on searching, listing, fees, safety and your account on makaug.com. WhatsApp help on 0780 863 394.'
  },
  '/anti-fraud': {
    title: 'Report a suspicious property listing | makaug.com',
    description: 'Spotted a scam, copied photos or a fake listing on makaug.com? Report it and our team will review it.'
  },
  '/advertise': {
    title: 'Advertise on makaug.com: reach Uganda property seekers',
    description: 'Reach people searching for homes, land and rentals across Uganda with featured listings, banners and WhatsApp sponsorships.'
  },
  '/marketplace': {
    title: 'Property services in Uganda: surveyors, lawyers, builders',
    description: "Find surveyors, lawyers, valuers, builders, plumbers, solar installers and other property services across Uganda's districts."
  },
  '/discover-ai-chatbot': {
    title: 'Ask makaug AI: find Uganda property in your own words',
    description: 'Describe the home, plot or rental you want in English, Luganda, Swahili and more, and the makaug assistant finds matching listings.'
  },
  '/careers': {
    title: 'Careers at makaug | makaug.com',
    description: 'Join makaug and help people across Uganda find, check and list property safely. See the roles we hire for and send your interest.'
  },
  '/terms': {
    title: 'Terms and conditions | makaug.com',
    description: 'The terms that apply when you search, list, advertise or pay for services on makaug.com.'
  },
  '/privacy-policy': {
    title: 'Privacy policy | makaug.com',
    description: 'How makaug.com collects, uses, shares and protects your personal information, and the choices you have.'
  },
  '/cookie-policy': {
    title: 'Cookie policy | makaug.com',
    description: 'Which cookies and similar technologies makaug.com uses, why, and how you can control them.'
  },
  '/featured': {
    title: 'Featured property listings in Uganda | makaug.com',
    description: 'Featured houses, rentals, plots and commercial property across Uganda, highlighted by the owners and agents who list them.'
  },
  // Not for search results: noindex,follow with a self-canonical.
  '/saved': { title: 'Saved properties | makaug.com', description: 'Your saved properties and searches on makaug.com.', robots: 'noindex,follow' },
  '/tiktok-connect': { title: 'Connect TikTok | makaug.com', description: 'Connect your TikTok account to link your property videos to makaug.com listings.', robots: 'noindex,follow' },
  '/login': { title: 'Sign in | makaug.com', description: 'Sign in to your makaug.com account.', robots: 'noindex,follow' },
  '/signup': { title: 'Create an account | makaug.com', description: 'Create a free makaug.com account to save properties and searches.', robots: 'noindex,follow' },
  '/student-signup': { title: 'Student sign-up | makaug.com', description: 'Create a makaug.com student account to find hostels and rooms near campus.', robots: 'noindex,follow' },
  '/broker-signup': { title: 'Broker sign-up | makaug.com', description: 'Register as a property broker or agent on makaug.com.', robots: 'noindex,follow' },
  '/field-agent-signup': { title: 'Field agent sign-up | makaug.com', description: 'Apply to work as a makaug.com field agent.', robots: 'noindex,follow' },
  '/advertiser-signup': { title: 'Advertiser sign-up | makaug.com', description: 'Create a makaug.com advertiser account.', robots: 'noindex,follow' },
  '/forgot-password': { title: 'Reset your password | makaug.com', description: 'Reset the password for your makaug.com account.', robots: 'noindex,follow' },
  '/verify-email': { title: 'Verify your email | makaug.com', description: 'Confirm the email address on your makaug.com account.', robots: 'noindex,follow' }
});

// In-app aliases keep working (no redirect) but canonicalise to the primary path.
const PUBLIC_PAGE_ALIASES = Object.freeze({
  '/sale': '/for-sale',
  '/rent': '/to-rent',
  '/students': '/student-accommodation',
  '/find-brokers': '/brokers',
  '/mortgage-finder': '/mortgage',
  '/property-valuation': '/valuation',
  '/ai-chatbot': '/discover-ai-chatbot',
  '/fraud': '/anti-fraud',
  '/report-fraud': '/anti-fraud'
});

function publicPageSeoFor(pathname = '/', baseUrl = PUBLIC_SITE_URL) {
  const clean = String(pathname || '/').split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
  const primary = PUBLIC_PAGE_ALIASES[clean] || clean;
  const entry = PUBLIC_PAGE_SEO[primary];
  if (!entry) return PUBLIC_PAGE_ALIASES[clean] ? { canonicalPath: primary, canonical: `${String(baseUrl).replace(/\/+$/, '')}${primary}` } : null;
  return {
    path: primary,
    canonicalPath: primary,
    title: entry.title,
    description: entry.description,
    robots: entry.robots || 'index,follow',
    canonical: `${String(baseUrl).replace(/\/+$/, '')}${primary}`
  };
}

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

// Honest prices for SEO copy. Only prices inside these bounds count; the
// "from" figure is the 10th percentile and needs at least 5 valid prices
// (the raw minimum printed "Prices start from USh 2").
const SEO_PRICE_BOUNDS = Object.freeze({
  one_off: [1_000_000, 20_000_000_000],
  monthly: [100_000, 100_000_000],
  student: [50_000, 20_000_000],
  // C20: weekly and yearly rents get their own honest bounds so the price can
  // show in the title.
  weekly: [20_000, 25_000_000],
  yearly: [1_000_000, 1_200_000_000]
});
const SEO_MIN_PRICES_FOR_COPY = 5;

function seoPriceKind(category, row = {}) {
  if (category === 'students') return 'student';
  const period = normalizePricePeriodForWrite(String(row.price_period || '').toLowerCase()) || '';
  const transaction = String(row.transaction_type || row?.extra_fields?.transaction_type || '').toLowerCase();
  const recurringKind = { month: 'monthly', week: 'weekly', year: 'yearly' };
  if (category === 'rent') return !period ? 'monthly' : (recurringKind[period] || null);
  if (category === 'commercial') {
    if (transaction === 'rent' || recurringKind[period]) return !period ? 'monthly' : (recurringKind[period] || null);
    return 'one_off';
  }
  return 'one_off';
}

function validSeoPrice(category, row = {}) {
  const kind = seoPriceKind(category, row);
  if (!kind) return null;
  const price = Number(row.price || 0);
  const [min, max] = SEO_PRICE_BOUNDS[kind];
  return Number.isFinite(price) && price >= min && price <= max ? price : null;
}

function priceInSeoBounds(row = {}, category = '') {
  return validSeoPrice(category || (row.listing_type === 'student' ? 'students' : row.listing_type), row) !== null;
}

function percentile(values = [], fraction = 0.5) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const rank = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function floorFromPrices(values = []) {
  return values.length >= SEO_MIN_PRICES_FOR_COPY ? percentile(values, 0.1) : 0;
}

// Valid prices for a canonical location, including its children for a
// city/district (same scope as the page and the rolled-up counts).
function locationValidPrices(snapshot, category, canonicalKey) {
  const direct = snapshot?.locationValidPrices?.[category];
  if (!direct || !canonicalKey) return [];
  const location = canonicalLocationByKey(canonicalKey);
  if (location?.level !== 'district') return direct.get(canonicalKey) || [];
  // District: every area in it, the same scope as the district's rolled-up count.
  const values = [];
  for (const [key, prices] of direct) {
    if (canonicalLocationByKey(key)?.district === location.district) values.push(...prices);
  }
  return values;
}

function snapshotMedian(snapshot, category, canonicalKey = null) {
  const values = canonicalKey ? locationValidPrices(snapshot, category, canonicalKey) : (snapshot?.categoryValidPrices?.[category] || []);
  return { median: values.length >= SEO_MIN_PRICES_FOR_COPY ? median(values) : 0, count: values.length };
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
  const categoryValidPrices = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, []]));
  const locationValidPricesByCategory = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, new Map()]));
  const categoryDistricts = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, new Set()]));
  const generatedMs = new Date(generatedAt).getTime();
  // Honest hub lastmod: newest listing timestamp shown on that hub (ms).
  const categoryLastmod = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, 0]));
  const locationLastmod = Object.fromEntries(Object.keys(CATEGORY_SEO).map((key) => [key, new Map()]));
  const districtKeyByDistrict = new Map();
  for (const option of canonicalLocationOptions()) {
    if (option.level === 'district' && option.district) districtKeyByDistrict.set(option.district, option.canonical_key);
  }
  const agentLastmod = new Map();
  let overallLastmod = 0;
  let newLast7d = 0;
  let thinPropertyCount = 0;
  if (!rows.length) {
    return {
      directCounts,
      counts: emptyCounts(),
      categoryLastmod,
      locationLastmod,
      agentLastmod,
      overallLastmod,
      categoryTotals,
      categoryPriceFloors,
      locationPriceFloors: directPriceFloors,
      categoryValidPrices,
      locationValidPrices: locationValidPricesByCategory,
      categoryDistricts,
      newLast7d,
      thinPropertyCount,
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
    const createdMs = new Date(row.created_at || '').getTime();
    const rowMs = new Date(row.updated_at || row.created_at || '').getTime();
    if (Number.isFinite(rowMs)) {
      overallLastmod = Math.max(overallLastmod, rowMs);
      for (const category of categories) {
        categoryLastmod[category] = Math.max(categoryLastmod[category], rowMs);
        for (const canonical of locations) {
          const keys = [canonical.key];
          const districtKey = districtKeyByDistrict.get(canonical.district);
          if (districtKey && districtKey !== canonical.key) keys.push(districtKey);
          for (const key of keys) {
            locationLastmod[category].set(key, Math.max(locationLastmod[category].get(key) || 0, rowMs));
          }
        }
      }
      if (row.agent_id && row.agent_public) {
        const agentKey = String(row.agent_id);
        agentLastmod.set(agentKey, Math.max(agentLastmod.get(agentKey) || 0, rowMs));
      }
    }
    if (Number.isFinite(createdMs) && Number.isFinite(generatedMs) && generatedMs - createdMs <= 7 * 86400000) newLast7d += 1;
    for (const category of categories) {
      categoryTotals[category] += 1;
      const valid = validSeoPrice(category, row);
      if (valid !== null) categoryValidPrices[category].push(valid);
      for (const canonical of locations) if (canonical.district) categoryDistricts[category].add(canonical.district);
    }
    for (const canonical of locations) {
      for (const category of categories) {
        directCounts[category].set(canonical.key, Number(directCounts[category].get(canonical.key) || 0) + 1);
        const valid = validSeoPrice(category, row);
        if (valid !== null) {
          if (!locationValidPricesByCategory[category].has(canonical.key)) locationValidPricesByCategory[category].set(canonical.key, []);
          locationValidPricesByCategory[category].get(canonical.key).push(valid);
        }
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
    const thin = isThinListingRow(row);
    if (thin) thinPropertyCount += 1;
    if (row.id) {
      properties.push({
        id: String(row.id),
        lastmod: row.updated_at || row.created_at || null,
        thin
      });
    }
  }
  for (const category of Object.keys(CATEGORY_SEO)) {
    categoryPriceFloors[category] = floorFromPrices(categoryValidPrices[category]);
  }
  const counts = Object.fromEntries(
    Object.entries(directCounts).map(([key, values]) => [key, canonicalLocationRollupCounts(values)])
  );
  // 10th percentile of valid prices per location (children included for a
  // city/district); no floor below 5 valid prices.
  const locationPriceFloors = Object.fromEntries(Object.keys(CATEGORY_SEO).map((category) => {
    const floors = new Map();
    const scratch = { locationValidPrices: locationValidPricesByCategory };
    for (const location of canonicalLocationOptions()) {
      const values = locationValidPrices(scratch, category, location.canonical_key);
      const floor = floorFromPrices(values);
      if (floor > 0) floors.set(location.canonical_key, floor);
    }
    return [category, floors];
  }));
  const rolledFacetCounts = Object.fromEntries(
    Object.entries(facetCounts).map(([key, values]) => [key, rollupFacetCountMap(values, Object.keys(FACET_DEFINITIONS[key] || {}))])
  );
  const rolledCommercialTransactionCounts = rollupFacetCountMap(commercialTransactionCounts, ['for-rent', 'for-sale']);
  return {
    directCounts,
    counts,
    categoryLastmod,
    locationLastmod,
    agentLastmod,
    overallLastmod,
    categoryTotals,
    categoryPriceFloors,
    locationPriceFloors,
    facetCounts: rolledFacetCounts,
    commercialTransactionCounts: rolledCommercialTransactionCounts,
    universityCounts,
    properties,
    categoryValidPrices,
    locationValidPrices: locationValidPricesByCategory,
    categoryDistricts,
    newLast7d,
    thinPropertyCount,
    generatedAt
  };
}

// Snapshot rows carry the found-online flags, review flags and a has_real_photo
// boolean (EXISTS in SQL), never the image rows themselves.
function isThinListingRow(row = {}) {
  const flags = row.copy_flags && typeof row.copy_flags === 'object' ? row.copy_flags : {};
  const foundOnline = isFoundOnlinePublicRow({ source: row.source, listed_via: row.listed_via }, flags);
  return isThinFoundOnlineListing({
    foundOnline,
    hasRealPhoto: row.has_real_photo === true,
    description: row.description,
    extra: flags
  });
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
            source, listed_via,
            jsonb_build_object(
              'found_online', extra_fields->'found_online',
              'social_search_candidate', extra_fields->'social_search_candidate',
              'sourced_inventory_candidate', extra_fields->'sourced_inventory_candidate',
              'third_party_discovery_result', extra_fields->'third_party_discovery_result',
              'source_badge', extra_fields->'source_badge',
              'source_batch', extra_fields->'source_batch',
              'source_platform', extra_fields->'source_platform',
              'source_url', COALESCE(extra_fields->'source_url', extra_fields->'source_post_url'),
              'video_url', extra_fields->'video_url',
              'staff_corrected_fields', extra_fields->'staff_corrected_fields',
              'king_review_corrected_fields', extra_fields->'king_review_corrected_fields',
              'king_review_facts_confirmed', extra_fields->'king_review_facts_confirmed'
            ) AS copy_flags,
            ${realHostedPhotoExistsSql('properties')} AS has_real_photo,
            agent_id,
            EXISTS (
              SELECT 1 FROM agents a
              WHERE a.id = properties.agent_id
                AND LOWER(COALESCE(a.status, 'pending')) NOT IN ('rejected', 'declined', 'suspended', 'deleted', 'removed', 'blocked')
            ) AS agent_public,
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
  // "Kampala, Kampala" → "Kampala" for district pages.
  const locationLabel = location
    ? (String(location.location || '').toLowerCase() === String(location.district || '').toLowerCase() ? location.district : `${location.location}, ${location.district}`)
    : 'Uganda';
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
    ? ` Prices start from UGX ${compactUgx(priceFloor)}.`
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

function isoFromMs(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : '';
}

function sitemapEntries(snapshot = {}, baseUrl = PUBLIC_SITE_URL) {
  const root = String(baseUrl || PUBLIC_SITE_URL).replace(/\/+$/, '');
  // Hub lastmod = newest updated_at among the listings on that hub, never the
  // generation time (that told crawlers everything changed on every fetch).
  // No listings, no lastmod.
  const entries = [
    { loc: `${root}/`, lastmod: isoFromMs(snapshot?.overallLastmod), changefreq: 'daily', priority: '1.0' },
    ...Object.entries(CATEGORY_SEO).map(([key, config]) => ({
      loc: `${root}${config.route}`,
      lastmod: isoFromMs(snapshot?.categoryLastmod?.[key]),
      changefreq: 'hourly',
      priority: '0.9'
    })),
    { loc: `${root}/about`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${root}/how-it-works`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${root}/help`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${root}/safety`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${root}/anti-fraud`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${root}/advertise`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${root}/marketplace`, changefreq: 'daily', priority: '0.8' },
    { loc: `${root}/valuation`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${root}/mortgage`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${root}/brokers`, changefreq: 'daily', priority: '0.7' },
    { loc: `${root}/badge`, changefreq: 'monthly', priority: '0.4' },
    { loc: `${root}/list-property`, changefreq: 'weekly', priority: '0.7' }
  ];
  for (const [key, config] of Object.entries(CATEGORY_SEO)) {
    const counts = snapshot?.counts?.[key] || new Map();
    for (const location of canonicalLocationOptions()) {
      const count = Number(counts.get(location.canonical_key) || 0);
      if (count < SEO_FACET_MIN_LISTINGS) continue;
      entries.push({
        loc: `${root}${config.route}/${canonicalLocationRouteSlug(location)}`,
        lastmod: isoFromMs(snapshot?.locationLastmod?.[key]?.get(location.canonical_key)),
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
        changefreq: 'daily',
        priority: '0.8'
      });
    }
  }
  for (const [universitySlug, countValue] of snapshot?.universityCounts || new Map()) {
    if (Number(countValue || 0) < SEO_FACET_MIN_LISTINGS) continue;
    entries.push({
      loc: `${root}/student-accommodation/university/${universitySlug}`,
      changefreq: 'daily',
      priority: '0.8'
    });
  }
  for (const property of snapshot?.properties || []) {
    if (property.thin) continue; // noindex,follow pages stay out of the sitemap
    entries.push({
      loc: `${root}/property/${encodeURIComponent(property.id)}`,
      lastmod: property.lastmod ? new Date(property.lastmod).toISOString() : '',
      changefreq: 'weekly',
      priority: '0.6'
    });
  }
  for (const [agentId, ms] of snapshot?.agentLastmod || new Map()) {
    entries.push({
      loc: `${root}/agents/${encodeURIComponent(agentId)}`,
      lastmod: isoFromMs(ms),
      changefreq: 'weekly',
      priority: '0.5'
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
  PUBLIC_PAGE_SEO,
  PUBLIC_PAGE_ALIASES,
  publicPageSeoFor,
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
  SEO_PRICE_BOUNDS,
  SEO_MIN_PRICES_FOR_COPY,
  validSeoPrice,
  priceInSeoBounds,
  snapshotMedian,
  locationValidPrices,
  isThinListingRow,
  __seoSnapshotCache: Object.freeze({
    clear: clearPublicSeoSnapshotCache,
    hasValue: () => Boolean(snapshotCache?.value),
    inFlight: () => Boolean(snapshotCacheInFlight)
  })
};
