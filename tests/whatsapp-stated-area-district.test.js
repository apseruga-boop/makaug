'use strict';

/**
 * 28 Sep 2026, 10:48. Ronald forwarded a plot through Agent 007:
 *
 *   *WAKISO -BULABAKULU ROADSIDE ESTATE 100BY50FTS @ 45M WITH READY LANDTITLE
 *    EXACTLY 500METRES OFF TARMAC
 *
 * and was told it still needed "exact area and district". He answered three
 * times over two minutes — "Wakiso district headquarters", "For sale in wakiso
 * district, near district headquarters.", "Wakiso" — and each time got the same
 * refusal back.
 *
 * He had it right the first time. Every one of those resolves to Wakiso at
 * district level, and the intake rejected district-level matches outright:
 *
 *   const exactLocation = matched && !['district','region'].includes(level) && confidence >= 1;
 *
 * Bulabakulu is simply not in our location registry, so the only thing that
 * could match was the district, and the district was refused. Nothing he could
 * type would ever have saved that plot. The example in the prompt — "Kira,
 * Wakiso" — works only because Kira happens to be a place we already know.
 *
 * That turned a gap in our own data into the agent's problem, in a loop with no
 * exit. Now a known district plus an area the agent named is accepted and
 * recorded as needing confirmation. Nothing is published without a moderator,
 * so the only thing the old behaviour protected was an empty review queue.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  employeePropertyFacts,
  employeePropertyMissing,
  resolveWhatsappLocation
} = require('../routes/whatsapp').__test;

const RONALD_CAPTION = '*WAKISO -BULABAKULU ROADSIDE ESTATE 100BY50FTS @ 45M WITH READY LANDTITLE EXACTLY 500METRES OFF TARMAC';

const facts = (text) => employeePropertyFacts(text, {});
const missing = (text) => employeePropertyMissing(facts(text));

test('the place Ronald named really is absent from the registry', () => {
  // The premise of the whole fix: he was not being vague, we were incomplete.
  assert.strictEqual(resolveWhatsappLocation('Bulabakulu', { allowText: true }).status, 'unmatched');
  const wakiso = resolveWhatsappLocation('Wakiso', { allowText: true });
  assert.strictEqual(wakiso.status, 'matched');
  assert.strictEqual(wakiso.match.level, 'district', 'and Wakiso only ever matches as a district');
});

test('his caption now yields the area he actually wrote', () => {
  const patch = facts(RONALD_CAPTION).locationPatch;
  assert.strictEqual(patch.area, 'Bulabakulu');
  assert.strictEqual(patch.district, 'Wakiso');
  assert.strictEqual(patch.canonical_location_match, 'district_with_stated_area',
    'staff must be able to see that the area is the agent’s word, not ours');
  assert.ok(Number(patch.canonical_location_confidence) < 1,
    'and that it is less certain than a registry match');
  assert.ok(!missing(RONALD_CAPTION).includes('exact area and district'),
    'the location question is answered and must stop being asked');
});

test('the exact reply he sent at 10:49 completes the property', () => {
  // A short correction is merged onto the caption it belongs to, so this is the
  // text the intake actually judged.
  const merged = `${RONALD_CAPTION}\nFor sale in wakiso district, near district headquarters.`;
  assert.deepStrictEqual(missing(merged), [],
    'nothing outstanding — before this change it asked for the area forever');
  const patch = facts(merged).locationPatch;
  assert.strictEqual(patch.area, 'Bulabakulu');
  assert.strictEqual(patch.district, 'Wakiso');
  assert.strictEqual(facts(merged).listingType, 'sale');
});

test('a district with nothing beside it is still not enough', () => {
  // The rule that district alone is too vague to publish was right. Only the
  // case where the agent DID name somewhere has changed.
  for (const caption of [
    'Land for sale in Wakiso at 45m',
    'Quick deal land for sale in Wakiso district with ready title 45m',
    'FOR SALE READY TITLE WAKISO 45M',
    '3 bedroom house for rent in Kampala at 1.5m'
  ]) {
    const patch = facts(caption).locationPatch;
    assert.strictEqual(patch.area, undefined, `"${caption}" names no area, so none may be invented`);
    assert.ok(missing(caption).includes('exact area and district'));
  }
});

test('places we do know are untouched by any of this', () => {
  const kira = facts('Kira, Wakiso 3 bedroom house at 250m for sale').locationPatch;
  assert.strictEqual(kira.area, 'Kira');
  assert.strictEqual(kira.canonical_location_match, 'exact_alias', 'a real match must stay a real match');
  assert.strictEqual(Number(kira.canonical_location_confidence), 1);

  const kololo = facts('Selling 5 bedroom house in Kololo @600m UGX').locationPatch;
  assert.strictEqual(kololo.area, 'Kololo');
  assert.strictEqual(kololo.district, 'Kampala');
  assert.strictEqual(kololo.canonical_location_match, 'exact_alias');

  const nansana = facts('Land for sale in Nansana Wakiso 45m').locationPatch;
  assert.strictEqual(nansana.area, 'Nansana');
  assert.strictEqual(nansana.canonical_location_match, 'exact_alias');
});

test('a caption that opens with the price still gives up its area', () => {
  const patch = facts('45m plot in Wakiso Bulabakulu').locationPatch;
  assert.strictEqual(patch.area, 'Bulabakulu');
  assert.strictEqual(patch.district, 'Wakiso');
});

test('the area is written for a reader, not shouted', () => {
  // It arrives in block capitals in most forwarded captions.
  assert.strictEqual(facts(RONALD_CAPTION).locationPatch.area, 'Bulabakulu');
  assert.notStrictEqual(facts(RONALD_CAPTION).locationPatch.area, 'BULABAKULU');
});
