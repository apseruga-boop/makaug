'use strict';

/**
 * Prices an agent actually types.
 *
 * On 23 Sep 2026 a complete Agent 007 listing — "Price:2000$ USD per month" —
 * was held back for a missing price. The parser only understood a currency
 * written BEFORE the number ("USD 2000"), so every other spelling read as no
 * price at all. Each line here is a spelling that must be understood.
 */

const test = require('node:test');
const assert = require('node:assert');

const { employeePropertyFacts, employeePropertyMissing } = require('../routes/whatsapp').__test;

const UGX_PER_USD_MIN = 3000;

const cases = [
  ['Price:2000$ USD per month', 2000, 'usd'],
  ['2000$ per month', 2000, 'usd'],
  ['$2,000 per month', 2000, 'usd'],
  ['US$2000 per month', 2000, 'usd'],
  ['2000 USD per month', 2000, 'usd'],
  ['USD 2000 per month', 2000, 'usd'],
  ['2000 dollars per month', 2000, 'usd'],
  ['1,200,000/= per month', 1200000, 'ugx'],
  ['shs 800,000 per month', 800000, 'ugx'],
  ['800,000 shs per month', 800000, 'ugx'],
  ['3.5m per month', 3500000, 'ugx'],
  ['UGX 300 million', 300000000, 'ugx'],
  ['@600m UGX', 600000000, 'ugx']
];

test('every common way of writing a price is understood', () => {
  for (const [priceText, amount, currency] of cases) {
    const caption = `House available for rent in Ntinda, 4 bedrooms. Price: ${priceText}`;
    const facts = employeePropertyFacts(caption, {});
    const price = Number(facts.price || 0);
    assert.ok(price > 0, `no price read from "${priceText}"`);
    if (currency === 'ugx') {
      assert.strictEqual(price, amount, `"${priceText}" should be UGX ${amount}`);
    } else {
      // Converted to shillings; the rate moves, the order of magnitude does not.
      assert.ok(
        price >= amount * UGX_PER_USD_MIN,
        `"${priceText}" should convert USD ${amount} into shillings, got ${price}`
      );
    }
    assert.ok(
      !employeePropertyMissing(facts).includes('price'),
      `"${priceText}" must not be reported as a missing price`
    );
  }
});

test('the real forwarded listing that failed is complete', () => {
  const caption = [
    'House available for rent',
    'Location 📍 Ntinda',
    'Number of bedroom 4',
    'Number of bathrooms 3',
    'Number of garage 1',
    'Servant quarter 2',
    'Compound and parking',
    'Close to the main road',
    'Price:2000$ USD per month'
  ].join('\n');
  assert.deepStrictEqual(employeePropertyMissing(employeePropertyFacts(caption, {})), []);
});

test('room counts and plot sizes are still never read as a price', () => {
  const facts = employeePropertyFacts('4 bedroom house on 12 decimals in Ntinda', {});
  assert.ok(employeePropertyMissing(facts).includes('price'), 'a caption with no money must still ask for the price');
});
