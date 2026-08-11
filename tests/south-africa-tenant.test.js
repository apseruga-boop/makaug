'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
const {
  SESHAIKHAYA_LAUNCH_MARKER,
  applySouthAfricaHtml,
  applySouthAfricaJavaScript,
  tenantFor
} = require('../packages/shared-country-core');
const registry = require('../utils/southAfricaLocationRegistry');
const mortgageRoute = require('../routes/mortgage');
const propertiesRoute = require('../routes/properties');
const { buildPublicSeoSnapshot } = require('../services/publicSeoService');

const root = path.resolve(__dirname, '..');
const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const publicHtml = sanitizePublicHtml(rawHtml, { pathname: '/' });
const html = applySouthAfricaHtml(publicHtml);
const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] || '';
const footer = html.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] || '';
const head = html.match(/<head>[\s\S]*?<\/head>/i)?.[0] || '';

const za = tenantFor('ZA');
assert.equal(za.countryCode, 'ZA');
assert.equal(za.currencyCode, 'ZAR');
assert.equal(za.languages.length, 11);
assert.deepEqual(za.locationHierarchy, ['province', 'city', 'suburb']);
assert.equal(za.publicFeatures.marketplace, false);
assert.equal(za.publicFeatures.valuation, false);
assert.equal(mortgageRoute.ACTIVE_COUNTRY_CODE, 'ZA');
assert.deepEqual(
  mortgageRoute.FALLBACK_MORTGAGE_PROVIDERS.map((provider) => provider.name),
  ['Standard Bank', 'Absa', 'FNB', 'Nedbank', 'Investec', 'SA Home Loans', 'ooba Home Loans']
);
for (const provider of mortgageRoute.FALLBACK_MORTGAGE_PROVIDERS) {
  assert.equal(provider.residentialRate, null, `${provider.name} must not expose an invented rate`);
  assert.match(provider.sourceUrl, /^https:\/\//);
  assert(!provider.name.includes('Uganda'));
}

for (const expected of [
  'data-country-code="ZA"',
  'seshaikhaya.com',
  'SOUTH AFRICA PROPERTY',
  'South Africa’s home for property',
  'Bond Finder',
  'ZAR',
  SESHAIKHAYA_LAUNCH_MARKER,
  '/assets/icons/seshaikhaya-mark.svg',
  '/assets/seshaikhaya.css'
]) {
  assert(html.includes(expected), `ZA HTML is missing ${expected}`);
}

for (const forbidden of [
  'id="nav-valuation"',
  'id="mnav-valuation"',
  'id="nav-marketplace"',
  'id="mnav-marketplace"',
  'Property Value',
  'Marketplace'
]) {
  assert(!nav.includes(forbidden), `ZA navigation leaked ${forbidden}`);
  assert(!footer.includes(forbidden), `ZA footer leaked ${forbidden}`);
}
assert(!head.includes('marketplace-sitemap.xml'), 'ZA head leaked Marketplace sitemap');
assert(!html.includes('256760112587'), 'ZA public HTML leaked Uganda WhatsApp number');
for (const forbidden of ['makaug how-to video', 'Help makaug find', '>District<']) {
  assert(!html.includes(forbidden), `ZA public HTML leaked ${forbidden}`);
}

const emptySeoSnapshot = buildPublicSeoSnapshot([]);
assert(Object.values(emptySeoSnapshot.counts).every((counts) => counts.size === 0));
assert(Object.values(emptySeoSnapshot.locationPriceFloors).every((prices) => prices.size === 0));
assert.deepEqual(emptySeoSnapshot.properties, []);

const rawJavaScript = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const zaJavaScript = applySouthAfricaJavaScript(rawJavaScript);
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const renderStartSource = fs.readFileSync(path.join(root, 'scripts', 'render-start.js'), 'utf8');
const renderBlueprintSource = fs.readFileSync(path.join(root, 'render.seshaikhaya.yaml'), 'utf8');
assert(serverSource.includes("app.get('/healthz'"), 'Render process health endpoint is missing');
assert(serverSource.includes("app.use('/api/health', healthRoutes)"), 'Database health endpoint must remain available');
assert(
  serverSource.indexOf("httpServer.listen(port, '0.0.0.0'") < serverSource.indexOf('await runMigrations()'),
  'Render liveness listener must bind before database migrations'
);
assert(serverSource.includes('if (runtimeReady) return next();'), 'Non-health traffic must wait for startup readiness');
assert(serverSource.includes('runtimeReady = true;'), 'Startup must release the readiness gate');
assert(
  renderStartSource.indexOf('earlyHttpServer.listen') < renderStartSource.indexOf('appProcess = fork('),
  'Render bootstrap must bind before forking the full application'
);
assert(renderStartSource.includes("=== '/healthz'"), 'Render bootstrap health endpoint is missing');
assert(renderStartSource.includes("hostname: '127.0.0.1'"), 'Render bootstrap must proxy to the isolated app process');
assert(renderStartSource.includes('PORT: String(appPort)'), 'Render app process must use a separate internal port');
assert(renderStartSource.includes("delete headers['content-length']"), 'Render proxy must not forward a stale GET body length');
assert(renderStartSource.includes("proxyRequest.end();"), 'Render proxy must explicitly finish bodyless requests');
assert(
  renderBlueprintSource.includes('startCommand: node scripts/render-start.js'),
  'Render Blueprint must use the early liveness bootstrap'
);
assert(zaJavaScript.includes('productDisplayName: "seshaikhaya.com"'));
assert(zaJavaScript.includes('let activeCur = "ZAR"'));
assert(zaJavaScript.includes('const PROPERTIES = [];'));
assert(zaJavaScript.includes('const BROKERS = [];'));
for (const ugandaPromptPlace of [
  'Gayaza', 'Makerere', 'Kololo', 'Bukoto', 'Muyenga', 'Kira',
  'Namugongo', 'Mukono', 'Matugga', 'Nakasero', 'Kyambogo', 'MUBS'
]) {
  assert(!new RegExp(`\\b${ugandaPromptPlace}\\b`).test(zaJavaScript), `ZA AI examples leaked ${ugandaPromptPlace}`);
}
for (const code of za.languages.map((language) => language.code)) {
  assert(zaJavaScript.includes(`${code}:` ) || code === 'en', `ZA JavaScript language patch is missing ${code}`);
}

assert.equal(registry.PROVINCES.length, 9);
assert(registry.CANONICAL_LOCATION_COUNT > 22_000, 'ZA registry is not nationally complete');
const seaPoint = registry.resolveCanonicalSouthAfricaLocation('Sea Point, Cape Town, Western Cape');
assert.equal(seaPoint.status, 'matched');
assert.equal(seaPoint.match.province, 'Western Cape');
assert.equal(seaPoint.match.city, 'Cape Town');
assert.equal(seaPoint.match.suburb, 'Sea Point');
assert.equal(registry.resolveCanonicalSouthAfricaLocation('Fourways').status, 'ambiguous');
assert.equal(registry.resolveCanonicalSouthAfricaLocation('Banda').status, 'unmatched');
assert.equal(registry.resolveCanonicalSouthAfricaLocation('Camps Bai').status, 'unmatched');

const province = registry.resolveCanonicalSouthAfricaLocation('Western Cape').match;
const city = registry.resolveCanonicalSouthAfricaLocation('Cape Town, Western Cape').match;
const exactScope = registry.canonicalLocationSearchScope([seaPoint.match.key], 0);
assert.deepEqual(exactScope.nearby, [], 'nearby=0 must never widen the selected suburb');

const campsBay = registry.resolveCanonicalSouthAfricaLocation('Camps Bay, Cape Town, Western Cape').match;
const rolledLocationCounts = registry.canonicalLocationRollupCounts(new Map([
  [province.key, 5],
  [city.key, 3],
  [seaPoint.match.key, 2],
  [campsBay.key, 7],
  ['unknown:orphan', 13]
]));
assert.equal(rolledLocationCounts.get(city.key), 12, 'city count must include its direct and suburb inventory');
assert.equal(rolledLocationCounts.get(province.key), 17, 'province count must include all direct, city, and suburb inventory');
assert.equal(rolledLocationCounts.get('unknown:orphan'), 13, 'non-registry direct counts must remain intact');

const provinceFilters = [];
const provinceValues = [];
assert.equal(propertiesRoute._test.addCanonicalLocationSearchFilter(
  provinceFilters,
  provinceValues,
  registry.canonicalLocationSearchScope([province.key], 0)
), true);
assert.deepEqual(provinceValues, ['Western Cape']);
assert.match(provinceFilters[0], /extra_fields->>'province'/);

const cityFilters = [];
const cityValues = [];
assert.equal(propertiesRoute._test.addCanonicalLocationSearchFilter(
  cityFilters,
  cityValues,
  registry.canonicalLocationSearchScope([city.key], 0)
), true);
assert.deepEqual(cityValues, ['Western Cape', 'Cape Town']);
assert.match(cityFilters[0], /extra_fields->>'city'/);

const suburbFilters = [];
const suburbValues = [];
assert.equal(propertiesRoute._test.addCanonicalLocationSearchFilter(suburbFilters, suburbValues, exactScope), true);
assert.deepEqual(suburbValues, [seaPoint.match.key]);
assert.match(suburbFilters[0], /canonical_location_id/);

const seaPointRow = {
  area: 'Sea Point',
  district: 'Western Cape',
  extra_fields: {
    canonical_location_id: seaPoint.match.key,
    province: 'Western Cape',
    city: 'Cape Town',
    suburb: 'Sea Point'
  }
};
assert.equal(propertiesRoute._test.publicLocationMatchForRow(
  seaPointRow,
  registry.canonicalLocationSearchScope([province.key], 0)
)?.type, 'descendant');
assert.equal(propertiesRoute._test.publicLocationMatchForRow(seaPointRow, exactScope)?.type, 'exact');

console.log('south-africa-tenant tests passed');
