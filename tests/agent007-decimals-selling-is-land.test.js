'use strict';
/**
 * 26 Oct 2026: "12 decimals Kyanja ring Road NOW SELLING UGX 200 million"
 * went to review as a "Property for sale" with no type and no size.
 */
const assert = require('assert');
const test = require('node:test');
process.env.NODE_ENV = 'test';
const router = require('../routes/whatsapp');
const { employeePropertyFacts, employeeLandSize } = router.__test;

test('a priced plot in decimals that is "selling" is land', () => {
  const facts = employeePropertyFacts('12 decimals Kyanja ring Road NOW SELLING UGX 200 million', {});
  assert.strictEqual(facts.listingType, 'land');
  assert.strictEqual(Number(facts.price), 200000000);
});

test('a house on a plot stays a sale', () => {
  const facts = employeePropertyFacts('3 bedroom house on 12 decimals Kyanja NOW SELLING UGX 450 million', {});
  assert.strictEqual(facts.listingType, 'sale');
});

test('the plot size is read from the caption', () => {
  assert.deepStrictEqual(employeeLandSize('12 decimals Kyanja ring Road NOW SELLING UGX 200 million'), { value: 12, unit: 'decimals' });
  assert.deepStrictEqual(employeeLandSize('2.5 acres at Gayaza 150m'), { value: 2.5, unit: 'acres' });
  assert.deepStrictEqual(employeeLandSize('3 bedroom house Kira 300m'), { value: null, unit: null });
});
