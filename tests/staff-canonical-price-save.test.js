'use strict';

// Staff Preview & edit: a null-price row arrives with Price on application
// already ticked. Saving a canonical amount used to return 200 and store null
// again, and the status note kept missing_or_placeholder_price. An MK-
// reference search used a leading-wildcard ILIKE and timed out (503).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const { normalizeStaffListingPatch } = require('../routes/staff')._test;
const { listingPriceQuality } = require('../utils/listingPriceQuality');
const { priceEvidenceNote, resolveStaffPriceChoice } = require('../utils/staffPriceChoice');
const { listingReferenceQuery, propertyListingSearchClause } = require('../utils/listingReferenceSearch');
const { buildAutomatedListingReview } = require('../services/listingModerationService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const NULL_PRICE_ROW = {
  listing_type: 'sale',
  transaction_type: 'sale',
  price: null,
  price_period: 'once',
  price_on_application: true,
  price_original_currency: 'UGX',
  area: 'Ntinda',
  district: 'Kampala',
  moderation_reason: 'Price evidence needs staff review: missing_or_placeholder_price.',
  extra_fields: {
    price_on_application: true,
    price_upon_application: true,
    price_quality: { ok: false, reasons: ['missing_or_placeholder_price'] }
  }
};

test('a typed canonical amount wins over the pre-ticked POA checkbox', () => {
  const { patch, errors } = normalizeStaffListingPatch(NULL_PRICE_ROW, {
    price: '1000000000',
    price_on_application: true,
    price_period: 'once',
    price_original_currency: 'UGX'
  });
  assert.deepEqual(errors, []);
  assert.equal(patch.price, 1000000000);
  assert.equal(patch.price_on_application, false);
  assert.equal(patch.__priceChoice, 'amount');
  const quality = listingPriceQuality({
    ...NULL_PRICE_ROW,
    price: patch.price,
    price_period: patch.price_period,
    price_on_application: false,
    extra_fields: { price_on_application: false, price_upon_application: false }
  });
  assert.equal(quality.reasons.includes('missing_or_placeholder_price'), false);
  assert.equal(quality.ok, true);
});

test('a blank price with the POA checkbox saves Price on application and clears the flag', () => {
  const { patch, errors } = normalizeStaffListingPatch(NULL_PRICE_ROW, {
    price: '',
    price_on_application: true,
    price_period: 'once',
    price_original_currency: 'UGX'
  });
  assert.deepEqual(errors, []);
  assert.equal(patch.price, null);
  assert.equal(patch.price_on_application, true);
  assert.equal(patch.__priceChoice, 'poa');
  const quality = listingPriceQuality({
    ...NULL_PRICE_ROW,
    price: null,
    price_on_application: true,
    extra_fields: { price_on_application: true, price_upon_application: true }
  });
  assert.equal(quality.reasons.includes('missing_or_placeholder_price'), false);
  assert.equal(quality.ok, true);
  const note = priceEvidenceNote(NULL_PRICE_ROW.moderation_reason, quality);
  assert.equal(note, '');
  assert.equal(/missing_or_placeholder_price/i.test(note), false);
});

test('a comma-formatted canonical amount is stored in full', () => {
  const { patch, errors } = normalizeStaffListingPatch(NULL_PRICE_ROW, {
    price: '1,000,000,000',
    price_on_application: true,
    price_period: 'once',
    price_original_currency: 'UGX'
  });
  assert.deepEqual(errors, []);
  assert.equal(patch.price, 1000000000);
  assert.equal(patch.price_original, 1000000000);
  assert.equal(patch.price_on_application, false);
});

test('an explicit POA period still drops a typed number (C20)', () => {
  const choice = resolveStaffPriceChoice({
    price: '1000000000',
    price_on_application: false,
    price_period: 'poa'
  });
  assert.equal(choice.mode, 'poa');
  assert.equal(choice.patch.price, null);
  assert.equal(choice.patch.price_on_application, true);
});

