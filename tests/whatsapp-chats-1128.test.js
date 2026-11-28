'use strict';

/**
 * What the chats of 27 and 28 Nov 2026 taught.
 *
 * - A renter looked at single rooms in Kireka at half past one in the
 *   morning, from the To Rent page. At ten he wrote "I'm looking for houses in
 *   kireka" and was shown land for sale at 270M, 3B and 290M: "houses" (the
 *   plural) was not read as a kind of home, and the six hours in which a
 *   search goes on had passed, so renting was forgotten too. Then "I mean
 *   rentals single room" was not read as renting.
 * - A member of staff forwarded "Flat house for sale 330m kasangat
 *   jokorelera ..." and it was held for "exact area and district": Kasangati
 *   written without its last letter.
 * - A listings website's away message ("Thank you for your message. We're
 *   unavailable right now, but will respond as soon as possible ...") came
 *   five hours after our message and got "Welcome back, do you want to carry
 *   on". Two machines talking.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const route = require('../routes/whatsapp').__test;
const playbook = require('../services/whatsappReplyPlaybook');

const filters = (text) => {
  const f = route.extractNaturalSearchFilters(text, {}, 'any', {});
  return { searchType: f.searchType, propertyType: f.propertyType || null, area: f.area || null };
};

test('houses are houses and rentals are renting, said in the plural', () => {
  assert.deepStrictEqual(filters("I'm looking for houses in kireka"), { searchType: 'any', propertyType: 'house', area: 'Kireka' });
  assert.deepStrictEqual(filters('I mean rentals single room'), { searchType: 'rent', propertyType: 'single room', area: null });
  assert.deepStrictEqual(filters('flats for rent Kyanja'), { searchType: 'rent', propertyType: 'apartment', area: 'Kyanja' });
  assert.deepStrictEqual(filters('offices for rent in Kampala'), { searchType: 'commercial', propertyType: 'office', area: 'Kampala' });
  // "Homes to rent" is anywhere to live: flats and rooms as much as houses.
  assert.deepStrictEqual(filters('homes to rent in Kira'), { searchType: 'rent', propertyType: null, area: 'Kira' });
  // A house is still not land: the search for one leaves land out.
  const values = [];
  const sql = route.whatsappPropertyTypeFilterSql
    ? route.whatsappPropertyTypeFilterSql(values, 'house', 'any', 'p')
    : '';
  if (sql) assert.match(sql, /LOWER\(COALESCE\(p\.listing_type, ''\)\) <> 'land'/);
});

test('renting stays renting for the day; the place, budget and kind of home are said again', () => {
  const night = Date.parse('2026-11-27T22:36:00Z'); // 01:36 in Kampala
  const session = {
    last_search_brief: {
      at: new Date(night).toISOString(),
      search_type: 'rent', property_type: 'single room', area: 'Kireka', max_budget_ugx: 150000, budget_period: 'month'
    }
  };
  const morning = night + (8 * 60 + 20) * 60 * 1000; // 09:56 in Kampala
  const said = { searchType: 'any', propertyType: 'house', area: 'Kireka' };
  const next = route.continueFromLastSearch(said, session, { now: morning });
  assert.strictEqual(next.searchType, 'rent', 'still renting');
  assert.strictEqual(next.propertyType, 'house', 'the house they asked for, not the single room');
  assert.ok(!next.maxBudgetUgx, 'the budget is not carried past six hours');
  assert.deepStrictEqual(next.continuedFromLastSearch, ['type']);
  // Said to buy: that is what they get.
  assert.strictEqual(route.continueFromLastSearch({ searchType: 'sale', area: 'Kireka' }, session, { now: morning }).searchType, 'sale');
  // A day on, nothing is carried.
  assert.strictEqual(route.continueFromLastSearch(said, session, { now: night + 25 * 3600e3 }).searchType, 'any');
  // Only renting or buying goes on that long, not a student room or land.
  const student = { last_search_brief: { ...session.last_search_brief, search_type: 'student' } };
  assert.strictEqual(route.continueFromLastSearch(said, student, { now: morning }).searchType, 'any');
});

test('Kasangati written without its last letter is still Kasangati', () => {
  const caption = 'Flat house for sale 330m kasangat jokorelera 5bedrooms 2barthrooms spacious compound 18,decimals prime area private maile land';
  const facts = route.employeePropertyFacts(caption, {});
  assert.deepStrictEqual(route.employeePropertyMissing(facts), []);
  assert.strictEqual(facts.naturalDraft.area, 'Kasangati');
  assert.strictEqual(facts.naturalDraft.district, 'Wakiso');
  assert.strictEqual(facts.listingType, 'sale', 'a house for sale, whatever the land tenure says');
});

test('an away message is a machine whenever it comes, within a day', () => {
  const away = "Thank you for your message. We're unavailable right now, but will respond as soon as possible. And feel free to browse current properties listing s and/or sign up to list your properties or services for FREE on: www.example.com";
  assert.strictEqual(playbook.looksLikeAwayMessage(away), true);
  assert.strictEqual(playbook.AWAY_MESSAGE_WINDOW_SECONDS, 86400);
  // One machine-like phrase from a person is still answered after ten minutes.
  for (const said of ['I need a house in Kira, thank you for your message', 'Thanks for the info, I will get back to you soon', 'Welcome! This is Testa Property Agency:']) {
    assert.strictEqual(playbook.looksLikeAwayMessage(said), false, said);
  }
  const source = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert.match(source, /const window = replyPlaybook\.looksLikeAwayMessage\(effectiveBody\)\n\s+\? replyPlaybook\.AWAY_MESSAGE_WINDOW_SECONDS\n\s+: replyPlaybook\.AUTO_REPLY_WINDOW_SECONDS;/);
});
