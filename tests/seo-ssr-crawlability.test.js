'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');
const {
  __seoSnapshotCache,
  buildPublicSeoSnapshot,
  categoryPageSeoMeta,
  loadPublicSeoInventorySnapshot,
  sitemapEntries
} = require('../services/publicSeoService');
const {
  SEO_FACET_MIN_LISTINGS,
  UNIVERSITY_LANDINGS,
  resolvePublicSeoLanding,
  landingCount,
  publicSeoLandingMeta,
  siblingFacetLinks
} = require('../services/publicSeoLandingService');
const { UNIVERSITIES } = require('../utils/constants');
const { facetDefinition, facetMatchesRow } = require('../utils/publicSeoFacets');
const { normalizeUniversityName } = require('../utils/universityMatcher');
const {
  SEO_LISTING_CACHE_MAX_ENTRIES,
  __seoListingCache,
  areaLinksForCategory,
  loadPublicSeoListings,
  loadPublicSeoListing,
  popularAreaLinks,
  renderAreaLinks,
  renderFooterAreaLinks,
  renderCategorySeoHtml,
  renderPropertySeoHtml,
  renderHomepageSeoHtml
} = require('../services/publicSeoRenderService');

const root = path.join(__dirname, '..');
const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const frontendSource = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const seoFacetMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '111_public_seo_facet_performance.sql'), 'utf8');

const listing = {
  id: '11111111-1111-4111-8111-111111111111',
  listing_type: 'rent',
  title: '2 Bedroom House to Rent in Ntinda',
  description: 'Bright two-bedroom home close to shops and public transport.',
  area: 'Ntinda',
  district: 'Kampala',
  price: 1500000,
  price_period: 'month',
  bedrooms: 2,
  bathrooms: 2,
  property_type: 'House',
  primary_image_url: '/assets/house-ads-v3/rent.webp',
  updated_at: '2026-08-09T04:00:00.000Z'
};

function listingVariant(base, index, overrides = {}) {
  return {
    ...base,
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    extra_fields: { canonical_location_id: 'kampala:ntinda' },
    ...overrides
  };
}

function h1Count(html) {
  return (String(html).match(/<h1\b/gi) || []).length;
}

function structuredTypes(structuredData) {
  return (structuredData?.['@graph'] || []).flatMap((item) => item?.['@type'] || []);
}

