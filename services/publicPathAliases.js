'use strict';

const { isKnownPublicRoute } = require('./publicHtmlSanitizer');

// Plausible public paths that used to 404. Each one 301s to the SPA view that
// already owns that search. /rent, /sale and /for-rent stay on their existing
// handlers (/rent and /sale are in-app pages; /for-rent is its own redirect).
const PRESERVE_EXACT = Object.freeze({
  '/contact': '/help',
  '/faq': '/help',
  '/privacy': '/privacy-policy',
  '/legal/terms': '/terms',
  '/pricing': '/about'
});

const TYPE_DESTINATIONS = Object.freeze({
  sale: { path: '/for-sale' },
  buy: { path: '/for-sale' },
  'for-sale': { path: '/for-sale' },
  for_sale: { path: '/for-sale' },
  forsale: { path: '/for-sale' },
  rent: { path: '/to-rent' },
  rental: { path: '/to-rent' },
  rentals: { path: '/to-rent' },
  'to-rent': { path: '/to-rent' },
  torent: { path: '/to-rent' },
  'for-rent': { path: '/to-rent' },
  'to-let': { path: '/to-rent' },
  to_let: { path: '/to-rent' },
  tolet: { path: '/to-rent' },
  let: { path: '/to-rent' },
  lettings: { path: '/to-rent' },
  land: { path: '/land' },
  plot: { path: '/land' },
  plots: { path: '/land' },
  commercial: { path: '/commercial' },
  office: { path: '/commercial', set: { commercial_type: 'office' } },
  offices: { path: '/commercial', set: { commercial_type: 'office' } },
  shop: { path: '/commercial', set: { commercial_type: 'shop_retail' } },
  shops: { path: '/commercial', set: { commercial_type: 'shop_retail' } },
  retail: { path: '/commercial', set: { commercial_type: 'shop_retail' } },
  warehouse: { path: '/commercial', set: { commercial_type: 'warehouse_industrial' } },
  warehouses: { path: '/commercial', set: { commercial_type: 'warehouse_industrial' } },
  student: { path: '/student-accommodation' },
  students: { path: '/student-accommodation' },
  hostel: { path: '/student-accommodation' },
  hostels: { path: '/student-accommodation' },
  'student-accommodation': { path: '/student-accommodation' },
  'short-term': { path: '/short-term' },
  short_term: { path: '/short-term' },
  shortterm: { path: '/short-term' },
  hotel: { path: '/short-term' },
  hotels: { path: '/short-term' },
  stay: { path: '/short-term' },
  stays: { path: '/short-term' },
  airbnb: { path: '/short-term' },
  broker: { path: '/brokers' },
  brokers: { path: '/brokers' },
  agent: { path: '/brokers' },
  agents: { path: '/brokers' },
  'off-plan': { path: '/off-plan' },
  offplan: { path: '/off-plan' }
});

const SEARCH_ROOTS = new Set([
  '/search',
  '/find',
  '/find-property',
  '/property-search',
  '/finder',
  '/properties',
  '/listings',
  '/listing',
  '/homes',
  '/houses',
  '/real-estate',
  '/realestate'
]);

