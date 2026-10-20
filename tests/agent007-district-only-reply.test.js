'use strict';

/**
 * 19 Oct 2026: Brian's "Off Mukono Kayunga Road" plot was waiting on an area and
 * district. He answered "Mukono district" twice and was asked the same thing
 * again, and his later complete captions were refused behind it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const router = require('../routes/whatsapp');
const { employeePropertyFacts, employeePropertyMissing } = router.__test;

const waiting = 'Off Mukono Kayunga Road\n\nPlot size 1 acre.   Price 290M “as is”\n\nIncomplete 4 bedroom house \n\nReady land title';

test('a district-only reply merged into the waiting caption resolves the district but not an area', () => {
  const facts = employeePropertyFacts(`${waiting}\nMukono district`, {});
  assert.strictEqual(facts.locationPatch.district, 'Mukono');
  assert(facts.locationPatch.canonical_location_id);
  assert(!facts.locationPatch.area);
  assert.deepStrictEqual(employeePropertyMissing(facts), ['exact area and district']);
});

test('the intake accepts the district as the answer instead of asking again', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert(src.includes("area: mergedFacts.locationPatch.district"));
});

test('a new complete caption is queued, not refused, while another property waits', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert(src.includes('I kept this new caption safe'));
  assert(!src.includes('Finish that property first, then resend this caption'));
});
