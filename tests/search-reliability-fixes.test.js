'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const appSource = read('assets/makaug-app.js');
const propertiesSource = read('routes/properties.js');
const aiSource = read('routes/ai.js');
const whatsappSource = read('routes/whatsapp.js');
const serverSource = read('server.js');
const migrationSource = read('db/migrations/126_quarantine_unlocated_public_properties.sql');
const zeroCoordinateMigrationSource = read('db/migrations/127_quarantine_zero_coordinate_public_property.sql');

test('public pages no longer crawl the complete inventory in the background', () => {
  assert.doesNotMatch(appSource, /PUBLIC_LISTINGS_BACKGROUND_MAX_PAGES/);
  assert.doesNotMatch(appSource, /PUBLIC_LISTINGS_ROUTE_SEARCH_MAX_PAGES/);
  assert.doesNotMatch(appSource, /schedulePublicCategoryDeepHydration/);
  assert.doesNotMatch(appSource, /backgroundRowsPromise/);
  assert.match(appSource, /limit: activeCategory \? PUBLIC_RESULTS_PAGE_SIZE : PUBLIC_LISTINGS_FAST_PAGE_LIMIT,[\s\S]*maxPages: 1/);
});

test('public search endpoints use a 60-second cache contract without response cookies', () => {
  assert.match(propertiesSource, /PUBLIC_LOCATION_SUGGEST_CACHE_TTL_MS = 60 \* 1000/);
  assert.match(propertiesSource, /\['PUBLIC_PROPERTIES_CACHE_TTL_MS'\],[\s\S]*60 \* 1000/);
  assert.match(propertiesSource, /res\.removeHeader\('Set-Cookie'\)/);
  assert.match(propertiesSource, /res\.set\('CDN-Cache-Control', value\)/);
  assert.match(propertiesSource, /res\.set\('Cloudflare-CDN-Cache-Control', value\)/);
  assert.match(propertiesSource, /res\.removeHeader\('CDN-Cache-Control'\)/);
  assert.match(propertiesSource, /res\.removeHeader\('Cloudflare-CDN-Cache-Control'\)/);
  assert.match(propertiesSource, /router\.get\('\/locations\/catalog',[\s\S]*setPublicPropertiesCacheHeaders\(res, true\)/);
  assert.match(propertiesSource, /router\.get\('\/locations\/resolve',[\s\S]*setPublicPropertiesCacheHeaders\(res, true\)/);
});

test('district searches roll up canonical children and stored district labels', () => {
  assert.match(propertiesSource, /canonical_location_id', ''\) LIKE ANY\(\?::text\[\]\)/);
  assert.match(
    propertiesSource,
    /canonical_location_id', ''\) = ''[\s\S]*LOWER\(TRIM\(COALESCE\(p\.district, ''\)\)\) = ANY\(\?::text\[\]\)/
  );

  const { canonicalLocationRollupCounts } = require('../utils/ugandaLocationRegistry');
  const counts = canonicalLocationRollupCounts(new Map([
    ['wakiso:wakiso', 2],
    ['wakiso:kira', 5],
    ['wakiso:kira mulawa', 7]
  ]));
  assert.equal(counts.get('wakiso:kira'), 5, 'city suggestions should use the same exact-id rule as exact search');
  assert.equal(counts.get('wakiso:wakiso'), 14, 'district suggestions should include every canonical child in the district');
});

test('count failures expose an unknown total and keep explicit pagination available', () => {
  assert.match(propertiesSource, /function approximatePublicPagination[\s\S]*total: null/);
  assert.match(propertiesSource, /totalPages: null/);
  assert.match(propertiesSource, /has_more: hasMore === true/);
  assert.match(appSource, /const unknownTotal = state\.mode === "api" && !state\.totalAuthoritative/);
  assert.match(appSource, /\$\{hasMore \? "\+" : ""\} properties/);
  assert.match(appSource, /navButton\("Next ›", page \+ 1, loading \|\| !hasMore\)/);
});

test('homepage typeahead delegates to canonical suggestions and passes the selected id', () => {
  assert.match(appSource, /function wireHeroCanonicalLocationTypeahead\(\)/);
  assert.match(appSource, /window\.setTimeout\(\(\) => fetchHeroCanonicalLocationSuggestions\(input, query\), 180\)/);
  assert.match(appSource, /\/api\/properties\/locations\/suggest\?\$\{params\.toString\(\)\}/);
  assert.match(appSource, /Number\(m\.listing_count\)[\s\S]*live/);
  assert.match(appSource, /locations: selectedHeroLocation\?\.canonical_location_id \|\| selectedHeroLocation\?\.id/);
  assert.match(appSource, /nearby: selectedHeroLocation \? 3 : ""/);
});

test('pasted and misspelled locations use one correction or require an explicit choice', () => {
  assert.match(appSource, /didYouMeanSuggestions\.length === 1/);
  assert.match(appSource, /disambiguationSuggestions\.length === 0/);
  assert.match(appSource, /Showing results for \$\{selected\.name \|\| selected\.label\} \(you typed/);
  assert.match(appSource, /Choose the intended location from the suggestions before searching/);
});

test('slow searches retry once and never claim a client-side result count', () => {
  assert.match(appSource, /PUBLIC_SEARCH_RETRY_DELAY_MS = 1500/);
  assert.match(appSource, /Still searching live properties/);
  assert.match(appSource, /renderPublicSearchDelayNotice\(startupCategory, \{ allowRetry: false \}\), 3000/);
  assert.match(appSource, /renderPublicSearchDelayNotice\(startupCategory, \{ allowRetry: true \}\), 10000/);
  assert.match(appSource, /toast\("Searching live properties\.\.\."\)/);
  assert.doesNotMatch(appSource, /toast\(`Found \$\{results\.length\} propert/);
  assert.match(serverSource, /res\.set\('Retry-After', '2'\)/);
  assert.match(propertiesSource, /function sendPublicPropertySearchUnavailable/);
  assert.match(propertiesSource, /code: 'property_search_temporarily_unavailable'/);
  assert.match(propertiesSource, /res\.status\(503\)\.json/);
});

test('web and WhatsApp AI distinguish search failure from zero results', () => {
  assert.match(aiSource, /include_summary: '1'/);
  assert.match(aiSource, /return await fetchAssistantSearchUrl\(url, \{ timeoutMs \}\)/);
  assert.match(aiSource, /fetchAssistantSearchUrl\(url, \{ timeoutMs, forceRefresh: true \}\)/);
  assert.match(aiSource, /total_matches: null/);
  assert.match(aiSource, /zero_results: false/);
  assert.match(aiSource, /Property search is temporarily busy/);
  assert.match(whatsappSource, /function whatsappSearchBusyReply/);
  assert.match(whatsappSource, /I have not treated this as no matching properties/);
  assert.match(whatsappSource, /isWhatsappPropertySearchRuntime\(intentResult\?\.intent, sessionStep\)/);
});

test('resolve shares the suggester count cache and locationless rows return to review', () => {
  assert.match(propertiesSource, /async function loadPublicLocationSuggestionCounts/);
  assert.match(propertiesSource, /const counts = await loadPublicLocationSuggestionCounts\(\)/);
  assert.match(propertiesSource, /listing_count: Number\(counts\.get\(resolution\.match\.key\)\) \|\| 0/);
  assert.match(migrationSource, /status = 'pending'/);
  assert.match(migrationSource, /moderation_stage = 'source_review'/);
  assert.match(migrationSource, /'publication_eligible', false/);
  assert.equal((migrationSource.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/g) || []).length, 4);
  assert.match(migrationSource, /AND status = 'approved'/);
  assert.match(migrationSource, /AND latitude IS NULL[\s\S]*AND longitude IS NULL/);
  assert.match(zeroCoordinateMigrationSource, /eb3515cc-3ab9-46d1-9e6e-632ae8714c05/);
  assert.match(zeroCoordinateMigrationSource, /AND latitude = 0[\s\S]*AND longitude = 0/);
  assert.match(zeroCoordinateMigrationSource, /status = 'pending'/);
  assert.match(zeroCoordinateMigrationSource, /'publication_eligible', false/);
});
