'use strict';

/**
 * "We need a restaurant place for rent in KAWEMPE"
 *
 * 5 Oct 2026, 11:36, from a Georgian number that had messaged two minutes
 * earlier asking for commercial property in Ntinda. The reply:
 *
 *   ✅ Filters applied: To Rent
 *   🔎 3 matching rental properties found in Kawempe
 *   1. Property for rent in Kawempe — USh 300K/month  (a single room)
 *
 * A single room offered as premises for a restaurant.
 *
 * The commercial vocabulary in this file was commercial|office|retail|warehouse|
 * shop|business space. "Restaurant" was not in it, so "for rent" won and the
 * search ran against residential rentals. The SQL that categorises listings has
 * always known restaurant is commercial, so the two halves of the system
 * disagreed about the same word.
 *
 * Everything downstream was already right, and that is the galling part. Had the
 * type been read correctly, the search would have found no commercial space in
 * Kawempe — there is none — and formatNoMatchOrFallbackReply would have said so,
 * saved the request as a demand lead, and offered commercial space elsewhere.
 * None of it ran, because three irrelevant results looked like success. No lead
 * was ever recorded for this man.
 */

const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/whatsapp').__test;

const typeOf = (text) => route.inferListingTypeFromStartRequest(text, {}) || '(none)';

test('the message that started this reads as commercial', () => {
  assert.strictEqual(typeOf('We need a restaurant place for rent in KAWEMPE'), 'commercial',
    'read as a residential rental, he was shown a single room at 300K');
});

test('the businesses people actually ask for premises for', () => {
  const asks = [
    'I need a bar and restaurant space in Ntinda',
    'Looking for a salon to rent in Kawempe',
    'pharmacy space for rent Kampala',
    'I want a shop for rent in Kikuubo',
    'warehouse to rent in Nalukolongo',
    'office space in Nakasero',
    'supermarket premises Kyanja',
    'bakery space for rent in Mukono',
    'butchery to rent Nateete',
    'hardware shop space in Kawempe',
    'a kiosk to rent at the stage',
    'gym space for rent in Kololo',
    'clinic premises to rent in Kira',
    'boutique space Ntinda',
    'garage workshop to rent in Nalukolongo',
    'duuka for rent in Bwaise'
  ];
  for (const ask of asks) {
    assert.strictEqual(typeOf(ask), 'commercial', `"${ask}"`);
  }
});

/**
 * The risk in widening this list is the opposite mistake: somebody looking for
 * somewhere to live, described by what is near it or what it has, sent to
 * commercial listings instead.
 */
test('a neighbourhood landmark is not a request for premises', () => {
  const homes = [
    ['3 bedroom house for rent in Ntinda near a school', 'rent'],
    ['house for sale in Muyenga with a garage', 'sale'],
    ['4 bedroom home for sale in Najjera close to the shop', 'sale'],
    ['2 bedroom to rent in Kira opposite the pharmacy', 'rent'],
    ['family house for rent in Kyanja next to a supermarket', 'rent'],
    ['bungalow for sale in Seeta behind the arcade', 'sale'],
    ['apartment for rent in Bukoto walking distance to the gym', 'rent']
  ];
  for (const [ask, expected] of homes) {
    assert.strictEqual(typeOf(ask), expected, `"${ask}" is somebody looking for somewhere to live`);
  }
});

/**
 * The mistake in reverse, which widening this list very nearly caused: a home
 * described by the rooms in it. A mansion with a bar is a house.
 */
test('a room inside a house is not a business', () => {
  // The caption that caught this: the bar is a room in the mansion. This
  // function finds no sale/rent word in it at all — the sale comes from the
  // high-value dollar rule further on — so what matters here is only that it is
  // never read as premises.
  const mansion = 'A 7 bedrooms mansion in Munyonyo with three sitting rooms, two kitchens, '
    + '8 bathrooms and rooftop kitchen, a bar and a bathroom going for 580,000 dollars last price.';
  assert.strictEqual(route.commercialUseInSearch(mansion), false, 'a mansion with a bar is a house');
  assert.notStrictEqual(typeOf(mansion), 'commercial');

  const homes = [
    ['5 bedroom house for sale in Kololo with a gym and a bar', 'sale'],
    ['4 bedroom villa for rent in Naguru with a spa and salon room', 'rent'],
    ['3 bedroom home for sale in Kira with a workshop at the back', 'sale']
  ];
  for (const [ask, expected] of homes) {
    assert.strictEqual(typeOf(ask), expected, `"${ask.slice(0, 48)}…" is a home`);
  }
  // But the same words, with no house around them, are somebody wanting premises.
  assert.strictEqual(typeOf('bar and restaurant for rent in Ntinda'), 'commercial');
  assert.strictEqual(typeOf('gym space to rent in Naguru'), 'commercial');
});

/**
 * Premises win even inside a sentence that mentions a dwelling, when the word
 * admits no other reading.
 */
test('an unmistakable premises word is not softened by the word "house"', () => {
  assert.strictEqual(typeOf('warehouse for rent in Nalukolongo near a house'), 'commercial');
  assert.strictEqual(typeOf('office block for sale in Nakasero next to apartments'), 'commercial');
});

test('the other searches are untouched', () => {
  assert.strictEqual(typeOf('I want land in Gayaza'), 'land');
  assert.strictEqual(typeOf('hostel near campus in Wandegeya'), 'student');
  assert.strictEqual(typeOf('3 bedroom house for rent in Kira'), 'rent');
  assert.strictEqual(typeOf('4 bedroom home for sale in Najjera'), 'sale');
  assert.strictEqual(typeOf('plot for sale in Mukono'), 'land');
});

test('the word has to be in the message at all', () => {
  assert.strictEqual(route.commercialUseInSearch(''), false);
  assert.strictEqual(route.commercialUseInSearch('hello'), false);
  // Not a substring of an ordinary word: "workshops" is a business, "barbecue"
  // is not a barber.
  assert.strictEqual(route.commercialUseInSearch('barbecue area'), false);
  assert.strictEqual(route.commercialUseInSearch('a spacious home'), false,
    '"spa" must not match inside "spacious"');
});
