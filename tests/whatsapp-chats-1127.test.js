'use strict';

/**
 * What the WhatsApp chats of 25 to 27 Nov 2026 taught. Every name, number and
 * caption here is made up; the places are real places.
 *
 * - "House starting at 100k and above" was searched as at most 100k.
 * - "How much is from ndejje to city centre" was taken as picking the Ndejje
 *   room, and answered with its contact block and five safety steps.
 * - Rooms found on TikTok with no number promised "the owner's number".
 * - "This land good for / Factory / Warehouses / School" went into review as a
 *   commercial property; ten "commercial acres … suitable for a warehouse" as
 *   a warehouse; "9 units of 2 bedrooms apartments" as a 2-bed property.
 * - "Half acre", "100by 100feet" and "50 by 100 feet" had no plot size, and
 *   "plots from 18m,20m and 25m" was priced at 25m.
 * - A plot whose only picture was its title was "📸 1 photo saved".
 * - A new agent's "Okay" was kept as the description of his video.
 * - "Looking for rental houses to buy" was searched as renting, and "To buy"
 *   was looked for on the map. "Am <name>" got the menu.
 * - Staff who sent a payment link were told twice that it had gone.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const cards = require('../services/whatsappPropertyCardService');

async function withDb(handler, run) {
  const saved = { query: db.query, getClient: db.getClient };
  db.query = async (sql, params = []) => (await handler(String(sql), params)) || { rows: [] };
  db.getClient = async () => ({ query: db.query, release() {} });
  try {
    return await run();
  } finally {
    db.query = saved.query;
    db.getClient = saved.getClient;
  }
}

const filters = (text) => route.extractNaturalSearchFilters(text, {}, 'any', {});

test('a price said as where it starts is a floor, not a ceiling', () => {
  const floor = (text) => { const f = filters(text); return [f.minBudgetUgx || 0, f.maxBudgetUgx || 0, f.searchType]; };
  assert.deepStrictEqual(floor('House starting at 100k and above'), [100000, 0, 'rent']);
  assert.deepStrictEqual(floor('single room from 150k in Kira'), [150000, 0, 'rent']);
  assert.deepStrictEqual(floor('apartment 1m+ in Kololo'), [1000000, 0, 'rent']);
  assert.deepStrictEqual(floor('house to rent over 1m'), [1000000, 0, 'rent']);
  assert.deepStrictEqual(floor('at least 2m per month'), [2000000, 0, 'rent']);
  assert.deepStrictEqual(floor('house from 300m'), [300000000, 0, 'sale'], 'a floor that size is a purchase');
  assert.deepStrictEqual(floor('land from 50m in Wakiso'), [50000000, 0, 'land']);
  // A ceiling, and a range, read as before.
  assert.deepStrictEqual(floor('a house not more than 500k'), [0, 500000, 'any']);
  assert.deepStrictEqual(floor('room under 300k'), [0, 300000, 'any']);
  assert.deepStrictEqual(floor('room for 150k in Kansanga'), [0, 150000, 'any']);
  assert.deepStrictEqual(floor('between 150k and 200k room'), [150000, 200000, 'any']);
  // An intent model that read the floor as a ceiling is overruled by the words.
  const withEntity = route.extractNaturalSearchFilters('House starting at 100k and above', { budget: 100000 }, 'any', {});
  assert.strictEqual(withEntity.maxBudgetUgx, 0);
  assert.strictEqual(withEntity.minBudgetUgx, 100000);
});

test('a floor is said back, searched from, and cheapest-first', async () => {
  const f = filters('House starting at 100k and above');
  assert.match(route.naturalSearchPrompt('en', f, 'area'), /Sure, I can look for a house to rent from USh 100,000\/month for you 🔎\nWhich area\?/);
  assert.match(route.filtersLeadLine({ ...f, area: 'Ndejje' }, 'en'), /^Here is what I have for a house to rent from USh 100,000\/month:/);
  const ceiling = route.buildWhatsappAffordableWhere({ searchType: 'rent', maxBudgetUgx: 300000 });
  assert.doesNotMatch(ceiling.where, /AND p\.price >= \$/);
  const floor = route.buildWhatsappAffordableWhere({ searchType: 'rent', minBudgetUgx: 100000 });
  assert.match(floor.where, /AND p\.price >= \$\d+/);
  assert.ok(floor.values.includes(100000));
  const range = route.buildWhatsappAffordableWhere({ searchType: 'rent', minBudgetUgx: 150000, maxBudgetUgx: 250000 });
  assert.doesNotMatch(range.where, /AND p\.price >= \$/, 'a range is searched by its top, as before');

  const queries = [];
  await withDb((sql, params) => { if (/FROM properties p/.test(sql)) queries.push({ sql, params }); }, async () => {
    await route.findPropertiesByNaturalFilters({ ...f, area: 'Ndejje' });
  });
  assert.strictEqual(queries.length, 1);
  assert.match(queries[0].sql, /AND price IS NOT NULL AND price >= \$\d+/);
  assert.match(queries[0].sql, /ORDER BY p\.price ASC NULLS LAST, /);
  assert.ok(queries[0].params.includes(100000));
});

test('a floor is remembered for the next message, and a new floor replaces an old ceiling', () => {
  const at = new Date().toISOString();
  const floorBrief = { last_search_brief: { search_type: 'rent', area: 'Ndejje', min_budget_ugx: 100000, max_budget_ugx: null, property_type: 'house', at } };
  const next = route.continueFromLastSearch({ searchType: 'rent', area: 'Kira', hasSignal: true }, floorBrief);
  assert.strictEqual(next.minBudgetUgx, 100000);
  assert.ok(!(next.maxBudgetUgx > 0));
  const ceilingBrief = { last_search_brief: { search_type: 'rent', area: 'Ndejje', max_budget_ugx: 300000, at } };
  const raised = route.continueFromLastSearch({ searchType: 'rent', minBudgetUgx: 500000, hasSignal: true }, ceilingBrief);
  assert.ok(!(raised.maxBudgetUgx > 0), 'from 500k is not capped at the 300k said before');
  assert.strictEqual(route.describeSearchBrief({ search_type: 'rent', area: 'Ndejje', min_budget_ugx: 100000 }), 'to rent in Ndejje from USh 100,000/mo');
});

test('a journey is answered with how far, not with a listing', async () => {
  const asked = route.readJourneyQuestion('How much is from ndejje to city centre');
  assert.deepStrictEqual({ from: asked.from, to: asked.to, money: asked.money }, { from: 'ndejje', to: 'city centre', money: true });
  for (const text of ['How much is a house from 100k to 300k', 'how much is rent from Kira to Ntinda', 'how long is the contract from january to march', 'how far is it from here', 'how much is the house', 'Ok']) {
    assert.strictEqual(route.readJourneyQuestion(text), null, text);
  }
  await withDb(() => null, async () => {
    const reply = await route.handleJourneyQuestion({ phone: '256700000489', step: 'main_menu', text: 'How much is from ndejje to city centre' });
    assert.strictEqual(reply.message, [
      'Ndejje is about 8 km from Kampala city centre in a straight line, a bit more by road.',
      "I can't tell you the fare: taxi and boda prices change with the route and the time of day, so people there will know today's price.",
      '',
      "If you'd like somewhere closer to town, tell me the area and your budget and I'll look 🏡"
    ].join('\n'));
    const far = await route.handleJourneyQuestion({ phone: '256700000489', step: 'main_menu', text: 'how far is Kira from town?' });
    assert.match(far.message, /^Kira is about \d+ km from Kampala city centre in a straight line/);
    assert.doesNotMatch(far.message, /fare/, 'no fare when they did not ask what it costs');
    const unknown = await route.handleJourneyQuestion({ phone: '256700000489', step: 'main_menu', text: 'how far is Zzqvill from town' });
    assert.match(unknown.message, /^Sorry, I don't know where Zzqvill is, so I can't tell you how far it is\./);
    assert.strictEqual(await route.handleJourneyQuestion({ phone: '256700000489', step: 'listing_type', text: 'how far is Kira from town?' }), null, 'not in the middle of listing a property');
  });
});

test('"how far is it from town" measures from the one property just sent, and is never taken as picking it', async () => {
  const ID = '5a5a5a5a-0000-4000-8000-000000000489';
  const card = cards.buildWhatsappPropertyPickCard({ id: ID, title: 'Single room for rent in Ndejje', listing_type: 'rent', price: 100000, price_period: 'mo', area: 'Ndejje', district: 'Wakiso' });
  const handler = (sql) => {
    if (/FROM outbound_message_queue/.test(sql)) return { rows: [{ text: card }] };
    if (/substr\(id::text, 1, 8\) = ANY/.test(sql)) return { rows: [{ id: ID }] };
    if (/WHERE id = ANY\(\$1::uuid\[\]\)/.test(sql)) return { rows: [{ id: ID, area: 'Ndejje', district: 'Wakiso', listing_type: 'rent', price: 100000, status: 'approved' }] };
    return null;
  };
  await withDb(handler, async () => {
    const it = await route.handleJourneyQuestion({ phone: '256700000489', step: 'main_menu', text: 'how far is it from town' });
    assert.match(it.message, /^Ndejje is about 8 km from Kampala city centre/);
    assert.strictEqual(await route.handleShownListingPick({ phone: '256700000489', step: 'main_menu', text: 'How much is from ndejje to city centre' }), null);
  });
});

test('CONTACT promises what it gives: who posted a listing found online, the owner\'s number for ours', () => {
  const foundOnline = { id: '0a0a0a0a-0000-4000-8000-000000000001', title: 'single room for rent', listing_type: 'rent', price: 100000, price_period: 'mo', area: 'Ndejje', district: 'Wakiso', listed_via: 'found_online', extra_fields: { found_online: true, source_platform: 'TikTok' } };
  const withNumber = { ...foundOnline, extra_fields: { ...foundOnline.extra_fields, public_contact_phone: '0700000123' } };
  const ours = { ...foundOnline, listed_via: 'whatsapp', extra_fields: {} };
  assert.match(cards.buildWhatsappPropertyPickCard(foundOnline, { others: [2] }), /Reply \*CONTACT\* to see who posted it, or \*2\* to see the other\.$/);
  assert.match(cards.buildWhatsappPropertyPickCard(withNumber), /Reply \*CONTACT\* for their number\.$/);
  assert.match(cards.buildWhatsappPropertyPickCard(ours), /Reply \*CONTACT\* for the owner's number\.$/);
  for (const row of [foundOnline, withNumber, ours]) assert.strictEqual(route.whatsappReplyKind(cards.buildWhatsappPropertyPickCard(row)), 'pick');
  const list = cards.buildWhatsappPropertySearchReply([foundOnline, { ...foundOnline, id: '0a0a0a0a-0000-4000-8000-000000000002' }], { location: 'Any area', searchType: 'rent' });
  assert.strictEqual(list.split('\n')[0], '🔎 *2 homes to rent*', 'not "in Any area"');
});

test('what a plot is good for, a line at a time, does not make it commercial', () => {
  const type = (caption) => route.employeePropertyFacts(caption, {}).listingType;
  assert.strictEqual(type('Money needed urgently\n3 acres of land\nPrivate mailo land\nFor sale\nTestville wakiso district\n\nStart on tarmac\nThis land good for\nFactory\nWarehouses\nSchool\nOr any project\nThe owner is selling all at once\nPrice 185m per acre'), 'land');
  assert.strictEqual(type('Commercial building for sale in Testville\nGood for\nOffices\nShops\n4 storeys on 20 decimals, 2bn'), 'commercial', 'a building stays a building');
});

test('commercial acres are commercial land, a block is the block, and a plot has its size and its lowest price', () => {
  const read = (caption) => {
    const facts = route.employeePropertyFacts(caption, {});
    const propertyType = route.advertPropertyType(caption, facts.listingType);
    const block = facts.listingType === 'sale' ? route.advertUnitBlock(caption) : null;
    return {
      type: facts.listingType,
      propertyType,
      price: facts.price,
      size: route.employeeLandSize(caption),
      title: route.ownerForwardListingTitle({ listingType: facts.listingType, area: facts.locationPatch?.area, bedrooms: facts.bedroomDraft?.bedrooms, propertyType, block })
    };
  };
  const acres = read('Commercial acres for sale in Mbalala!! Jinja road!\n* 10 acres on main road, suitable for a school,  warehouse, factory,hotel etc..with a. Private mailo land title!\nPrice per acre is ugx. 350m');
  assert.deepStrictEqual([acres.type, acres.propertyType, acres.title], ['commercial', 'commercial_land', 'Commercial land for sale in Mbalala']);
  const block = read('Good Deal Kira Mulawa 9 units of 2 bedrooms apartments monthly income 9.6 million on 25 decimals plot on Sale UGX 1BILLION');
  assert.strictEqual(block.title, '9 two-bedroom apartments for sale in Kira-Mulawa');
  assert.strictEqual(block.price, 1000000000);
  assert.strictEqual(read('3 bedroom house for sale in Kira on a 50x100 plot with title, 350m').title, '3-bed property for sale in Kira', 'one house is still one house');
  assert.deepStrictEqual(route.employeeLandSize('the above Half acre it is on sale, the owner wants 75m'), { value: 0.5, unit: 'acres' });
  assert.deepStrictEqual(route.employeeLandSize("plot on sale at Testville it's 100by 100feet, 45m"), { value: 10000, unit: 'sq_ft' });
  assert.deepStrictEqual(route.employeeLandSize('plots are available 50 by 100 feet with title'), { value: 5000, unit: 'sq_ft' });
  assert.deepStrictEqual(route.employeeLandSize("it's on 1ACRE AND 50 DECIMALs road electricity available"), { value: 1.5, unit: 'acres' });
  assert.deepStrictEqual(route.employeeLandSize('12 decimals in Kira, 45m'), { value: 12, unit: 'decimals' });
  assert.strictEqual(read('Members, plots in Testville trading center, 50 by 100 feet with title, plots ranges from 18m,20m and 25m, depends on the location').price, 18000000);
  assert.strictEqual(route.parseListingPriceDraft('Price UGX 1,200,000 per month'), 1200000, 'thousands commas still go');
});

test('a photo of a title is counted as a document, and a property with nothing to show is said to need photos', () => {
  const data = { whatsapp_agent_self_intake: true, agent: { full_name: 'Testa Agent' } };
  const facts = route.employeePropertyFacts('Plots in Matugga, Wakiso, 50 by 100 feet, title available, 18m each', data);
  const title = { kind: 'image', publicEligible: false, evidenceOnly: true };
  const onlyTitle = route.agentSelfIntakeSavedReply({ data, facts, storedMedia: [title], caption: 'Plots in Matugga, Wakiso, 50 by 100 feet, title available, 18m each' });
  assert.doesNotMatch(onlyTitle, /1 photo saved/);
  assert.match(onlyTitle, /🔒 The photo of a document \(a title, say\) is kept private — we never show those on the site\./);
  assert.match(onlyTitle, /📸 \*Still needed:\* a few photos or a short video of the property itself — it cannot go live without one\./);
  const withVideo = route.agentSelfIntakeSavedReply({ data, facts, storedMedia: [title, { kind: 'video' }], caption: 'Plots in Matugga, Wakiso, 18m each' });
  assert.match(withVideo, /📸 1 video saved — send more/);
  assert.match(withVideo, /🔒 The photo of a document/);
  assert.doesNotMatch(withVideo, /Still needed/);
});

test('"Okay" while a new agent\'s video waits for its words is not its words', async () => {
  const AGENT_PHONE = '256700000443';
  const AGENT = { id: '00000000-0000-4000-8000-000000000443', makaug_agent_number: 'MKA-AG-0000443', full_name: 'Testa Byansi', phone: `+${AGENT_PHONE}`, whatsapp: `+${AGENT_PHONE}`, status: 'approved' };
  const before = process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = '256700000111';
  const writes = [];
  try {
    await withDb((sql, params) => {
      if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) { writes.push(JSON.stringify(params)); return { rows: [] }; }
      if (/FROM agents/i.test(sql) && /status = 'approved'/i.test(sql)) return { rows: [AGENT] };
      return null;
    }, async () => {
      const reply = await route.handleEmployeeWhatsappIntake({
        phone: AGENT_PHONE,
        body: 'Okay',
        runtime: {},
        session: {
          current_step: 'employee_property_media',
          session_data: {
            ...route.agentSelfIntakeSessionData(AGENT),
            pending_property_media: [{ url: 'https://media.makaug.com/replay/testa.mp4', mimeType: 'video/mp4', kind: 'video' }],
            pending_property_media_stored_at: new Date().toISOString()
          }
        }
      });
      assert.strictEqual(reply.handled, true);
      assert.match(reply.message, /^👍 Your video is safe with me\.\n\nWhenever you are ready, tell me about the property in one message: what it is, for \*rent\* or \*sale\*, the \*area and district\*, and the \*price\*\./);
      assert.doesNotMatch(reply.message, /Okay/);
      assert.ok(!writes.some((write) => /pending_property_caption":"Okay/.test(write)), 'not kept as a description');
    });
  } finally {
    if (before === undefined) delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
    else process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = before;
  }
});

test('buying rentals is buying, "To buy" is not a place, and a name is answered with that name', async () => {
  assert.strictEqual(route.parseSearchType('Looking for rental houses to buy'), 'sale');
  assert.strictEqual(route.parseSearchType('rentals to rent in Kira'), 'rent');
  assert.strictEqual(route.parseSearchType('buy or rent in Kira'), 'rent', 'unchanged when both are said');
  const ai = route.extractNaturalSearchFilters('Looking for rental houses to buy', { listing_type: 'rent' }, 'any', {});
  assert.strictEqual(ai.searchType, 'sale', 'a model that read "rental" as renting does not undo it');
  for (const said of ['To buy', 'to rent', 'I want to buy', 'for sale']) assert.ok(route.ONLY_RENT_OR_BUY.test(said), said);
  for (const said of ['Kira', 'to buy in Kira']) assert.ok(!route.ONLY_RENT_OR_BUY.test(said), said);

  await withDb(() => null, async () => {
    const waiting = { searchType: 'rent', propertyType: 'house', hasSignal: true };
    const session = { phone: '256700000270', current_step: 'search_area', session_data: { pending_search_filters: waiting }, language: 'en' };
    const reply = await route.processMessage('256700000270', 'To buy', null, null, { session, language: 'en' });
    assert.strictEqual(reply.nextStep, 'search_area');
    assert.doesNotMatch(reply.message, /on my map/);
    assert.match(reply.message, /Sure, I can look for a house to buy for you 🔎\nWhich area\?/);
  });

  assert.strictEqual(route.nameTheyGave("Am Testa Beb's Edwards"), "Testa Beb's Edwards");
  assert.strictEqual(route.nameTheyGave('My name is Grace'), 'Grace');
  for (const said of ['I am fine', 'I am an agent', 'Am in Kira', "I'm Testa from makaug", 'This is Kira', 'I am looking for a house', 'Its me', 'I am Sarah, looking for land']) {
    assert.strictEqual(route.nameTheyGave(said), '', said);
  }
  const brief = { last_search_brief: { search_type: 'sale', area: 'Kyebando', at: new Date().toISOString() } };
  assert.strictEqual(route.introductionReply("Testa Beb's Edwards", brief), "Nice to meet you, Testa 🙏\nWould you like more homes for sale in Kyebando, or something else? Tell me your budget and I'll find the best options.");
});
