'use strict';

/**
 * What the chats of 20 Nov 2026 taught the bot.
 *
 * 1. A renter shown single rooms at 150K asked "What is needed to get a
 *    house". It was taken as a search for "house".
 * 2. He then named Kiwatule and was shown houses at 850K to 2M, with "See all"
 *    opening the for-sale page; then he said "for 150k" and was asked for the
 *    area he had just named.
 * 3. An agent described 64 acres in full with one video over 25 MB. Nothing was
 *    saved, and he was told "Everything else you sent is kept".
 * 4. "2 acres at 22M each" was saved as 22M an acre, and the message said only
 *    "UGX 22,000,000".
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const route = require('../routes/whatsapp').__test;

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
const renting = (at = minutesAgo(5)) => ({
  last_search_brief: { search_type: 'rent', area: 'Kireka', max_budget_ugx: 150000, budget_period: 'month', property_type: 'single room', beds_min: null, at }
});

// ── 1. How to get a place ───────────────────────────────────────────────────

test('a question about how to get a place is told apart from a search', () => {
  for (const asked of [
    'What is needed to get a house',
    'what do I need to rent a room',
    'How do I get a house?',
    'How can I rent a room',
    'What’s needed to get a rental',
    'requirements for renting a room'
  ]) assert.strictEqual(route.isRentingProcessQuestion(asked), true, asked);
  for (const asked of [
    '2 bedroom house in Kira under 1m',
    'single room in Kireka',
    'What is needed to buy land',
    'how do I list my house',
    'What is the price of a house in Ntinda',
    'house',
    'I need a house'
  ]) assert.strictEqual(route.isRentingProcessQuestion(asked), false, asked);
});

test('it is answered with how renting works, and the search they were on carries on', () => {
  const reply = route.rentingProcessReply('en', renting());
  assert.match(reply, /\*Getting a place\*/);
  assert.match(reply, /call or WhatsApp the owner or agent from the listing\. makaug charges you nothing\./);
  assert.match(reply, /See the room or house before you pay anything\./);
  assert.match(reply, /how many months they want upfront \(often 1 to 3\)/);
  assert.match(reply, /National ID, and get a written agreement and a receipt/);
  assert.match(reply, /Want me to keep looking \(single room to rent up to USh 150,000\/month\)\? Send the area\.$/);
  // Nobody searching yet: an example instead.
  assert.match(route.rentingProcessReply('en', {}), /Tell me the area and your budget and I will find options, for example: \*single room in Kireka under 150k\*\.$/);
  // A brief from yesterday is not "the search they were on".
  assert.doesNotMatch(route.rentingProcessReply('en', renting(minutesAgo(180))), /keep looking/);
});

test('wired in before the search, and not for a question that names a place', () => {
  const hook = source.indexOf('&& isRentingProcessQuestion(cleanBody)');
  assert.ok(hook > 0);
  assert.ok(hook < source.indexOf('&& isAffordabilityAdviceQuestion(cleanBody)'), 'before the budget search');
  assert.match(source, /&& isRentingProcessQuestion\(cleanBody\)\s+&& !parseAreaFromText\(cleanBody, sessionData\)\s+\) \{\s+return respond\(rentingProcessReply\(lang, sessionData\), step === 'search_area' \? 'search_area' : 'main_menu'\);/);
});

// ── 2. A search carries on ──────────────────────────────────────────────────

test('a new area keeps the budget and the kind of home', () => {
  const next = route.continueFromLastSearch({ area: 'Kiwatule', searchType: 'any', hasSignal: true }, renting());
  assert.strictEqual(next.area, 'Kiwatule');
  assert.strictEqual(next.searchType, 'rent');
  assert.strictEqual(next.maxBudgetUgx, 150000);
  assert.strictEqual(next.budgetPeriod, 'month');
  assert.strictEqual(next.propertyType, 'single room');
  assert.deepStrictEqual(next.continuedFromLastSearch, ['type', 'home', 'budget']);
});

