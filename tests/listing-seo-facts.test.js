'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../services/publicSeoRenderService');
const copy = require('../services/publicListingCopy');

const saleComplex = (overrides = {}) => ({
  id: '250495cb-ddef-4499-a6d8-b977c2287193',
  listing_type: 'rent', transaction_type: 'sale', property_type: 'Apartment complex',
  title: '3-Bed property for rent in Naguru', title_reviewed: true,
  description: 'Property for rent in Naguru, listed at UGX 91,200,000/month.',
  area: 'Naguru', district: 'Kampala', price: 7220000000, price_period: 'mo',
  ...overrides
});

test('explicit sale and apartment-complex facts replace stale rental SEO copy', () => {
  const row = saleComplex();
  const title = seo.propertySeoTitle(row);
  const heading = seo.propertyPublicHeading(row);
  const description = seo.propertySeoDescription(row);
  for (const text of [title, heading, description]) {
    assert.match(text, /Apartment complex for Sale in Naguru, Kampala/);
    assert.doesNotMatch(text, /for rent|\/month|3[- ]?bed/i);
  }
  assert.match(title, /UGX 7\.2B/);
  assert.match(description, /UGX 7,220,000,000/);
  const rendered = seo.renderPropertySeoHtml('<div id="detail-content"></div><footer></footer>', row);
  assert.match(rendered.html, /<h1[^>]*>Apartment complex for Sale in Naguru, Kampala<\/h1>/);
  assert.equal(rendered.meta.description, description);
  assert.equal(rendered.structuredData['@graph'][1].name, heading);
  assert.match(rendered.html, /data-price-period=""/);
});

test('a generic stored property title does not hide a known property type', () => {
  const row = saleComplex({ listing_type: 'sale', price_period: 'once', title: 'Property for sale in Naguru', description: 'Property for sale in Naguru, Kampala, listed at USD 1,900,000.' });
  assert.match(seo.propertyPublicHeading(row), /^Apartment complex for Sale/);
  assert.match(seo.propertySeoDescription(row), /^Apartment complex for Sale/);
  assert.equal(copy.cleanListingTitle(row), 'Apartment complex for sale in Naguru');
});

test('unrelated accurate reviewed copy remains intact', () => {
  const row = saleComplex({ listing_type: 'sale', title: 'Furnished apartment complex for sale in Naguru', description: 'Furnished apartment complex for sale in Naguru. Twelve units with parking.', price_period: 'once' });
  assert.equal(seo.propertyPublicHeading(row), row.title);
  assert.equal(seo.propertySeoDescription(row), 'Furnished apartment complex for sale in Naguru.');
  assert.ok(seo.propertySeoTitle(row).startsWith(`${row.title} — `));
});

test('a stale monthly price embedded in reviewed sale copy is replaced', () => {
  const row = saleComplex({ listing_type: 'sale', title: 'Apartment complex for sale in Naguru UGX 91M/month' });
  assert.doesNotMatch(seo.propertySeoTitle(row), /\/month/);
  assert.doesNotMatch(seo.propertyPublicHeading(row), /\/month/);
  assert.doesNotMatch(copy.cleanListingTitle(row), /\/month/);
});

test('explicit rental wins over a stale sale category and keeps its rental period', () => {
  const row = saleComplex({ listing_type: 'sale', transaction_type: 'rent', property_type: 'Apartment', title: 'Apartment for sale in Naguru', price: 2500000, price_period: 'mo' });
  assert.match(seo.propertySeoTitle(row), /Apartment for Rent.*UGX 2\.5M\/month/);
  assert.match(seo.propertyPublicHeading(row), /Apartment for Rent/);
  assert.match(copy.factualListingTitle(row), /Apartment for rent/);
});

test('public copy uses transaction facts before category and stale monthly period', () => {
  const row = saleComplex();
  assert.match(copy.factualListingTitle(row), /^Apartment complex for sale/);
  assert.match(copy.buildThirdPartyPublicTitle(row), /apartment complex for sale/);
  assert.equal(copy.publicPriceLabelFor(row), 'UGX 7,220,000,000');
});

test('descriptions without stored copy still identify the actual property and transaction', () => {
  assert.match(seo.propertySeoDescription(saleComplex({ description: '' })), /^Apartment complex for Sale in Naguru, Kampala\. UGX 7,220,000,000/);
});

