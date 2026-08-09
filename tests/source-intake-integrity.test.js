'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildSocialSearchListing,
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
  assert.equal(listing.price, 85000000);
  assert.equal(listing.priceOriginal, 85000000);
  assert.equal(listing.sourcePriceRejectionReason, '');
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
  assert.equal(sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent).eligible, true);
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
  assert.match(html, /k24-intake-integrity-20260803/);
});

test('spaced Uganda phones are masked while a separate caption price remains usable', () => {
  const international = 'Apartment in Kira for rent at 900k. Call 256 702 968 650.';
  const local = 'Apartment in Kira for rent at 900k. Call 0751 281954.';
  assert.equal(phoneFromText(international), '+256702968650');
  assert.equal(phoneFromText(local), '+256751281954');
  assert.equal(priceTextFromText(international).toLowerCase(), '900k');

  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    caption: international,
    title: 'Apartment in Kira for rent',
    listing_type: 'rent',
    price: 256702968650,
  }));
  assert.equal(listing.price, 900000);
  assert.equal(listing.sourcePriceRejectionReason, '');
});

test('unit counts and prices absent from the source evidence are rejected', () => {
  const count = normalizeFoundOnlineSourcePost(sourcePost({
    caption: 'Block of 11 apartment units for sale in Kira.',
    title: 'Block of apartment units for sale',
    price: 11,
  }));
  assert.equal(count.price, null);
  assert.equal(count.sourcePriceRejectionReason, 'implausible_unit_count_is_not_price');

  const fabricated = normalizeFoundOnlineSourcePost(sourcePost({
    caption: 'House for sale in Kira. Call for the price.',
    price: 420000000,
  }));
  assert.equal(fabricated.price, null);
  assert.equal(fabricated.sourcePriceRejectionReason, 'source_price_not_in_evidence');
});

test('clean caption prices parse and low-price dwelling captions normalize to monthly rent', () => {
  const caption = 'One Bedroom Apartment at only 900k in Kireka Namugongo Road. Call 0751 281954.';
  assert.equal(priceTextFromText(caption).toLowerCase(), '900k');
  const normalized = normalizeFoundOnlineSourcePost(sourcePost({
    title: 'One Bedroom Apartment at only 900k',
    caption,
    area: '',
    district: '',
    listing_type: 'sale',
    price: 900000,
  }));
  const persisted = buildSocialSearchListing(normalized);
  assert.equal(normalized.area, 'Kireka');
  assert.equal(normalized.district, 'Wakiso');
  assert.equal(normalized.listingType, 'rent');
  assert.equal(normalized.price, 900000);
  assert.equal(normalized.price_period, 'month');
  assert.equal(persisted.listing_type, 'rent');
  assert.equal(persisted.price_period, 'month');
});

test('ordinary rentals and house sales near universities do not become student listings', () => {
  const rental = normalizeFoundOnlineSourcePost(sourcePost({
    title: 'Single room for rent in Kireka',
    caption: 'Single room for rent in Kireka at UGX 350,000 per month.',
    area: 'Kireka',
    district: 'Wakiso',
    listing_type: 'rent',
    price: 350000,
  }));
  assert.equal(buildSocialSearchListing(rental).listing_type, 'rent');

  const sale = normalizeFoundOnlineSourcePost(sourcePost({
    title: 'Four bedroom house for sale in Kyambogo',
    caption: 'Four bedroom house for sale in Kyambogo at UGX 300M.',
    area: 'Kyambogo',
    district: 'Kampala',
    listing_type: 'sale',
    price: 300000000,
    latitude: 0.3489,
    longitude: 32.6301,
  }));
  assert.equal(buildSocialSearchListing(sale).listing_type, 'sale');
});

test('expanded foreign-market gate catches GBP, Nigeria, US and Kolhapur rows', () => {
  const samples = [
    'Flat to rent in London for £635 pcm.',
    'House for sale in Abuja, Nigeria for NGN 90M.',
    'Home for sale in Memphis, USA for $250k.',
    '2 BHK apartment for sale in Kolhapur, India.',
  ];
  samples.forEach((caption, index) => {
    const listing = normalizeFoundOnlineSourcePost(sourcePost({
      source_url: `https://www.youtube.com/watch?v=foreign-${index}`,
      title: caption,
      caption,
      area: 'Kampala',
      district: 'Kampala',
      price: 250000000,
    }));
    assert.equal(listing.countryGate.allowed, false, caption);
    assert.equal(sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent).eligible, false, caption);
  });
});

test('politics, pageants and memes are rejected even when upstream metadata looks property-like', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    title: 'Miss Uganda pageant winner receives a three bedroom house',
    caption: 'Miss Uganda pageant news in Kampala: winner receives a three bedroom house worth UGX 250M.',
    area: 'Kampala',
    district: 'Kampala',
    price: 250000000,
    listing_type: 'sale',
  }));
  const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
  assert.equal(intake.eligible, false);
  assert.ok(intake.blocking_reasons.includes('not_a_listing'));
});

test('commercial source rows carry transaction and subtype without a staff pre-patch', () => {
  const listing = normalizeFoundOnlineSourcePost(sourcePost({
    title: 'Office to rent in Ntinda',
    caption: 'Commercial office to rent in Ntinda at UGX 5M per month.',
    area: 'Ntinda',
    district: 'Kampala',
    listing_type: 'commercial',
    property_type: 'commercial',
    price: 5000000,
  }));
  assert.equal(listing.listingType, 'commercial');
  assert.equal(listing.transaction_type, 'rent');
  assert.equal(listing.subtype, 'office');
  const persisted = buildSocialSearchListing(listing);
  assert.equal(persisted.transaction_type, 'rent');
  assert.equal(persisted.property_type, 'office');
});
