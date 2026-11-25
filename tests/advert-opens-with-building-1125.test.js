'use strict';

/**
 * 25 Nov 2026. An agent's forwarded adverts came into review as land:
 * "Those unfinished houses are on sale … 50 by 100 feet with title" and "The
 * above senior secondary school it's on sale … on 1 acre and 50 decimals".
 * The plot size made them land, and the moderator had to change each by hand
 * and approve past the data check. An advert that opens with the building it
 * sells is that building. Every caption here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/whatsapp').__test;
const type = (caption) => route.employeePropertyFacts(caption, {}).listingType;

test('an advert that opens with its building is the building, whatever it stands on', () => {
  assert.strictEqual(type('Those unfinished houses are on sale located at Testville, 50 by 100 feet with title on table, the owner wants 115m but negotiable'), 'sale');
  assert.strictEqual(type("The above senior secondary school it's on sale located at Testville trading centre, on 1 acre and 50 decimals, title available, the owner wants 300m"), 'commercial');
  assert.strictEqual(type('Hotel for sale in Testville on 2 acres at 2.5bn'), 'commercial');
  assert.strictEqual(type('12 self contained units for rent in Testville at 300k per month'), 'rent');
});

test('land is still land, even with houses or a school nearby or in what it suits', () => {
  assert.strictEqual(type('Those are 4 acres of land located at Testville, each at 10m, title available'), 'land');
  assert.strictEqual(type('12 decimals Testville ring Road near houses NOW SELLING UGX 200 million'), 'land');
  assert.strictEqual(type('Acres for sale in Testville town, 4 acres, on main road, suitable for many projects, factory, school, hotel, apartments, hospital, 200m'), 'land');
  assert.strictEqual(type('Plot for sale in Testville near a school, 50x100, title, 45m'), 'land');
  assert.strictEqual(type('3 bedroom house for sale in Testville on a 50x100 plot with title, 350m'), 'sale');
});