// child: append (location or listing slug), query (slug becomes ?q=), profile.
const EXACT_DESTINATIONS = Object.freeze({
  '/buy': { path: '/for-sale', child: 'append' },
  '/buying': { path: '/for-sale', child: 'append' },
  '/purchase': { path: '/for-sale', child: 'append' },
  '/forsale': { path: '/for-sale', child: 'append' },
  '/houses-for-sale': { path: '/for-sale', child: 'append' },
  '/homes-for-sale': { path: '/for-sale', child: 'append' },
  '/property-for-sale': { path: '/for-sale', child: 'append' },
  '/properties-for-sale': { path: '/for-sale', child: 'append' },
  '/sales': { path: '/for-sale' },
  '/sell': { path: '/for-sale' },
  '/selling': { path: '/for-sale' },
  '/rental': { path: '/to-rent', child: 'append' },
  '/rentals': { path: '/to-rent', child: 'append' },
  '/to-let': { path: '/to-rent', child: 'append' },
  '/tolet': { path: '/to-rent', child: 'append' },
  '/torent': { path: '/to-rent', child: 'append' },
  '/lettings': { path: '/to-rent', child: 'append' },
  '/letting': { path: '/to-rent', child: 'append' },
  '/houses-for-rent': { path: '/to-rent', child: 'append' },
  '/houses-to-rent': { path: '/to-rent', child: 'append' },
  '/homes-to-rent': { path: '/to-rent', child: 'append' },
  '/property-for-rent': { path: '/to-rent', child: 'append' },
  '/properties-for-rent': { path: '/to-rent', child: 'append' },
  '/apartments-for-rent': { path: '/to-rent', child: 'append', set: { property_type: 'apartment' } },
  '/plots': { path: '/land', child: 'append' },
  '/plot': { path: '/land', child: 'append' },
  '/land-for-sale': { path: '/land', child: 'append' },
  '/landforsale': { path: '/land', child: 'append' },
  '/plots-for-sale': { path: '/land', child: 'append' },
  '/commercial-property': { path: '/commercial', child: 'append' },
  '/commercial-properties': { path: '/commercial', child: 'append' },
  '/offices': { path: '/commercial', child: 'append', set: { commercial_type: 'office' } },
  '/office': { path: '/commercial', child: 'append', set: { commercial_type: 'office' } },
  '/shops': { path: '/commercial', child: 'append', set: { commercial_type: 'shop_retail' } },
  '/shop': { path: '/commercial', child: 'append', set: { commercial_type: 'shop_retail' } },
  '/retail': { path: '/commercial', child: 'append', set: { commercial_type: 'shop_retail' } },
  '/warehouses': { path: '/commercial', child: 'append', set: { commercial_type: 'warehouse_industrial' } },
  '/warehouse': { path: '/commercial', child: 'append', set: { commercial_type: 'warehouse_industrial' } },
  '/agents': { path: '/brokers' },
  '/agent': { path: '/brokers', child: 'profile' },
  '/estate-agents': { path: '/brokers' },
  '/estate-agent': { path: '/brokers' },
  '/realtors': { path: '/brokers' },
  '/realtor': { path: '/brokers' },
  '/find-agent': { path: '/brokers' },
  '/find-agents': { path: '/brokers' },
  '/find-a-broker': { path: '/brokers' },
  '/student': { path: '/student-accommodation', child: 'append' },
  '/hostel': { path: '/student-accommodation', child: 'append' },
  '/hostels': { path: '/student-accommodation' },
  '/accommodation': { path: '/student-accommodation' },
  '/student-housing': { path: '/student-accommodation', child: 'append' },
  '/studenthousing': { path: '/student-accommodation' },
  '/campus-housing': { path: '/student-accommodation' },
  '/shortterm': { path: '/short-term', child: 'append' },
  '/short-stay': { path: '/short-term', child: 'append' },
  '/shortstay': { path: '/short-term', child: 'append' },
  '/short-stays': { path: '/short-term', child: 'append' },
  '/shortstays': { path: '/short-term', child: 'append' },
  '/stays': { path: '/short-term', child: 'query' },
  '/stay': { path: '/short-term', child: 'query' },
  '/hotels': { path: '/short-term', child: 'query' },
  '/hotel': { path: '/short-term', child: 'query' },
  '/airbnb': { path: '/short-term', child: 'query' },
  '/holiday-lets': { path: '/short-term', child: 'query' },
  '/holiday-let': { path: '/short-term', child: 'query' },
  '/vacation-rentals': { path: '/short-term', child: 'query' },
  '/vacation-rental': { path: '/short-term', child: 'query' },
  '/bnb': { path: '/short-term', child: 'query' },
  '/serviced-apartments': { path: '/short-term', child: 'query' },
  '/serviced-apartment': { path: '/short-term', child: 'query' },
  '/short-lets': { path: '/short-term', child: 'query' },
  '/short-let': { path: '/short-term', child: 'query' },
  '/nightly': { path: '/short-term', child: 'query' },
  '/nightly-stays': { path: '/short-term', child: 'query' },
  '/offplan': { path: '/off-plan', child: 'append' },
  '/off-plans': { path: '/off-plan', child: 'append' },
  '/new-developments': { path: '/off-plan' },
  '/new-builds': { path: '/off-plan' }
});

const TEXT_KEYS = ['q', 'query', 'search', 'keyword', 'keywords'];
const AREA_KEYS = ['area', 'district', 'location', 'where', 'city'];
const TYPE_KEYS = ['type', 'listing_type', 'listingtype', 'category', 'tab'];
const RENAME = Object.freeze({
  propertytype: 'property_type',
  room_type: 'property_type',
  roomtype: 'property_type',
  transactiontype: 'transaction_type',
  listingorigin: 'listing_origin',
  origin: 'listing_origin',
  minprice: 'min_price',
  maxprice: 'max_price',
  budget: 'max_price',
  beds: 'bedrooms',
  min_beds: 'bedrooms',
  minbeds: 'bedrooms',
  maxbeds: 'max_beds',
  max_beds: 'max_beds',
  baths: 'bathrooms',
  furnishing: 'furnished',
  minsize: 'min_size',
  maxsize: 'max_size',
  landtitletype: 'land_title_type',
  commercialtype: 'commercial_type',
  studentcampus: 'student_campus',
  campus: 'student_campus',
  university: 'student_campus',
  maxdistancekm: 'max_distance_km',
  radius_km: 'radiuskm',
  radius: 'radiuskm',
  locationids: 'location_ids'
});

function normalizePathname(pathname = '') {
  const raw = String(pathname || '').split('?')[0].split('#')[0];
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('..')) return '';
  const trimmed = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
  return trimmed.toLowerCase();
}

function searchFromOriginalUrl(originalUrl = '') {
  const raw = String(originalUrl || '');
  const query = raw.indexOf('?');
  return query === -1 ? '' : raw.slice(query);
}

function firstValue(params, keys) {
  for (const key of keys) {
    const value = String(params.get(key) || '').trim();
    if (value) return value;
  }
  return '';
}