test('a new budget keeps the area', () => {
  const next = route.continueFromLastSearch({ maxBudgetUgx: 150000, searchType: 'any', hasSignal: true }, renting());
  assert.strictEqual(next.area, 'Kireka');
  assert.strictEqual(next.carriedArea, true);
  assert.strictEqual(next.searchType, 'rent');
  // When the area is what is being asked for now, it is not filled in.
  assert.strictEqual(route.continueFromLastSearch({ maxBudgetUgx: 150000, hasSignal: true }, renting(), { keepArea: false }).area, undefined);
});

test('a different search is left alone', () => {
  const land = { searchType: 'land', area: 'Mukono', hasSignal: true };
  assert.strictEqual(route.continueFromLastSearch(land, renting()), land, 'land after a room');
  // A 2 bedroom after a single room: still renting, but not at a single room's budget.
  const bigger = route.continueFromLastSearch({ bedsMin: 2, area: 'Kira', searchType: 'any', hasSignal: true }, renting());
  assert.strictEqual(bigger.searchType, 'rent');
  assert.strictEqual(bigger.maxBudgetUgx, undefined);
  assert.strictEqual(bigger.propertyType, undefined);
  // Two hours on, it is a new conversation.
  const late = { area: 'Kiwatule', hasSignal: true };
  assert.strictEqual(route.continueFromLastSearch(late, renting(minutesAgo(121))), late);
  assert.strictEqual(route.continueFromLastSearch(late, {}), late);
});