async function run() {
  const rentListings = [1, 2, 3].map((index) => listingVariant(listing, index));
  const commercialListings = [11, 12, 13].map((index) => listingVariant(listing, index, {
    listing_type: 'commercial',
    title: `Office Space ${index} for Rent in Kampala`,
    property_type: 'Office',
    transaction_type: 'rent',
    area: 'Kampala',
    district: 'Kampala',
    extra_fields: { canonical_location_id: 'kampala:kampala', commercial_type: 'office' }
  }));
  const studentListings = [21, 22, 23].map((index) => listingVariant(listing, index, {
    listing_type: 'student',
    title: `Student Room ${index} near Makerere`,
    property_type: 'Hostel',
    nearest_university: 'Makerere University',
    area: 'Kikoni',
    district: 'Kampala',
    price_period: 'semester',
    extra_fields: { canonical_location_id: 'kampala:kikoni', nearest_university: 'Makerere University' }
  }));
  const snapshot = buildPublicSeoSnapshot([...rentListings, ...commercialListings, ...studentListings], '2026-08-09T06:00:00.000Z');
  assert.equal(
    areaLinksForCategory(snapshot, 'commercial').some((link) => link.label === 'Kampala'),
    false,
    'district nodes must not render as Popular areas'
  );
  assert.equal(
    popularAreaLinks(snapshot).some((link) => link.label === 'Kampala'),
    false,
    'district nodes belong in Browse by district, never Popular areas'
  );
  const rendererBoundaryLinks = [
    { href: '/for-sale/kampala-kampala', label: 'Kampala', count: 123, level: 'district' },
    { href: '/land/central-central', label: 'Central', count: 80, level: 'region' },
    { href: '/for-sale/ntinda-kampala', label: 'Ntinda, Kampala', count: 12, level: 'area' }
  ];
  const globalAreas = renderAreaLinks(rendererBoundaryLinks, 'Popular property areas in Uganda');
  const globalFooterAreas = renderFooterAreaLinks(rendererBoundaryLinks);
  for (const output of [globalAreas, globalFooterAreas]) {
    assert(output.includes('Ntinda, Kampala'), 'global area renderers must retain neighbourhood links');
    assert(!output.includes('Kampala (123)'), 'global area renderers must reject bare district chips');
    assert(!output.includes('/for-sale/kampala-kampala'), 'global area renderers must reject district routes');
    assert(!output.includes('/land/central-central'), 'global area renderers must reject region routes');
  }
  const meta = categoryPageSeoMeta('/to-rent/ntinda-kampala', snapshot);
  const rentCategoryMeta = categoryPageSeoMeta('/to-rent', snapshot);
  assert(rentCategoryMeta.title.includes('3 Listings, August 2026'), 'category titles must include honest inventory and freshness');
  assert.equal(rentCategoryMeta.priceFloor, 1500000, 'category metadata must carry the live price floor');
  assert(rentCategoryMeta.description.includes('Prices start from USh 1,500,000'), 'category descriptions must expose the live price floor');
  const sanitizedCategory = sanitizePublicHtml(rawHtml, { pathname: '/to-rent/ntinda-kampala' });
  const sanitizedFeatured = sanitizePublicHtml(rawHtml, { pathname: '/featured' });

  assert.equal(h1Count(sanitizedCategory), 1, 'an area route must not retain the featured-page H1');
  assert(!sanitizedCategory.includes('id="page-featured"'), 'an area route must remove the unrelated featured page');
  assert(sanitizedFeatured.includes('id="page-featured"'), 'the dedicated featured route must remain available');

  const category = renderCategorySeoHtml(sanitizedCategory, {
    meta,
    snapshot,
    listings: [listing],
    baseUrl: 'https://makaug.com'
  });
  assert.equal(h1Count(category.html), 1, 'an SSR category page must contain exactly one H1');
  assert(category.html.includes('Houses for rent in Ntinda, Kampala'), 'the category H1 must carry location and intent');
  assert(category.html.includes(`href="/property/${listing.id}"`), 'the raw card must contain a real property anchor');
  assert(category.html.includes(listing.title), 'the raw card must contain the listing title');
  assert(category.html.includes('USh 1,500,000/month'), 'the raw card must contain the listing price');
  assert(category.html.includes('2 bedrooms'), 'the raw card must contain the bedroom count');
  assert(category.html.includes('data-ssr-breadcrumbs="1"'), 'the visible category page must include breadcrumbs');
  assert(category.html.includes('/to-rent/ntinda-kampala'), 'listing and area navigation must expose a crawlable area URL');
  assert.deepEqual(structuredTypes(category.structuredData), ['CollectionPage', 'BreadcrumbList', 'ItemList']);

  for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) {
    assert(!category.html.includes(forbidden), `public category HTML must not leak protected copy: ${forbidden}`);
  }

  const detail = renderPropertySeoHtml(
    sanitizePublicHtml(rawHtml, { pathname: `/property/${listing.id}` }),
    listing,
    { snapshot, baseUrl: 'https://makaug.com' }
  );
  assert.equal(h1Count(detail.html), 1, 'an SSR detail page must contain exactly one H1');
  assert(detail.html.includes('data-ssr-property-detail'), 'the detail route must ship a rendered property body');
  assert(detail.html.includes(listing.description), 'the raw detail HTML must include the listing description');
  assert(detail.html.includes('Property description'), 'the raw detail HTML must label the property copy');
  assert(detail.html.includes('/to-rent/ntinda-kampala'), 'the detail page must link back to its crawlable area page');
  assert(detail.html.includes('data-ssr-footer-area-links="1"'), 'detail pages must retain crawlable popular-area footer links');
  assert.deepEqual(structuredTypes(detail.structuredData), ['BreadcrumbList', 'Product', 'RealEstateListing']);
  const product = detail.structuredData['@graph'][1];
  assert.equal(product.offers['@type'], 'Offer');
  assert.equal(product.offers.priceCurrency, 'UGX');
  assert.equal(detail.meta.title, '2bdrm House for Rent in Ntinda, Kampala — USh 1,500,000/month | makaug.com');
  assert.equal(detail.meta.description, 'Bright two-bedroom home close to shops and public transport.');

  const homepage = renderHomepageSeoHtml(sanitizePublicHtml(rawHtml, { pathname: '/' }), {
    snapshot,
    listings: [listing],
    baseUrl: 'https://makaug.com'
  });
  assert.equal(h1Count(homepage.html), 1, 'the homepage must retain exactly one H1');
  assert(homepage.html.includes('data-ssr-property-card'), 'the homepage must ship at least one rendered card when inventory exists');
  assert(homepage.html.includes('data-ssr-area-links'), 'the homepage must expose crawlable popular-area links');
  assert(!homepage.html.includes('/for-sale/kampala-kampala'), 'the homepage and its footer must not emit a bare district route');
  assert.deepEqual(structuredTypes(homepage.structuredData), ['Organization', 'WebSite']);
  assert.equal(homepage.structuredData['@graph'][1].potentialAction['@type'], 'SearchAction');
  assert(homepage.html.includes('style="min-height:24rem"'), 'the homepage grid must reserve first-paint space to reduce layout shift');

  assert.equal(SEO_FACET_MIN_LISTINGS, 3, 'facet pages must default to a minimum of three live listings');
  assert(facetMatchesRow(facetDefinition('sale', 'cheap'), { price: 200000000, property_type: 'House' }), 'cheap sale intent must match houses in budget');
  assert(!facetMatchesRow(facetDefinition('sale', 'cheap'), { price: 200000000, property_type: 'Apartment' }), 'cheap house intent must not silently broaden to apartments');
  assert(facetMatchesRow(facetDefinition('sale', 'cheap'), { price: 250000000, property_type: 'Town house' }), 'cheap sale price and type boundaries must be inclusive');
  assert(!facetMatchesRow(facetDefinition('sale', 'cheap'), { price: 250000001, property_type: 'Town house' }), 'cheap sale price must stop above USh 250M');
  assert(facetMatchesRow(facetDefinition('rent', 'affordable'), { price: 1500000, property_type: 'House' }), 'affordable rent must include the USh 1.5M boundary');
  assert(!facetMatchesRow(facetDefinition('land', 'residential-plots'), { property_type: 'Commercial plot' }), 'residential facets must not claim generic commercial plots');
  assert(facetMatchesRow(facetDefinition('land', 'residential-plots'), { property_type: 'Residential plot' }), 'residential facets must match explicit residential plots');
  assert(facetMatchesRow(facetDefinition('land', 'residential-plots'), { property_type: 'Residential' }), 'residential facets must retain the stored Residential enum');
  assert(facetMatchesRow(facetDefinition('land', 'commercial-plots'), { property_type: 'Commercial land' }), 'commercial land must match the commercial plot facet');
  assert.equal(UNIVERSITIES.length, 48, 'the supported student-search catalogue must contain the agreed 48 canonical institutions');
  assert.equal(UNIVERSITY_LANDINGS.length, UNIVERSITIES.length, 'SEO university routes must cover the authoritative backend catalogue');
  assert.equal(new Set(UNIVERSITY_LANDINGS.map((item) => item.slug)).size, UNIVERSITY_LANDINGS.length, 'university landing slugs must be unique');
  const frontendUniversityBlock = frontendSource.match(/const UGANDA_UNIVERSITIES = \[([\s\S]*?)\n\];/);
  assert(frontendUniversityBlock, 'the browser university catalogue must remain explicit and testable');
  const frontendUniversities = [...frontendUniversityBlock[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name) => name !== 'Other / Not Listed');
  assert.deepEqual(frontendUniversities, UNIVERSITIES, 'browser filters and backend SEO must use the same canonical university catalogue');
  assert.equal(normalizeUniversityName('Virtual University Uganda'), 'Nexus International University', 'retired university names must map to one canonical landing');
  assert.equal(normalizeUniversityName('King Ceasor University'), 'King Ceasar University', 'spelling variants must not create duplicate university landings');
  assert.equal(normalizeUniversityName('International Health Sciences University'), 'Clarke International University', 'renamed institutions must retain inventory matching');
  UNIVERSITY_LANDINGS.forEach((university) => {
    const landing = resolvePublicSeoLanding(`/student-accommodation/university/${university.slug}`);
    assert.equal(landing?.university?.name, university.name, `university route must resolve: ${university.slug}`);
  });

  const rentFacetLanding = resolvePublicSeoLanding('/to-rent/ntinda-kampala/2-bedroom');
  const commercialLanding = resolvePublicSeoLanding('/commercial/for-rent/kampala');
  const universityLanding = resolvePublicSeoLanding('/student-accommodation/university/makerere');
  assert.equal(rentFacetLanding?.facet?.value, 2);
  assert.equal(commercialLanding?.facet?.value, 'rent');
  assert.equal(universityLanding?.university?.name, 'Makerere University');
  assert.equal(resolvePublicSeoLanding('/hostels/makerere')?.canonicalPath, '/student-accommodation/university/makerere');
  assert.equal(resolvePublicSeoLanding('/commercial/for-rent/kampala-kampala')?.canonicalPath, '/commercial/for-rent/kampala', 'district facet aliases must have one canonical route');
  assert.equal(categoryPageSeoMeta('/land/gayaza-wakiso', snapshot)?.location?.location, 'Gayaza', 'Gayaza must be a canonical SEO location');
  assert.equal(landingCount(snapshot, rentFacetLanding), 3, 'rent facet counts must roll up to the exact area');
  assert.equal(landingCount(snapshot, commercialLanding), 3, 'commercial transaction counts must roll up to Kampala district');
  assert.equal(landingCount(snapshot, universityLanding), 3, 'university pages must be inventory-counted');

  const facetMeta = publicSeoLandingMeta(rentFacetLanding, snapshot, 'https://makaug.com');
  const facetPage = renderCategorySeoHtml(sanitizedCategory, {
    meta: facetMeta,
    snapshot,
    listings: rentListings,
    siblingLinks: siblingFacetLinks(snapshot, rentFacetLanding),
    baseUrl: 'https://makaug.com'
  });
  assert.equal(h1Count(facetPage.html), 1, 'a facet page must contain exactly one keyword and location H1');
  assert(facetPage.html.includes('2-bedroom property for rent in Ntinda, Kampala'));
  assert(facetPage.html.includes('id="makaug-seo-route-state"'), 'facet HTML must preserve its route state through hydration');
  assert(facetPage.html.includes('data-location-id="kampala:ntinda"'));
  assert(facetPage.html.includes('data-bedrooms="2"'));
  assert(facetPage.html.includes('https://makaug.com/to-rent/ntinda-kampala'), 'facet breadcrumbs must link to a valid parent area route');
  assert(facetPage.html.includes('data-ssr-footer-area-links="1"'), 'category and facet pages must include popular-area footer links');
  assert.deepEqual(structuredTypes(facetPage.structuredData), ['CollectionPage', 'BreadcrumbList', 'ItemList']);

  const sitemapUrls = sitemapEntries(snapshot).map((entry) => entry.loc);
  assert(sitemapUrls.includes('https://makaug.com/to-rent/ntinda-kampala/2-bedroom'), 'qualified bedroom facets must enter the sitemap');
  assert(sitemapUrls.includes('https://makaug.com/commercial/for-rent/kampala'), 'qualified commercial transaction pages must enter the sitemap');
  assert(sitemapUrls.includes('https://makaug.com/student-accommodation/university/makerere'), 'qualified university pages must enter the sitemap');
  assert.equal(sitemapEntries(snapshot).find((entry) => entry.loc.endsWith('/to-rent/ntinda-kampala/2-bedroom'))?.lastmod, '2026-08-09T06:00:00.000Z', 'generated facet URLs must carry lastmod');
  assert.equal(sitemapEntries(snapshot).find((entry) => entry.loc.endsWith(`/property/${rentListings[0].id}`))?.lastmod, rentListings[0].updated_at, 'detail sitemap URLs must carry listing lastmod');
  const thinSnapshot = buildPublicSeoSnapshot(rentListings.slice(0, 2));
  assert(!sitemapEntries(thinSnapshot).some((entry) => entry.loc.endsWith('/to-rent/ntinda-kampala/2-bedroom')), 'thin facet pages must stay out of the sitemap');
  assert(!sitemapEntries(thinSnapshot).some((entry) => entry.loc.endsWith('/to-rent/ntinda-kampala')), 'thin area pages must stay out of the sitemap');

  const cacheNow = Date.now();
  __seoListingCache.clear();
  __seoListingCache.set('oldest', { rows: [] }, cacheNow);
  for (let index = 1; index < SEO_LISTING_CACHE_MAX_ENTRIES; index += 1) {
    __seoListingCache.set(`entry:${index}`, { rows: [] }, cacheNow);
  }
  assert(__seoListingCache.get('oldest', cacheNow), 'an LRU read must refresh recency');
  __seoListingCache.set('overflow', { rows: [] }, cacheNow);
  assert.equal(__seoListingCache.size(), SEO_LISTING_CACHE_MAX_ENTRIES, 'listing cache must never exceed its configured cap');
  assert.equal(__seoListingCache.get('entry:1', cacheNow), null, 'the least recently used cache entry must be evicted first');
  assert(__seoListingCache.get('oldest', cacheNow), 'the refreshed cache entry must survive eviction');
  __seoListingCache.clear();

  __seoSnapshotCache.clear();
  let snapshotQueryCount = 0;
  let snapshotQuerySql = '';
  const snapshotDb = {
    async query(sql) {
      snapshotQueryCount += 1;
      snapshotQuerySql = sql;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { rows: rentListings };
    }
  };
  const coldSnapshotLoads = await Promise.all(
    Array.from({ length: 12 }, () => loadPublicSeoInventorySnapshot(snapshotDb))
  );
  assert.equal(snapshotQueryCount, 1, 'concurrent cold SSR requests must share one inventory snapshot query');
  assert(coldSnapshotLoads.every((value) => value === coldSnapshotLoads[0]), 'concurrent callers must share the same snapshot value');
  assert(snapshotQuerySql.includes('jsonb_strip_nulls(jsonb_build_object('), 'the snapshot query must project only bounded SEO metadata');
  assert(!/nearest_university,\s*extra_fields,/.test(snapshotQuerySql), 'the snapshot query must not parse full property extra_fields documents');
  assert.equal(__seoSnapshotCache.inFlight(), false, 'the in-flight snapshot reference must clear after completion');
  assert.equal(__seoSnapshotCache.hasValue(), true, 'a completed snapshot must be cached for later requests');
  __seoSnapshotCache.clear();

  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [listing] };
    }
  };
  const loadedCategory = await loadPublicSeoListings(db, {
    categoryKey: 'rent',
    location: meta.location,
    limit: 12,
    force: true
  });
  assert.equal(loadedCategory.length, 1);
  assert(queries[0].sql.includes("LOWER(COALESCE(p.status, '')) IN ('approved', 'live', 'published')"), 'SSR cards must use the public live-status predicate');
  assert(queries[0].sql.includes('qa_test_delete'), 'SSR cards must exclude launch/test inventory');
  assert(queries[0].sql.includes("LOWER(COALESCE(p.listing_type, '')) = 'rent'"), 'SSR category rows must be type-scoped');
  assert(queries[0].sql.includes("extra_fields->>'canonical_location_id'"), 'SSR area rows must use canonical location fields');

  await loadPublicSeoListings(db, {
    categoryKey: 'rent',
    location: meta.location,
    facet: facetDefinition('rent', 'houses'),
    facetSlug: 'houses',
    limit: 12,
    force: true
  });
  const facetQuery = queries[1];
  assert(!facetQuery.sql.includes('CONCAT_WS'), 'facet queries must use indexable field-level predicates instead of concatenated scans');
  assert(facetQuery.sql.includes("LOWER(TRIM(COALESCE(p.property_type, ''))) ~*"), 'facet type matching must align with the trigram index expression');
  assert(String(facetQuery.values.at(-2)).startsWith('\\m(?:house|home'), 'facet SQL regexes must be word-bounded');

  await loadPublicSeoListings(db, {
    categoryKey: 'students',
    university: UNIVERSITY_LANDINGS.find((item) => item.name === 'Makerere University'),
    limit: 12,
    force: true
  });
  const universityQuery = queries[2];
  assert(!universityQuery.sql.includes('LIKE ANY'), 'university crawls must not use leading-wildcard array scans');
  assert(universityQuery.sql.includes("LOWER(TRIM(COALESCE(p.nearest_university, ''))) ~*"), 'university queries must align with their trigram index');
  assert(universityQuery.values[0].includes('makerere'), 'university queries must preserve canonical and alias terms');

  const loadedDetail = await loadPublicSeoListing(db, listing.id);
  assert.equal(loadedDetail.id, listing.id);
  assert(queries[3].sql.includes('qa_test_delete'), 'SSR detail routes must use the same public/test exclusion predicate');

  assert(seoFacetMigration.includes('idx_properties_public_live_title_trgm'), 'facet title regexes must have a matching trigram index');
  assert(seoFacetMigration.includes('idx_properties_public_live_nearest_university_trgm'), 'university regexes must have a matching trigram index');
  assert(seoFacetMigration.includes('idx_properties_public_live_type_updated'), 'crawler listing order must have a public partial index');

  assert(frontendSource.includes('href="${adminAttr(detailPath)}"'), 'hydrated property cards must preserve real anchors');
  assert(frontendSource.includes('setPropertyDetailDocumentTitle(p, displayTitle)'), 'detail hydration must keep the listing-specific document title');
  assert(frontendSource.includes('[data-ssr-property-detail]'), 'direct detail hydration must retain the server title formula');
  assert(frontendSource.includes('hasCanonicalPropertySeoTitle'), 'language hydration must not reset a detail route title');
  assert(frontendSource.includes('(?:for-sale|to-rent|land|commercial|student-accommodation)(?:\\/[a-z0-9-]+)+'), 'language hydration must preserve nested facet titles');
  assert(frontendSource.includes('seoRouteStateHandoffPayload'), 'facet route state must hydrate into the client filters');
  assert(frontendSource.includes('if (!payload.preservePath) updateHeroSearchRoute'), 'facet hydration must preserve the canonical nested URL');
  assert(frontendSource.includes('filters.exactBedrooms'), 'bedroom facet hydration must preserve exact-bedroom semantics');
  assert(frontendSource.includes('setSelectWithFallback'), 'price facets must survive values not present in the preset selects');
  assert(frontendSource.includes('path.startsWith("/hostels/")'), 'university aliases must hydrate the student inventory');
  assert(serverSource.includes("res.set('X-makaug-Listing-SSR', '1')"), 'detail SSR must expose a diagnostic header');
  assert(serverSource.includes("res.set('X-makaug-SEO-Facet', landing.kind)"), 'facet SSR must expose a diagnostic header');
  assert(serverSource.includes("count < SEO_FACET_MIN_LISTINGS"), 'thin facet pages must be noindexed at request time');
  assert(serverSource.includes("return res.status(404).send('Property area not found')"), 'unknown area slugs must not create indexable duplicate pages');
  assert(serverSource.includes("Number(meta.count || 0) < SEO_FACET_MIN_LISTINGS"), 'valid thin area pages must be noindexed');
  assert(serverSource.includes("res.set('X-Robots-Tag', 'noindex, noarchive')"), 'missing/unpublished details must be noindexed');
  assert(serverSource.includes("return res.status(404).send('Property not found')"), 'missing/unpublished details must return a real 404');
  const homepageRouteIndex = serverSource.indexOf("app.get(['/', '/index.html']");
  const spaFallbackIndex = serverSource.indexOf('function shouldServeIndex(req)');
  const staticHandlerIndex = serverSource.indexOf('app.use(express.static');
  assert(homepageRouteIndex >= 0, 'the homepage SSR route must be registered');
  assert(homepageRouteIndex < spaFallbackIndex, 'the homepage SSR route must register before the generic SPA fallback');
  assert(homepageRouteIndex < staticHandlerIndex, 'the homepage SSR route must register before the static file handler');
  assert(serverSource.slice(homepageRouteIndex, spaFallbackIndex).includes("res.set('X-makaug-Homepage-SSR'"), 'the homepage SSR route must retain its deploy diagnostic header');

  console.log('SEO SSR crawlability tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
