'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalListingTitle,
  canonicalListingLead,
  replaceEmployeeTemplateLead,
} = require('../scripts/listing-fact-copy');

const sale = {
  listing_type: 'sale', transaction_type: 'sale', property_type: 'Apartment block',
  area: 'Kyanja', district: 'Kampala', bedrooms: null,
  price: 3800000000, price_currency: 'UGX', price_original: 1000000,
  price_original_currency: 'USD', price_period: 'once', price_on_application: false,
};

test('repairs only the generated lead, preserving the original caption, video and contact bytes', () => {
  const suffix = '  KYANJA TOWN!!! 20 RENTAL UNITS APARTMENT BLOCK\nSELLING 1M USD 🔥\nWatch the attached video tour before enquiring. Contact Sewa sewa.';
  const before = { ...sale, listing_type: 'rent', transaction_type: null,
    description: 'Rental property in Kyanja, Kampala, listed at UGX 1,000,000.' + suffix };
  const repaired = replaceEmployeeTemplateLead(before, sale);
  assert.equal(repaired.previousLead, 'Rental property in Kyanja, Kampala, listed at UGX 1,000,000.');
  assert.equal(repaired.lead, 'Apartment block for sale in Kyanja, Kampala, listed at USD 1,000,000.');
  assert.equal(repaired.description, repaired.lead + suffix);
  assert.equal(repaired.changed, true);
  assert.equal(before.description, repaired.previousLead + suffix);
});

test('retains authored/source prose even when its first sentence discusses an old price', () => {
  for (const description of [
    'Apartment block of 8 one-bedroom units for sale in Kyanja, Kampala. Asking UGX 1.3 billion.',
    'Property for sale in Kiwatule town 4 units of 2 bedroom rentals Plot size 15 decimals. Price 350M.',
    'A house in Kira, listed at UGX 120,000,000. The source is unchanged.',
    'Rental property in Ntinda, with two bungalows and 14 decimals. Price 550M.',
  ]) {
    const result = replaceEmployeeTemplateLead({ ...sale, description }, sale);
    assert.equal(result.changed, false);
    assert.equal(result.description, description);
    assert.equal(result.previousLead, null);
  }
});

test('per-acre, plot and rental quote bases appear in the regenerated lead', () => {
  const land = { ...sale, listing_type: 'land', transaction_type: 'sale', property_type: 'Land',
    price: 350000000, price_original: 350000000, price_original_currency: 'UGX' };
  assert.equal(canonicalListingLead({ ...land, price_period: 'acre' }), 'Land for sale in Kyanja, Kampala, listed at UGX 350,000,000/acre.');
  assert.equal(canonicalListingLead({ ...land, price_period: 'per_plot' }), 'Land for sale in Kyanja, Kampala, listed at UGX 350,000,000/plot.');
  const rent = { ...land, transaction_type: 'rent', price: 150000, price_original: 150000 };
  for (const [period, suffix] of [['acre_yr', '/acre/year'], ['yr', '/year'], ['mo', '/month'], ['wk', '/week'], ['sem', '/semester'], ['unit', '/unit'], ['per unit', '/unit']]) {
    assert.equal(canonicalListingLead({ ...rent, price_period: period }), 'Land for rent in Kyanja, Kampala, listed at UGX 150,000' + suffix + '.');
  }
});

test('a stale recurring period cannot put a monthly suffix on an explicit sale', () => {
  assert.equal(canonicalListingLead({ ...sale, price_period: 'mo' }), 'Apartment block for sale in Kyanja, Kampala, listed at USD 1,000,000.');
});

test('POA suppresses residual numeric amounts and never invents zero prices', () => {
  assert.equal(canonicalListingLead({ ...sale, price_on_application: true }), 'Apartment block for sale in Kyanja, Kampala, price on application.');
  assert.equal(canonicalListingLead({ ...sale, price_period: 'poa' }), 'Apartment block for sale in Kyanja, Kampala, price on application.');
  assert.equal(canonicalListingLead({ ...sale, price: null, price_original: null }), 'Apartment block for sale in Kyanja, Kampala, price on application.');
});

test('canonical title uses supported type and transaction, with no stale amount or duplicated location', () => {
  assert.equal(canonicalListingTitle({ ...sale, bedrooms: 2, property_type: 'house', district: 'Kyanja' }), '2-bedroom house for sale in Kyanja');
  assert.equal(canonicalListingTitle({ ...sale, listing_type: 'rent', transaction_type: 'rent', property_type: 'shop_retail', bedrooms: null }), 'Shop / retail space for rent in Kyanja, Kampala');
});

test('type suffixes do not duplicate transaction wording and unknown bases fail explicitly', () => {
  assert.equal(canonicalListingTitle({ ...sale, property_type: 'House for sale' }), 'House for sale in Kyanja, Kampala');
  assert.throws(() => canonicalListingLead({ ...sale, price_period: 'unknown basis' }), /Unsupported price period/);
});

test('no-price employee lead is recognized only when it matches the old row exactly', () => {
  const before = { listing_type: 'rent', area: 'Kyanja', district: 'Kampala', description: 'Rental property in Kyanja, Kampala. Original caption.' };
  assert.equal(replaceEmployeeTemplateLead(before, sale).description, 'Apartment block for sale in Kyanja, Kampala, listed at USD 1,000,000. Original caption.');
  assert.equal(replaceEmployeeTemplateLead({ ...before, description: 'Rental property in Ntinda. Original caption.' }, sale).changed, false);
});

test('reapplying a repair leaves a corrected lead unchanged', () => {
  const before = { ...sale, description: 'Property for sale in Kyanja, Kampala, listed at UGX 1,000,000. Caption.' };
  const once = replaceEmployeeTemplateLead(before, sale);
  const twice = replaceEmployeeTemplateLead({ ...sale, description: once.description }, sale);
  assert.equal(twice.description, once.description);
  assert.equal(twice.changed, false);
});
