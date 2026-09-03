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
  assert(bad.issue_codes.includes('canonical_price_currency_mismatch'));
  assert(bad.issue_codes.includes('price_above_canonical_sanity_limit'));
  assert(bad.issue_codes.includes('fx_magnitude_mismatch'));
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

test('category classifier gives physical property type and explicit transaction intent precedence', () => {
  const cases = [
    {
      title: 'Apartment for sale with 12m monthly income',
      listing_type: 'student',
      expected: 'sale',
    },
    {
      title: 'Rentals for sale in Mpererwe',
      listing_type: 'student',
      expected: 'sale',
    },
    {
      title: 'House for rent in Rubaga',
      description: 'Three bedrooms and two bathrooms.',
      listing_type: 'commercial',
      bedrooms: 3,
      bathrooms: 2,
      expected: 'rent',
    },
    {
      title: 'Prime land for sale in Kyanja',
      description: 'Ideal for a residential apartment development.',
      listing_type: 'rent',
      expected: 'land',
    },
    {
      title: 'Plots for sale in Kiwenda',
      listing_type: 'sale',
      expected: 'land',
    },
    {
      title: '7-bedroom mansion for sale collecting 20m monthly income',
      listing_type: 'student',
      bedrooms: 7,
      expected: 'sale',
    },
    {
      title: 'Apartment block for sale making UGX 12m per month',
      listing_type: 'commercial',
      expected: 'sale',
    },
    {
      title: '4 acres for sale in Makerere',
      description: 'Suitable for homes and apartments.',
      listing_type: 'student',
      expected: 'land',
    },
    {
      title: 'Office space for rent in Ntinda',
      listing_type: 'sale',
      expected: 'commercial',
      expectedTransaction: 'rent',
    },
    {
      title: 'Hostel near Makerere per semester',
      listing_type: 'rent',
      expected: 'student',
    },
    {
      title: 'Two bedrooms home at 400k #housesforrent',
      description: 'Browse houses for sale across Uganda.',
      listing_type: 'rent',
      bedrooms: 2,
      expected: 'rent',
    },
    {
      title: 'This apartment is going for UGX 1.5M a month',
      description: 'Generic property catalogue with homes for sale.',
      listing_type: 'rent',
      expected: 'rent',
    },
    {
      title: '#house Forrent 2bedrooms 2bathrooms in Kira',
      listing_type: 'rent',
      bedrooms: 2,
      expected: 'rent',
    },
    {
      title: 'Kitende land deal - 3 acres with Milo title',
      description: 'Suitable for homes and apartments.',
      listing_type: 'commercial',
      expected: 'land',
    },
    {
      title: '42-decimal plot in Mbalwa',
      description: 'Residential development opportunity.',
      listing_type: 'sale',
      expected: 'land',
    },
    {
      title: 'New appartment for rent in Wakiso town',
      source_caption: '#affordableplots #landforsale #newbuilding',
      listing_type: 'rent',
      expected: 'rent',
    },
    {
      title: '34 rental units apartment block fully occupied for sale',
      source_caption: 'Making monthly income, seated on 38 decimals with a Mailo land title.',
      listing_type: 'sale',
      bedrooms: 34,
      expected: 'sale',
    },
  ];

  for (const fixture of cases) {
    const classification = deriveListingClassification(fixture);
    assert.equal(classification.listing_type, fixture.expected, fixture.title);
    if (fixture.expectedTransaction) {
      assert.equal(classification.transaction_type, fixture.expectedTransaction, fixture.title);
    }
    assert.equal(classification.category_ambiguous, false, fixture.title);
  }
});

test('genuinely contradictory transaction evidence stays in its original category for review', () => {
  const record = validRent({
    listing_type: 'sale',
    title: 'House for sale and for rent in Kira',
    description: 'Contact the owner for clarification.',
  });
  const classification = deriveListingClassification(record);
  const report = listingDataIntegrityReport(record);

  assert.equal(classification.listing_type, 'sale');
  assert.equal(classification.category_ambiguous, true);
  assert(report.issue_codes.includes('category_ambiguous'));
  assert.equal(report.issues.find((issue) => issue.code === 'category_ambiguous').proposed_listing_type, 'sale');
});

test('generated description boilerplate cannot invent a transaction for an ambiguous source title', () => {
  const record = validRent({
    listing_type: 'rent',
    title: 'A brand new spacious 2 bedroom apartment',
    description: 'Browse houses for sale and rent across Uganda.',
    source_title: 'comfortpropertyconsulta',
  });
  const classification = deriveListingClassification(record);
  const report = listingDataIntegrityReport(record);

  assert.equal(classification.listing_type, 'rent');
  assert.equal(classification.category_ambiguous, true);
  assert(report.issue_codes.includes('category_ambiguous'));
});

test('editorial and non-listing source text stays in the original category for review', () => {
  const cases = [
    {
      listing_type: 'rent',
      title: 'Kampala property investment playbook',
      source_text: 'A discussion about buying land, apartments, offices and professional property management.',
    },
    {
      listing_type: 'rent',
      title: 'Community gathering this evening',
      source_text: 'Meet at Plot 47 Kigo at 5:30 PM.',
    },
  ];

  for (const record of cases) {
    const classification = deriveListingClassification(record);
    const report = listingDataIntegrityReport({ ...validRent(), ...record });
    assert.equal(classification.listing_type, record.listing_type);
    assert.equal(classification.category_ambiguous, true);
    assert(report.issue_codes.includes('category_ambiguous'));
  }
});

