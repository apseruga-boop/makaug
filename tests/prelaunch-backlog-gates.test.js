const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const { canonicalLocationSearchScope } = require('../utils/ugandaLocationRegistry');
const { buildPublicSeoSnapshot } = require('../services/publicSeoService');
const { popularAreaLinks } = require('../services/publicSeoRenderService');

test('nearby zero is a literal canonical location scope, including city nodes', () => {
  const exact = canonicalLocationSearchScope(['wakiso:kira'], 0);
  assert.deepEqual(exact.exact.map((item) => item.key), ['wakiso:kira']);
  assert.equal(exact.nearby.length, 0);

  const widened = canonicalLocationSearchScope(['wakiso:kira'], 3);
  assert.deepEqual(widened.exact.map((item) => item.key), ['wakiso:kira']);
  assert.ok(widened.nearby.some((item) => item.key !== 'wakiso:kira'));

  const route = read('routes/properties.js');
  assert.match(route, /req\.query\.nearby_km \?\? req\.query\.nearbyKm \?\? req\.query\.nearby/);
  assert.match(route, /requestedRadiusKm \?\?/);
});

test('homepage Popular Areas emits one strict, clean destination per canonical area', () => {
  const rows = [];
  const add = (count, listingType, id, area, district) => {
    for (let index = 0; index < count; index += 1) {
      rows.push({
        id: `${listingType}-${id}-${index}`,
        listing_type: listingType,
        canonical_location_id: id,
        area,
        district,
        price: 1000000,
        price_period: listingType === 'rent' ? 'mo' : 'once'
      });
    }
  };
  add(6, 'sale', 'wakiso:kira', 'Kira', 'Wakiso');
  add(4, 'land', 'wakiso:kira', 'Kira', 'Wakiso');
  add(3, 'rent', 'wakiso:kira', 'Kira', 'Wakiso');
  add(5, 'sale', 'kampala:kyanja', 'Kyanja', 'Kampala');

  const links = popularAreaLinks(buildPublicSeoSnapshot(rows), 15);
  const kira = links.filter((link) => link.canonicalKey === 'wakiso:kira');
  assert.equal(kira.length, 1);
  assert.equal(kira[0].label, 'Kira');
  assert.equal(kira[0].href, '/for-sale/kira-wakiso');
  assert.equal(kira[0].count, 6, 'chip count must equal its exact for-sale destination');
});

test('period controls share category and land transaction semantics across all edit surfaces', () => {
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  const ownerRoute = read('routes/property-seeker.js');
  assert.match(app, /const LISTING_PRICE_PERIOD_OPTIONS = Object\.freeze/);
  assert.match(app, /land_sale:[\s\S]*Per Acre[\s\S]*Per Plot[\s\S]*Negotiable/);
  assert.match(app, /land_rent:[\s\S]*Per Year[\s\S]*Per Month[\s\S]*Per Acre per Year/);
  assert.match(app, /commercial_sale:[\s\S]*Price on application \(POA\)/);
  assert.match(app, /function adminReviewSyncPricePeriods/);
  assert.match(app, /function syncOwnedListingPricePeriods/);
  assert.match(app, /key: "land_mode"/);
  assert.match(app, /payload\.transaction_type = extra\.land_mode \|\| "sale"/);
  assert.match(html, /owned-edit-transaction-type-input/);
  assert.match(ownerRoute, /add\('transaction_type', transactionType\)/);
});

test('complete favicon set and compact hero counter markup are present', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('site.webmanifest'));
  for (const file of [
    'favicon.ico',
    'assets/icons/makaug-icon-16.png',
    'assets/icons/makaug-icon-32.png',
    'assets/icons/makaug-apple-touch-icon.png',
    'assets/icons/makaug-icon-192.png',
    'assets/icons/makaug-icon-512.png'
  ]) {
    assert.ok(fs.statSync(path.join(ROOT, file)).size > 0, `${file} must be non-empty`);
  }
  assert.match(html, /rel="icon" href="\/favicon\.ico"/);
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  assert.match(html, /\.hero-opportunity-counter \{[\s\S]*min-width: 0;/);
  assert.match(html, /<\/span> <span id="hero-property-count-label">property opportunities<\/span>/);
});