test('an accurate land title stays intact when an old property-type field disagrees', () => {
  const row = { listing_type: 'land', transaction_type: 'sale', property_type: 'house', title: 'Land for sale in Kitende', area: 'Wakiso' };
  assert.equal(copy.cleanListingTitle(row), row.title);
  assert.equal(seo.propertyPublicHeading(row), row.title);
});

test('land sales preserve per-acre and per-plot prices, and land rentals preserve time units', () => {
  const row = { listing_type: 'land', transaction_type: 'sale', property_type: 'Land', price: 100000000 };
  assert.equal(seo.priceLabel({ ...row, price_period: 'acre' }), 'UGX 100,000,000/acre');
  assert.equal(seo.priceLabel({ ...row, price_period: 'plot' }), 'UGX 100,000,000/plot');
  assert.equal(seo.priceLabel({ ...row, price_period: 'mo' }), 'UGX 100,000,000');
  assert.equal(seo.priceLabel({ ...row, transaction_type: 'rent', price_period: 'mo' }), 'UGX 100,000,000/month');
});

test('the actual Bunga rental-property description uses its saved sale facts', () => {
  const row = { listing_type: 'sale', property_type: 'apartment', area: 'Bunga', district: 'Kampala', price: 1600000000, price_period: 'once', title: '14-Bed property for rent in Bunga', description: 'Rental property in Bunga, Kampala, listed at UGX 1,600,000,000. One bedroom apartment block available for rent and for sale in Bunga Kampala 1.7m per month 8 units Income is 14m per month selling at 1.6bn ugx.' };
  assert.match(seo.propertySeoDescription(row), /^apartment for Sale in Bunga, Kampala\. UGX 1,600,000,000/);
  assert.doesNotMatch(seo.propertySeoDescription({ ...row, property_type: null }), /^Rental property/i);
});

test('commercial and land rental periods without explicit transactions keep their units', () => {
  for (const listing_type of ['commercial', 'land']) {
    const row = { listing_type, price: 1800000, price_period: 'mo' };
    assert.equal(copy.publicListingTransaction(row), 'rent');
    assert.equal(seo.priceLabel(row), 'UGX 1,800,000/month');
    assert.equal(copy.publicPriceLabelFor(row), 'UGX 1,800,000/month');
  }
  assert.equal(seo.priceLabel({ listing_type: 'short_term', price: 250000, price_period: 'night' }), 'UGX 250,000/night');
});

test('Kira-Mulawa units for sale show the asking price rather than a monthly rental or POA', () => {
  const row = {
    id: '7aafe4c1-4eb5-4e13-8e8d-28b78616710b',
    title: 'property for rent in Kira-Mulawa',
    description: 'Rental property in Kira-Mulawa, Wakiso, listed at UGX 160,000,000. Kira Mulawa 5 double rental units monthly income 2.2 million on sale UGX 160 million.',
    area: 'Kira-Mulawa', district: 'Wakiso', bedrooms: null,
    canonical_location_id: 'wakiso:kira mulawa',
    listing_type: 'sale', transaction_type: 'sale', property_type: 'Double rental units',
    price: 160000000, price_original: 160000000, price_currency: 'UGX',
    price_original_currency: 'UGX', price_period: 'once', price_on_application: false
  };
  const listing = seo.normalizeSeoListingRow(row);
  assert.equal(listing.price, 160000000);
  assert.equal(listing.price_on_application, false);
  assert.equal(copy.cleanListingTitle(row), 'Double rental units for sale in Kira-Mulawa');
  for (const text of [seo.propertySeoTitle(listing), seo.propertyPublicHeading(listing), seo.propertySeoDescription(listing)]) {
    assert.match(text, /Double rental units for [Ss]ale in Kira-Mulawa/);
    assert.doesNotMatch(text, /for rent|\/month|Price on application|\b\d+[- ]?(?:bed|bdrm)/i);
  }
  assert.match(seo.propertySeoTitle(listing), /UGX 160M/);
  assert.match(seo.propertySeoDescription(listing), /UGX 160,000,000/);
  const rendered = seo.renderPropertySeoHtml('<div id="detail-content"></div><footer></footer>', listing);
  const product = rendered.structuredData['@graph'].find((node) => [].concat(node['@type']).includes('Product'));
  assert.equal(product.category, 'Double rental units');
  assert.equal(product.offers.price, 160000000);
  assert.equal(product.offers.priceCurrency, 'UGX');
});
