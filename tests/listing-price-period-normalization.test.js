'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeCommercialTransactionType,
  normalizeListingPricePeriod
} = require('../utils/commercialClassification');
const {
  normalizeFoundOnlineSourcePost
} = require('../services/socialSearchSourcedListingsService');

test('explicit source sale language overrides a guessed monthly period', () => {
  assert.equal(
    normalizeListingPricePeriod('month', {
      listingType: 'commercial',
      description: 'Commercial building on sale in Nansana at 150m'
    }),
    'once'
  );
  assert.equal(
    normalizeCommercialTransactionType('', {
      pricePeriod: 'once',
      description: 'Rental property for sale in Fort Portal'
    }),
    'sale'
  );
});

test('commercial source row on sale is stored as a one-off sale', () => {
  const listing = normalizeFoundOnlineSourcePost({
    listing_type: 'commercial',
    title: 'Commercial building in Nansana',
    description: 'Unfinished flat and a commercial building on sale in Nansana at 150m.',
    district: 'Wakiso',
    area: 'Nansana',
    price: 150000000,
    price_period: 'month',
    source_platform: 'youtube',
    source_url: 'https://www.youtube.com/watch?v=zC23no7RoLI'
  });

  assert.equal(listing.listingType, 'commercial');
  assert.equal(listing.price_period, 'once');
  assert.equal(listing.transaction_type, 'sale');
});

test('rental income asset for sale is not classified as student rent', () => {
  const listing = normalizeFoundOnlineSourcePost({
    listing_type: 'student',
    title: 'Student accommodation in Kampala',
    description: 'RENTAL PROPERTY FOR SALE in Fort Portal at 160m. Four self-contained single rooms and a double room.',
    district: 'Kabarole',
    area: 'Fort Portal',
    price: 160000000,
    price_period: 'month',
    source_platform: 'x',
    source_url: 'https://x.com/example/status/123'
  });

  assert.equal(listing.listingType, 'sale');
  assert.equal(listing.price_period, 'once');
});
