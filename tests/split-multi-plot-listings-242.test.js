'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { propertyPriceMetadata, configuredUsdToUgxRate } = require('../utils/propertyPriceCurrency');
const { resolveCanonicalUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { COPY, MARKER } = require('../scripts/split-multi-plot-listings-242-copy');

test('Kawuku copy no longer mentions Bussi, and the new listing is Bussi-only', () => {
  assert.equal(COPY.p5t3f.sourceTitle, '20 acres for sale in Kawuku, Entebbe');
  assert.match(COPY.p5t3f.sourceDescription, /20 titled acres for sale in Kawuku, Entebbe/);
  assert.match(COPY.p5t3f.sourceDescription, /UGX 260 million per acre/);
  assert.doesNotMatch(COPY.p5t3f.sourceDescription, /Bussi/);
  assert.doesNotMatch(COPY.p5t3f.sourceDescription, /should be split/);
  assert.equal(COPY.p5t3f.child.title, '9 acres for sale on Bussi Island');
  assert.match(COPY.p5t3f.child.description, /9 titled acres for sale on Bussi Island/);
  assert.match(COPY.p5t3f.child.description, /UGX 160 million per acre/);
  assert.doesNotMatch(COPY.p5t3f.child.description, /Kawuku/);
  assert.equal(COPY.p5t3f.child.price, 160000000);
  assert.equal(COPY.p5t3f.child.landSizeValue, 9);
  assert.equal(COPY.p5t3f.child.copyPhotos, true);
  assert.equal(COPY.p5t3f.child.latitude, 0.04917);
  assert.equal(COPY.p5t3f.child.longitude, 32.32667);
});

test('the live Bwaise listing keeps the first advert price, and each new plot uses its own exact figure', () => {
  assert.equal(COPY.sta5.sourceTitle, 'Commercial plot for sale in Bwaise');
  assert.equal(COPY.sta5.sourcePrice, 300000000);
  assert.match(COPY.sta5.sourceDescription, /UGX 300 million/);
  assert.doesNotMatch(COPY.sta5.sourceDescription, /250 million/);
  assert.doesNotMatch(COPY.sta5.sourceDescription, /Kawempe/);
  assert.equal(COPY.sta5.clearLandSize, true);

  const prices = COPY.sta5.children.map((child) => child.price);
  assert.deepEqual(prices, [300000000, 350000000, 360000000]);
  assert.equal(COPY.sta5.children[0].title, '8-decimal commercial plot for sale in Kawempe');
  assert.equal(COPY.sta5.children[0].landSizeValue, 8);
  assert.equal(COPY.sta5.children[0].landSizeUnit, 'decimals');
  assert.match(COPY.sta5.children[0].description, /UGX 300 million/);
  assert.equal(COPY.sta5.children[1].title, '12-decimal commercial plot for sale in Kawempe town');
  assert.match(COPY.sta5.children[1].description, /Ttula Road/);
  assert.match(COPY.sta5.children[1].description, /UGX 350 million/);
  assert.equal(COPY.sta5.children[2].title, '12-decimal commercial plot for sale near Kawempe Hospital');
  assert.match(COPY.sta5.children[2].description, /Bombo Road/);
  assert.match(COPY.sta5.children[2].description, /UGX 360 million/);
  assert.ok(COPY.sta5.children.every((child) => child.copyPhotos === false));
  assert.ok(COPY.sta5.children.every((child) => !/250 million/.test(child.description)));
});

test('Namanve warehouses convert USD 1,950,000 the way the site converts other USD listings', () => {
  const rate = configuredUsdToUgxRate();
  const priced = propertyPriceMetadata(COPY.y2urd.usd, { currency: 'USD', usdToUgxRate: rate });
  assert.equal(COPY.y2urd.usd, 1950000);
  assert.equal(priced.price_original, 1950000);
  assert.equal(priced.price_original_currency, 'USD');
  assert.equal(priced.price_currency, 'UGX');
  assert.equal(priced.price_fx_rate_ugx, rate);
  assert.equal(priced.price, Math.round(1950000 * rate));
  assert.equal(priced.price, 7410000000);
  assert.equal(COPY.y2urd.description, 'Three detached warehouse units plus office space for sale in Namanve, on a 4-acre plot, at USD 1,950,000.');
  assert.doesNotMatch(COPY.y2urd.description, /stored price field was empty/);
});

test('Bussi Island resolves in the catalogue at the GeoNames island point', () => {
  const result = resolveCanonicalUgandaLocation('Bussi Island');
  assert.equal(result.status, 'matched');
  const place = result.match || result;
  assert.equal(place.name, 'Bussi');
  assert.equal(place.district, 'Wakiso');
  assert.equal(place.key, 'wakiso:bussi');
  assert.equal(Number(place.lat), 0.04917);
  assert.equal(Number(place.lng), 32.32667);
});

test('migration 242, rollback, and the startup hook are in place', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'db/migrations/242_split_multi_plot_listings.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'scripts/rollback-242-split-multi-plot-listings.sql'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(migration, /split_multi_plot_listings_242_backup/);
  assert.match(rollback, /action = 'create_split'/);
  assert.match(rollback, /status = 'pending'/);
  assert.match(server, /runSplitMultiPlotListings242/);
  assert.ok(server.indexOf('runSplitMultiPlotListings242') > server.indexOf('runPlaceholderTitlesAndPastedCopy241'));
  assert.equal(MARKER, 'split_listings_242');
});
