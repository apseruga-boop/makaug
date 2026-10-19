'use strict';

/**
 * 19 Oct 2026, three WhatsApp conversations that went nowhere:
 *  - "Hi makaug, I'm looking for land or a plot ... seller or broker ... Page:
 *    makaug.com/land/nansana-wakiso" returned a list of agents (the word "broker").
 *  - "I want a single room for rent muyenga" returned a 4-bedroom house.
 *  - "for petrol stations" got the generic menu.
 */
const assert = require('assert');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const t = require('../routes/whatsapp').__test;

const land = "Hi makaug, I'm looking for land or a plot. Please help me find available land listings, compare details, and contact the seller or broker safely. Page: makaug.com/land/nansana-wakiso";

test('a website land button message becomes a land search in the page area', () => {
  assert.strictEqual(t.websitePrefillSearchText(land), 'land for sale in Nansana Wakiso');
  const f = t.extractNaturalSearchFilters(t.websitePrefillSearchText(land), {}, 'any', {});
  assert.strictEqual(f.searchType, 'land');
  assert.strictEqual(f.area, 'Nansana');
});

test('a generic category page still becomes the right search without inventing an area', () => {
  assert.strictEqual(t.websitePrefillSearchText(land.replace('/land/nansana-wakiso', '/land')), 'land for sale');
  assert.strictEqual(
    t.websitePrefillSearchText("Hi makaug, I'm on the To Rent page and I'm looking for a rental. Please help me. Page: makaug.com/rent"),
    'property to rent'
  );
});

test('a broker request or ordinary message is left alone', () => {
  assert.strictEqual(t.websitePrefillSearchText("Hi makaug, I'm looking for a trusted broker or agent. Page: makaug.com/brokers"), '');
  assert.strictEqual(t.websitePrefillSearchText('rent in Muyenga under 2m'), '');
});

test('"single room" is a property type and matches bedsitters, studios and one-bedroom rentals', () => {
  const f = t.extractNaturalSearchFilters('I want a single room for rent muyenga', {}, 'any', {});
  assert.strictEqual(f.propertyType, 'single room');
  assert.strictEqual(f.searchType, 'rent');
  const values = [];
  const sql = t.whatsappPropertyTypeFilterSql(values, 'single room', 'rent', 'p');
  assert(/bed\[\\s_-\]\?sitter/.test(values[0]) || values[0].includes('bed'), 'bedsitter is covered');
  assert(sql.includes('p.bedrooms'), 'one-bedroom rentals are covered');
});

test('petrol stations are commercial premises', () => {
  const f = t.extractNaturalSearchFilters('for petrol  stations', {}, 'any', {});
  assert.strictEqual(f.searchType, 'commercial');
  assert.strictEqual(f.hasSignal, true);
});

test('a house with a garage is still a house search', () => {
  const f = t.extractNaturalSearchFilters('4 bedroom house with a garage in Kira', {}, 'any', {});
  assert.notStrictEqual(f.searchType, 'commercial');
});

test('a fuel station named as a landmark does not turn a land search into a commercial one', () => {
  const f = t.extractNaturalSearchFilters('land for sale in Kira behind Total fuel station', {}, 'any', {});
  assert.strictEqual(f.searchType, 'land');
});
