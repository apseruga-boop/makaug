'use strict';
const assert = require('assert');
const test = require('node:test');
process.env.NODE_ENV = 'test';
const { employeePropertyFacts } = require('../routes/whatsapp').__test;

test('monthly income is not the asking price', () => {
  const f = employeePropertyFacts('Hot deal rentals ON SALE!!! Location #SEETA_TOWN(Along Namilyango Rd) 2 double roomed shops & 4 units of 2bedrooms 16decimals they have monthly revenue of(2.5m ugx) At only #180m ugx', {});
  assert.strictEqual(Number(f.price), 180000000);
  const g = employeePropertyFacts('rentals on sale Location #Namugongo_Misindye 10 double self-contained rooms With total income of #2.5m ugx, titled 20decimals At#190m ugx', {});
  assert.strictEqual(Number(g.price), 190000000);
  const h = employeePropertyFacts('Bank property deal rentals on sale Location #Kiwanga_Bweyogerere 2units of 2bedrooms 10decimals with total income of #1m ugx At only #115m UG x last', {});
  assert.strictEqual(Number(h.price), 115000000);
});

test('a road named after a district does not become the district', () => {
  const f = employeePropertyFacts('Residential house up 4 sale Location #Mukono_Kisowera kayunga rd.. measuring 25decimals has 3bedrooms At only 180m ugx', {});
  assert.strictEqual(f.locationPatch.district, 'Mukono');
  const g = employeePropertyFacts('Kyanja Ring Road 6 units of One Bedroom Apartments On 12 Decimals Selling at 850M', {});
  assert.strictEqual(g.locationPatch.area, 'Kyanja');
});
