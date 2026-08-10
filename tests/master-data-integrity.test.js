'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_CANONICAL_PRICE_UGX,
  deriveListingClassification,
  listingDataIntegrityReport,
} = require('../utils/listingDataIntegrity');
const { propertyPriceMetadata } = require('../utils/propertyPriceCurrency');
const {
  normalizeFoundOnlineSourcePost,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function validRent(overrides = {}) {
  return {
    listing_type: 'rent',
    title: 'Three-bedroom apartment for rent in Muyenga',
    description: 'Apartment for rent in Muyenga, Kampala at UGX 2,500,000 per month.',
    district: 'Kampala',
    area: 'Muyenga',
    price: 2500000,
    price_currency: 'UGX',
    price_original_currency: 'UGX',
    price_original: 2500000,
    price_period: 'month',
    lister_phone: '+256700000000',
    ...overrides,
  };
}

test('canonical price is always UGX while USD provenance is preserved separately', () => {
  const metadata = propertyPriceMetadata('$2,500', {
    usdToUgxRate: 3800,
    fxAsOf: '2026-08-09T00:00:00.000Z',
  });
  assert.equal(metadata.price, 9500000);
  assert.equal(metadata.price_currency, 'UGX');
  assert.equal(metadata.price_original_currency, 'USD');
  assert.equal(metadata.price_original, 2500);
  assert.equal(metadata.price_fx_rate_ugx, 3800);
});

test('approval report blocks non-canonical currency and repeated FX multiplication', () => {
  const bad = listingDataIntegrityReport(validRent({
    price: 9500000000000,
    price_currency: 'USD',
    price_original_currency: 'USD',
    price_original: 2500,
    price_fx_rate_ugx: 3800,
  }));
  assert.equal(bad.ok, false);
  assert(bad.issue_codes.includes('canonical_price_currency_not_ugx'));
  assert(bad.issue_codes.includes('price_above_100bn_ugx'));
  assert(bad.issue_codes.includes('usd_fx_magnitude_mismatch'));
  assert.equal(MAX_CANONICAL_PRICE_UGX, 100000000000);
});

test('phone-as-price, junk floors, category and period contradictions are review blockers', () => {
  const phonePrice = listingDataIntegrityReport(validRent({
    price: 700000000,
    lister_phone: '+256700000000',
  }));
  assert(phonePrice.issue_codes.includes('phone_number_stored_as_price'));

  const contradiction = listingDataIntegrityReport({
    ...validRent(),
    listing_type: 'land',
    bedrooms: 4,
    price_period: 'month',
  });
  assert(contradiction.issue_codes.includes('category_conflicts_with_source_evidence'));
  assert(contradiction.issue_codes.includes('bedrooms_on_land_category'));
  assert(contradiction.issue_codes.includes('price_period_conflicts_with_category'));
});

test('POA is explicit and mutually exclusive with a numeric price', () => {
  const validPoa = listingDataIntegrityReport(validRent({
    price: null,
    price_original: null,
    price_on_application: true,
  }));
  assert.equal(validPoa.issue_codes.includes('missing_price_without_poa'), false);

  const missingPoa = listingDataIntegrityReport(validRent({ price: null, price_original: null }));
  assert(missingPoa.issue_codes.includes('missing_price_without_poa'));

  const conflict = listingDataIntegrityReport(validRent({ price_on_application: true }));
  assert(conflict.issue_codes.includes('price_and_poa_conflict'));
});

test('nightly and hospitality posts are rejected by intake, never converted to monthly rent', () => {
  const raw = {
    source_url: 'https://www.tiktok.com/@host/video/7000000000000000116',
    source_platform: 'tiktok',
    source_name: 'Host',
    title: 'Airbnb apartment in Kira',
    caption: 'Short-stay apartment in Kira, Wakiso for UGX 180,000 per night. Contact this profile.',
    area: 'Kira',
    district: 'Wakiso',
    price: 180000,
    price_period: 'night',
    listing_type: 'rent',
  };
  const listing = normalizeFoundOnlineSourcePost(raw);
  const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
  assert.equal(deriveListingClassification(listing).hospitality, true);
  assert.equal(intake.eligible, false);
  assert(intake.data_integrity.issue_codes.includes('unsupported_hospitality_or_nightly'));
});

test('commercial category shorthand becomes a real subtype filter', () => {
  const route = read('routes/properties.js');
  assert.match(route, /COMMERCIAL_PROPERTY_TYPES\.includes\(categoryToken\)/);
  assert.match(route, /categoryCommercialType \? 'commercial'/);
  assert.match(route, /commercial_type \|\| categoryCommercialType/);
  assert.match(route, /LOWER\(COALESCE\(p\.property_type, p\.extra_fields->>'commercial_type', ''\)\) = \?/);
});

test('all publication paths use the integrity gate and invalidate count cache', () => {
  const propertyRoute = read('routes/properties.js');
  const staffRoute = read('routes/staff.js');
  const adminRoute = read('routes/admin.js');
  const metrics = read('services/publicInventoryMetricsService.js');
  assert.match(propertyRoute, /nextStatus === 'approved'[\s\S]*listingDataIntegrityReport\(current\)/);
  assert.match(staffRoute, /staffBulkModerationDecision[\s\S]*listingDataIntegrityReport\(row\)/);
  assert.match(adminRoute, /direct-publish[\s\S]*listingDataIntegrityReport\(property\)/);
  assert.match(metrics, /function invalidatePublicInventoryMetricsCache[\s\S]*publicInventoryMetricsCache\.clear\(\)/);
  assert.match(propertyRoute, /invalidatePublicInventoryMetricsCache\(`listing_status_/);
});

test('migration 116 is additive, review-only, auditable, and contains the one-off dedupe pass', () => {
  const migration = read('db/migrations/116_master_data_integrity.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS price_original_currency TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS price_on_application BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /CHECK \(price_currency = 'UGX'\)/);
  assert.match(migration, /price > 100000000000/);
  assert.match(migration, /unsupported_hospitality_or_nightly/);
  assert.match(migration, /duplicate_property_fingerprint/);
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /moderation_stage = 'source_review'/);
  assert.match(migration, /automatic_publish', FALSE/);
  assert.doesNotMatch(migration, /status\s*=\s*'approved'/i);
});

test('King review edits source currency and POA without changing canonical currency semantics', () => {
  const app = read('assets/makaug-app.js');
  const propertyRoute = read('routes/properties.js');
  assert.match(app, /Canonical price \(UGX\)/);
  assert.match(app, /price_original_currency: get\("admin-review-price-currency-edit"\)/);
  assert.match(app, /admin-review-price-on-application-edit/);
  assert.match(app, /data-data-integrity-review/);
  assert.match(propertyRoute, /price_currency: \(\) => 'UGX'/);
  assert.match(propertyRoute, /price_original_currency/);
  assert.match(propertyRoute, /price_on_application/);
});
