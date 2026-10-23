'use strict';

/**
 * 23 Oct 2026: "GAYAZA MAKENKE 3 Bedrooms House For Sale ... UGX 170MILLION" was
 * refused for "exact area and district". Gayaza alone resolves to Wakiso; the
 * extra neighbourhood word sent the phrase to fuzzy matching across a dozen
 * unrelated districts.
 */
const assert = require('assert');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const router = require('../routes/whatsapp');
const { employeePropertyFacts, employeePropertyMissing } = router.__test;

test('a recognised place beside an unknown neighbourhood is the location', () => {
  for (const caption of [
    'GAYAZA MAKENKE\n3 Bedrooms House For Sale\nSited on 50x100ft\nReady Private Title\nUGX 170MILLION  - Negotiable',
    'GAYAZA MAKENKE 3 Bedrooms House For Sale Sited on 50x100ft Ready Private Title UGX 170MILLION - Negotiable'
  ]) {
    const facts = employeePropertyFacts(caption, {});
    assert.strictEqual(facts.locationPatch.area, 'Gayaza');
    assert.strictEqual(facts.locationPatch.district, 'Wakiso');
    assert.deepStrictEqual(employeePropertyMissing(facts), []);
  }
});

test('a caption with no recognisable place still asks for one', () => {
  const facts = employeePropertyFacts('3 bedroom house for sale Makenke UGX 170m', {});
  assert.deepStrictEqual(employeePropertyMissing(facts), ['exact area and district']);
});
