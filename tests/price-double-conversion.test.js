'use strict';

// Prices must not be converted twice, and impossible prices can't be approved
// or saved — not even with a staff override. Cases from listings-audit.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  parseSourcePrice,
  propertyPriceMetadata,
  normalizePricePeriodForWrite
} = require('../utils/propertyPriceCurrency');
const { listingPriceQuality } = require('../utils/listingPriceQuality');

test('parser: prefers the price next to a currency or price word, reads b/m/k and "X or Y"', () => {
  const cases = [
    ['USh 9,500,000', 9_500_000, 'UGX'], // b96b3fe9: source said "USh 9,500,000"
    ['$2000/mo', 2000, 'USD'], // 75c28461: "$2000/mo"
    ['2.2B', 2_200_000_000, ''], // 50ce7080: "2.2B" was read as UGX 2
    ['Price: 2.2B negotiable', 2_200_000_000, ''],
    ['650m or 173k', 650_000_000, ''], // 24a96e31: read as 173,000
    ['3 bedroom house for sale at 350m', 350_000_000, ''],
    ['land 50x100 at 45m', 45_000_000, ''],
    ['Call 0772123456 price 80m', 80_000_000, ''],
    ['UGX 120m per acre', 120_000_000, 'UGX'],
    ['Shs 1.5M per month', 1_500_000, 'UGX'],
    ['4 bedrooms 2.2bn', 2_200_000_000, ''],
    ['Smart house in Kigo at 700mugx', 700_000_000, 'UGX'],
    ['asking 2.2bnugx', 2_200_000_000, 'UGX']
  ];
  for (const [text, amount, currency] of cases) {
    const parsed = parseSourcePrice(text);
    assert.equal(parsed?.amount, amount, text);
    assert.equal(parsed?.currency, currency, text);
  }
});

test('metadata: a shilling figure is never converted as USD', () => {
  const ugx = propertyPriceMetadata('USh 9,500,000 (also on $ promo)');
  assert.equal(ugx.price, 9_500_000);
  assert.equal(ugx.price_original_currency, 'UGX');
  const usd = propertyPriceMetadata('$2000/mo');
  assert.equal(usd.price_original_currency, 'USD');
  assert.equal(usd.price, 2000 * Number(process.env.USD_TO_UGX_RATE || 3800));
  // 8e25bf4a "USh 3,230,000,000,000,000,000": a UGX number tagged USD
  const absurd = propertyPriceMetadata('$850,000,000');
  assert.equal(absurd.price, null);
  assert.equal(absurd.supported, false);
  assert.equal(absurd.rejection_reason, 'usd_original_looks_like_ugx');
});

test('quality: hard limits that no override can pass', () => {
  const impossible = listingPriceQuality({ listing_type: 'sale', price: 3_230_000_000_000_000_000, price_period: 'once' }, { highMonthlyPriceConfirmed: true, priceBasisConfirmed: true });
  assert.equal(impossible.ok, false);
  // C17 adds the plausibility bound as a second hard reason.
  assert.deepEqual(impossible.hard_reasons, ['price_impossible_above_1e12', 'price_above_plausible_bounds']);
  assert.equal(impossible.blocked_even_with_override, true);
  const usdLooksUgx = listingPriceQuality({ listing_type: 'sale', price: 9_500_000 * 3800, price_original: 9_500_000, price_original_currency: 'USD' }, { highMonthlyPriceConfirmed: true });
  assert.ok(usdLooksUgx.hard_reasons.includes('usd_original_looks_like_ugx'));
});

test('quality: ranges need confirmation, and confirmation clears them', () => {
  const rows = [
    [{ listing_type: 'rent', price: 28_300_000_000, price_period: 'month' }, 'high_monthly_price_requires_staff_confirmation'], // 75c28461 rent 28.3bn/month
    [{ listing_type: 'sale', price: 900_000, price_period: 'once' }, 'one_off_price_below_1m'],
    [{ listing_type: 'land', price: 25_000_000_000, price_period: 'once' }, 'one_off_price_above_20bn'],
    [{ listing_type: 'rent', price: 40_000, price_period: 'month' }, 'monthly_price_below_50k']
  ];
  for (const [row, reason] of rows) {
    const q = listingPriceQuality(row);
    assert.ok(q.reasons.includes(reason), `${reason}: ${q.reasons}`);
    const confirmed = listingPriceQuality(row, { highMonthlyPriceConfirmed: true });
    assert.ok(!confirmed.reasons.includes(reason), `${reason} should clear with confirmation`);
  }
  assert.equal(listingPriceQuality({ listing_type: 'sale', price: 350_000_000, price_period: 'once' }).ok, true);
  assert.equal(listingPriceQuality({ listing_type: 'rent', price: 1_500_000, price_period: 'month' }).ok, true);
});

test('periods are saved with one spelling', () => {
  for (const [input, out] of [['mo', 'month'], ['Monthly', 'month'], ['per month', 'month'], ['sem', 'semester'], ['yr', 'year'], ['annually', 'year'], ['nightly', 'night'], ['one-off', 'once'], ['total', 'once'], ['week', 'week']]) {
    assert.equal(normalizePricePeriodForWrite(input), out, input);
  }
});

test('edit paths never re-derive the price from a stored original', () => {
  const props = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  assert.match(props, /originalSuppliedNow/);
  assert.doesNotMatch(props, /toNullableFloat\(patch\.price_original \?\? existing\.price_original\)/);
  const staff = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
  assert.match(staff, /currencyGivenNow && originalGivenNow/);
  const wa = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.doesNotMatch(wa, /meta\.price_original \|\| newPrice\.price\); sets\.push/);
});
