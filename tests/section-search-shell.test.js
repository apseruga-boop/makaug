'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const appSource = fs.readFileSync('assets/makaug-app.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');
const backendProbeSource = fs.readFileSync('scripts/probe-backend-connections.js', 'utf8');
const routeProbeSource = fs.readFileSync('scripts/probe-route-transitions.js', 'utf8');
const browserProbeSource = fs.readFileSync('scripts/probe-public-routes-browser.js', 'utf8');

const sections = [
  ['sale', 'sale-location-f', 'sale-use-location-btn'],
  ['rent', 'rent-location-f', 'rent-use-location-btn'],
  ['students', 'student-q-f', 'student-use-location-btn'],
  ['land', 'land-q-f', 'land-use-location-btn'],
  ['commercial', 'commercial-q-f', 'commercial-use-location-btn'],
  ['brokers', 'broker-q-f', '']
];

test('section search shell is configured for every rollout route', () => {
  assert.match(appSource, /const SECTION_SEARCH_CONFIGS = \{/);
  assert.match(appSource, /function mountSectionSearchShell/);
  assert.match(appSource, /function runSectionSearch/);
  for (const [section, queryId, locationButtonId] of sections) {
    assert.match(appSource, new RegExp(`${section}: \\{[\\s\\S]*?key: "${section}"`));
    assert.match(appSource, new RegExp(`queryId: "${queryId}"`));
    assert.match(htmlSource, new RegExp(`id="${queryId}"`));
    if (locationButtonId) assert.match(htmlSource, new RegExp(`id="${locationButtonId}"`));
  }
});

test('section search route mount feeds analytics and backend probes', () => {
  assert.match(appSource, /mountSectionSearchShell\(targetPage\)/);
  assert.match(appSource, /runSectionSearch\(page, \{ source: `\$\{source\}_fragment` \}\)/);
  assert.match(appSource, /trackEvent\("section_search_run"/);
  assert.match(appSource, /recordHeroSearchBackendPayload\(buildHeroSearchBackendPayload/);
  assert.match(appSource, /backend_endpoint: isBrokerSearch \? "agents" : "properties_search"/);
  assert.match(appSource, /\/api\/agents\?\$\{params\.toString\(\)\}/);
  assert.match(appSource, /\/api\/properties\/search\?\$\{params\.toString\(\)\}/);
});

test('direct category route query links prefill and run section search', () => {
  assert.match(appSource, /function routeSearchHandoffPayload\(page\)/);
  assert.match(appSource, /new URLSearchParams\(window\.location\.search \|\| ""\)/);
  assert.match(appSource, /qs\.get\("area"\) \|\| qs\.get\("district"\) \|\| qs\.get\("location"\)/);
  assert.match(appSource, /query: query \|\| area/);
  assert.match(appSource, /consumeHeroSearchHandoff\(page\) \|\| routeSearchHandoffPayload\(page\)/);
  assert.match(appSource, /setValue\("student-q-f", payload\.query\)/);
  assert.match(appSource, /setValue\("sale-location-f", payload\.query\)/);
  assert.match(appSource, /const routePayload = routeSearchHandoffPayload\(config\.key\)/);
  assert.match(appSource, /shell\.dataset\.routeQueryApplied !== routeKey/);
  assert.match(appSource, /function syncActiveRouteSearchHandoff\(source = "route_query_sync"\)/);
  assert.match(appSource, /syncActiveRouteSearchHandoff\("deep_link_route_query"\)/);
  assert.match(appSource, /startup_route_query_retry/);
  assert.match(appSource, /public_inventory_route_query/);
  assert.match(appSource, /shell\.dataset\.userEdited !== "1"/);
  assert.match(appSource, /const routeQuery = routePayload\.query \|\| routePayload\.area \|\| ""/);
  assert.match(appSource, /if \(shellInput && \(!shellInput\.value \|\| options\.forceRouteQuery\)\) shellInput\.value = routeQuery/);
  assert.match(appSource, /filterStudents\(\)/);
  assert.match(appSource, /filterListings\("sale"\)/);
});

test('legacy WhatsApp hash links are normalized to public category routes', () => {
  assert.match(appSource, /function normalizeLegacyHashPublicRoute\(\)/);
  assert.match(appSource, /\^#page-\(\[a-z0-9-\]\+\)\(\?:\\\?\(\.\+\)\)\?\$/);
  assert.match(appSource, /window\.history\.replaceState\(\{ page, source: "legacy_hash_public_route" \}, "", nextPath\)/);
  assert.match(appSource, /normalizeLegacyHashPublicRoute\(\);\s*const path = \(window\.location\.pathname/);
});

test('release probes assert section search shells on public routes', () => {
  assert.match(backendProbeSource, /frontend section search shell config exists/);
  assert.match(routeProbeSource, /missing section search shell/);
  assert.match(routeProbeSource, /route-fragment-loading/);
  assert.match(routeProbeSource, /publicRouteSkeleton/);
  assert.match(browserProbeSource, /SECTION_SEARCH_ROUTES/);
  for (const [section] of sections) {
    assert.match(routeProbeSource, new RegExp(`'${section}'`));
    assert.match(browserProbeSource, new RegExp(`'${section}'`));
  }
});
