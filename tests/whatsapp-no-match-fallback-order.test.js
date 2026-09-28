'use strict';

/**
 * 28 Sep 2026, 1:54pm. Someone browsing rentals said:
 *
 *   "I mean specifically the ones in Bunga at 500 k per month"
 *
 * and the top of the reply was a card for a **7-bedroom house for sale**,
 * followed by "I do not have an approved exact match for To Rent in Bunga",
 * followed by "67 matching properties found in Bunga".
 *
 * Three things were wrong and they all came from one line. The no-match
 * fallback relaxed the search like this:
 *
 *   if (searchType !== 'any' && area) {
 *     findPropertiesByNaturalFilters({ ...filters, searchType: 'any' })   // first attempt
 *   }
 *
 * Renting versus buying was the FIRST thing thrown away, before the budget was
 * even tried. So a renter got sale listings; the count above them ("67") was
 * every listing in Bunga rather than the 41 rentals; and nothing in the message
 * said the budget was what had not fitted.
 *
 * Bunga really does have 41 rentals and the cheapest really is UGX 1,000,000 a
 * month, so the honest answer was always available: nothing at 500K, the lowest
 * is 1M, here are the closest. The order of relaxation is now budget, then the
 * extras, then the area, and the transaction type last of all — because a
 * budget is something a person might stretch and renting instead of buying is
 * not.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  findBroaderPropertyFallback,
  lowestPricedFallbackRow
} = require('../routes/whatsapp').__test;

// Bunga as production actually holds it.
const BUNGA_RENTALS = [
  { id: 'r1', title: '1-bed Property for rent in Bunga', listing_type: 'rent', area: 'Bunga', price: '1000000', price_period: 'mo', bedrooms: 1 },
  { id: 'r2', title: '2-bed Property for rent in Bunga', listing_type: 'rent', area: 'Bunga', price: '1200000', price_period: 'mo', bedrooms: 2 },
  { id: 'r3', title: '3-bed Property for rent in Bunga', listing_type: 'rent', area: 'Bunga', price: '2500000', price_period: 'mo', bedrooms: 3 }
];
const BUNGA_SALES = [
  { id: 's1', title: '7bdrm Property for Sale in Bunga', listing_type: 'sale', area: 'Bunga', price: '1500000000', bedrooms: 7 }
];

// Stand-ins that behave like the real finders: honour the type, honour the
// budget, and return nothing when a rental under 500K is asked for.
function bungaFinders(calls) {
  return {
    findPropertiesByNaturalFilters: async (filters) => {
      calls.push({ via: 'filters', searchType: filters.searchType, budget: filters.maxBudgetUgx });
      // Mixed results come back newest-first, and the newest Bunga listing is
      // the house for sale — which is exactly why it appeared at the top of the
      // reply the customer saw.
      const pool = filters.searchType === 'rent' ? BUNGA_RENTALS
        : filters.searchType === 'sale' ? BUNGA_SALES
          : [...BUNGA_SALES, ...BUNGA_RENTALS];
      const cap = Number(filters.maxBudgetUgx) > 0 ? Number(filters.maxBudgetUgx) : Infinity;
      return pool.filter((row) => Number(row.price) <= cap);
    },
    findPropertiesForWhatsapp: async (type, area) => {
      calls.push({ via: 'type', searchType: type, area });
      return type === 'rent' ? BUNGA_RENTALS
        : type === 'sale' ? BUNGA_SALES
          : [...BUNGA_SALES, ...BUNGA_RENTALS];
    }
  };
}

const bungaAt500k = {
  searchType: 'rent',
  area: 'Bunga',
  maxBudgetUgx: 500000
};

test('a renter is never answered with a house for sale', async () => {
  const calls = [];
  const result = await findBroaderPropertyFallback(bungaAt500k, bungaFinders(calls));
  assert.ok(result.rows.length, 'something must come back');
  assert.strictEqual(result.rows[0].listing_type, 'rent',
    'the first card is what the person sees, and they asked to rent');
  for (const row of result.rows) {
    assert.strictEqual(row.listing_type, 'rent',
      `"${row.title}" is not a rental — this is the 7-bedroom house all over again`);
  }
});

test('the budget is the first thing let go, not the transaction type', async () => {
  const calls = [];
  await findBroaderPropertyFallback(bungaAt500k, bungaFinders(calls));
  const first = calls[0];
  assert.strictEqual(first.searchType, 'rent', 'the first retry must still be looking for rentals');
  assert.ok(!first.budget, 'and it must be the price cap that was dropped');
});

test('the reply is told what was given up, so it can say so', async () => {
  const result = await findBroaderPropertyFallback(bungaAt500k, bungaFinders([]));
  assert.strictEqual(result.relaxed.budget, true, 'the budget was stretched');
  assert.ok(!result.relaxed.type, 'the type was not');
  assert.strictEqual(result.effectiveSearchType, 'rent',
    'the count above the results must describe rentals, not all 67 listings in Bunga');
  assert.strictEqual(result.effectiveArea, 'Bunga');
});

test('the nearest real price can be quoted back', async () => {
  const result = await findBroaderPropertyFallback(bungaAt500k, bungaFinders([]));
  const cheapest = lowestPricedFallbackRow(result.rows);
  assert.strictEqual(Number(cheapest.price), 1000000,
    'the honest answer to "500k in Bunga" is that the lowest is 1M');
  assert.strictEqual(cheapest.listing_type, 'rent');
});

test('the type is given up only when the area has nothing of it at all', async () => {
  const calls = [];
  const emptyForRent = {
    findPropertiesByNaturalFilters: async (filters) => {
      calls.push({ via: 'filters', searchType: filters.searchType });
      return [];
    },
    findPropertiesForWhatsapp: async (type, area) => {
      calls.push({ via: 'type', searchType: type, area });
      // Nowhere has rentals; the area has sales.
      if (type === 'rent') return [];
      return area ? BUNGA_SALES : [];
    }
  };
  const result = await findBroaderPropertyFallback(bungaAt500k, emptyForRent);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.relaxed.type, true, 'and only then is it reported as given up');
  assert.strictEqual(result.effectiveSearchType, 'any',
    'so the heading stops claiming these are rentals');
  const rentAttemptsFirst = calls.findIndex((c) => c.searchType === 'any');
  assert.ok(calls.slice(0, rentAttemptsFirst).every((c) => c.searchType === 'rent'),
    'every attempt before that one must have been looking for rentals');
});

test('when nothing at all exists, it says so rather than inventing a relaxation', async () => {
  const nothing = {
    findPropertiesByNaturalFilters: async () => [],
    findPropertiesForWhatsapp: async () => []
  };
  const result = await findBroaderPropertyFallback(bungaAt500k, nothing);
  assert.deepStrictEqual(result.rows, []);
  assert.deepStrictEqual(result.relaxed, {});
});

test('a search with no budget still keeps its type', async () => {
  const calls = [];
  const result = await findBroaderPropertyFallback(
    { searchType: 'rent', area: 'Bunga' },
    bungaFinders(calls)
  );
  assert.ok(result.rows.every((row) => row.listing_type === 'rent'));
  assert.strictEqual(result.effectiveSearchType, 'rent');
  assert.ok(!result.relaxed.budget, 'there was no budget to stretch');
});
