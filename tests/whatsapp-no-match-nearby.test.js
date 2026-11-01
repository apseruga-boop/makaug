'use strict';

/**
 * "Mulago" (Ronald, 1 Nov 2026, 13:07): no approved listing there, and the
 * reply jumped to "4845 matching properties found in Mulago" — every listing
 * in the country, labelled with his suburb. Kampala around Mulago has plenty.
 * Nearest first, widening until something is found, and when the whole
 * country really is the pool, the header says so.
 */

const test = require('node:test');
const assert = require('node:assert');

const { findBroaderPropertyFallback, fallbackLocationLabel, resolveWhatsappAreaPoint } = require('../routes/whatsapp').__test;

const NEAR_MULAGO = [
  { id: 'n1', title: '2-bed Property for rent in Wandegeya', listing_type: 'rent', area: 'Wandegeya', district: 'Kampala', price: '900000', price_period: 'mo', distance_km: 0.9, total_count: 2 },
  { id: 'n2', title: '1-bed Property for rent in Makerere', listing_type: 'rent', area: 'Makerere', district: 'Kampala', price: '700000', price_period: 'mo', distance_km: 1.4, total_count: 2 }
];

function finders(calls, { nearAt = 3 } = {}) {
  return {
    findPropertiesByNaturalFilters: async (filters) => { calls.push({ via: 'filters', area: filters.area }); return []; },
    findPropertiesForWhatsapp: async (type, area) => { calls.push({ via: 'type', type, area }); return area ? [] : [{ id: 'far', title: 'Land in Gulu', listing_type: 'land', area: 'Gulu', district: 'Gulu', price: '50000000' }]; },
    findPropertiesNearWhatsappWithFilters: async (type, point, filters, miles) => {
      calls.push({ via: 'near', type, miles, lat: point.lat });
      return miles >= nearAt ? { rows: NEAR_MULAGO, usedNearestFallback: false, radiusMiles: miles } : { rows: [], usedNearestFallback: false, radiusMiles: miles };
    },
    resolveAreaPoint: (area) => (area === 'Mulago' ? { lat: 0.337, lng: 32.577, label: 'Mulago', district: 'Kampala' } : null)
  };
}

test('an empty suburb is answered with what is live close by, nearest first, before "anywhere"', async () => {
  const calls = [];
  const result = await findBroaderPropertyFallback({ searchType: 'rent', area: 'Mulago' }, finders(calls));
  assert.strictEqual(result.relaxed.near, true);
  assert.ok(!result.relaxed.area, 'the area was not given up: these are around it');
  assert.deepStrictEqual(result.rows.map((r) => r.id), ['n1', 'n2']);
  assert.match(result.rows[0].proximity_header, /within 3 miles of Mulago/);
  assert.match(result.rows[0].distance_label, /from Mulago/);
  assert.ok(!calls.some((c) => c.via === 'type' && c.area === ''), 'the whole-country search never ran');
  assert.strictEqual(fallbackLocationLabel(result, 'Mulago'), '', 'the header comes from the distance, not the suburb');
});

test('the radius widens until something is found', async () => {
  const calls = [];
  const result = await findBroaderPropertyFallback({ searchType: 'rent', area: 'Mulago' }, finders(calls, { nearAt: 10 }));
  assert.deepStrictEqual(calls.filter((c) => c.via === 'near').map((c) => c.miles), [3, 6, 10]);
  assert.match(result.rows[0].proximity_header, /within 10 miles/);
});

test('when the whole country really is the pool, the header says Uganda, not the suburb', async () => {
  const deps = finders([]);
  deps.resolveAreaPoint = () => null; // a place we cannot put on the map
  const result = await findBroaderPropertyFallback({ searchType: 'any', area: 'Nowhere' }, deps);
  assert.strictEqual(result.relaxed.area, true);
  assert.strictEqual(fallbackLocationLabel(result, 'Nowhere'), 'Uganda');
  assert.strictEqual(fallbackLocationLabel({ relaxed: {}, effectiveArea: 'Bunga' }, 'Bunga'), 'Bunga');
});

test('a failing rung does not cost the customer the rungs below it', async () => {
  const deps = finders([]);
  deps.findPropertiesNearWhatsappWithFilters = async () => { throw new Error('no coordinates column'); };
  const result = await findBroaderPropertyFallback({ searchType: 'any', area: 'Mulago' }, deps);
  assert.ok(result.rows.length, 'the country-wide rung still answered');
  assert.strictEqual(result.relaxed.area, true);
});

test('the registry puts a suburb on the map', () => {
  const point = resolveWhatsappAreaPoint('Mulago');
  assert.ok(point && Number.isFinite(point.lat) && Number.isFinite(point.lng), JSON.stringify(point));
  assert.strictEqual(point.district, 'Kampala');
  assert.strictEqual(resolveWhatsappAreaPoint('zzzz-not-a-place'), null);
});