test('the status note drops only the resolved missing-price reason', () => {
  const kept = priceEvidenceNote(
    'Price evidence needs staff review: missing_or_placeholder_price, source_price_figure_missing.',
    { reasons: ['source_price_figure_missing'] }
  );
  assert.match(kept, /source_price_figure_missing/);
  assert.equal(/missing_or_placeholder_price/i.test(kept), false);
  const untouched = priceEvidenceNote(
    'Price evidence needs staff review: missing_or_placeholder_price.',
    { reasons: ['missing_or_placeholder_price'] }
  );
  assert.match(untouched, /missing_or_placeholder_price/);
});

test('POA with no number passes the approval pricing check', () => {
  const review = buildAutomatedListingReview({
    listing: {
      title: 'House in Ntinda',
      description: 'Four bedroom house in Ntinda.',
      district: 'Kampala',
      area: 'Ntinda',
      listing_type: 'sale',
      price: null,
      price_period: 'once',
      price_on_application: true,
      extra_fields: { price_on_application: true, price_upon_application: true }
    }
  });
  const pricing = (review.checks || []).find((item) => item.key === 'pricing_checked');
  assert.ok(pricing, 'pricing_checked present');
  assert.equal(pricing.status, 'pass');
  const missing = buildAutomatedListingReview({
    listing: {
      title: 'House in Ntinda',
      description: 'Four bedroom house in Ntinda.',
      district: 'Kampala',
      area: 'Ntinda',
      listing_type: 'sale',
      price: null,
      price_period: 'once',
      price_on_application: false,
      extra_fields: {}
    }
  });
  const missingPrice = (missing.checks || []).find((item) => item.key === 'pricing_checked');
  assert.equal(missingPrice.status, 'fail');
});

test('an MK reference search is an equality lookup on inquiry_reference', () => {
  const values = [];
  const clause = propertyListingSearchClause('p', 'MK-20261009-60823D', values);
  assert.equal(clause, 'p.inquiry_reference = $1');
  assert.deepEqual(values, ['MK-20261009-60823D']);
  assert.equal(listingReferenceQuery('  mk-20261009-60823d '), 'MK-20261009-60823D');
  const broad = [];
  const ilike = propertyListingSearchClause('p', 'Ntinda house', broad);
  assert.match(ilike, /ILIKE/);
  assert.equal(ilike.includes('inquiry_reference ='), false);
  assert.deepEqual(broad, ['%Ntinda house%']);
});

test('staff, admin and public search use the reference lookup, and the price choice is wired through', () => {
  const staff = read('routes/staff.js');
  const admin = read('routes/admin.js');
  const properties = read('routes/properties.js');
  const app = read('assets/makaug-app.js');
  assert.match(staff, /propertyListingSearchClause\('p', search, values\)/);
  assert.match(admin, /propertyListingSearchClause\('p', search, values\)/);
  assert.match(admin, /inquiry_reference = \$\$\{values\.length\}/);
  assert.match(properties, /p\.inquiry_reference = \?/);
  assert.match(staff, /resolveStaffPriceChoice\(normalized\)/);
  assert.match(admin, /resolveStaffPriceChoice\(normalizedPatch\)/);
  assert.match(properties, /resolveStaffPriceChoice\(patch\)/);
  assert.match(staff, /priceEvidenceNote\(existing\.moderation_reason, resolvedPriceQuality\)/);
  assert.match(admin, /moderation_reason = CASE WHEN \$8::boolean THEN \$5::text ELSE COALESCE\(\$5::text, moderation_reason\) END/);
  assert.match(app, /id="admin-review-price-edit" type="text" inputmode="decimal"/);
  assert.match(app, /function adminReviewOnCanonicalPriceInput\(\)/);
  assert.match(app, /!adminReviewHasTypedCanonicalPrice\(get\("admin-review-price-edit"\)\)/);
  const saveStart = app.indexOf('async function saveStaffListingPreview');
  const saveBody = app.slice(saveStart, saveStart + 500);
  assert.match(saveBody, /try \{[\s\S]*apiRequest\(`\/api\/staff\/properties\//);
});
