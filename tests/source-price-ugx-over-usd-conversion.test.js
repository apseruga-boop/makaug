'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeFoundOnlineSourcePost } = require('../services/socialSearchSourcedListingsService');

const caption = 'Plot for sale in Nakwero Gayaza Road Uganda Already titled Good for residential and commercial use Price: Ugx 65 million ($15,324) VISIT OUR OFFICIAL WEBSITE';

test('0C0E8C: a UGX price with a dollar conversion in brackets stays UGX', () => {
  const row = normalizeFoundOnlineSourcePost({
    title: 'Plot for sale Nakwero sale $15,324',
    description: caption,
    source_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    district: 'Wakiso'
  });
  assert.equal(row.price, 65000000);
  assert.equal(row.priceOriginalCurrency, 'UGX');
});

test('a dollar-only price is still converted from USD', () => {
  const row = normalizeFoundOnlineSourcePost({
    title: 'House for sale $120,000',
    description: 'House for sale in Kira. Price $120,000',
    source_url: 'https://www.youtube.com/watch?v=abcdefghijl'
  });
  assert.equal(row.priceOriginalCurrency, 'USD');
  assert.equal(row.priceOriginal, 120000);
});