test('found-online intake uses the shared precedence classifier for future harvested rows', () => {
  const cases = [
    ['Apartment for sale with 12m monthly income', 'sale'],
    ['Rentals for sale in Mpererwe', 'sale'],
    ['House for rent in Rubaga', 'rent'],
    ['Prime land for sale in Kyanja', 'land'],
    ['Plots for sale in Kiwenda', 'land'],
    ['7-bedroom mansion for sale collecting 20m monthly income', 'sale'],
    ['Apartment block for sale making UGX 12m per month', 'sale'],
    ['4 acres for sale in Makerere', 'land'],
    ['Office space for rent in Ntinda', 'commercial'],
    ['Hostel near Makerere per semester', 'student'],
    ['Two bedrooms home at 400k #housesforrent', 'rent'],
    ['This apartment is going for UGX 1.5M a month', 'rent'],
    ['#house Forrent 2bedrooms 2bathrooms in Kira', 'rent'],
    ['Kitende land deal - 3 acres with Milo title', 'land'],
    ['42-decimal plot in Mbalwa', 'land'],
    ['New appartment for rent in Wakiso town', 'rent'],
    ['34 rental units apartment block fully occupied for sale', 'sale'],
  ];

  cases.forEach(([title, expected], index) => {
    const listing = normalizeFoundOnlineSourcePost({
      source_url: `https://www.tiktok.com/@precedence/video/${7000000000000000200n + BigInt(index)}`,
      source_platform: 'tiktok',
      title,
      listing_type: 'student',
      area: 'Ntinda',
      district: 'Kampala',
      price: 100000000,
    });
    assert.equal(listing.listingType === 'students' ? 'student' : listing.listingType, expected, title);
  });
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
  const handlerStart = route.indexOf('async function listPropertiesHandler');
  const listHandler = route.slice(handlerStart, route.indexOf("router.get('/search'", handlerStart));
  assert.match(listHandler, /const categoryCommercialType = COMMERCIAL_PROPERTY_TYPES\.includes\(categoryToken\)/);
  assert.match(listHandler, /categoryCommercialType \? 'commercial'/);
  assert.match(listHandler, /commercial_type \|\| categoryCommercialType/);
  assert.match(listHandler, /LOWER\(COALESCE\(p\.property_type, p\.extra_fields->>'commercial_type', ''\)\) = \?/);
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
  const server = read('server.js');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS price_original_currency TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS price_on_application BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /status NOT IN \('approved', 'pending'\)[\s\S]*price_currency IS NOT DISTINCT FROM 'UGX'/);
  assert.match(migration, /price > 100000000000/);
  assert.match(migration, /unsupported_hospitality_or_nightly/);
  assert.match(migration, /duplicate_property_fingerprint/);
  assert.match(migration, /CREATE TEMP TABLE price_snapshot_116/);
  assert.match(migration, /fx_magnitude_repaired_requires_review/);
  assert.match(migration, /currency_conversion_requires_review/);
  assert.match(migration, /status = CASE WHEN p\.status = 'approved' THEN 'pending' ELSE p\.status END/);
  assert.match(migration, /WHERE previous_status = 'approved'/);
  assert.match(migration, /moderation_stage = CASE WHEN p\.status = 'approved' THEN 'source_review'/);
  assert.match(migration, /automatic_publish', FALSE/);
  assert.doesNotMatch(migration, /SET status\s*=\s*'approved'/i);
  assert.doesNotMatch(migration, /SET[\s\S]{0,160}listing_type\s*=/i);
  assert.match(server, /markers:\s*\[[\s\S]*'canonical-location-source-review-115'[\s\S]*'master-data-integrity-116'/);
});

test('migration 116 transforms only active rows and creates demotion events only for approved rows', () => {
  const migration = read('db/migrations/116_master_data_integrity.sql');
  const propertyUpdates = [...migration.matchAll(/UPDATE properties(?:\s+p)?[\s\S]*?;/gi)].map((match) => match[0]);

  assert.equal(propertyUpdates.length, 3, 'all three property updates must be covered by the active-row gate');
  propertyUpdates.forEach((statement, index) => {
    assert.match(statement, /status IN \('approved', 'pending'\)/, `update ${index + 1} must target active rows only`);
    assert.match(statement, /status NOT IN \('rejected', 'deleted'\)/, `update ${index + 1} must explicitly protect rejected and deleted rows`);
  });
  assert.match(migration, /WITH evidence AS[\s\S]*WHERE p\.status IN \('approved', 'pending'\)/);
  assert.match(migration, /WITH duplicate_candidates AS[\s\S]*WHERE status IN \('approved', 'pending'\)/);
  assert.match(migration, /status = CASE WHEN p\.status = 'approved' THEN 'pending' ELSE p\.status END/);
  assert.match(migration, /FROM queued\s+WHERE previous_status = 'approved'/);
  assert.doesNotMatch(migration, /SET status = 'pending'/);
});

test('King review edits source currency and POA without changing canonical currency semantics', () => {
  const app = read('assets/makaug-app.js');
  const propertyRoute = read('routes/properties.js');
  assert.match(app, /Canonical price \(UGX\)/);
  assert.match(app, /price_original_currency: get\("admin-review-price-currency-edit"\)/);
  assert.match(app, /admin-review-price-on-application-edit/);
  assert.match(app, /data-data-integrity-review/);
  assert.match(propertyRoute, /price_currency: \(\) => CANONICAL_PROPERTY_CURRENCY/);
  assert.match(propertyRoute, /price_original_currency/);
  assert.match(propertyRoute, /price_on_application/);
});
