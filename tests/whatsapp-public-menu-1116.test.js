'use strict';

/**
 * The public WhatsApp menu, 16 Nov 2026.
 *
 * Walking every route a member of the public takes on the makaug number
 * found: a "1" after search results started the listing questions and sent a
 * five-minute film; "student hostel near Makerere 300k" and "Land for sale in
 * Wakiso around 50m" were told "That looks like a property you are selling";
 * "How much does it cost to list my house?" got the listing questions; "I want
 * to talk to a person" got an email address; and results were a wall of long
 * links. The owner approved a new menu (1 to 5 where they were, 6 a person), the
 * results look (the property's card, a short list, short links, "Reply 1, 2
 * or 3") and the pick (the card, then CONTACT for the owner's number).
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const cards = require('../services/whatsappPropertyCardService');
const route = require('../routes/whatsapp').__test;

function withFakeDb(reply, run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return reply(String(sql), params) || { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

const ids = [
  '7a1b2c3d-1111-4111-8111-111111111111',
  '7a1b2c3e-2222-4222-8222-222222222222',
  '7a1b2c3f-3333-4333-8333-333333333333',
  '7a1b2c40-4444-4444-8444-444444444444',
  '7a1b2c41-5555-4555-8555-555555555555'
];
const rows = ids.map((id, index) => ({
  id,
  title: `${index + 2}-bed house for rent in Kira`,
  listing_type: 'rent',
  transaction_type: 'rent',
  property_type: 'house',
  area: 'Kira',
  district: 'Wakiso',
  bedrooms: index + 2,
  price: 600_000 + index * 100_000,
  price_period: 'month',
  status: 'approved',
  updated_at: '2026-11-14T10:00:00Z',
  total_count: 5
}));

test('the menu keeps 1 to 5 where they were and adds a person', () => {
  const menu = route.welcomeMessage('en', { contact_name: 'Grace Namata' });
  const lines = menu.split('\n');
  assert.strictEqual(lines[0], "🏡 *makaug* · Uganda's property marketplace");
  assert.match(lines[1], /^Good (?:morning|afternoon|evening), Grace 👋 What can I help you with\?$/);
  const options = lines.filter((line) => /^[1-6]️⃣ /.test(line));
  assert.deepStrictEqual(options, [
    '1️⃣ List my property',
    '2️⃣ Search for a property',
    '3️⃣ Find an agent',
    '4️⃣ Off-plan projects',
    '5️⃣ Join makaug as an agent',
    '6️⃣ Talk to a person'
  ]);
  assert.match(menu, /Or just type what you want, like "2 bedroom house in Kira under 1m"\./);
  assert.strictEqual(lines[lines.length - 1], '_Reply LANGUAGE for Luganda, Kiswahili and 6 more._');
  assert.doesNotMatch(menu, /https?:\/\//, 'no link to unfurl under the menu');
  assert.strictEqual(route.whatsappReplyKind(menu), 'menu');
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const translated = route.welcomeMessage(lang, {});
    assert.match(translated, /\n6️⃣ /, `${lang} has a sixth option`);
    assert.match(translated, /LANGUAGE/, `${lang} says how to change language`);
  }
});

test('6 on the menu, or asking in words, is a person; a viewing or an agent is not', () => {
  const yes = [
    ['main_menu', '6'],
    ['greeting', '6'],
    ['', '6'],
    ['main_menu', 'I want to talk to a person'],
    ['price', 'can I speak to someone'],
    ['main_menu', 'customer care please'],
    ['main_menu', 'nataka kuongea na mtu']
  ];
  const no = [
    ['listing_type', '6'],
    ['search_type', '6'],
    ['description', 'Nice house, call me for viewing'],
    ['main_menu', 'Can I talk to an agent'],
    ['verify_otp', 'talk to a person'],
    ['main_menu', '']
  ];
  for (const [step, text] of yes) assert.strictEqual(route.wantsToTalkToAPerson(step, text), true, `${step} | ${text}`);
  for (const [step, text] of no) assert.strictEqual(route.wantsToTalkToAPerson(step, text), false, `${step} | ${text}`);
});

test('the reply to a person request says when somebody answers', () => {
  const at = (hour) => new Date(Date.UTC(2026, 10, 16, hour - 3, 10));
  assert.match(route.talkToPersonMessage('en', at(7)), /from 9am today\./);
  assert.match(route.talkToPersonMessage('en', at(12)), /reply to you here soon\. We answer between 9am and 6pm\./);
  assert.match(route.talkToPersonMessage('en', at(19)), /from 9am tomorrow\./);
  assert.match(route.talkToPersonMessage('en', at(12)), /Changed your mind\? Reply \*MENU\*\./);
  assert.match(route.talkToPersonMessage('sw', at(12)), /saa 3 asubuhi na saa 12 jioni/);
});

test('what it costs to list is answered, not started', () => {
  const cost = [
    'How much does it cost to list my house?',
    'How much do you charge for listing?',
    'Is it free to list?',
    'listing fee?',
    'How much is it to join as an agent',
    'What does it cost to put up an advert?'
  ];
  const notCost = [
    'How much is the rent?',
    'how much for this house',
    'How much is the 2 bedroom in Kira listed for?',
    '2 bedroom house in Kira under 1m'
  ];
  for (const text of cost) assert.strictEqual(route.LISTING_COST_QUESTION.test(text), true, text);
  for (const text of notCost) assert.strictEqual(route.LISTING_COST_QUESTION.test(text), false, text);
  const reply = route.listingCostReply();
  assert.match(reply, /\*Owners:\* UGX [\d,]+ a month per property, from the day it goes live\./);
  assert.match(reply, /\*Agents:\* UGX [\d,]+ a month, short stays included\./);
  assert.match(reply, /No commission/);
  assert.match(reply, /Nothing is charged automatically\./);
  assert.match(reply, /Reply \*1\* to list your property, or \*5\* to join as an agent\./);
  assert.doesNotMatch(reply, /free (?:trial|days?)/i);
});

test('somebody saying what they want is not selling; an advert still is', () => {
  const wants = [
    'student hostel near Makerere 300k',
    'Land for sale in Wakiso around 50m',
    'Land in Wakiso 50m available?',
    'Self contained room near Kyambogo 250k'
  ];
  const adverts = [
    '3 bedroom house for rent in Kira 1.2m. Call 0700 000 111',
    '2 bedroom house available in Najjera 700k',
    'Plot for sale in Mukono 40m negotiable',
    'House for sale\nMunyonyo\n4 bedrooms\nTitled\n850m'
  ];
  for (const text of wants) assert.strictEqual(route.looksLikeAdvertText(text), false, text);
  for (const text of adverts) assert.strictEqual(route.looksLikeAdvertText(text), true, text);
});

test('results: the total, a short list, short links, and a number to reply', () => {
  const reply = cards.buildWhatsappPropertySearchReply(rows, {
    location: 'Kira',
    searchType: 'rent',
    searchResultsUrl: 'https://makaug.com/to-rent?listing_type=rent&area=Kira'
  });
  const lines = reply.split('\n');
  assert.strictEqual(lines[0], '🔎 *5 homes to rent in Kira*');
  assert(reply.includes('*1* · 2-bed house, Kira\n      *USh 600K a month*\n      makaug.com/p/7a1b2c3d'));
  assert(reply.includes('makaug.com/p/7a1b2c3f'), 'the third is shown');
  assert(!reply.includes('makaug.com/p/7a1b2c40'), 'the fourth waits for MORE');
  assert(!/makaug\.com\/property\//.test(reply), 'no long links');
  assert(reply.includes('Reply *1*, *2* or *3* to see one, *MORE* for more.'));
  assert(reply.includes('See all 5: makaug.com/to-rent?listing_type=rent&area=Kira'));
  assert.deepStrictEqual(cards.shortCodesFromWhatsappReply(reply), ['7a1b2c3d', '7a1b2c3e', '7a1b2c3f']);
  assert.strictEqual(route.whatsappReplyKind(reply), 'results');
  assert.strictEqual(
    cards.shareCardImageUrl(rows[0]),
    `https://makaug.com/og/property/${ids[0]}.jpg?v=${Math.floor(Date.parse(rows[0].updated_at) / 1000).toString(36)}`
  );
  assert.strictEqual(cards.shareCardImageUrl({ id: 'not-an-id' }), '');
});

test('one result, or one picked, is its card with CONTACT', () => {
  const only = cards.buildWhatsappPropertySearchReply(rows.slice(0, 1), { location: 'Kira', searchType: 'rent' });
  assert.match(only, /^🏡 \*2-bed house for rent in Kira\*\n💰 USh 600K a month\n📍 Kira, Wakiso\n/);
  assert.match(only, /🔗 makaug\.com\/p\/7a1b2c3d · photos and map/);
  assert.match(only, /Reply \*CONTACT\* for the owner's number\.$/);
  assert.strictEqual(route.whatsappReplyKind(only), 'pick');
  const picked = cards.buildWhatsappPropertyPickCard(rows[1], { others: [1, 3] });
  assert.match(picked, /Reply \*CONTACT\* for the owner's number, or \*1\* or \*3\* to see the others\.$/);
});

function resultsDb({ lastText, sessionPatches }) {
  return (sql, params) => {
    if (/FROM outbound_message_queue/.test(sql)) return { rows: [{ text: lastText }] };
    if (/FROM properties/.test(sql) && /ANY\(\$1::uuid\[\]\)/.test(sql)) {
      return { rows: rows.filter((row) => params[0].includes(row.id)) };
    }
    if (/UPDATE whatsapp_sessions/.test(sql)) { sessionPatches.push(JSON.parse(params[0])); return { rows: [] }; }
    return { rows: [] };
  };
}

test('a number after results is that property, MORE is the next three, and the menu keeps its numbers', async () => {
  const list = cards.buildWhatsappPropertySearchReply(rows, { location: 'Kira', searchType: 'rent' });
  const fresh = { last_results: ids, last_results_shown: 3, last_results_at: new Date().toISOString() };

  const patches = [];
  await withFakeDb(resultsDb({ lastText: list, sessionPatches: patches }), async () => {
    const two = await route.handleResultsReply({ phone: '256700000101', step: 'main_menu', text: '2', sessionData: fresh });
    assert.match(two.message, /^🏡 \*3-bed house for rent in Kira\*/);
    assert.match(two.message, /or \*1\* or \*3\* to see the others\.$/);
    assert.strictEqual(patches[0].listing_enquiry_property_id, ids[1]);

    const more = await route.handleResultsReply({ phone: '256700000101', step: 'main_menu', text: 'more', sessionData: fresh });
    assert.match(more.message, /^🔎 \*More you might like\*/);
    assert(more.message.includes('*4* · 5-bed house, Kira'));
    assert(more.message.includes('Reply *4* or *5* to see one.'));
    assert.strictEqual(patches[1].last_results_shown, 5);

    const which = await route.handleResultsReply({ phone: '256700000101', step: 'main_menu', text: 'contact', sessionData: fresh });
    // 25 Nov 2026: not "for the owner's number", which a listing found online may not have.
    assert.strictEqual(which.message, 'Which one? Reply *1*, *2* or *3* to see it, then *CONTACT* to get in touch.');

    const beyond = await route.handleResultsReply({ phone: '256700000101', step: 'main_menu', text: '6', sessionData: fresh });
    assert.strictEqual(beyond, null, '6 is not one of the three shown: it is the menu');

    const midListing = await route.handleResultsReply({ phone: '256700000101', step: 'listing_type', text: '2', sessionData: fresh });
    assert.strictEqual(midListing, null, 'a number in the listing questions is theirs');
  });

  await withFakeDb(resultsDb({ lastText: route.welcomeMessage('en', {}), sessionPatches: [] }), async () => {
    const one = await route.handleResultsReply({ phone: '256700000101', step: 'main_menu', text: '1', sessionData: fresh });
    assert.strictEqual(one, null, 'after the menu, 1 is List my property');
  });

  const stale = { ...fresh, last_results_at: new Date(Date.now() - 31 * 60000).toISOString() };
  await withFakeDb(resultsDb({ lastText: list, sessionPatches: [] }), async () => {
    const late = await route.handleResultsReply({ phone: '256700000101', step: 'main_menu', text: '1', sessionData: stale });
    assert.strictEqual(late, null, 'half an hour on, a number is the menu again');
  });
});

test('the list a person was shown is remembered where it goes out, whichever search made it', async () => {
  route.recordResultList(rows);
  const list = cards.buildWhatsappPropertySearchReply(rows, { location: 'Kira', searchType: 'rent' });
  const patches = [];
  await withFakeDb(resultsDb({ lastText: '', sessionPatches: patches }), async () => {
    await route.rememberResultsShown('256700000102', list);
    assert.deepStrictEqual(patches[0].last_results, ids, 'all five, so MORE has the rest');
    assert.strictEqual(patches[0].last_results_shown, 3);

    const more = cards.buildWhatsappResultsList(rows.slice(3), { header: '🔎 *More you might like*', startAt: 4 });
    await route.rememberResultsShown('256700000102', more);
    assert.strictEqual(patches.length, 1, "MORE's list carries on from the one remembered");

    const picked = cards.buildWhatsappPropertyPickCard(rows[1], { others: [1, 3] });
    await route.rememberResultsShown('256700000102', picked);
    assert.strictEqual(patches.length, 1, 'a property picked from the list leaves the list alone');
  });
});
