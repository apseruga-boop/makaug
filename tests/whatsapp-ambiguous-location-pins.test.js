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

const fs = require('node:fs');
const path = require('node:path');

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

// The two captions exactly as they were sent, 9 Oct 2026.
const SEETA_FULL = 'SEETA_BAJJO RD NEW TARMAC ACCESS🔥🔥 3 RENTAL UNITS OF #2BEDROOMS '
  + 'AND BATHROOM SEATED ON #12DECIMALS MAKING 1.8M UGX TITLED SELLING AT 170M UGX';
const NAKASAJJA_FULL = 'Nakasajja 11 decimals plot near Orevine international school UGX 45 million';

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

test('both captions from the stuck batch now save, exactly as sent', () => {
  for (const caption of [SEETA_FULL, NAKASAJJA_FULL]) {
    assert.deepStrictEqual(missing(caption), [], caption.slice(0, 40));
  }
  assert.deepStrictEqual(where(SEETA_FULL), { area: 'Seeta', district: 'Mukono' });
  assert.deepStrictEqual(where(NAKASAJJA_FULL), { area: 'Nakasajja', district: 'Wakiso' });
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

// ---------------------------------------------------------------------------
// What it earns is not what it costs
// ---------------------------------------------------------------------------

test('the asking price beats the monthly income in the same caption', () => {
  // The Seeta caption carries both: "MAKING 1.8M UGX … SELLING AT 170M UGX".
  // Price notation is normalised before the scan, which turned "1.8M UGX" into a
  // currency-led amount and let it match ahead of "SELLING AT". Once the location
  // stopped blocking it, this would have gone live as a 1.8m rental.
  const f = facts(SEETA_FULL);
  assert.strictEqual(f.price, 170000000, 'the asking price, not the rent roll');
  assert.strictEqual(f.listingType, 'sale', 'a block of rentals being sold is a sale');
});

test('the NALYA block still reads the same way', () => {
  const f = facts('NALYA 4 RENTAL UNITS APARTMENT BLOCK OF 3 BEDROOMS EACH '
    + 'MAKING 10MILLION MONTHLY SELLING UGX 1.1BILLION');
  assert.strictEqual(f.price, 1100000000);
  assert.strictEqual(f.listingType, 'sale');
});

test('an income with no asking price beside it is still the figure we have', () => {
  // Nothing else is stated, so dropping it would lose the only number in the
  // caption and send intake asking for a price the agent already gave.
  const f = facts('Rental block in Kireka making UGX 3m monthly');
  assert.strictEqual(f.price, 3000000);
});

test('an ordinary price led by its currency is untouched', () => {
  assert.strictEqual(facts('House for sale in Kololo UGX 600m').price, 600000000);
  assert.strictEqual(facts('2 bedroom apartment in Ntinda for rent at UGX 1.2m monthly').price, 1200000);
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

// ---------------------------------------------------------------------------
// A batch with nothing outstanding must be closeable
// ---------------------------------------------------------------------------

/**
 * 9 Oct 2026, 09:16. With the location fixed, the batch summary read "needs:
 * nothing more" against both properties — and COMPLETE still answered "I have
 * not completed this batch because one property is still waiting to be matched
 * with its caption and media", of a property that had both. The summary offered
 * "reply OK", which no handler in this step implements.
 *
 * Neither property reached staff review. The batch could not be closed by any
 * word the agent was given.
 */

test('the headline does not claim a detail is missing when none is', () => {
  const ready = route.employeeBatchSummaryHeadline(0, 2, true);
  assert.doesNotMatch(ready, /still need a detail/,
    'the list underneath says "needs: nothing more" — the headline must not contradict it');
  assert.match(ready, /ready and waiting/);
  assert.match(route.employeeBatchSummaryHeadline(0, 1, true), /is ready and waiting/);
});

test('the old headline is unchanged when something really is missing', () => {
  assert.match(route.employeeBatchSummaryHeadline(0, 2), /all 2 properties below still need a detail/);
  assert.match(route.employeeBatchSummaryHeadline(0, 1), /the property below still needs a detail/);
  assert.match(route.employeeBatchSummaryHeadline(3, 0), /All 3 saved/);
});

test('this step never offers OK again, because nothing implements it', () => {
  // A keyword we print but do not handle is a dead end, and this flow has cost
  // us several. If OK is ever offered here again it must be implemented first.
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.doesNotMatch(source, /nothing more — reply \*OK\*/,
    'offer COMPLETE, which saves, or implement OK');
  assert.doesNotMatch(source, /nothing more — send its photos or reply \*OK\*/,
    'the property already has its photos at this point');
});

test('COMPLETE saves what is ready before it refuses anything', () => {
  // The guard that matters: the refusal must come after the save attempt, not
  // instead of it. Reordering these two would restore the loop exactly.
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const flush = source.indexOf('flushReadyEmployeeSubmissions({');
  const refusal = source.indexOf('I have not completed this batch because ${blocker}');
  assert.ok(flush > 0 && refusal > 0, 'both the flush and the refusal should exist');
  assert.ok(flush < refusal, 'COMPLETE must try to save before it reports an obstacle');
});
