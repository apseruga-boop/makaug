'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  listingPriceQuality
} = require('../utils/listingPriceQuality');
const {
  buildSocialSearchListing,
  normalizeFoundOnlineSourcePost
} = require('../services/socialSearchSourcedListingsService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('price gate blocks placeholder and implausible whole-property prices', () => {
  assert.deepEqual(
    listingPriceQuality({ listing_type: 'sale', price: 1, price_period: 'once' }).reasons,
    ['missing_or_placeholder_price']
  );
  assert.ok(
    listingPriceQuality({ listing_type: 'land', price: 50_000, price_period: 'once' })
      .reasons.includes('whole_property_price_below_100k')
  );
});

test('price gate blocks recurring sale or land and requires confirmation above 100m monthly', () => {
  assert.ok(
    listingPriceQuality({ listing_type: 'land', price: 20_000_000, price_period: 'month' })
      .reasons.includes('land_price_marked_recurring')
  );
  assert.ok(
    listingPriceQuality({
      listing_type: 'commercial',
      transaction_type: 'rent',
      price: 150_000_000,
      price_period: 'month',
      description: 'Commercial warehouse for rent at UGX 150M per month'
    }).reasons.includes('high_monthly_price_requires_staff_confirmation')
  );
  assert.equal(
    listingPriceQuality({
      listing_type: 'commercial',
      transaction_type: 'rent',
      price: 150_000_000,
      price_period: 'month',
      description: 'Commercial warehouse for rent at UGX 150M per month'
    }, { highMonthlyPriceConfirmed: true }).ok,
    true
  );
});

test('source intake repairs explicit sale language and routes missing price evidence to review', () => {
  const sale = normalizeFoundOnlineSourcePost({
    listing_type: 'commercial',
    title: 'Commercial building on sale',
    description: 'Commercial building for sale in Wakiso at UGX 150M',
    district: 'Wakiso',
    area: 'Nansana',
    price: 150_000_000,
    price_period: 'month',
    source_url: 'https://www.youtube.com/watch?v=price-gate-sale'
  });
  assert.equal(sale.price_period, 'once');
  assert.equal(sale.transaction_type, 'sale');

  const pending = buildSocialSearchListing({
    ...sale,
    key: 'missing-price-evidence',
    agentKey: 'test-source',
    listingType: 'sale',
    title: 'House for sale in Kira',
    description: 'Call for the asking price',
    sourceText: 'House for sale in Kira. Call for the asking price.',
    sourceTitle: 'House for sale in Kira',
    price: null,
    price_period: 'once',
    area: 'Kira',
    district: 'Wakiso',
    address: 'Kira, Wakiso',
    lat: 0.4,
    lng: 32.64
  });
  assert.equal(pending.status, 'pending');
  assert.match(pending.moderation_reason, /Pending King review/i);
  assert.ok(JSON.parse(pending.extra_fields).price_quality.reasons.includes('missing_or_placeholder_price'));
});

test('all approval paths and historic repair migration use the shared gate', () => {
  const properties = read('routes/properties.js');
  const staff = read('routes/staff.js');
  const app = read('assets/makaug-app.js');
  const migration = read('db/migrations/095_listing_price_quality_gate.sql');
  const missingPriceMigration = read('db/migrations/096_listing_price_quality_missing_price_hold.sql');

  assert.match(properties, /Listing price data must be corrected or confirmed before approval/);
  assert.match(properties, /high_monthly_price_confirmed/);
  assert.match(properties, /price_basis_verified_at/);
  assert.match(staff, /reason: 'price_data_quality'/);
  assert.match(app, /High recurring price verification required/);
  assert.match(app, /high_monthly_price_confirmed/);
  assert.match(app, /data-price-confirmation-required/);
  assert.match(migration, /explicit_source_sale_language/);
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /'featured', false/);
  assert.match(migration, /price_quality_previous_status/);
  assert.match(missingPriceMigration, /p\.price IS NULL OR p\.price <= 1/);
  assert.match(missingPriceMigration, /missing_or_placeholder_price/);
  assert.match(missingPriceMigration, /status = 'pending'/);
});
