'use strict';

/**
 * 6 Nov 2026, 15:28–15:38: a renter came from the To Rent page with a clear
 * brief — a single room, 150k–200k, in Bunga/Kansanga/near Soya — and left
 * ten minutes later with "Seems you don't have what I want. Have a great day."
 *
 * What he got: "That looks like a property you are selling: For rent · 3-bed
 * · Nanganda, Kalungu · USh 150,000/month" (the forwarded-advert question);
 * one message swallowed as a second caption; search results at 600k, 1M and
 * 1.2M because the 150k–200k range parsed as no budget at all; result lines
 * reading "Property for rent in Bunga" with no home type; the menu when he
 * gave up; and "Verified agents (Bunga)" naming two brokers with nothing in
 * Bunga. Nobody at makaug heard.
 */
const test = require('node:test');
const assert = require('node:assert');
const t = require('../routes/whatsapp').__test;
const { buildWhatsappPropertySearchReply, whatsappHomeTypeLine } = require('../services/whatsappPropertyCardService');

const BRIEF = 'Hi makaug, I\'m on the To Rent page and I\'m looking for a rental. Please help me Am looking for a rental; Single room Between 150k- 200k In bunga, Kansanga, kalungu, nanganda, konga or near soya trading centre I need a house that is either with in or1-3km from soya';
const BRIEF_2 = '150k -200k rent At Soya bunga or 1km-3km away';
const BRIEF_3 = '150k -200k rent Single room At Soya bunga or 1km-3km away';

test('a search brief is never read as an advert being forwarded', () => {
  for (const text of [BRIEF, BRIEF_2, BRIEF_3, 'Single room Between 150k- 200k In bunga', '2 bedroom in Kira 800k-1m', 'I have a client looking for a 3 bedroom house in Kira under 1.5m per month', 'Do you have any single rooms available in Kansanga for 200k']) {
    assert.strictEqual(t.looksLikeSearchBrief(text), true, text);
    assert.strictEqual(t.looksLikeForwardedProperty({ cleanBody: text, mediaUrl: '', runtime: {} }), false, text);
  }
  for (const text of [
    'HOUSE FOR SALE KITENDE KITOVU ENTEBBE ROAD. 3BEDROOMS SELF CONTAINED ON 18 DECIMALS WITH TITTLE AT ASKING PRICE 370M',
    '2 bedroom apartment for rent in Ntinda at 1.2m per month, call 0700000000',
    'Plot for sale in Gayaza 50x100 at 25m, 2km from the main road',
    'Vanta House has reached the 7th floor. 1BHK starts from USD 53,800 2BHK starts from USD 95,000'
  ]) {
    assert.strictEqual(t.looksLikeSearchBrief(text), false, text);
    assert.strictEqual(t.looksLikeForwardedProperty({ cleanBody: text, mediaUrl: '', runtime: {} }), true, text);
  }
});

test('a budget range is a budget, and "room" beside the money does not cancel it', () => {
  const cases = [
    ['Single room Between 150k- 200k In bunga', 200000, 150000, 'single room'],
    [BRIEF_3, 200000, 150000, 'single room'],
    ['single room in Bunga under 200k', 200000, 0, 'single room'],
    ['2 bedroom 800k-1m Ntinda', 1000000, 800000, null],
    ['rent in Muyenga under 2m', 2000000, 0, null],
    ['room for 150k in Kansanga', 150000, 0, null]
  ];
  for (const [text, max, min, ptype] of cases) {
    const f = t.extractNaturalSearchFilters(text);
    assert.strictEqual(f.maxBudgetUgx, max, `${text} → max`);
    assert.strictEqual(f.minBudgetUgx || 0, min, `${text} → min`);
    if (ptype) assert.strictEqual(f.propertyType, ptype, `${text} → type`);
  }
  assert.strictEqual(t.extractNaturalSearchFilters('3 bedroom house in Kira for 1.5m per month').bedsMin, 3, 'a bedroom count is still a count');
  assert.strictEqual(t.parseBudgetRange('house 1-3km from soya'), null, 'a distance is not a budget');
  assert.strictEqual(t.parseBudgetRange('plot 50x100 in gayaza'), null);
});

