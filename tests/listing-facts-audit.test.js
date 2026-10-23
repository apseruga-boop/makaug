'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditListingFacts } = require('../scripts/audit-listing-facts');

test('read-only audit separates income assets, dual offers and FX arithmetic candidates', () => {
  const rows = [
    { id: 'income', listing_type: 'rent', price_period: 'mo', price: 2200000, extra_fields: { source_caption: '5 double rental units monthly income 2.2 million on sale UGX 160 million' } },
    { id: 'dual', listing_type: 'sale', price_period: 'once', extra_fields: { source_caption: 'Apartment for rent or for sale. Call for terms.' } },
    { id: 'fx', listing_type: 'sale', price: 380000000, price_original: 100000, price_original_currency: 'USD', price_fx_rate_ugx: 3800 },
    { id: 'bad-fx', listing_type: 'sale', price: 38000000, price_original: 100000, price_original_currency: 'USD', price_fx_rate_ugx: 3800 },
    { id: 'unknown', listing_type: 'sale', price_period: 'once', property_type: null }
  ];
  const before = JSON.stringify(rows);
  const report = auditListingFacts(rows);
  const reasons = Object.fromEntries(report.candidates.map((row) => [row.id, row.reasons]));
  assert.ok(reasons.income.includes('source_sale_vs_rent_fields'));
  assert.ok(reasons.income.includes('income_and_sale_amount_need_separate_review'));
  assert.ok(reasons.dual.includes('source_contains_both_sale_and_rent'));
  assert.ok(!reasons.dual.includes('source_rent_vs_sale_fields'));
  assert.ok(!reasons.fx);
  assert.ok(reasons['bad-fx'].includes('recorded_fx_arithmetic_differs'));
  assert.ok(!reasons.unknown, 'a missing physical type alone is not declared a mismatch');
  assert.equal(report.counts.listings, 5);
  assert.equal(report.readOnly, true);
  assert.equal(JSON.stringify(rows), before);
});

test('duplicate IDs cannot silently reduce inventory coverage', () => {
  assert.throws(() => auditListingFacts([{ id: 'same' }, { id: 'same' }]), /Duplicate listing IDs/);
});

test('audit catches income-as-price and suffix USD variants found in the inventory', () => {
  const report = auditListingFacts([
    { id: 'block', listing_type: 'sale', price: 36000000, extra_fields: { source_caption: '20 apartments for sale making 36m selling for 3.6b' } },
    { id: 'units', listing_type: 'sale', price: 6000000, extra_fields: { source_description: 'Six units two bedrooms making 6m monthly selling for 600m' } },
    { id: 'usd-suffix', listing_type: 'land', price: 3400000, price_original_currency: 'UGX', extra_fields: { source_caption: 'Commercial property for sale at 3.4m USD' } },
    { id: 'dollars', listing_type: 'sale', price_original_currency: 'UGX', extra_fields: { source_caption: 'House for sale at $400,000' } }
  ]);
  const reasons = Object.fromEntries(report.candidates.map((row) => [row.id, row.reasons]));
  for (const id of ['block', 'units']) assert.ok(reasons[id].includes('income_and_sale_amount_need_separate_review'));
  for (const id of ['usd-suffix', 'dollars']) assert.ok(reasons[id].includes('source_usd_with_non_usd_price_metadata'));
});
