'use strict';

/**
 * The question an agent can actually answer.
 *
 * 4 Oct 2026, 08:19. Francis Isabirye's block went to Agent 007:
 *
 *   "NALYA 4 RENTAL UNITS APARTMENT BLOCK OF 3 BEDROOMS EACH
 *    MAKING 10MILLION MONTHLY SELLING UGX 1.1BILLION"
 *
 * It came back "⚠️ Not saved yet … Still needs: exact area and district", and
 * the batch would not complete. The area was the first word of the caption.
 *
 * Naalya is a suburb on the Northern Bypass that anyone in Kampala can point to.
 * The administrative gazetteer is built from UBOS parish names and carried only
 * Nalyankanja, in Mityana and Mubende, so nothing matched — and the message
 * asked for the one thing he had already given. There was no reply that would
 * have worked, which is the same dead end Ronald hit on 28 Sep with Bulabakulu,
 * where he answered three times and gave up.
 *
 * Two things were wrong, and the registry gap was only the first.
 */

const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/whatsapp').__test;
const { resolveWhatsappLocation } = require('../services/whatsappLocationResolverService');

const facts = (caption) => route.employeePropertyFacts(caption, {});
const missing = (caption) => route.employeePropertyMissing(facts(caption));

const FRANCIS = 'NALYA 4 RENTAL UNITS APARTMENT BLOCK OF 3 BEDROOMS EACH '
  + 'MAKING 10MILLION MONTHLY SELLING UGX 1.1BILLION';

// ---------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------

test('Naalya is a place, spelled either way', () => {
  for (const spelling of ['Naalya', 'Nalya', 'naalya', 'NALYA']) {
    const resolved = resolveWhatsappLocation(spelling, { allowText: true });
    assert.strictEqual(resolved?.status, 'matched', `"${spelling}" must resolve`);
    assert.strictEqual(resolved.match.district, 'Wakiso',
      'Naalya is in Wakiso, Kira Municipality — not Mityana, where Nalyankanja is');
  }
});

test("Francis's block saves, with nothing outstanding", () => {
  const patch = facts(FRANCIS).locationPatch;
  assert.strictEqual(patch.area, 'Naalya');
  assert.strictEqual(patch.district, 'Wakiso');
  assert.deepStrictEqual(missing(FRANCIS), [], 'this is the message that would not save');
});

// ---------------------------------------------------------------------------
// The price
// ---------------------------------------------------------------------------

test('a block of rentals being sold is a sale, not a 1.1bn monthly rent', () => {
  const sold = facts(FRANCIS);
  assert.strictEqual(sold.listingType, 'sale',
    '"rental" and "monthly" describe what it earns; "SELLING" describes what is on offer');
  assert.strictEqual(Number(sold.price), 1100000000);
});

test('ordinary rentals are still rentals', () => {
  const unchanged = [
    ['3 bedroom house for rent in Kira, Wakiso at 1.2m per month', 'rent'],
    ['2 bedroom apartment for rent in Ntinda at 1.5m monthly', 'rent'],
    ['Rental units in Najjera for rent at 800k per month', 'rent'],
    ['Rental block on sale in Kyanja at 850m making 7m monthly', 'sale']
  ];
  for (const [caption, expected] of unchanged) {
    assert.strictEqual(facts(caption).listingType, expected, `"${caption.slice(0, 44)}…"`);
  }
});

// ---------------------------------------------------------------------------
// The next place we are missing
// ---------------------------------------------------------------------------

/**
 * Adding Naalya fixes Naalya. The registry will always trail the places agents
 * actually sell in — Konge and Nsagu are both missing today — so the refusal
 * itself had to change.
 */
test('a place we do not have is named back, and only its district is asked for', () => {
  assert.deepStrictEqual(missing('Plot for sale in Konge at 180m'), ['which district Konge is in'],
    'asking for "exact area and district" asks for the area they just gave');
  const patch = facts('Plot for sale in Konge at 180m').locationPatch;
  assert.strictEqual(patch.area, 'Konge', 'the name they wrote is kept');
  assert.strictEqual(patch.canonical_location_match, 'area_stated_district_unknown');
  assert.ok(!patch.district, 'and no district is invented');
});

test('the one-word answer completes the property', () => {
  // What intake actually evaluates: the original caption with the reply added.
  const answered = facts('Plot for sale in Konge at 180m\nWakiso');
  assert.strictEqual(answered.locationPatch.area, 'Konge', 'the area must survive the answer');
  assert.strictEqual(answered.locationPatch.district, 'Wakiso');
  assert.deepStrictEqual(route.employeePropertyMissing(answered), [],
    'being asked for a district, giving it, and being refused again is the loop that made Ronald stop');
});

test("Ronald's 28 September caption keeps its area too", () => {
  const patch = facts('WAKISO -BULABAKULU ROADSIDE ESTATE 100BY50FTS @ 45M').locationPatch;
  assert.strictEqual(patch.area, 'Bulabakulu');
  assert.strictEqual(patch.district, 'Wakiso');
});

// ---------------------------------------------------------------------------
// What must never be treated as a place
// ---------------------------------------------------------------------------

/**
 * "This is the biggest property in Northern Uganda, we found it 😁 8000 acres…"
 * went live as *Land for sale in This*. Taking an unrecognised word at its word
 * is exactly the move that caused that, so the gate stays narrow.
 */
test('a sales pitch is not a location', () => {
  for (const caption of [
    'This is the biggest property in Northern Uganda, we found it 8000 acres of land for sale in Adjumani at 3m per acre',
    'Massive 200 acres large on sale in Luweero, mailo land title at 12m each acre',
    'Most affordable land you will ever see in Mukono at 9m',
    'Beautiful home for sale in Wakiso at 450m',
    'Spacious bungalow for sale in Mukono at 300m'
  ]) {
    const area = facts(caption).locationPatch.area;
    assert.ok(!area || resolveWhatsappLocation(area, { allowText: true })?.status === 'matched',
      `"${caption.slice(0, 34)}…" offered "${area}" as a place`);
  }
});

test('a word a clause away from the district is still not the area', () => {
  assert.notStrictEqual(
    facts('Bulabakulu is a lovely place and this plot is for sale in Wakiso at 45m').locationPatch.area,
    'Bulabakulu',
    'once a district has matched, the area has to sit beside it'
  );
});

test('a caption naming no place at all is not given one', () => {
  for (const caption of ['house for sale at 300m', 'Plot on quick sale, price 45m negotiable']) {
    assert.ok(!facts(caption).locationPatch.area, `"${caption}" names nowhere`);
    assert.deepStrictEqual(missing(caption).filter((item) => /area|district/i.test(item)),
      ['exact area and district'], 'with nothing to go on, the original question is the right one');
  }
});

test('places we already resolve are untouched', () => {
  for (const [caption, area, district] of [
    ['Selling 5 bedroom house in Kololo @600m UGX', 'Kololo', 'Kampala'],
    ['Plot for sale in Kira, Wakiso 50x100 at 90m', 'Kira', 'Wakiso'],
    ['4 bedroom house for sale in Najjera at 500m', 'Najjera', 'Wakiso']
  ]) {
    const patch = facts(caption).locationPatch;
    assert.strictEqual(patch.area, area);
    assert.strictEqual(patch.district, district);
    assert.strictEqual(patch.canonical_location_match, 'exact_alias');
  }
});