test('a result line says what the home is when the title does not', () => {
  assert.strictEqual(whatsappHomeTypeLine({ property_type: 'single room' }, 'Property for rent in Bunga'), 'single room');
  assert.strictEqual(whatsappHomeTypeLine({ property_type: 'apartment', bedrooms: 2 }, 'Property for rent in Bunga'), '2 bedrooms · apartment');
  assert.strictEqual(whatsappHomeTypeLine({ property_type: 'apartment', bedrooms: 2 }, '2-bed Apartment for rent in Bunga'), '');
  const reply = buildWhatsappPropertySearchReply([
    { id: 'a', title: 'Property for rent in Bunga', area: 'Bunga', district: 'Kampala', price: 600000, price_period: 'mo', listing_type: 'rent', property_type: 'single room', total_count: 2 },
    { id: 'b', title: 'Property for rent in Bunga', area: 'Bunga', district: 'Kampala', price: 1200000, price_period: 'mo', listing_type: 'rent', property_type: 'apartment', bedrooms: 2, total_count: 2 }
  ], { location: 'Bunga', searchType: 'rent' });
  assert.match(reply, /1\. 🏡 \*Property for rent in Bunga\*\n🏷️ Single room\n📍 Bunga, Kampala/);
  assert.match(reply, /🏷️ 2 bedrooms · apartment/);
});

test('giving up is heard: the brief is read back and a person takes over', () => {
  for (const text of ['Seems you don\'t have what I want Have a great day', 'You don\'t have what I am looking for', 'ok thanks anyway', 'forget it', 'This is not helpful', 'I will try elsewhere']) {
    assert.strictEqual(t.customerGivingUp(text), true, text);
  }
  for (const text of ['I want a 2 bedroom in Kira', 'Do you have a single room in Bunga?', 'thanks', 'you have nice houses', '3']) {
    assert.strictEqual(t.customerGivingUp(text), false, text);
  }
  const brief = t.searchBriefFromFilters({ searchType: 'rent', area: 'Bunga', maxBudgetUgx: 200000, minBudgetUgx: 150000, propertyType: 'single room' }, BRIEF_3);
  assert.strictEqual(t.describeSearchBrief(brief), 'single room to rent in Bunga USh 150,000–200,000/mo');
  const reply = t.customerGivingUpReply('en', brief);
  assert.match(reply, /^Sorry — I did not find you what you asked for/);
  assert.match(reply, /\*single room to rent in Bunga USh 150,000–200,000\/mo\*/);
  assert.match(reply, /passed it to a person at makaug/);
  assert.doesNotMatch(reply, /1️⃣|MENU|999/);
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.match(source, /customerGivingUp\(effectiveBody\) && ASSISTANT_FREE_STEPS\.has/);
  assert.match(source, /needs_person_reason: 'customer_gave_up'/);
  assert.match(source, /reason: `Customer gave up — nothing matched/);
  assert.match(source, /last_search_brief: \{ \.\.\.searchBriefFromFilters/);
});

test('the agent list says who actually works the place', () => {
  const brian = { id: '5aeed103-cda3-4d75-930c-4c43ee1659eb', full_name: 'Kimuli Brian', company_name: 'Independent agent', districts_covered: ['Kampala', 'Wakiso'], listings_count: 12, area_listings_count: 0 };
  const innocent = { id: 'b6dca5cd-3ada-4133-937f-4e81527bb530', full_name: 'Tuyisengye Innocent', company_name: 'Tuyisengye Innocent', districts_covered: ['Kampala', 'Nakaseke'], listings_count: 4, area_listings_count: 0 };
  const nobodyInBunga = t.formatAgentSearchMessage('en', [brian, innocent], 'Bunga');
  assert.match(nobodyInBunga, /^👔 \*Verified agents\* \(Kampala, Wakiso — none lists Bunga itself yet\)/);
  assert.doesNotMatch(nobodyInBunga, /Tuyisengye Innocent\* - Tuyisengye Innocent/, 'a company that repeats the name is noise');
  assert.doesNotMatch(nobodyInBunga, /- Independent agent/);
  const someone = t.formatAgentSearchMessage('en', [{ ...brian, area_listings_count: 3 }, innocent], 'Bunga');
  assert.match(someone, /^👔 \*Verified agents\* \(Bunga\)/);
  assert.match(someone, /🏡 3 homes listed in Bunga/);
  assert.ok(t.whatsappAgentKeywordScore({ ...brian, area_listings_count: 3 }, ['Bunga', 'Kampala']) > t.whatsappAgentKeywordScore(innocent, ['Bunga', 'Kampala']));
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.match(source, /ORDER BY area_listings_count DESC, listings_count DESC/);
});
