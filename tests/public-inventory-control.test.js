'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync('assets/makaug-app.js', 'utf8');
const browserProbeSource = fs.readFileSync('scripts/probe-public-routes-browser.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');
const packageSource = fs.readFileSync('package.json', 'utf8');
const tailwindConfigSource = fs.readFileSync('tailwind.config.cjs', 'utf8');
const tailwindCssSource = fs.readFileSync('assets/tailwind.css', 'utf8');
const whatsappRouteSource = fs.readFileSync('routes/whatsapp.js', 'utf8');
const adminRouteSource = fs.readFileSync('routes/admin.js', 'utf8');
const agentsRouteSource = fs.readFileSync('routes/agents.js', 'utf8');
const propertiesRouteSource = fs.readFileSync('routes/properties.js', 'utf8');
const serverSource = fs.readFileSync('server.js', 'utf8');
const publicInventoryPerformanceMigration = fs.readFileSync('db/migrations/066_public_inventory_performance.sql', 'utf8');

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} to exist`);
  const next = appSource.indexOf('\nfunction ', start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

function constFunctionSource(name) {
  const start = appSource.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `Expected const ${name} to exist`);
  const end = appSource.indexOf('\n};', start);
  assert.notEqual(end, -1, `Expected const ${name} to end with };`);
  return appSource.slice(start, end + 3);
}

function asyncFunctionSource(name) {
  const start = appSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `Expected async ${name} to exist`);
  const nextFunction = appSource.indexOf('\nfunction ', start + 1);
  const nextAsync = appSource.indexOf('\nasync function ', start + 1);
  const next = [nextFunction, nextAsync].filter((idx) => idx !== -1).sort((a, b) => a - b)[0];
  return appSource.slice(start, next === undefined ? appSource.length : next);
}

function routeSource(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected route ${signature} to exist`);
  const next = source.indexOf('\nrouter.', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('public listings are backend-controlled, not frontend seed inventory', () => {
  assert.match(appSource, /function publicSampleListingsEnabled\(\)/);
  assert.match(appSource, /window\.MAKAUG_ALLOW_SAMPLE_LISTINGS === true/);
  assert.match(appSource, /function isBackendControlledListing\(property\)/);
  assert.match(appSource, /function isListingPublicVisible\(property\) \{\s*if \(adminRecordLooksLikeTest\(property\)\) return false;/);
  assert.match(appSource, /function getPublicListings\(\) \{\s*return PROPERTIES\.filter\(\(p\) => \(\s*isListingPublicVisible\(p\)[\s\S]*isBackendControlledListing\(p\)[\s\S]*publicSampleListingsEnabled\(\)/);
  assert.doesNotMatch(appSource, /function getPublicListings\(\) \{\s*return PROPERTIES\.filter\(\(p\) => isListingPublicVisible\(p\)\);\s*\}/);
});

test('admin live controls use paginated backend snapshots', () => {
  assert.match(appSource, /async function fetchAdminPaginatedRows\(path, headers, options = \{\}\)/);
  assert.match(adminRouteSource, /router\.get\('\/properties\/review-queue'/);
  assert.match(adminRouteSource, /router\.get\('\/properties\/actioned'/);
  assert.match(adminRouteSource, /function adminSourceQualitySuppressedFlagSql\(alias = 'p'\)/);
  assert.match(adminRouteSource, /function adminActiveReviewQueueWhere\(alias = 'p'\)/);
  assert.match(adminRouteSource, /function adminDefaultReviewQueueWhere\(alias = 'p'\)/);
  assert.match(adminRouteSource, /COUNT\(\*\) FILTER \(WHERE \$\{adminDefaultReviewQueueWhere\(''\)\}\)::int AS pending/);
  assert.match(adminRouteSource, /safeCount\(`SELECT COUNT\(\*\)::int AS total FROM properties p WHERE \$\{adminDefaultReviewQueueWhere\('p'\)\}`\)/);
  const reviewQueueRouteSource = routeSource(adminRouteSource, "router.get('/properties/review-queue'");
  assert.match(reviewQueueRouteSource, /const filters = \[includeTestLike \? adminActiveReviewQueueWhere\('p'\) : adminDefaultReviewQueueWhere\('p'\)\]/);
  assert.match(reviewQueueRouteSource, /source_quality_filter: 'stored_suppression_flag_only'/);
  assert.match(reviewQueueRouteSource, /count_filter: includeTestLike \? 'admin_active_review_queue' : 'admin_default_review_queue'/);
  assert.doesNotMatch(reviewQueueRouteSource, /sourceQualitySuppressedSql\('p'\)/);
  assert.match(adminRouteSource, /function adminPublicLiveListingFastWhere\(alias = 'p'\)/);
  assert.match(adminRouteSource, /safeCount\(`SELECT COUNT\(\*\)::int AS total FROM properties p WHERE \$\{adminPublicLiveListingFastWhere\('p'\)\}`\)/);
  assert.match(adminRouteSource, /'source_review'/);
  assert.match(adminRouteSource, /'queued'/);
  assert.match(adminRouteSource, /function adminPendingReviewWhere\(alias = 'p'\)[\s\S]*\$\{statusExpr\} NOT IN \(\$\{final\}\)[\s\S]*\$\{stageExpr\} NOT IN \(\$\{final\}\)/);
  assert.doesNotMatch(adminRouteSource, /AND \(\$\{statusExpr\} IN \(\$\{pending\}\) OR \$\{stageExpr\} IN \(\$\{pending\}\)\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/review-queue\?include_total=0", headers, \{ maxPages: 3 \}\)/);
  assert.match(appSource, /King dashboard refresh already running; skipping duplicate render\./);
  assert.match(adminRouteSource, /adminCachedPayload\('admin-summary-v4'/);
  assert.match(adminRouteSource, /adminCachedPayload\('admin-command-centre-v4'/);
  assert.match(adminRouteSource, /admin-review-queue-v5/);
  assert.match(adminRouteSource, /const includeTotal = parseBooleanLike\(req\.query\.include_total \|\| req\.query\.includeTotal, false\)/);
  assert.match(adminRouteSource, /const rowLimit = limit \+ 1/);
  assert.match(adminRouteSource, /has_more: hasMore/);
  assert.match(appSource, /function adminAuthHeaders\(\) \{\s*const headers = \{\};[\s\S]*headers\["x-api-key"\] = adminApiKey;[\s\S]*headers\.Authorization = `Bearer \$\{authState\.token\}`;[\s\S]*return headers;/);
  assert.match(appSource, /async function adminSafeSnapshotRequest\(label, requestFn, fallback\)/);
  assert.match(appSource, /adminSafeSnapshotRequest\("review queue", \(\) => fetchAdminPaginatedRows\("\/api\/admin\/properties\/review-queue\?include_total=0", headers, \{ maxPages: 3 \}\), \[\]\)/);
  assert.match(appSource, /adminSafeSnapshotRequest\("actioned listings", \(\) => fetchAdminPaginatedRows\("\/api\/admin\/properties\/actioned\?include_total=0", headers, \{ maxPages: 3 \}\), \[\]\)/);
  assert.match(appSource, /adminSafeSnapshotRequest\("whatsapp insights"/);
  assert.match(appSource, /function adminUnavailableFallback\(label, fallback, error\)/);
  assert.match(appSource, /partialLiveData: unavailablePanels\.length > 0/);
  assert.match(appSource, /function adminPreferNonZeroMetric\(primaryValue, fallbackValue\)/);
  assert.match(appSource, /merged\.live_listings = adminPreferNonZeroMetric\(metrics\.live_listings, fallbackMetrics\.live_listings\)/);
  assert.match(appSource, /ADMIN_PENDING_QUEUE_RENDER_STEP = 150/);
  assert.match(appSource, /function adminShowMorePendingQueueRows\(\)/);
  assert.match(appSource, /function hydrateAdminAllListingsInBackground\(headers\)/);
  assert.match(htmlSource, /review-queue-list-count-parity-20260711/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/properties\?status=all", headers, \{ maxPages: 500 \}\)/);
  assert.match(appSource, /if \(activeTab === "listings"\) hydrateAdminAllListingsInBackground\(headers\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live", headers, \{ maxPages: 10 \}\)/);
  assert.match(appSource, /Object\.defineProperties\(rows, \{/);
  assert.match(appSource, /adminSummary: \{ value: lastResponse\?\.summary \|\| firstResponse\?\.summary \|\| null \}/);
  assert.match(appSource, /const adminLiveRows = remoteSnap\?\.liveListings \|\| localSnap\.liveListings \|\| \[\]/);
  assert.match(appSource, /renderAdminFeaturedRows\(adminLiveRows\)/);
  assert.match(appSource, /renderAdminActionedRows\(remoteSnap\?\.actionedListings \|\| remoteSnap\?\.allListings \|\| localSnap\.allListings \|\| \[\]\)/);
  assert.doesNotMatch(appSource, /renderAdminFeaturedRows\(remoteSnap\?\.allListings \|\| localSnap\.allListings/);
});

test('remove and status actions can target listings loaded only through the live endpoint', () => {
  assert.match(appSource, /adminLiveListings\.find\(\s*\(p\) => String\(p\.id\) === String\(localId\)/);
  assert.match(appSource, /const liveIdx = adminLiveListings\.findIndex/);
  assert.match(appSource, /if \(liveIdx >= 0\) adminLiveListings\[liveIdx\]/);
});

test('admin live and featured surfaces clean-filter test-like backend listings', () => {
  assert.match(appSource, /function adminPublicControlVisibilityBadge\(row = \{\}\)/);
  assert.match(appSource, /Test-like public listing/);
  assert.match(functionSource('adminLiveEndpointRows'), /adminApplyLaunchCleanFilter\(rows\)\.filter\(adminIsPublicLiveAdminListing\)/);
  for (const name of ['renderAdminLiveListingsRows', 'renderAdminFeaturedRows']) {
    const source = functionSource(name);
    assert.match(source, /adminLiveEndpointRows\(listings\)/);
  }
  for (const name of ['renderAdminAllListingsRows']) {
    const source = functionSource(name);
    assert.match(source, /adminPublicControlVisibilityBadge/);
  }
});

test('browser release probe blocks uncontrolled seed listings from public pages', () => {
  assert.match(browserProbeSource, /FORBIDDEN_PUBLIC_LISTING_TEXT/);
  assert.match(browserProbeSource, /Luxury Villa in Kololo/);
  assert.match(browserProbeSource, /uncontrolled seed listing visible/);
});

test('anonymous public property APIs suppress launch seed QA listings', () => {
  const routeSource = propertiesRouteSource;
  assert.match(routeSource, /LAUNCH_SEED_LISTING_MARKERS = \['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'\]/);
  assert.match(routeSource, /LAUNCH_DUMMY_LISTING_TITLES = new Set\(\['sdgsdgd', 'sgsgsgsgs'\]\)/);
  assert.match(routeSource, /function addPublicLaunchSeedFilter/);
  assert.match(routeSource, /COALESCE\(p\.title, ''\) NOT ILIKE/);
  assert.match(routeSource, /LOWER\(TRIM\(COALESCE\(p\.title,/);
  assert.match(routeSource, /COALESCE\(p\.extra_fields->>'soft_launch_test', ''\) !~\*/);
  assert(routeSource.includes("COALESCE(p.lister_email, '') !~* '(makaug\\\\.invalid|test@|qa@|dummy|sample)'"));
  assert.match(routeSource, /const publicOnly = parseBooleanLike\(req\.query\.public_only \|\| req\.query\.publicOnly, false\)/);
  assert.match(routeSource, /if \(publicOnly \|\| !adminAccess\) \{\s*addPublicLaunchSeedFilter\(filters, values\);/);
  assert.match(appSource, /PUBLIC_LISTINGS_FAST_PAGE_LIMIT = 8/);
  assert.match(appSource, /PUBLIC_LISTINGS_BACKGROUND_PAGE_LIMIT = 24/);
  assert.match(appSource, /PUBLIC_LISTINGS_BACKGROUND_MAX_PAGES = 80/);
  assert.match(appSource, /PUBLIC_LISTINGS_ROUTE_SEARCH_MAX_PAGES = 80/);
  assert.match(appSource, /PUBLIC_RESULTS_PAGE_SIZE = 24/);
  assert.match(appSource, /PUBLIC_PAGINATION_CATEGORIES = Object\.freeze\(\["sale", "rent", "students", "commercial", "land"\]\)/);
  assert.match(appSource, /PUBLIC_OPPORTUNITY_SUMMARY_PATH = "\/api\/properties\?status=approved&public_only=1&limit=1&page=1&summary_only=1&include_summary=1"/);
  assert.match(routeSource, /const summaryOnly = parseBooleanLike\(req\.query\.summary_only \|\| req\.query\.summaryOnly, false\)/);
  assert.match(routeSource, /const includeSummary = summaryOnly \|\| parseBooleanLike/);
  assert.match(routeSource, /if \(summaryOnly\) \{/);
  assert.match(appSource, /PUBLIC_CATEGORY_DEEP_HYDRATION_DELAY_MS = 8000/);
  assert.match(appSource, /const publicCategoryDeepHydrationTimers = new Map\(\)/);
  assert.match(appSource, /const publicActiveCategoryHydrationPromises = new Map\(\)/);
  assert.match(appSource, /function applyPublicRowsForUi\(publicRowsSnapshot, responseSnapshot, options = \{\}\)/);
  assert.match(appSource, /function exactPublicPaginationTotal\(response\)/);
  assert.match(appSource, /response\?\.pagination\?\.approximate/);
  assert.match(appSource, /function publicOpportunityStatsFromApiResponse\(response\)/);
  assert.match(appSource, /window\.__makaugPublicSummaryPromise && !window\.__makaugPublicSummaryConsumed/);
  assert.match(appSource, /const response = await apiRequest\(PUBLIC_OPPORTUNITY_SUMMARY_PATH, \{ skipAuth: true \}\)/);
  assert.match(appSource, /const firstPagePath = activeCategory\s*\? activeRouteSearchPath \|\| publicInventoryCategoryPath\(activeCategory\) \|\| "\/api\/properties\?status=approved&public_only=1"\s*: "\/api\/properties\?status=approved&public_only=1"/);
  assert.match(appSource, /const firstPageRowsPromise = fetchPublicPaginatedRows\(firstPagePath, \{[\s\S]*limit: activeCategory \? PUBLIC_RESULTS_PAGE_SIZE : PUBLIC_LISTINGS_FAST_PAGE_LIMIT,[\s\S]*maxPages: 1,[\s\S]*includeSummary: Boolean\(activeRouteSearchPath\)/);
  assert.match(appSource, /const \{ rows: firstPageRows, firstResponse: firstPageResponse \} = await firstPageRowsPromise/);
  assert.match(appSource, /const summaryStats = await summaryStatsPromise/);
  assert(appSource.indexOf('const { rows: firstPageRows, firstResponse: firstPageResponse } = await firstPageRowsPromise') < appSource.indexOf('const summaryStats = await summaryStatsPromise'));
  assert.match(appSource, /applyPublicRowsForUi\(firstPageRows, firstPageResponse\);[\s\S]*cachePublicCategoryPageRows\(activeCategory, 1, firstPageRows\);[\s\S]*renderAll\(\);/);
  assert.match(appSource, /cachePublicCategoryPageRows\(activeCategory, 1, firstPageRows\)/);
  assert.match(appSource, /function schedulePublicCategoryDeepHydration\(category, totalCount = 0\)/);
  assert.match(appSource, /window\.setTimeout\(\(\) => \{[\s\S]*refreshActivePublicInventoryCategoryFromApi\(\{ silent: true \}\)/);
  assert.match(appSource, /schedulePublicCategoryDeepHydration\(activeCategory, categoryTotal\);\s*return true;/);
  assert.match(appSource, /const backgroundRowsPromise = fetchPublicPaginatedRows\("\/api\/properties\?status=approved&public_only=1", \{/);
  assert.match(appSource, /limit: PUBLIC_LISTINGS_BACKGROUND_PAGE_LIMIT,[\s\S]*maxPages: PUBLIC_LISTINGS_BACKGROUND_MAX_PAGES,[\s\S]*includeSummary: false/);
  assert.match(appSource, /const firstPageCategoryExactTotal = activeCategory \? exactPublicPaginationTotalValue\(firstPageResponse\) : null;/);
  assert.match(appSource, /const categoryTotal = activeCategory \? firstPageCategoryExactTotal \?\? \(publicOpportunityStatForCategory\(activeCategory\) \?\? summaryStats\?\.\[activeCategory\] \?\? 0\) : 0;/);
  assert.match(appSource, /const \{ rows: publicRows, firstResponse \} = await backgroundRowsPromise;\s*const featuredRows = await featuredRowsPromise;\s*applyPublicRowsForUi\(publicRows, firstResponse, \{ featuredRows, prune: true \}\);\s*renderAll\(\);/);
  assert.match(appSource, /function publicOpportunityStatForCategory\(category\)/);
  assert.match(appSource, /function getPublicCategoryDisplayCount\(category, localCount = 0, \{ filtered = false \} = \{\}\)/);
  assert.match(appSource, /function setPublicCategoryCount\(category, localCount = 0, options = \{\}\)/);
  assert.match(appSource, /function hasActiveListingFilter\(page\)/);
  assert.match(appSource, /function activePublicInventoryCategoryFromRoute\(\)/);
  assert.match(appSource, /function publicInventoryCategoryPath\(category\)/);
  assert.match(appSource, /function renderPublicCategoryPagination\(category, options = \{\}\)/);
  assert.match(appSource, /function renderPublicCategoryPage\(category, list = \[\], options = \{\}\)/);
  assert.match(appSource, /async function fetchPublicCategoryPage\(category, page = 1, options = \{\}\)/);
  assert.match(appSource, /async function goToPublicCategoryPage\(category, page = 1\)/);
  assert.match(appSource, /data-public-pagination-bar/);
  assert.match(appSource, /onclick="goToPublicCategoryPage\('\$\{adminAttr\(key\)\}', \$\{visiblePage\}\)"/);
  assert.match(appSource, /limit=\$\{PUBLIC_RESULTS_PAGE_SIZE\}&page=\$\{safePage\}/);
  assert.match(appSource, /async function fetchPublicCategoryRows\(category, totalCount = 0, options = \{\}\)/);
  assert.match(appSource, /async function refreshActivePublicInventoryCategoryFromApi\(\{ silent = true \} = \{\}\)/);
  assert.match(appSource, /if \(publicListingsApiLoading\) return refreshActivePublicInventoryCategoryFromApi\(\{ silent \}\)/);
  assert.match(appSource, /return "\/api\/properties\?status=approved&public_only=1&student_portal=1"/);
  assert.match(appSource, /category=\$\{encodeURIComponent\(normalized\)\}/);
  assert.match(appSource, /const activeCategory = activePublicInventoryCategoryFromRoute\(\)/);
  assert.match(appSource, /onPageRows: \(pageRows, pageResponse\) => \{/);
  assert.match(appSource, /applyPublicRowsForUi\(pageRows, pageResponse\);\s*renderAll\(\);/);
  assert.match(appSource, /await fetchPublicCategoryRows\(activeCategory, categoryTotal, \{/);
  assert.match(appSource, /renderPublicCategoryPageWithAuthoritativeCache\("sale", saleListings, \{/);
  assert.match(appSource, /renderPublicCategoryPageWithAuthoritativeCache\("rent", rentListings, \{/);
  assert.match(appSource, /setPublicCategoryCount\(key, total, \{ filtered: true \}\)/);
  assert.match(appSource, /renderPublicCategoryPage\("sale", list, \{/);
  assert.match(appSource, /renderPublicCategoryPage\("rent", list, \{/);
  assert(appSource.includes('const summaryParam = hasSummaryParam ? "" : `&include_summary=${includeSummary ? "1" : "0"}`;'));
  assert.match(appSource, /publicListingsApiTotal = Number\.isFinite\(apiTotal\) \? apiTotal : rows\.length/);
  assert.match(appSource, /apiRequest\(`\$\{path\}\$\{separator\}limit=\$\{limit\}&page=\$\{page\}\$\{summaryParam\}`, \{ skipAuth: true \}\)/);
  assert.match(routeSource, /} else \{\s*opportunitySummary = null;\s*\}/);
  assert.match(routeSource, /const rowLimit = includeSummary \? limit : limit \+ 1/);
  assert.match(routeSource, /const pagination = includeSummary[\s\S]*approximatePublicPagination/);
  assert.match(routeSource, /newest: 'p\.created_at DESC, p\.id DESC'/);
  assert(routeSource.includes('const priceSortRankSql'), 'public inventory route should rank unpriced/outlier rows last for price sorting');
  assert.match(routeSource, /price_asc: `\$\{priceSortRankSql\} ASC, p\.price ASC NULLS LAST, p\.created_at DESC, p\.id DESC`/);
  assert.match(routeSource, /price_desc: `\$\{priceSortRankSql\} ASC, p\.price DESC NULLS LAST, p\.created_at DESC, p\.id DESC`/);
  assert.match(routeSource, /\?\s*`\$\{distanceSql\} ASC NULLS LAST, p\.created_at DESC, p\.id DESC`/);
  assert.doesNotMatch(routeSource, /} else \{\s*const countResult = await db\.query/);
  assert.match(routeSource, /isLaunchSeedListing\(property\) && !ownerCanPreview && !adminAccess/);
  assert.match(routeSource, /normalized\.set\('include_summary', parseBooleanLike\(rawValue, true\) \? '1' : '0'\)/);
  assert.match(routeSource, /normalized\.set\('page', String\(page\)\)/);
  assert.match(routeSource, /normalized\.set\('limit', String\(limit\)\)/);
  assert.match(publicInventoryPerformanceMigration, /idx_properties_public_live_created/);
  assert.match(publicInventoryPerformanceMigration, /idx_property_images_public_primary_lookup/);
  assert.match(publicInventoryPerformanceMigration, /ON property_images \(\(md5\(url\)\), property_id\)/);
});

test('public featured property feed only returns featured backend listings', () => {
  assert.match(propertiesRouteSource, /const featuredRaw = req\.query\.featured \?\? req\.query\.is_featured \?\? req\.query\.isFeatured/);
  assert.match(propertiesRouteSource, /const featuredFilterRequested = featuredRaw !== undefined/);
  assert.match(propertiesRouteSource, /if \(featuredFilterRequested\) \{/);
  assert.match(propertiesRouteSource, /COALESCE\(p\.extra_fields->>'featured', 'false'\) IN \('true', '1', 'yes'\)/);
  assert.match(propertiesRouteSource, /const defaultSort = featuredFilterRequested && featuredOnly \? 'featured' : 'newest'/);
  assert.match(appSource, /let publicFeaturedListingsFromApi = \[\]/);
  assert.match(appSource, /function getHomepageFeaturedListings\(publicListings = \[\]\)/);
  assert.match(appSource, /function loadingPropertyGridHtml\(count = 3\)/);
  assert.match(appSource, /id === "home-grid" && !publicListingsFromApiLoaded/);
  assert.match(appSource, /\/api\/properties\?status=approved&featured=true&limit=12&page=1&public_only=1&sort=featured&include_summary=0/);
  assert.match(appSource, /\/api\/properties\?status=approved&public_only=1&limit=1&page=1&summary_only=1&include_summary=1/);
  assert.match(appSource, /const featuredRowsPromise = activeCategory \? Promise\.resolve\(\[\]\) : fetchPublicFeaturedListingsFromApi\(\)/);
  assert.match(appSource, /function applyPublicOpportunityStats\(stats\)/);
  assert.match(appSource, /fetchPublicOpportunityStatsFromApi\(\)/);
  assert.match(appSource, /const featuredListings = applyPublicFeaturedRows\(rows\)/);
  assert.match(appSource, /renderGrid\("home-grid", getHomepageFeaturedListings\(publicListings\)\.slice\(0, 3\)\)/);
});

test('anonymous public agent APIs suppress QA broker records', () => {
  assert.match(agentsRouteSource, /PUBLIC_AGENT_SUPPRESSED_MARKERS = \['QA TEST - DELETE', 'SOFT LAUNCH TEST - DELETE', 'TRAINING', 'DEMO', 'SAMPLE', 'PLACEHOLDER'\]/);
  assert.match(agentsRouteSource, /function addPublicAgentLaunchTestFilter/);
  assert.match(agentsRouteSource, /function addPublicAgentSelfRegistrationFilter/);
  assert.match(agentsRouteSource, /PUBLIC_AGENT_MIN_LIVE_LISTINGS = 2/);
  assert.match(agentsRouteSource, /function addPublicAgentInventoryFilter/);
  assert.match(agentsRouteSource, /addPublicAgentLaunchTestFilter\(filters, values\)/);
  assert.match(agentsRouteSource, /addPublicAgentSelfRegistrationFilter\(filters\)/);
  assert.match(agentsRouteSource, /addPublicAgentInventoryFilter\(filters\)/);
  assert.match(agentsRouteSource, /COUNT\(\*\)::int[\s\S]*p\.agent_id = a\.id[\s\S]*p\.status = 'approved'[\s\S]*>= \$\{PUBLIC_AGENT_MIN_LIVE_LISTINGS\}/);
  assert(agentsRouteSource.includes('a.user_id IS NOT NULL'));
  assert(agentsRouteSource.includes("COALESCE(a.email, '') !~* '(qa-test|makaug\\\\.invalid|dummy|sample)'"));
  assert(agentsRouteSource.includes("COALESCE(a.licence_number, '') !~* '^(QA|TEST|DUMMY|SAMPLE)-'"));
  assert(agentsRouteSource.includes("COALESCE(a.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'"));
  assert(agentsRouteSource.includes("COALESCE(a.full_name, '') !~* '(training|demo|sample|placeholder)'"));
  assert(agentsRouteSource.includes("COALESCE(a.company_name, '') !~* '(training|demo|sample|placeholder)'"));
  assert(agentsRouteSource.includes("COALESCE(a.verification_reason, '') !~* '(training|demo|sample|placeholder)'"));
});

test('admin live endpoint mirrors public visibility and exposes cleanup action', () => {
  assert.match(adminRouteSource, /function adminLaunchTestListingCondition/);
  assert.match(adminRouteSource, /function adminPublicLiveListingCondition/);
  assert.match(adminRouteSource, /function adminPublicLiveListingWhere/);
  assert.match(adminRouteSource, /status'\)} = 'approved' OR \(\$\{adminColumn\(alias, 'status'\)\} = 'sold' AND \$\{adminColumn\(alias, 'sold_at'\)\} >= NOW\(\) - INTERVAL '7 days'\)/);
  assert.match(adminRouteSource, /function adminFeaturedListingCondition/);
  assert.match(adminRouteSource, /COUNT\(\*\) FILTER \(WHERE status = 'approved' OR \(status = 'sold' AND sold_at >= NOW\(\) - INTERVAL '7 days'\)\)::int AS public_live/);
  assert.match(adminRouteSource, /COUNT\(\*\) FILTER \(WHERE \(status = 'approved' OR \(status = 'sold' AND sold_at >= NOW\(\) - INTERVAL '7 days'\)\) AND \$\{adminFeaturedListingCondition\(''\)\}\)::int AS public_featured/);
  assert.match(adminRouteSource, /router\.get\('\/properties\/live'/);
  assert.match(adminRouteSource, /WHERE \$\{publicLiveCondition\}/);
  assert.match(adminRouteSource, /summary: \{\s*public_inventory:/);
  assert.match(adminRouteSource, /public_visible_total/);
  assert.match(adminRouteSource, /featured_total/);
  assert.match(adminRouteSource, /public_parity/);
  assert.match(adminRouteSource, /same_as_public_api/);
  assert.match(adminRouteSource, /CONCAT\('\/property\/', p\.id::text\) AS property_url/);
  assert.match(appSource, /function adminIsPublicLiveAdminListing/);
  assert.match(appSource, /function adminLiveEndpointRows/);
  assert.match(appSource, /admin_live_endpoint: true/);
  assert.match(appSource, /const trustedRows = adminLiveEndpointRows\(listings\)/);
  assert.match(appSource, /let adminPublicInventoryParity = \{\}/);
  assert.match(appSource, /publicInventoryParity: adminPublicInventoryParity/);
  assert.match(appSource, /function renderAdminLiveParitySummary/);
  assert.match(appSource, /Online public listings/);
  assert.match(appSource, /Featured online/);
  assert.match(appSource, /summary\?\.properties\?\.public_live \?\? summary\?\.properties\?\.approved/);
  assert.match(htmlSource, /admin-live-parity-summary/);
  assert.match(htmlSource, /admin-featured-parity-summary/);
  assert.match(appSource, /Open Public Listing/);
  assert.match(adminRouteSource, /router\.post\('\/test-listings\/cleanup-live'/);
  assert.match(adminRouteSource, /live_test_listing_cleanup/);
  assert.match(appSource, /adminCleanupLiveTestListings/);
  assert.match(appSource, /\/api\/admin\/test-listings\/cleanup-live/);
  assert.match(htmlSource, /admin-clean-live-tests-btn/);
});

test('homepage opportunity counter uses the public API total as the visible source of truth', () => {
  assert.match(appSource, /const apiTotal = Number\(publicListingsApiTotal \?\? 0\) \|\| 0/);
  assert.match(appSource, /const unresolvedPublicListings = Math\.max\(0, authoritativeTotal - bucketTotal\)/);
  assert.match(appSource, /if \(unresolvedPublicListings\) stats\.sale \+= unresolvedPublicListings/);
  assert.match(appSource, /stats\.other = 0/);
  assert.match(htmlSource, /hero-public-total-parity-20260610/);
  assert.match(htmlSource, /hero-route-classification-20260610/);
  assert.match(appSource, /const publicListingType = normalizedListingType \|\| getHeroPropertyOpportunityBucket\(p\)/);
  assert.match(appSource, /return "sale";\s*\}\s*function heroOpportunityStatRow/);
});

test('homepage opportunity counter preserves backend category counts and aliases', () => {
  const normalizeStats = vm.runInNewContext(`${functionSource('normalizeHeroOpportunityStats')}; normalizeHeroOpportunityStats`);
  const stats = normalizeStats({
    total: 409,
    by_type: {
      for_sale: 266,
      to_rent: 48,
      student_accommodation: 4,
      commercial: 10,
      land: 81
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), {
    total: 409,
    sale: 266,
    rent: 48,
    student: 4,
    commercial: 10,
    land: 81,
    other: 0,
    social: 0
  });
});

test('student public listings are discoverable from backend listing aliases', () => {
  const isStudent = vm.runInNewContext(`${constFunctionSource('normalizeType')}\n${functionSource('isPublicDemoTrainingListing')}\n${functionSource('isStudentDiscoverable')}; isStudentDiscoverable`);
  assert.equal(isStudent({ listing_type: 'student' }), true);
  assert.equal(isStudent({ type: 'student_accommodation' }), true);
  assert.equal(isStudent({ type: 'rent', students_welcome: 'yes' }), true);
  assert.equal(isStudent({ type: 'sale', students_welcome: true }), false);
  assert.equal(isStudent({ type: 'commercial', extra_fields: { student_verified: true } }), false);
  assert.equal(isStudent({ type: 'sale' }), false);
  assert.equal(isStudent({ type: 'student', title: 'Makaug training student room', extra_fields: { source_badge: 'Training visibility check' } }), false);
  assert.match(appSource, /function studentCard\(p, options = \{\}\) \{\s*return propCard\(p, \{ \.\.\.options, student: true \}\);\s*\}/);
  assert.match(appSource, /studentCard\(p, \{ categoryPage: "students" \}\)/);
  assert.match(appSource, /function publicCardTheme\(type, options = \{\}\)/);
  assert.match(appSource, /student: "bg-purple-700"/);
  assert.match(propertiesRouteSource, /const listingType = normalizeListingType\(req\.query\.listing_type \|\| req\.query\.type \|\| req\.query\.category\)/);
  assert.match(propertiesRouteSource, /p\.listing_type = \? OR \(p\.listing_type = \? AND p\.students_welcome = \?\)/);
  assert.match(propertiesRouteSource, /WHEN \$\{directType\} = 'rent' AND \$\{a\}\.students_welcome = TRUE THEN 'student'/);
  assert(appSource.includes('if (t !== "rent") return false;'), 'student page should not accept sale/commercial listings through students_welcome');
  assert(!appSource.includes('if (!["sale", "rent", "commercial"].includes(t)) return false;'), 'old broad student discoverability should stay removed');
  assert(appSource.includes('distanceMiles != null && Number.isFinite(Number(distanceMiles))'), 'null API distances must not render as 0.0 mi away');
});

test('public cards do not show stale Kampala area when richer location fields disagree', () => {
  const locationLabel = vm.runInNewContext([
    functionSource('cleanWhatsappValue'),
    functionSource('uniqueCleanLocationParts'),
    functionSource('publicPropertyLocationLabel'),
    'publicPropertyLocationLabel'
  ].join('\n'));

  assert.equal(
    locationLabel({
      area: 'Kampala',
      neighborhood: 'Adyel',
      city: 'Lira City',
      district: 'Lira',
      location: 'Kampala, Lira'
    }),
    'Adyel, Lira City, Lira'
  );
  assert.equal(
    locationLabel({
      area: 'Kampala',
      neighborhood: 'Mukono Town',
      city: 'Mukono',
      district: 'Mukono',
      location: 'Kampala, Mukono'
    }),
    'Mukono Town, Mukono'
  );
  assert.equal(
    locationLabel({
      area: 'Kampala',
      neighborhood: 'Kasubi',
      city: 'Rubaga',
      district: 'Kampala'
    }),
    'Kasubi, Rubaga, Kampala'
  );
  assert(appSource.includes('const displayLocation = publicPropertyLocationLabel(p);'), 'property/student cards should use the corrected public location label');
  assert(!appSource.includes('[p.area, universityDistanceText].filter(Boolean).join(", ")'), 'student cards must not prepend stale area to university labels');
});

test('listing detail has a mobile sticky contact bar with phone, source, and makaug fallback priority', () => {
  const propCardSource = functionSource('propCard');
  const openPropertyCardDetailSource = functionSource('openPropertyCardDetail');
  const openPropertyLinkDetailSource = functionSource('openPropertyLinkDetail');
  const openDetailSource = asyncFunctionSource('openDetail');
  assert.match(appSource, /function detailMobileContactBarHtml\(\{/);
  assert.match(appSource, /id="property-detail-mobile-contact-bar"/);
  assert.match(appSource, /lg:hidden fixed inset-x-0 bottom-0/);
  assert.match(appSource, /min-h-\[44px\]/);
  assert.match(appSource, /function publicCallPhoneForProperty/);
  assert.match(appSource, /function publicWhatsappPhoneForProperty/);
  assert.match(appSource, /function detailContactActionButtonsHtml/);
  assert.match(appSource, /function listingBadgeRowHtml/);
  assert.match(appSource, /function shouldShowListingTypeBadge/);
  assert.match(appSource, /function landTitleBadgeForListingHtml/);
  assert.match(appSource, /listingAgent: "Agent listed"/);
  assert.match(appSource, /listingPrivate: "Private listed"/);
  assert.match(functionSource('listingBadgeRowHtml'), /if \(!isFoundOnlineListing\(p\)\) badges\.push\(badgeHtml\(listingSourceMeta\(p\), sizeClass\)\);/);
  assert.doesNotMatch(functionSource('listingBadgeRowHtml'), /foundOnlineSourcePlatformBadgeMeta/);
  assert.doesNotMatch(functionSource('listingBadgeRowHtml'), /Sourced online/);
  assert.match(appSource, /id="detail-source-verification"/);
  assert.match(appSource, /More options \/ Report an issue/);
  assert.match(appSource, /Source date approx\./);
  assert.match(appSource, /callPhone: publicCallPhone/);
  assert.match(appSource, /whatsappPhone: publicWhatsappPhone/);
  assert.match(appSource, /actions\.push\(`<a href="\$\{adminAttr\(`tel:/);
  assert.match(appSource, /actions\.push\(`<a href="\$\{adminAttr\(buildWhatsAppUrl/);
  assert.match(appSource, /actions\.push\(`<a href="\$\{adminAttr\(sourceHref\)/);
  assert.match(appSource, /translatePropertyUi\("Call"\)/);
  assert.match(appSource, /translatePropertyUi\("Social"\)/);
  assert.match(appSource, /translatePropertyUi\("Message via social"\)/);
  assert.match(appSource, /"Social": "Mitandao"/);
  assert.match(appSource, /"Social": "ማህበራዊ"/);
  assert.match(appSource, /"Social": "تواصل"/);
  assert.match(appSource, /actions\.length >= 3 \? "grid-cols-3"/);
  assert.match(appSource, /buildWhatsAppUrl\(MAKAUG_SUPPORT_WHATSAPP/);
  assert.match(appSource, /propertyDetailContactTheme\(type = ""\)[\s\S]*bg-purple-700 hover:bg-purple-600/);
  assert.match(appSource, /sourceUrl: sourceContactUrl/);
  assert.match(propCardSource, /onclick="openPropertyCardDetail\(event, \$\{idArg\}\)"/);
  assert.match(openPropertyCardDetailSource, /return openPropertyLinkDetail\(event, id, "property_card"\)/);
  assert.match(openPropertyLinkDetailSource, /Promise\.resolve\(openDetail\(id, \{ source \}\)\)/);
  assert.match(openDetailSource, /const mobileContactBarHtml = detailMobileContactBarHtml\(\{/);
  assert(
    openDetailSource.indexOf('${listingOnlineSourceDisclosureHtml(p)}') > openDetailSource.indexOf('translatePropertyUi("Location")'),
    'source disclosure should render below the property info and location map, not at the top of the card'
  );
  assert(
    openDetailSource.indexOf('${renderUgNlisVerificationCard(p)}') > openDetailSource.indexOf('${listingOnlineSourceDisclosureHtml(p)}'),
    'UgNLIS verification should sit with source verification after the property-first content'
  );
  assert.match(openDetailSource, /\$\{renderDetailSimilarPropertiesSectionHtml\(similar\)\}/);
  assert.match(openDetailSource, /hydrateDetailSimilarProperties\(p\);/);
  ['sale', 'rent', 'students', 'commercial', 'land'].forEach((page) => {
    assert.match(appSource, new RegExp(`renderPublicCategoryPage\\("${page}"`), `${page} page should use shared public category card rendering`);
  });
  assert.match(htmlSource, /property24-contact-bar-20260709/);
  assert.match(serverSource, /property24ContactBarVersion/);
  assert.match(htmlSource, /public-contact-phone-routing-20260709/);
  assert.match(serverSource, /publicContactPhoneRoutingVersion/);
  assert.match(htmlSource, /contact-bar-copy-fit-20260709/);
  assert.match(serverSource, /contactBarCopyFitVersion/);
  assert.match(htmlSource, /contact-bar-all-properties-i18n-20260709/);
  assert.match(serverSource, /contactBarAllPropertiesI18nVersion/);
  assert.match(htmlSource, /detail-p1-p2-p4-fix-20260709/);
  assert.match(serverSource, /detailP1P2P4FixVersion/);
  assert.match(htmlSource, /tiktok-oembed-fields-20260709/);
  assert.match(serverSource, /tiktokOembedFieldsVersion/);
  assert.match(htmlSource, /badge-standardisation-20260709/);
  assert.match(serverSource, /badgeStandardisationVersion/);
  assert.match(htmlSource, /found-online-play-chip-cleanup-20260709/);
  assert.match(serverSource, /foundOnlinePlayChipCleanupVersion/);
  assert.match(propertiesRouteSource, /function publicContactPhoneForRow/);
  assert.match(propertiesRouteSource, /public_contact_phone: publicContactPhone \|\| null/);
  assert.match(appSource, /function isTikTokProfileUrl/);
  assert.match(appSource, /function isTikTokVideoUrl/);
  assert.match(appSource, /function foundOnlineSourceContactCtaUrl/);
  assert.match(appSource, /isTikTokProfileUrl\(contactUrl\) && isTikTokVideoUrl\(sourceUrl\)/);
  assert.match(appSource, /sourceContactUrl = foundOnlineSourceContactCtaUrl\(foundOnlineMeta\)/);
});

test('public result pages keep the map shell sticky without trapping it in a short scroll rail', () => {
  const mapColumnCss = (htmlSource.match(/\.listing-map-col\s*\{[\s\S]*?\n\s*\}/) || [''])[0];
  const mapShellCss = (htmlSource.match(/\.listing-map-shell\s*\{[\s\S]*?\n\s*\}/) || [''])[0];
  const mapHeightCss = (htmlSource.match(/\.listing-map-shell \.map-h\s*\{[\s\S]*?\n\s*\}/) || [''])[0];
  assert.match(mapColumnCss, /position:\s*relative;/, 'the right rail should stretch with the results grid instead of becoming the sticky element');
  assert.match(mapColumnCss, /align-self:\s*stretch;/, 'the right rail should stay as tall as the listing results section');
  assert.doesNotMatch(mapColumnCss, /overflow-y:\s*auto;/, 'the right rail must not trap the map in an internal scroll area');
  assert.doesNotMatch(mapColumnCss, /max-height:/, 'the right rail must not end before the listing results section');
  assert.match(mapShellCss, /position:\s*sticky;/, 'the map shell itself should be sticky');
  assert.match(mapShellCss, /top:\s*5\.75rem;/, 'the map should pin below the public header/search chrome');
  assert.match(mapShellCss, /max-height:\s*calc\(100vh - 6\.75rem\);/, 'the sticky stack should fit below the public header');
  assert.match(mapShellCss, /overflow-y:\s*auto;/, 'the combined map and assist form should scroll as one pinned panel when needed');
  assert.match(mapHeightCss, /height:\s*min\(52vh,\s*calc\(100vh - 22rem\),\s*430px\);/, 'the sticky map should leave space for the pinned assist form');
  assert.match(mapHeightCss, /min-height:\s*340px;/, 'desktop maps should not collapse while sharing the sticky rail');
  for (const page of ['sale', 'rent', 'students', 'commercial', 'land', 'brokers']) {
    assert.match(
      htmlSource,
      new RegExp(`<div class="hidden lg:block listing-map-col">[\\s\\S]*?<div class="listing-map-shell">[\\s\\S]*?<div id="map-${page}" class="map-h[\\s\\S]*?<div class="map-assist-card`),
      `${page} results page should pin the map and assist form inside the shared sticky rail`
    );
  }
  assert.match(htmlSource, /public-sticky-map-assist-rail-20260710/);
  assert.match(serverSource, /publicStickyMapAssistRailVersion/);
});

test('public shell uses precompiled Tailwind CSS instead of the runtime Play CDN', () => {
  assert.match(htmlSource, /<link rel="stylesheet" href="\/assets\/tailwind\.css">/);
  assert.doesNotMatch(htmlSource, /cdn\.tailwindcss\.com/);
  assert.match(htmlSource, /tailwind-static-css-20260710/);
  assert.match(serverSource, /tailwindStaticCssVersion = 'tailwind-static-css-20260710'/);
  assert.match(packageSource, /"build:css": "tailwindcss -c tailwind\.config\.cjs -i assets\/tailwind\.input\.css -o assets\/tailwind\.css --minify"/);
  assert.match(packageSource, /"build:bot": "npm run build:css && tsc -p tsconfig\.json"/);
  assert.match(tailwindConfigSource, /content: \['\.\/index\.html', '\.\/assets\/makaug-app\.js'\]/);
  assert.ok(tailwindCssSource.length > 100000, 'compiled Tailwind CSS should be present, not an empty placeholder');
  assert.match(tailwindCssSource, /\.bg-green-700/);
  assert.match(tailwindCssSource, /\.text-green-700/);
  assert.match(tailwindCssSource, /\.md\\:grid-cols-2/);
  assert.match(tailwindCssSource, /\.rounded-2xl/);
  assert.match(tailwindCssSource, /\.hover\\:bg-green-50:hover/);
});

test('public result pages expose the full inventory and avoid black iframe media cards', () => {
  assert.match(appSource, /const PUBLIC_LISTINGS_BACKGROUND_MAX_PAGES = 80;/);
  assert.match(appSource, /const PUBLIC_LISTINGS_ROUTE_SEARCH_MAX_PAGES = 80;/);
  assert.match(appSource, /const PUBLIC_RESULTS_PAGE_SIZE = 24;/);
  assert.doesNotMatch(appSource, /const PUBLIC_LISTINGS_BACKGROUND_MAX_PAGES = 2;/);
  assert.match(asyncFunctionSource('fetchPublicCategoryRows'), /fetchPublicPaginatedRows/);
  assert.doesNotMatch(asyncFunctionSource('fetchPublicCategoryRows'), /Promise\.all\(Array\.from/);
  assert.match(functionSource('renderPublicCategoryPagination'), /Page \$\{page\} of \$\{totalPages\}/);
  assert.match(functionSource('renderPublicCategoryPagination'), /‹ Prev/);
  assert.match(functionSource('renderPublicCategoryPagination'), /Next ›/);
  assert.match(functionSource('renderPublicCategoryPage'), /PUBLIC_RESULTS_PAGE_SIZE/);
  assert.match(asyncFunctionSource('fetchPublicCategoryPage'), /limit=\$\{PUBLIC_RESULTS_PAGE_SIZE\}&page=\$\{safePage\}/);
  assert.match(asyncFunctionSource('goToPublicCategoryPage'), /fetchPublicCategoryPage/);

  const sourceVisual = functionSource('foundOnlineSourceVisualHtml');
  assert.doesNotMatch(sourceVisual, /<iframe/);
  assert.match(sourceVisual, /foundOnlineSourceThumbnailUrl/);
  assert.match(sourceVisual, /foundOnlineSourcePlayControlsHtml/);
  assert.match(sourceVisual, /foundOnlineSourcePlayControlsHtml\(sourceUrl, platform, \{ chip: true, icon \}\)/);
  assert.match(functionSource('foundOnlineSourceThumbnailUrl'), /img\.youtube\.com\/vi/);
  assert.match(sourceVisual, /source preview/);
  assert.match(htmlSource, /id="source-video-modal"/);
  assert.match(functionSource('foundOnlineSourcePlayControlsHtml'), /data-source-video-play/);
  assert.match(functionSource('foundOnlineSourcePlayControlsHtml'), /options\.chip === true/);
  assert.match(functionSource('foundOnlineSourcePlayControlsHtml'), /openFoundOnlineSourceVideoPlayer/);
  assert.match(functionSource('getSourceVideoEmbedMeta'), /youtube\.com\/embed/);
  assert.match(functionSource('getSourceVideoEmbedMeta'), /autoplay: "1"/);
  assert.match(functionSource('getSourceVideoEmbedMeta'), /getTikTokEmbedUrl/);
  assert.match(functionSource('getXPostEmbedUrl'), /platform\.twitter\.com\/embed\/Tweet\.html/);
  assert.match(functionSource('openFoundOnlineSourceVideoPlayer'), /source-video-frame-wrap/);
  assert.match(functionSource('openFoundOnlineSourceVideoPlayer'), /openModal\("source-video-modal"\)/);

  const socialTile = functionSource('socialImportListingCardHtml');
  assert.match(socialTile, /data-social-import-tile="1"/);
  assert.match(socialTile, /socialImportTileMediaHtml/);
  assert.match(socialTile, /socialImportPriceHtml/);
  assert.match(socialTile, /socialImportSpecsHtml/);
  assert.match(socialTile, /socialImportProvenanceHtml/);
  assert.match(functionSource('socialImportPlatformMeta'), /label: "TikTok"/);
  assert.match(functionSource('socialImportPlatformMeta'), /label: "X"/);
  assert.match(functionSource('normalizeSocialImportPlatform'), /x\.com\//);
  assert.match(functionSource('socialImportPlatformMeta'), /label: "Facebook"/);
  assert.match(functionSource('socialImportPlatformMeta'), /label: "Instagram"/);
  assert.match(functionSource('socialImportMediaType'), /fb\\.watch/);
  assert.match(functionSource('socialImportMediaBadgeHtml'), /ti-player-play-filled/);
  assert.match(functionSource('socialImportMediaBadgeHtml'), /ti-photo/);
  assert.match(functionSource('socialImportTileMediaHtml'), /social-import-source-chip/);
  assert.match(functionSource('socialImportMediaBadgeHtml'), /social-import-media-badge/);
  assert.match(functionSource('propCard'), /return socialImportListingCardHtml\(p, options\);/);
  assert.match(htmlSource, /social-import-tiles-20260713/);

  const detailMap = asyncFunctionSource('initDetailMap');
  assert.match(functionSource('renderStaticDetailMapFallback'), /staticmap\.openstreetmap\.de/);
  assert.match(detailMap, /renderStaticDetailMapFallback\(el, p, point\)/);
});

test('public properties API is cacheable and uses the fast public summary path', () => {
  assert.match(propertiesRouteSource, /function readPositiveIntegerEnv\(names, fallback\)/);
  assert.match(propertiesRouteSource, /PUBLIC_PROPERTIES_CACHE_TTL_MS = readPositiveIntegerEnv\(/);
  assert.match(propertiesRouteSource, /PUBLIC_OPPORTUNITY_SUMMARY_CACHE_TTL_MS/);
  assert.match(propertiesRouteSource, /60 \* 1000/);
  assert.match(propertiesRouteSource, /function publicPropertiesCacheControl\(\)/);
  assert.match(propertiesRouteSource, /function clearPublicPropertiesCache\(reason = 'public_inventory_changed'\)/);
  assert.match(propertiesRouteSource, /PUBLIC_PROPERTIES_CACHE_IGNORED_QUERY_KEYS = new Set\(\['cache_refresh', 'cacheRefresh', 'deploy_probe', 'v', '_'\]\)/);
  assert.match(propertiesRouteSource, /function isPublicCacheRefreshRequest\(req\)/);
  assert.match(propertiesRouteSource, /X-Makaug-Properties-Cache', 'HIT'/);
  assert.match(propertiesRouteSource, /forcePublicCacheRefresh \? 'REFRESH' : 'MISS'/);
  assert.match(propertiesRouteSource, /X-Makaug-Properties-Cache', canUsePublicResponseCache \? \(forcePublicCacheRefresh \? 'REFRESH' : 'MISS'\) : 'BYPASS'/);
  assert.match(propertiesRouteSource, /function fastPublicOpportunityBucketSql\(alias = 'p'\)/);
  assert.match(propertiesRouteSource, /const opportunityBucketSql = fastPublicOpportunityBucketSql\('p'\)/);
  assert.match(propertiesRouteSource, /function approximatePublicPagination/);
  assert.match(propertiesRouteSource, /public_opportunities: includeSummary \? opportunitySummary : null/);
  assert.doesNotMatch(propertiesRouteSource, /SELECT COUNT\(\*\)::int AS total\s+FROM properties p\s+\$\{where\}/);
  assert.match(propertiesRouteSource, /WITH public_page_source AS/);
  assert.match(propertiesRouteSource, /COALESCE\(p\.extra_fields, '\{\}'::jsonb\)\s+- 'raw_source_post'/);
  assert.match(propertiesRouteSource, /WHERE i\.property_id = public_page\.id/);
  assert.match(serverSource, /PUBLIC_HTML_WARMUP_PATHS = \['\/'\]/);
  assert.match(serverSource, /PUBLIC_INVENTORY_WARMUP_PATHS = \[/);
  assert.match(serverSource, /PUBLIC_CACHE_WARMUP_INTERVAL_MS = 45 \* 1000/);
  assert.match(serverSource, /function addPublicCacheRefreshParam\(pathName\)/);
  assert.match(serverSource, /function schedulePublicCacheWarmup\(baseUrl\)/);
  assert.match(serverSource, /publicInventoryPerformanceVersion = 'public-inventory-performance-20260629'/);
  assert.match(serverSource, /publicInventoryProgressiveRenderVersion = 'public-inventory-progressive-render-20260630'/);
  assert.match(serverSource, /publicInventoryFirstPageVersion = 'public-inventory-first-page-24-20260630'/);
  assert.match(serverSource, /publicInventoryCacheKeyVersion = 'public-inventory-cache-key-20260630'/);
  assert.match(serverSource, /publicHomepageFeaturedFastVersion = 'public-home-featured-fast-20260630'/);
  assert.match(serverSource, /publicHomepageSummaryFastVersion = 'public-home-summary-fast-20260630'/);
  assert.match(htmlSource, /public-summary-stale-session-fix-20260701/);
  assert.match(serverSource, /\.\.\.PUBLIC_HTML_WARMUP_PATHS, \.\.\.PUBLIC_INVENTORY_WARMUP_PATHS/);
  assert.match(serverSource, /\/api\/properties\?status=approved&public_only=1&limit=1&page=1&include_summary=1/);
  assert.match(serverSource, /\/api\/properties\?status=approved&public_only=1&limit=8&page=1&include_summary=0/);
  assert.match(serverSource, /\/api\/properties\?status=approved&public_only=1&listing_type=sale&limit=8&page=1&include_summary=0/);
  assert.match(serverSource, /\/api\/properties\?status=approved&public_only=1&listing_type=rent&limit=8&page=1&include_summary=0/);
  assert.match(serverSource, /\/api\/properties\?status=approved&featured=true&limit=12&page=1&public_only=1&sort=featured&include_summary=0/);
  assert.match(propertiesRouteSource, /clearPublicPropertiesCache\(`listing_status_\$\{current\.status \|\| 'unknown'\}_to_\$\{nextStatus\}`\)/);
  assert.match(propertiesRouteSource, /fast_manual_notification_response/);
  assert.match(propertiesRouteSource, /runPublicInventoryFollowup\(\s*\(\) => matchListingToSavedSearches/);
  assert.doesNotMatch(propertiesRouteSource, /const opportunityBucketSql = publicOpportunityBucketSql\('p'\)/);
  assert.match(propertiesRouteSource, /Cache-Control', canUsePublicResponseCache \? publicPropertiesCacheControl\(\) : 'no-store'/);
});

test('property detail enquiries are routed to the listing contact, not the signed-in admin viewer', () => {
  const routeSource = fs.readFileSync('routes/properties.js', 'utf8');
  assert.match(routeSource, /LEFT JOIN agents a ON a\.id = p\.agent_id/);
  assert.match(routeSource, /const targetPhone = listingContact\.agent_whatsapp \|\| listingContact\.agent_phone \|\| listingContact\.lister_phone/);
  assert.match(routeSource, /type: 'property_enquiry_for_lister'/);
  assert.doesNotMatch(routeSource, /type: 'enquiry_sent'[\s\S]{0,160}recipientPhone: contactPhone/);
  assert.match(appSource, /const canPrefillInquiryFromUser = !!authState\?\.user && !isAdminViewer/);
  assert.match(appSource, /Your enquiry will go to \{name\}\./);
});

test('property share icons render real social links with javascript fallbacks', () => {
  assert.match(appSource, /function getPropertyShareHref\(property = \{\}, channel = "copy"\)/);
  assert.match(appSource, /function renderPropertyShareActions\(property, idArg, options = \{\}\)/);
  assert.match(appSource, /function sharePropertyListingFromEvent\(event, id, channel = "copy"\)/);
  assert.match(appSource, /data-property-share-channel="\$\{adminAttr\(item\.channel\)\}"/);
  assert.match(appSource, /https:\/\/wa\.me\/\?text=/);
  assert.match(appSource, /facebook\.com\/sharer\/sharer\.php/);
  assert.match(appSource, /linkedin\.com\/sharing\/share-offsite/);
  assert.match(appSource, /twitter\.com\/intent\/tweet/);
  assert.match(appSource, /www\.tiktok\.com\/upload/);
  assert.match(appSource, /renderPropertyShareActions\(p, idArg, \{ stopPropagation: true \}\)/);
  assert.match(appSource, /renderPropertyShareActions\(p, detailIdArg\)/);
});

test('broker profiles recover when public route fragments removed the profile page shell', () => {
  const source = asyncFunctionSource('openBrokerProfile');
  assert.match(appSource, /function openBrokerProfileLink\(event, id\)/);
  assert.match(appSource, /function ensureBrokerProfilePageShell\(\)/);
  assert.match(appSource, /function setCanonicalBrokerProfileUrl\(brokerOrId, source = "broker_profile"\)/);
  assert.match(appSource, /href="\$\{adminAttr\(getBrokerProfilePath\(b\)\)\}"/);
  assert.match(appSource, /onclick="return openBrokerProfileLink\(event, \$\{adminListingIdArg\(b\.id\)\}\)"/);
  assert.match(appSource, /page\.id = "page-broker-profile"/);
  assert.match(appSource, /id="broker-profile-content"/);
  assert.match(source, /const content = ensureBrokerProfilePageShell\(\)/);
  assert.match(source, /showPage\("broker-profile", \{ history: false, source: "broker_profile_open" \}\)/);
  assert.match(source, /setCanonicalBrokerProfileUrl\(b, "broker_profile_open"\)/);
  assert.match(source, /content\.innerHTML =/);
  assert.doesNotMatch(source, /document\.getElementById\("broker-profile-content"\)\.innerHTML/);
});

test('agent deep links open the broker profile route directly', () => {
  const source = asyncFunctionSource('parseInitialDeepLink');
  const start = source.indexOf('if (agentFromPath || brokerFromQuery)');
  const end = source.indexOf('const adminControl', start);
  assert(start > -1 && end > start, 'Expected agent deep-link branch to exist');
  const agentBranch = source.slice(start, end);
  assert.match(agentBranch, /await openBrokerProfile\(found\.id\)/);
  assert.match(agentBranch, /await openBrokerProfile\(loaded\.id\)/);
  assert.doesNotMatch(agentBranch, /showPage\("brokers", \{ history: false, source: "deep_link" \}\)/);
});

test('approval WhatsApp notification opens before heavy admin dashboard refresh', () => {
  const source = asyncFunctionSource('adminSetListingStatus');
  const modalIndex = source.indexOf('openAdminWhatsAppMessageModal({');
  const detailIndex = source.indexOf('const detail = await apiRequest(`/api/properties/${encodeURIComponent(backendId)}`');
  const refreshIndex = source.indexOf('void renderAdminDashboard().catch');
  assert(modalIndex > -1, 'status flow should still open the owner WhatsApp modal');
  assert(detailIndex > -1, 'status flow should still refresh approved listing detail');
  assert(refreshIndex > -1, 'dashboard refresh should be non-blocking after status update');
  assert(modalIndex < detailIndex, 'approval WhatsApp modal should open before approved listing detail refresh');
  assert(modalIndex < refreshIndex, 'approval WhatsApp modal should open before dashboard refresh starts');
  assert.match(source, /buildAdminApprovalWhatsAppMessage\(listing\)/);
  assert.doesNotMatch(source, /await renderAdminDashboard\(\);/);
});

test('King dashboard loads core review data before heavy tab-specific panels', () => {
  const needsSource = functionSource('adminDashboardActiveTabNeedsRows');
  const snapshotSource = asyncFunctionSource('fetchRemoteAdminSnapshot');
  const tabSource = functionSource('setAdminWorkflowTab');
  const renderSource = asyncFunctionSource('renderAdminDashboard');
  assert.match(needsSource, /reviewQueue: \["review", "student-sweep", "youtube-sweep"\]\.includes\(normalized\)/);
  assert.match(needsSource, /ads: normalized === "ads"/);
  assert.match(needsSource, /whatsapp: normalized === "whatsapp"/);
  assert.match(snapshotSource, /const fieldAgentParams = new URLSearchParams\(\{ limit: "10000", role: "field_agent" \}\)/);
  assert.match(snapshotSource, /shouldLoadFieldAgents \? adminSafeSnapshotRequest\("field agents"/);
  assert.match(snapshotSource, /shouldLoadAds \? adminSafeSnapshotRequest\("advertising packages"/);
  assert.match(snapshotSource, /shouldLoadWhatsapp \? adminSafeSnapshotRequest\("whatsapp insights"/);
  assert.match(snapshotSource, /shouldLoadNotifications \? adminSafeSnapshotRequest\("crm summary"/);
  assert.match(snapshotSource, /shouldLoadActionedListings \? adminSafeSnapshotRequest\("actioned listings"/);
  assert.match(snapshotSource, /if \(activeTab === "listings"\) hydrateAdminAllListingsInBackground\(headers\)/);
  assert.match(tabSource, /adminScheduleDashboardRefreshForTab\(\)/);
  assert.match(renderSource, /fetchRemoteAdminSnapshot\(\{ activeTab: activeAdminWorkflowTab/);
  assert.match(renderSource, /if \(activeAdminWorkflowTab === "staff"\) \{[\s\S]*renderAdminStaffControl\(\)/);
});

test('King dashboard clears stale admin identity instead of rendering disconnected local data', () => {
  const apiSource = asyncFunctionSource('apiRequest');
  const headersSource = functionSource('adminAuthHeaders');
  const canUseSource = functionSource('canUseLiveAdminApi');
  const snapshotSource = asyncFunctionSource('fetchRemoteAdminSnapshot');
  const requestSource = asyncFunctionSource('adminSafeSnapshotRequest');
  const renderSource = asyncFunctionSource('renderAdminDashboard');
  const clearSource = functionSource('clearStaleAdminAuthState');
  const gateSource = functionSource('renderAdminAuthFailureGate');
  assert.match(apiSource, /credentials: "same-origin"/);
  assert.match(headersSource, /headers\.Authorization = `Bearer \$\{authState\.token\}`/);
  assert.match(canUseSource, /adminApiKey \|\| hasAdminIdentity\(\)/);
  assert.match(requestSource, /Number\(error\?\.status \|\| 0\) === 401[\s\S]*adminLiveAuthFailure = error/);
  assert.match(snapshotSource, /const authFailure = buildAdminAuthFailureError\(\);[\s\S]*if \(authFailure\) throw authFailure/);
  assert.match(renderSource, /if \(e\?\.adminAuthFailure\) \{[\s\S]*renderAdminAuthFailureGate\(gate, body, e\);[\s\S]*return;/);
  assert.match(clearSource, /authState = \{ token: null, user: null \}/);
  assert.match(clearSource, /localStorage\.removeItem\(AUTH_STORAGE_KEY\)/);
  assert.match(gateSource, /Reconnect King Dashboard/);
});

test('WhatsApp property search uses the same public inventory guardrails', () => {
  assert.match(whatsappRouteSource, /WHATSAPP_PUBLIC_SUPPRESSED_LISTING_MARKERS = \['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'\]/);
  assert.match(whatsappRouteSource, /WHATSAPP_PUBLIC_SUPPRESSED_LISTING_TITLES = new Set\(\['sdgsdgd', 'sgsgsgsgs'\]\)/);
  assert.match(whatsappRouteSource, /function addWhatsappPublicListingFilter/);
  assert.match(whatsappRouteSource, /COALESCE\(\$\{safeAlias\}\.title, ''\) NOT ILIKE/);
  assert.match(whatsappRouteSource, /COALESCE\(\$\{safeAlias\}\.source, ''\) !~\* '\(qa\|test\|seed\|demo\|soft_launch\|launch_proof\)'/);
  assert.match(whatsappRouteSource, /where \+= addWhatsappPublicListingFilter\(values, 'p'\)/);
  assert.match(whatsappRouteSource, /function findWebsitePublicListings\(filters = \{\}, limit = 5\) \{\s*void filters;\s*void limit;\s*return \[\];/);
});

test('public app cache version is bumped for controlled inventory rollout', () => {
  assert.match(htmlSource, /controlled-public-inventory-20260514/);
  assert.match(htmlSource, /admin-live-control-parity-20260515/);
  assert.match(htmlSource, /live-featured-cleanup-20260519/);
  assert.match(htmlSource, /agent-inquiry-nearby-20260519/);
  assert.match(htmlSource, /approval-profile-sync-20260519/);
  assert.match(htmlSource, /broker-profile-share-links-20260519/);
  assert.match(htmlSource, /direct-agent-profile-20260519/);
  assert.match(htmlSource, /public-featured-feed-fix-20260525/);
  assert.match(htmlSource, /king-live-public-parity-20260609/);
  assert.match(htmlSource, /public-opportunity-counts-20260629/);
  assert.match(htmlSource, /public-inventory-performance-20260629/);
  assert.match(htmlSource, /public-inventory-progressive-render-20260630/);
  assert.match(htmlSource, /public-inventory-first-page-24-20260630/);
  assert.match(htmlSource, /public-inventory-cache-key-20260630/);
  assert.match(htmlSource, /public-home-featured-fast-20260630/);
  assert.match(htmlSource, /public-home-summary-fast-20260630/);
  assert.match(htmlSource, /public-active-category-feed-20260630/);
  assert.match(htmlSource, /public-active-category-progress-20260630/);
  assert.match(htmlSource, /public-category-first-page-route-20260630/);
  assert.match(htmlSource, /public-category-first-paint-8-20260630/);
  assert.match(htmlSource, /public-app-immediate-load-20260630/);
  assert.match(htmlSource, /public-app-init-immediate-20260630/);
  assert.match(htmlSource, /public-summary-prefetch-20260630/);
  assert.match(htmlSource, /public-category-focused-hydration-20260630/);
  assert.match(htmlSource, /public-category-deferred-hydration-20260630/);
  assert.match(htmlSource, /window\.__makaugAppVersion \+= "-public-scale-fast-path-20260704"/);
  assert.match(htmlSource, /window\.__makaugPublicSummaryPath = "\/api\/properties\?status=approved&public_only=1&limit=1&page=1&summary_only=1&include_summary=1"/);
  assert.match(htmlSource, /window\.__makaugPublicSummaryPromise = fetch\(window\.__makaugPublicSummaryPath, \{ credentials: "same-origin" \}\)/);
  assert.match(htmlSource, /preload\.href = "\/assets\/makaug-app\.js\?v=" \+ encodeURIComponent\(window\.__makaugAppVersion\)/);
  assert.match(htmlSource, /script\.src = "\/assets\/makaug-app\.js\?v=" \+ encodeURIComponent\(window\.__makaugAppVersion\)/);
  assert.doesNotMatch(htmlSource, /<link rel="preload" href="\/assets\/makaug-app\.js\?v=/);
  const scaleMarkerCount = (htmlSource.match(/public-scale-fast-path-20260704/g) || []).length;
  assert.ok(scaleMarkerCount >= 2, 'Expected public scale marker in both preload and runtime loader setup');
  assert.doesNotMatch(htmlSource, /DOMContentLoaded", loadMakaugApp/);
  assert.doesNotMatch(appSource, /DOMContentLoaded", initializeMakaugApp/);
  assert.match(serverSource, /publicInventoryPerformanceVersion = 'public-inventory-performance-20260629'/);
  assert.match(serverSource, /publicInventoryProgressiveRenderVersion = 'public-inventory-progressive-render-20260630'/);
  assert.match(serverSource, /publicInventoryFirstPageVersion = 'public-inventory-first-page-24-20260630'/);
  assert.match(serverSource, /publicInventoryCacheKeyVersion = 'public-inventory-cache-key-20260630'/);
  assert.match(serverSource, /publicHomepageFeaturedFastVersion = 'public-home-featured-fast-20260630'/);
  assert.match(serverSource, /publicHomepageSummaryFastVersion = 'public-home-summary-fast-20260630'/);
  assert.match(serverSource, /publicCategoryFirstPaintVersion = 'public-category-first-paint-8-20260630'/);
  assert.match(serverSource, /publicAppImmediateLoadVersion = 'public-app-immediate-load-20260630'/);
  assert.match(serverSource, /publicAppInitImmediateVersion = 'public-app-init-immediate-20260630'/);
  assert.match(serverSource, /publicSummaryPrefetchVersion = 'public-summary-prefetch-20260630'/);
  assert.match(serverSource, /publicCategoryFocusedHydrationVersion = 'public-category-focused-hydration-20260630'/);
  assert.match(serverSource, /publicCategoryDeferredHydrationVersion = 'public-category-deferred-hydration-20260630'/);
});
