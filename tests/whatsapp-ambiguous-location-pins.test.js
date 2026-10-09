'use strict';

/**
 * Two places named, one district. And a landmark that answers the question.
 *
 * 9 Oct 2026, 07:49. A batch of two came back "📋 Nothing saved yet — all 2
 * properties below still need a detail", and neither of them needed one:
 *
 *   "SEETA_BAJJO RD NEW TARMAC ACCESS🔥🔥 3 RENTAL UNITS OF #2 BEDROOMS…"
 *      → needs: exact area and district
 *   "Nakasajja 11 decimals plot near Orevine international school…"
 *      → needs: which district Nakasajja is in — Wakiso or Mukono
 *
 * Two different failures wearing the same coat.
 *
 * The first: Seeta and Bajjo are both in the registry and both in Mukono. Two
 * recognised names made the caption "ambiguous", and ambiguous meant blocked —
 * even though the two candidates agreed on the only thing intake needed. The
 * agent was never unclear about the district.
 *
 * The second is a fair question asked at the wrong moment. Nakasajja genuinely
 * is in two districts: Wakiso on Gayaza Road, and Kyampisi in Mukono. But the
 * caption had already answered it — Orel-Vine's campus is the Gayaza Road one.
 *
 * What must stay true: a name that really is ambiguous, with nothing in the
 * caption to settle it, still gets asked about. The fix is for captions that
 * carry the answer, not a licence to guess.
 */

const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/whatsapp').__test;
const { landmarkDistrictsInText } = require('../utils/ugandaLandmarkPins');

const facts = (caption) => route.employeePropertyFacts(caption, {});
const missing = (caption) => route.employeePropertyMissing(facts(caption));
const where = (caption) => {
  const { locationPatch = {} } = facts(caption);
  return { area: locationPatch.area, district: locationPatch.district };
};

const SEETA = 'SEETA_BAJJO RD NEW TARMAC ACCESS🔥🔥 3 RENTAL UNITS OF #2 BEDROOMS '
  + 'SELF CONTAINED AT 85M';
const NAKASAJJA = 'Nakasajja 11 decimals plot near Orevine international school at 40m';

// ---------------------------------------------------------------------------
// Two names, one district
// ---------------------------------------------------------------------------

test('Seeta and Bajjo both being Mukono is an answer, not an ambiguity', () => {
  assert.deepStrictEqual(missing(SEETA), [],
    'the caption named the place, the type and the price — nothing was outstanding');
  assert.deepStrictEqual(where(SEETA), { area: 'Seeta', district: 'Mukono' });
});

test('the underscore the agent typed does not hide the place', () => {
  assert.deepStrictEqual(where('SEETA_BAJJO RD 3 RENTAL UNITS AT 85M'),
    where('SEETA BAJJO RD 3 RENTAL UNITS AT 85M'));
});

test('the first name written wins, because the rest places it', () => {
  // "Seeta Bajjo Rd" is a road in Seeta, not a property in Bajjo.
  assert.strictEqual(where('SEETA BAJJO RD 3 RENTAL UNITS AT 85M').area, 'Seeta');
  assert.strictEqual(where('BAJJO SEETA RD 3 RENTAL UNITS AT 85M').area, 'Bajjo');
});

// ---------------------------------------------------------------------------
// The landmark that settles it
// ---------------------------------------------------------------------------

test('Orel-Vine puts Nakasajja in Wakiso, however the agent spells it', () => {
  assert.deepStrictEqual(landmarkDistrictsInText('near Orevine international school'), ['Wakiso']);
  assert.deepStrictEqual(landmarkDistrictsInText('near Orel-Vine International Academy'), ['Wakiso']);
  assert.deepStrictEqual(landmarkDistrictsInText('near orelvine'), ['Wakiso']);
});

test('so the plot saves instead of asking a question it was already told', () => {
  assert.deepStrictEqual(missing(NAKASAJJA), []);
  assert.deepStrictEqual(where(NAKASAJJA), { area: 'Nakasajja', district: 'Wakiso' });
});

test('any place we recognise can settle it — no landmark entry needed', () => {
  // The general rule, and the one that will carry most captions: agents write
  // the road far more often than they write a school.
  assert.deepStrictEqual(where('Nakasajja plot along Gayaza road at 40m'),
    { area: 'Nakasajja', district: 'Wakiso' });
});

test('a landmark only picks from the shortlist, it never invents a district', () => {
  // Orel-Vine pins Wakiso. Seeta's candidates are Mukono only, so the pin has
  // no vote and must not drag the listing to Wakiso.
  assert.strictEqual(where('SEETA BAJJO RD near Orevine international school at 85M').district,
    'Mukono');
});

// ---------------------------------------------------------------------------
// The question we still want asked
// ---------------------------------------------------------------------------

test('Nakasajja with nothing to place it is still a real question', () => {
  assert.deepStrictEqual(missing('Nakasajja 11 decimals plot at 40m'),
    ['which district Nakasajja is in — Wakiso or Mukono'],
    'both Nakasajjas are real; guessing between them would file land in the wrong district');
});

test('the Watuba loop stays shut', () => {
  // Watuba is in three districts and Luwero is named: the district the agent
  // wrote must survive, or answering the question asks it again.
  assert.deepStrictEqual(missing('10 acres at Watuba Luwero for sale at 200m'), []);
});

test('two ambiguous names that settle nothing are never silently picked', () => {
  // Kasana sits in Kayunga and Mukono, Nakasajja in Wakiso and Mukono. Mukono
  // is on both shortlists, which is exactly the shape that would tempt a guess.
  // Neither name is evidence about the other, so nothing may be filed.
  const caption = 'plot at Kasana Nakasajja at 40m';
  const { locationPatch = {} } = facts(caption);
  assert.ok(!locationPatch.district,
    'no district may be recorded when nothing in the caption chose one');
  assert.ok(missing(caption).length > 0, 'and it must still be asked about');
});