test('both ways a search runs carry on from the last one', () => {
  assert.match(source, /if \(naturalFilters\.hasSignal\) \{\s+const continued = continueFromLastSearch\(naturalFilters, sessionData\);/);
  assert.match(source, /naturalFilters = continued\.carriedArea \? resolveWhatsappSearchLocation\(continued, continued\.area\) : continued;/);
  assert.match(source, /if \(naturalFilters\) naturalFilters = continueFromLastSearch\(naturalFilters, sessionData, \{ keepArea: false \}\);/);
});

test('"See all" opens the page for what was shown', () => {
  const rentals = [{ listing_type: 'rent' }, { listing_type: 'rent' }, { listing_type: 'rent' }];
  assert.strictEqual(route.searchResultsLinkType('any', rentals), 'rent');
  assert.strictEqual(route.whatsappSearchResultsUrl(route.searchResultsLinkType('any', rentals), 'Kiwatule'), 'https://makaug.com/to-rent?listing_type=rent&area=Kiwatule');
  assert.strictEqual(route.searchResultsLinkType('any', [{ listing_type: 'rent' }, { listing_type: 'sale' }]), 'any', 'mixed: as before');
  assert.strictEqual(route.searchResultsLinkType('sale', rentals), 'sale', 'what was asked for wins');
  assert.strictEqual(route.searchResultsLinkType('any', []), 'any');
});

// ── 3. A video too big to take ──────────────────────────────────────────────

const tooBig = Object.assign(new Error('Employee intake media storage failed'), { cause: new Error('WhatsApp video exceeds the 25MB intake limit') });
const ACRES = '64 ACRES ON SALE AT A PRICE OF 27M NEGOTIABLE EACH LOCATED AT MYANZI MITYANA MUBENDE ROAD';
const KITAANDWE = '2 ACRES ON SALE AT A PRICE OF 22M EACH LOCATED AT KITAANDWE LUBUMBA MITYANA ROAD';

test('a description whose only video was too big is kept, and the agent is told it is not saved', () => {
  assert.deepStrictEqual(route.employeeMediaTooLarge(tooBig), { limitMb: 25, isVideo: true });
  assert.strictEqual(route.employeeMediaTooLarge(new Error('timeout')), null);
  const message = route.employeeMediaTooLargeKeptMessage(ACRES, route.employeeMediaTooLarge(tooBig));
  assert.match(message, /^⚠️ \*Not saved yet — "64 ACRES ON SALE/);
  assert.match(message, /That video is over 25 MB, so I couldn't take it, and a property needs at least one photo or video\./);
  assert.match(message, /I have kept your description\. Send a few photos, or a video under 2 minutes, and I will add them to it\.$/);
  assert.doesNotMatch(message, /Everything else you sent is kept/);

  const data = {};
  route.keepEmployeeCaptionForMedia(data, { caption: ACRES, inboundMessageId: 'in-1', senderMs: 1000 });
  assert.strictEqual(data.pending_property_caption, ACRES, 'its photos complete it');
  assert.strictEqual(data.pending_caption_media_too_large, true);
  // A description already waiting is not pushed aside: this one waits behind it.
  const busy = { pending_property_caption: KITAANDWE };
  route.keepEmployeeCaptionForMedia(busy, { caption: ACRES, inboundMessageId: 'in-2', senderMs: 2000 });
  assert.strictEqual(busy.pending_property_caption, KITAANDWE);
  assert.strictEqual(busy.pending_property_queue[0].caption, ACRES);
});

test('the next property the agent sends does not drop it', () => {
  const data = { pending_property_caption: ACRES, pending_caption_sender_ms: 1000, pending_caption_media_too_large: true };
  route.releaseEmployeePendingCaption(data, { before: ACRES, caption: KITAANDWE });
  assert.strictEqual(data.pending_property_caption, ACRES, 'back in line for its photos');
  assert.strictEqual(data.pending_caption_media_too_large, true);
  assert.strictEqual(data.pending_property_queue, undefined);
  // Its own photos arrive and it is saved: then it is done with.
  route.releaseEmployeePendingCaption(data, { before: ACRES, caption: ACRES });
  assert.strictEqual(data.pending_property_caption, undefined);
  assert.strictEqual(data.pending_caption_media_too_large, undefined);
  // Any other waiting description is released as it always was.
  const plain = { pending_property_caption: ACRES };
  route.releaseEmployeePendingCaption(plain, { before: ACRES, caption: KITAANDWE });
  assert.strictEqual(plain.pending_property_caption, undefined);
});

test('wired in where the media of a new property is stored', () => {
  assert.match(source, /const tooLarge = employeeMediaTooLarge\(error\);\s+if \(tooLarge && shouldStartProperty && caption\) \{\s+keepEmployeeCaptionForMedia\(data, \{ caption, inboundMessageId, senderMs: mediaSenderMs \}\);/);
  // Four since 22 Nov 2026: an advert found already on makaug by its files
  // releases its description too (findListingWithSameMedia).
  assert.strictEqual((source.match(/releaseEmployeePendingCaption\(data, \{ before: pendingCaptionBeforeMessage, caption \}\);/g) || []).length, 4);
});

// ── 4. Per acre ─────────────────────────────────────────────────────────────

test('a price per acre is said to be per acre', () => {
  const lines = route.agentPropertyDetailLines({ listingType: 'land', pricePeriod: 'acre', price: 22000000, priceMetadata: {}, locationPatch: { area: 'Kitaandwe', district: 'Mityana' } }, KITAANDWE);
  assert.ok(lines.includes('💰 UGX 22,000,000 an acre'), lines.join(' | '));
  const plots = route.agentPropertyDetailLines({ listingType: 'land', pricePeriod: 'plot', price: 15000000, priceMetadata: {}, locationPatch: { area: 'Kira' } }, 'plots at 15m each');
  assert.ok(plots.includes('💰 UGX 15,000,000 a plot'), plots.join(' | '));
  const whole = route.agentPropertyDetailLines({ listingType: 'land', pricePeriod: 'once', price: 45000000, priceMetadata: {}, locationPatch: { area: 'Kira' } }, 'land in kira 45m');
  assert.ok(whole.includes('💰 UGX 45,000,000'), whole.join(' | '));
});
