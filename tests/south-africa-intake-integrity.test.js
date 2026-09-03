'use strict';

const assert = require('assert');

process.env.COUNTRY_CODE = 'ZA';
process.env.USD_TO_ZAR_RATE = '18';
process.env.EUR_TO_ZAR_RATE = '21';
process.env.GBP_TO_ZAR_RATE = '24';

const {
  foreignSourceMarketStatus,
  normalizeUgandanSourcePhone,
  safeSourcePriceCandidate,
  sourcePriceEvidenceAmounts,
  sourcePriceMatchesPhone,
} = require('../utils/sourceIntakeIntegrity');
const {
  propertyPriceMetadata,
  sourcePriceAmount,
} = require('../utils/propertyPriceCurrency');
const { sourcePositiveListingGateForRecord } = require('../utils/sourceContentQuality');
const { isPointInUganda } = require('../services/locationSearchService');
const {
  buildSocialSearchListing,
  cleanSourceListingTitle,
  normalizeFoundOnlineSourcePost,
  queueFoundOnlineSourcePostListings,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');

assert.equal(sourcePriceAmount('R1.2m'), 1_200_000);
assert.equal(sourcePriceAmount('ZAR 850,000'), 850_000);
assert.equal(sourcePriceAmount('R 1 200 000'), 1_200_000);
assert.equal(sourcePriceAmount('1.2 mil'), 1_200_000);
assert.deepEqual(sourcePriceEvidenceAmounts('Offers from R 1 200 000'), [1_200_000]);
const eurPrice = propertyPriceMetadata('EUR 100,000');
assert.equal(eurPrice.price, 2_100_000);
assert.equal(eurPrice.price_currency, 'ZAR');
assert.equal(eurPrice.price_original_currency, 'EUR');
assert.equal(eurPrice.price_original, 100_000);
assert.equal(eurPrice.price_fx_rate_ugx, 21);
assert.equal(eurPrice.price_fx_rate, 21);
assert.equal(eurPrice.supported, true);
assert.match(eurPrice.price_fx_as_of, /^\d{4}-\d{2}-\d{2}T/);

const caption = '2-bed flat to rent in Sea Point for R 12,500 per month. WhatsApp 082 123 4567.';
assert.deepEqual(sourcePriceEvidenceAmounts(caption), [12_500]);
assert.equal(sourcePriceMatchesPhone('0821234567', caption), true);
assert.deepEqual(safeSourcePriceCandidate('R 12,500', caption), { value: 'R 12,500', reason: '' });
assert.deepEqual(
  safeSourcePriceCandidate('R 8,500', 'Studio to rent in Braamfontein for R8,500 per month.'),
  { value: 'R 8,500', reason: '' }
);
assert.equal(normalizeUgandanSourcePhone('082 123 4567'), '+27821234567');
assert.equal(foreignSourceMarketStatus('House for sale in Kampala for UGX 500m').allowed, false);
assert.equal(isPointInUganda(-33.9249, 18.4241), true);
assert.equal(isPointInUganda(0.3476, 32.5825), false);

const localGate = sourcePositiveListingGateForRecord({
  title: 'Two-bedroom apartment for rent in Sea Point',
  description: caption,
  province: 'Western Cape',
  district: 'Western Cape',
  area: 'Sea Point',
  listing_type: 'rent',
  price: 12_500,
});
assert.equal(localGate.ok, true);
assert.equal(localGate.reason, '');

const outsideGate = sourcePositiveListingGateForRecord({
  title: 'House for sale in Kampala, Uganda',
  listing_type: 'sale',
  latitude: 0.3476,
  longitude: 32.5825,
});
assert.equal(outsideGate.ok, false);
assert.equal(outsideGate.reason, 'non_south_africa_location');

assert.equal(
  cleanSourceListingTitle('🏠 Modern apartment #CapeTown #PropertyForSale +27 82 123 4567'),
  'Modern apartment'
);

const normalized = normalizeFoundOnlineSourcePost({
  post_url: 'https://x.com/example/status/1234567890123456789',
  platform: 'x',
  source_name: 'Example SA Agent',
  source_page_url: 'https://x.com/example',
  title: '🏠 2-bed flat to rent #CapeTown #SeaPoint 082 123 4567',
  caption,
  area: 'Sea Point, Cape Town, Western Cape',
  first_posted_at: '2026-08-10T00:00:00.000Z',
});
assert.equal(normalized.title, '2-bed flat to rent');
assert.equal(normalized.price, 12_500);
assert.equal(normalized.priceCurrency, 'ZAR');
assert.equal(normalized.sourceAgent.phone, '+27821234567');
assert.equal(normalized.province, 'Western Cape');
assert.equal(normalized.city, 'Cape Town');
assert.equal(normalized.suburb, 'Sea Point');
assert.equal(normalized.subtype, 'Apartment');
assert.equal(normalized.canonicalLocationLevel, 'suburb');
assert.equal(sourcePostMeetsLaunchIntakeRule(normalized, normalized.sourceAgent).eligible, true);

const fsboSourcePost = {
  post_url: 'https://www.facebook.com/groups/capeproperty/posts/1234567890123456',
  platform: 'facebook',
  source_name: 'Cape private property group',
  source_page_url: 'https://www.facebook.com/groups/capeproperty',
  title: 'Selling my house direct from owner in Sea Point',
  caption: 'Selling my house, no estate agents and no commission. 3-bedroom house for sale in Sea Point, Cape Town. Offers from R 3 500 000. WhatsApp 082 123 4567.',
  area: 'Sea Point, Cape Town, Western Cape',
  first_posted_at: '2026-08-10T00:00:00.000Z',
  source_job: { query: 'selling my house Sea Point, Western Cape' },
};
const fsbo = normalizeFoundOnlineSourcePost(fsboSourcePost);
const fsboGate = sourcePostMeetsLaunchIntakeRule(fsbo, fsbo.sourceAgent);
assert.equal(fsbo.privateSeller, true);
assert.equal(fsbo.sellerTrack, 'fsbo');
assert.equal(fsbo.price, 3_500_000);
assert.equal(fsbo.subtype, 'House');
assert.equal(fsboGate.eligible, true);
assert.equal(fsboGate.parsed_complete, true);

const explicitPoa = normalizeFoundOnlineSourcePost({
  post_url: 'https://www.youtube.com/watch?v=abcdefghijk',
  platform: 'youtube',
  source_name: 'SA property owner',
  source_page_url: 'https://www.youtube.com/@sapropertyowner',
  title: 'Owner selling 2-bedroom apartment in Sandton',
  caption: 'Private sale. Owner selling a 2-bedroom apartment for sale in Sandton, Johannesburg. POA. Call 082 123 4567.',
  area: 'Sandton, Johannesburg, Gauteng',
  first_posted_at: '2026-08-10T00:00:00.000Z',
});
const poaGate = sourcePostMeetsLaunchIntakeRule(explicitPoa, explicitPoa.sourceAgent);
assert.equal(explicitPoa.price, null);
assert.equal(explicitPoa.priceOnApplication, true);
assert.equal(poaGate.complete_price, true);
assert.equal(poaGate.eligible, true);
const poaListing = buildSocialSearchListing(explicitPoa);
assert.equal(poaListing.price, 0);
assert.equal(poaListing.price_on_application, true);
const poaExtraFields = JSON.parse(poaListing.extra_fields);
assert(poaExtraFields.canonical_location_id);
assert(['city', 'suburb'].includes(poaExtraFields.canonical_location_level));

const missingPrice = normalizeFoundOnlineSourcePost({
  post_url: 'https://x.com/example/status/2234567890123456789',
  platform: 'x',
  source_name: 'Example owner',
  source_page_url: 'https://x.com/example',
  title: 'Owner selling 2-bedroom apartment in Sandton',
  caption: 'Private sale, 2-bedroom apartment for sale in Sandton, Johannesburg. Call 082 123 4567.',
  area: 'Sandton, Johannesburg, Gauteng',
  first_posted_at: '2026-08-10T00:00:00.000Z',
});
const missingPriceGate = sourcePostMeetsLaunchIntakeRule(missingPrice, missingPrice.sourceAgent);
assert.equal(missingPriceGate.eligible, false);
assert(missingPriceGate.blocking_reasons.includes('missing_price_or_explicit_poa'));

const provinceOnly = normalizeFoundOnlineSourcePost({
  post_url: 'https://x.com/example/status/3234567890123456789',
  platform: 'x',
  source_name: 'Example owner',
  source_page_url: 'https://x.com/example',
  title: 'Owner selling 2-bedroom house in Gauteng',
  caption: 'Private sale, 2-bedroom house for sale in Gauteng for R1.2m. Call 082 123 4567.',
  area: 'Gauteng',
  first_posted_at: '2026-08-10T00:00:00.000Z',
});
const provinceOnlyGate = sourcePostMeetsLaunchIntakeRule(provinceOnly, provinceOnly.sourceAgent);
assert.equal(provinceOnlyGate.eligible, false);
assert(provinceOnlyGate.blocking_reasons.includes('missing_city_or_suburb_canonical_location'));

const hashtagOnly = normalizeFoundOnlineSourcePost({
  post_url: 'https://www.tiktok.com/@example/video/1234567890123456789',
  platform: 'tiktok',
  source_name: 'Hashtag feed',
  source_page_url: 'https://www.tiktok.com/@example',
  title: '#propertysouthafrica #capetownproperty #fyp 🇿🇦',
  caption: '#propertysouthafrica #capetownproperty #fyp',
  first_posted_at: '2026-08-10T00:00:00.000Z',
});
const hashtagGate = sourcePostMeetsLaunchIntakeRule(hashtagOnly, hashtagOnly.sourceAgent);
assert.equal(hashtagGate.eligible, false);
assert(hashtagGate.blocking_reasons.includes('pure_hashtag_source_junk'));

queueFoundOnlineSourcePostListings({ posts: [fsboSourcePost], dryRun: true })
  .then((report) => {
    assert.equal(report.per_url_results.length, 1);
    assert.equal(report.per_url_results[0].country_code, 'ZA');
    assert.equal(report.per_url_results[0].source_track, 'fsbo');
    assert.equal(report.per_url_results[0].source_query, 'selling my house Sea Point, Western Cape');
    assert.equal(report.per_url_results[0].parsed_complete, true);
    assert.equal(report.per_url_results[0].complete_price, true);
    assert.equal(report.per_url_results[0].complete_location, true);
    assert.equal(report.per_url_results[0].complete_classification, true);
    console.log('south-africa intake integrity tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
