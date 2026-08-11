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

const rawJavaScript = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const zaJavaScript = applySouthAfricaJavaScript(rawJavaScript);
assert(zaJavaScript.includes('productDisplayName: "seshaikhaya.com"'));
assert(zaJavaScript.includes('let activeCur = "ZAR"'));
assert(zaJavaScript.includes('const PROPERTIES = [];'));
assert(zaJavaScript.includes('const BROKERS = [];'));
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
