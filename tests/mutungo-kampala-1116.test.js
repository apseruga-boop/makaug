'use strict';

/**
 * Mutungo, 16 Nov 2026.
 *
 * "Apartment block for sale in Mutungo Hill" was filed under Wakiso: the place
 * list had the village on Kigo Road (Wakiso) as an area and Mutungo hill in
 * Nakawa (Kampala) only as a census parish, so the village won. Staff could not
 * move the listing either: the editor refused "Mutungo belongs to Wakiso, not
 * Kampala". Plain "Mutungo" is now the hill in Kampala; the village is Wakiso
 * when the text says Wakiso or Kigo; and staff can choose either district for
 * a place that exists in both.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const registry = require('../utils/ugandaLocationRegistry');
const staff = require('../routes/staff')._test;
const { employeePropertyFacts, employeePropertyMissing } = require('../routes/whatsapp').__test;

const key = (value, district) => registry.canonicalizeUgandaLocation(value, district)?.key || null;
const fromText = (text) => registry.resolveCanonicalUgandaLocationFromText(text);

test('plain Mutungo is the hill in Nakawa, Kampala', () => {
  assert.strictEqual(key('Mutungo'), 'kampala:mutungo');
  assert.strictEqual(key('Mutungo Hill'), 'kampala:mutungo');
  const hill = registry.canonicalLocationByKey('kampala:mutungo');
  assert.strictEqual(hill.district, 'Kampala');
  assert.strictEqual(hill.town, 'Nakawa');
  assert.strictEqual(fromText('Apartment block for sale in Mutungo Hill for $1Million USD').match.key, 'kampala:mutungo');
  assert.strictEqual(fromText('Am looking for a single room house in mutungo').match.key, 'kampala:mutungo');
});

test('the Kigo Road village is Wakiso when the text says so', () => {
  assert.strictEqual(key('Mutungo', 'Wakiso'), 'wakiso:mutungo');
  assert.strictEqual(key('Mutungo Kigo'), 'wakiso:mutungo');
  assert.strictEqual(fromText('plot in Mutungo, Wakiso').match.key, 'wakiso:mutungo');
  assert.strictEqual(fromText('land at Mutungo Kigo road').match.key, 'wakiso:mutungo');
  assert.strictEqual(key('Mutungo Kitiko'), 'wakiso:kitiko', 'unchanged');
});

test('a listing or two under the other Mutungo does not make the name ambiguous', () => {
  const counts = new Map([['wakiso:mutungo', 1], ['kampala:mutungo', 0]]);
  const result = registry.resolveCanonicalUgandaLocation('Mutungo', '', { counts });
  assert.strictEqual(result.status, 'matched');
  assert.strictEqual(result.match.key, 'kampala:mutungo');
});

test('an agent advert for Mutungo Hill is saved in Kampala', () => {
  const facts = employeePropertyFacts('Apartment block for sale in Mutungo Hill for  $1Million USD\nREADY PRIVATE MAILO LAND TITLE \nCONTACT:', {});
  assert.strictEqual(facts.locationPatch.area, 'Mutungo');
  assert.strictEqual(facts.locationPatch.district, 'Kampala');
  assert.deepStrictEqual(employeePropertyMissing(facts), []);
});

test('staff can put a place in either district where it exists in both, and nowhere else', () => {
  const toKampala = staff.normalizeStaffListingPatch({ area: 'Mutungo', district: 'Wakiso', extra_fields: {} }, { area: 'Mutungo', district: 'Kampala' });
  assert.deepStrictEqual(toKampala.errors, []);
  assert.strictEqual(toKampala.patch.district, 'Kampala');

  const toWakiso = staff.normalizeStaffListingPatch({ area: 'Mutungo', district: 'Kampala', extra_fields: {} }, { area: 'Mutungo', district: 'Wakiso' });
  assert.deepStrictEqual(toWakiso.errors, []);
  assert.strictEqual(toWakiso.patch.district, 'Wakiso');

  const priceOnly = staff.normalizeStaffListingPatch({ area: 'Mutungo', district: 'Wakiso', extra_fields: {} }, { price: 5000000 });
  assert.deepStrictEqual(priceOnly.errors, []);
  assert.notStrictEqual(priceOnly.patch.district, 'Kampala', 'a save that does not touch the place does not move it');

  const kira = staff.normalizeStaffListingPatch({ area: 'Kira', district: 'Wakiso', extra_fields: {} }, { area: 'Kira', district: 'Kampala' });
  assert.ok(kira.errors.includes('Kira belongs to Wakiso, not Kampala'), 'still refused where there is no such place');
  const nsangi = staff.normalizeStaffListingPatch({ area: 'Nsangi', district: 'Wakiso', extra_fields: {} }, { area: 'Nsangi', district: 'Masaka' });
  assert.ok(nsangi.errors.includes('Nsangi belongs to Wakiso, not Masaka'));

  assert.deepStrictEqual(staff.staffLocationWarnings({ area: 'Mutungo', district: 'Wakiso', extra_fields: {} }), []);
  assert.deepStrictEqual(staff.staffLocationWarnings({ area: 'Kira', district: 'Kampala', extra_fields: {} }), ['Kira belongs to Wakiso, not Kampala']);
});