function typeFromQuery(params) {
  const raw = firstValue(params, TYPE_KEYS).toLowerCase().replace(/\s+/g, '-');
  return TYPE_DESTINATIONS[raw] || TYPE_DESTINATIONS[raw.replace(/-/g, '_')] || null;
}

function normalizeSearch(search, presets = null) {
  const incoming = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const out = new URLSearchParams();
  const text = firstValue(incoming, TEXT_KEYS);
  const area = firstValue(incoming, AREA_KEYS);
  if (text) out.set('q', text);
  if (area) out.set('area', area);
  const campus = firstValue(incoming, ['campus', 'university', 'student_campus', 'studentcampus']);
  if (campus && !out.has('student_campus')) out.set('student_campus', campus);
  if (campus && !text && !area) out.set('q', campus);
  const consumed = new Set([
    ...TEXT_KEYS,
    ...AREA_KEYS,
    ...TYPE_KEYS,
    ...Object.keys(RENAME),
    'campus',
    'university',
    'student_campus',
    'studentcampus'
  ]);
  for (const [key, value] of incoming.entries()) {
    if (!String(value || '').trim()) continue;
    const lower = key.toLowerCase();
    if (RENAME[lower]) {
      if (!out.has(RENAME[lower])) out.set(RENAME[lower], value);
      continue;
    }
    if (consumed.has(lower)) continue;
    out.append(key, value);
  }
  if (presets) {
    for (const [key, value] of Object.entries(presets)) {
      if (value && !out.has(key)) out.set(key, value);
    }
  }
  return out;
}

function hasUsefulSearch(params) {
  for (const key of params.keys()) {
    if (!['lang', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'ref'].includes(key)) {
      return true;
    }
  }
  return false;
}

function locationWithQuery(pathname, params) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function safeSlug(segment = '') {
  return /^[a-z0-9-]{1,80}$/.test(segment);
}

function finish(target, originalPath, originalSearch) {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('://')) return '';
  const request = `${originalPath}${originalSearch || ''}`;
  if (target === request || target === originalPath) return '';
  return target;
}

function resolvePublicPathAlias(pathname = '', originalUrl = '') {
  const path = normalizePathname(pathname);
  if (!path || path.startsWith('/api/') || path === '/api') return '';
  if (isKnownPublicRoute(path)) return '';
  const search = searchFromOriginalUrl(originalUrl);

  if (PRESERVE_EXACT[path]) return finish(`${PRESERVE_EXACT[path]}${search}`, path, search);

  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return '';
  const root = `/${parts[0]}`;
  const rest = parts.slice(1);
  if (rest.some((segment) => !safeSlug(segment))) return '';

  if (SEARCH_ROOTS.has(root)) {
    if (rest.length > 2) return '';
    let destination = null;
    let segments = rest.slice();
    if (segments.length && TYPE_DESTINATIONS[segments[0]]) {
      destination = TYPE_DESTINATIONS[segments[0]];
      segments = segments.slice(1);
    }
    if (!destination) destination = typeFromQuery(new URLSearchParams(String(search || '').replace(/^\?/, '')));
    const params = normalizeSearch(search, destination && destination.set);
    if (!destination && segments.length) {
      if (!params.get('q')) params.set('q', segments.join(' ').replace(/-/g, ' '));
      destination = { path: '/for-sale' };
      segments = [];
    }
    if (!destination) destination = { path: hasUsefulSearch(params) ? '/for-sale' : '/' };
    if (segments.length > 2) return '';
    const targetPath = segments.length ? `${destination.path}/${segments.join('/')}` : destination.path;
    return finish(locationWithQuery(targetPath, params), path, search);
  }

  const exact = EXACT_DESTINATIONS[root];
  if (!exact) return '';
  if (!rest.length) {
    return finish(locationWithQuery(exact.path, normalizeSearch(search, exact.set)), path, search);
  }
  if (!exact.child || rest.length > (exact.child === 'append' ? 2 : 1)) return '';
  if (exact.child === 'profile') {
    return finish(`/agents/${rest[0]}${search}`, path, search);
  }
  if (exact.child === 'query') {
    const params = normalizeSearch(search, exact.set);
    if (!params.get('q')) params.set('q', rest[0].replace(/-/g, ' '));
    return finish(locationWithQuery(exact.path, params), path, search);
  }
  const targetPath = `${exact.path}/${rest.join('/')}`;
  return finish(locationWithQuery(targetPath, normalizeSearch(search, exact.set)), path, search);
}

function publicAliasCatalog() {
  const rows = [
    ...Object.entries(PRESERVE_EXACT).map(([from, to]) => ({ from, to, kind: 'preserve' })),
    ...[...SEARCH_ROOTS].sort().map((from) => ({ from, to: '/', kind: 'search' })),
    ...Object.entries(EXACT_DESTINATIONS).map(([from, dest]) => ({ from, to: dest.path, kind: dest.child || 'exact' }))
  ];
  return rows.sort((a, b) => a.from.localeCompare(b.from));
}

module.exports = {
  resolvePublicPathAlias,
  publicAliasCatalog,
  PRESERVE_EXACT,
  SEARCH_ROOTS,
  EXACT_DESTINATIONS
};
