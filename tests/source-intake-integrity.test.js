'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeFoundOnlineSourcePost,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');
const {
  extractArea,
  phoneFromText,
  priceTextFromText,
} = require('../services/socialPlatformPostDiscoveryService');
const {
  propertyPriceMetadata,
} = require('../utils/propertyPriceCurrency');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function sourcePost(overrides = {}) {
  return {
    source_url: 'https://www.tiktok.com/@ugandaagent/video/7000000000000000001',
    source_platform: 'tiktok',
    source_name: 'Uganda Agent',
    title: 'House for sale in Kira',
    caption: 'House for sale in Kira, Wakiso. Call 0700000000.',
    area: 'Kira',
    district: 'Wakiso',
    price: 250000000,
    listing_type: 'sale',
    ingested_at: '2026-07-25T20:00:00.000Z',
    ...overrides,
  };
}

test('price extraction masks a Uganda phone and keeps the actual 85M listing price', () => {
  const caption = 'House for sale in Bujjuko. Selling at #85m Ugx 0706592177';
  assert.equal(priceTextFromText(caption).toLowerCase(), '85m');
  assert.equal(phoneFromText(caption), '+256706592177');

  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://www.tiktok.com/@ugandaagent/video/7000000000000000002',
    title: 'House for sale in Bujjuko',
    caption,
    area: 'Bujjuko',
    price: 706592177,
  }));
  assert.equal(listing.price, null);
  assert.equal(listing.priceText, '');
  assert.equal(listing.sourcePriceRejectionReason, 'phone_number_is_not_price');
  assert.equal(listing.sourceAgent.phone, '+256706592177');
});

test('construction cost figures are not treated as listing prices', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://www.youtube.com/watch?v=build-cost-not-listing',
    source_platform: 'youtube',
    title: 'Cost to build a three-bedroom house',
    caption: 'Construction cost breakdown: roofing materials UGX 23M.',
    price: 23000000,
    area: 'Kira',
  }));
  const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
  assert.equal(listing.price, null);
  assert.equal(listing.sourcePriceRejectionReason, 'construction_cost_is_not_listing_price');
  assert.equal(intake.eligible, false);
});

test('unresolved locations remain unresolved and never default to Kampala', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://x.com/example/status/7000000000000000003',
    source_platform: 'x',
    title: 'House for sale',
    caption: 'House for sale. Contact the source for its location.',
    area: 'Mystery Estate',
    district: '',
  }));
  assert.equal(listing.area, '');
  assert.equal(listing.district, '');
  assert.equal(listing.canonicalLocationId, null);
  assert.equal(listing.locationResolutionStatus, 'unresolved');
  assert.equal(listing.locationEvidenceConfirmed, false);
  assert.equal(sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent).eligible, false);
});

test('foreign country and currency evidence is rejected before price conversion', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://www.tiktok.com/@rwandaproperty/video/7000000000000000004',
    title: 'House for sale in Kigali',
    caption: 'House for sale in Kigali, Rwanda for 13 Million FRw.',
    area: 'Kigali',
    district: '',
    price_text: '13 Million FRw',
    price: undefined,
    price_currency: 'RWF',
  }));
  const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
  assert.equal(listing.countryGate.allowed, false);
  assert.equal(listing.price, null);
  assert.equal(listing.priceCurrency, null);
  assert.equal(listing.area, '');
  assert.equal(listing.district, '');
  assert.equal(intake.eligible, false);
  assert.equal(intake.country_gate_passed, false);
});

test('foreign phone numbers are never rewritten as Uganda numbers', () => {
  const caption = 'House for sale in Dar es Salaam. Call +255 787 123 456.';
  assert.equal(phoneFromText(caption), '');
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://www.instagram.com/p/foreign-phone-test',
    source_platform: 'instagram',
    title: 'House for sale',
    caption,
    area: '',
    district: '',
    price: 200000000,
    phone: '+255 787 123 456',
  }));
  assert.equal(listing.sourceAgent.phone, null);
  assert.equal(listing.countryGate.allowed, false);
  assert.equal(sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent).eligible, false);
});

test('USD monthly prices preserve source amount and ingest-time FX provenance', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://www.instagram.com/p/usd-rent-test',
    source_platform: 'instagram',
    title: 'Apartment for rent in Kololo',
    caption: 'Apartment for rent in Kololo, Kampala. $2,500/Month.',
    area: 'Kololo',
    district: 'Kampala',
    listing_type: 'rent',
    price: '$2,500/Month',
    price_currency: 'USD',
    ingested_at: '2026-07-25T20:00:00.000Z',
  }));
  assert.equal(listing.priceCurrency, 'USD');
  assert.equal(listing.priceOriginal, 2500);
  assert.equal(listing.price, 9500000);
  assert.equal(listing.priceFxAsOf, '2026-07-25T20:00:00.000Z');
  assert.equal(listing.price_period, 'month');
});

test('unsupported currency metadata is rejected instead of silently becoming UGX', () => {
  const metadata = propertyPriceMetadata('13 Million', { currency: 'RWF' });
  assert.equal(metadata.supported, false);
  assert.equal(metadata.price, null);
  assert.equal(metadata.price_currency, null);
  assert.equal(metadata.rejection_reason, 'unsupported_property_price_currency');
});

test('glued currency suffixes and abbreviated USD prices keep their full magnitude', () => {
  assert.equal(priceTextFromText('Smart house in Kigo at 700mugx'), '700mugx');
  assert.equal(propertyPriceMetadata(priceTextFromText('Smart house in Kigo at 700mugx')).price, 700000000);
  assert.equal(priceTextFromText('Villa in Lubowa asking 2.2bnugx'), '2.2bnugx');
  assert.equal(propertyPriceMetadata(priceTextFromText('Villa in Lubowa asking 2.2bnugx')).price, 2200000000);
  assert.equal(priceTextFromText('House for sale in Bwebajja for $400k'), '$400k');
  const usd = propertyPriceMetadata(priceTextFromText('House for sale in Bwebajja for $400k'));
  assert.equal(usd.price_currency, 'USD');
  assert.equal(usd.price_original, 400000);
});

test('specific Entebbe Road areas win over the generic road and city wording', () => {
  assert.equal(extractArea('Smart house on Kigo Road near Entebbe'), 'Kigo');
  assert.equal(extractArea('Apartment in Lubowa on Entebbe Road'), 'Lubowa');
  assert.equal(extractArea('Home in Bwebajja along Entebbe Road'), 'Bwebajja');
});

test('a newly observed exact TikTok property is reviewable when the source date is unavailable', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    source_url: 'https://www.tiktok.com/@ugandaagent/video/7000000000000000005',
    title: 'Smart house for sale on Kigo Road',
    caption: 'Three-bedroom smart house for sale on Kigo Road, Wakiso at 700mugx. Call 0700000000.',
    area: 'Kigo',
    district: 'Wakiso',
    price: '700mugx',
    published_at: '',
    ingested_at: '2026-08-02T08:00:00.000Z',
  }));
  const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
  assert.equal(listing.area, 'Kigo');
  assert.equal(listing.price, 700000000);
  assert.equal(intake.date_status, 'needs_source_platform_date_confirmation');
  assert.equal(intake.eligible, true);
});

test('same-batch fingerprint registration and integrity marker are shipped', () => {
  const importer = read('services/socialSearchSourcedListingsService.js');
  const html = read('index.html');
  assert.match(importer, /registerExistingFoundOnlineItem\(existing, item/);
  assert.match(importer, /registerExistingFoundOnlineItem\(previewCombined, item/);
  assert.match(html, /source-intake-integrity-20260725/);
});
