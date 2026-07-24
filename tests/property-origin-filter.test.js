'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const routes = read('routes/properties.js');
const app = read('assets/makaug-app.js');
const html = read('index.html');

assert(routes.includes("normalizeListingOrigin"), 'properties API must normalize the listing-origin query');
assert(routes.includes("listing_origin || req.query.listingOrigin"), 'properties API must accept listing_origin');
assert(routes.includes("${listingOriginSql('p')} = ?"), 'properties API must filter against one canonical origin expression');
assert(routes.includes("AS listing_origin"), 'public property rows must expose their canonical origin');
assert(
  routes.includes('timeoutMs: 4000'),
  'cold origin and filtered counts must have a bounded production-safe query budget'
);
assert(routes.includes("router.get('/search', listPropertiesHandler);")
  && routes.includes("router.get('/', listPropertiesHandler);"),
'search and catalogue routes must share one listing-origin implementation');
assert(
  routes.includes('withPublicPropertyDatabaseRetry(() => db.query(listSql, listValues))'),
  'public list/search should retry one transient pool failure instead of returning a first-hit 500'
);
assert(routes.includes("error: 'Invalid property id'"), 'malformed property IDs must return a controlled client error');

['sale', 'rent', 'student', 'commercial', 'land'].forEach((category) => {
  assert(html.includes(`id="${category}-origin-f"`), `${category} refine panel must include an origin filter`);
});
assert(app.includes('params.set("listing_origin"'), 'public category searches must submit the origin filter');
assert(app.includes('qs.get("listing_origin") || qs.get("listingOrigin") || qs.get("origin_type")'), 'deep links must hydrate the origin filter');
assert(app.includes('filters.listingOrigin) params.set("listing_origin", filters.listingOrigin)'), 'origin filters must survive route persistence');
assert(app.includes('listingOrigin: values.listingOrigin || ""'), 'section-search routing must retain the selected origin');
assert(app.includes('if (!page || !routeSearchHandoffPayload(page)) return false'), 'filter-only deep links must activate the route handoff');
assert(app.includes('publicListingMatchesOrigin'), 'local filtering must use the same origin semantics');
assert(app.includes('listingFoundOnlineBadgeHtml'), 'found-online cards must retain a provenance badge');
assert(app.includes('listingSourceMeta(p)'), 'private and agent cards must retain provenance badges');

console.log('property origin filter tests passed');
