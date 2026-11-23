'use strict';

/**
 * What the team asked to be learned from the WhatsApp chats of 23 Nov 2026.
 *
 * - A renter's budget (150k a month) and room (a single room) were forgotten
 *   from one message to the next: "what about kireka" got a five-bedroom
 *   bungalow, and "kungu, kiwatule" was searched in Kiwatule only.
 * - Someone on our team wrote to her, she answered "i want a single one", and the
 *   assistant sent her the menu over him.
 * - "I want a house along gayaza road" was asked for "the area or district",
 *   and "Wakiso district" got rentals at 3M a month and a house at 950M.
 * - A host answered the Monday check-in with "Open" and was asked "Which
 *   stay?" with the same line four times. The check-in itself was three links
 *   of 150 characters each.
 * - An agent asked "Is it a mistake or they really want something of 150k"
 *   about a request we had sent him, and was told to send its photos.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.AGENT_BOOKING_TOKEN_SECRET = process.env.AGENT_BOOKING_TOKEN_SECRET || 'chat-lessons-1123-secret';
process.env.STAY_REQUEST_TOKEN_SECRET = process.env.STAY_REQUEST_TOKEN_SECRET || 'chat-lessons-1123-stay-secret';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const stays = require('../services/shortTermBookingService');
const booking = require('../services/agentBookingService');
const intake = require('../services/whatsappEmployeeIntakeService');

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---------------------------------------------------------------- the host

const STAY = (n, extra = {}) => ({
  id: `11111111-1111-4111-8111-1111111111${n}`,
  title: 'property for rent in Kisaasi',
  area: 'Kisaasi',
  district: 'Kampala',
  reference: `ST-0000${n}`,
  slug: `kisaasi-stay-st-0000${n}`,
  bedrooms: 1,
  property_type: 'apartment',
  source: 'imported',
  extra_fields: {},
  description: '',
  asked_at: new Date(Date.now() - 60 * 60 * 1000),
  ...extra
});

function hostDb({ rows = [], lastSent = '' } = {}) {
  const calls = [];
  const updates = [];
  return {
    calls,
    updates,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (sql.includes('st-booking:weekly-reply')) return { rows };
      if (sql.includes('st-booking:weekly-last-sent')) return { rows: lastSent ? [{ text: lastSent }] : [] };
      if (sql.includes('st-booking:listing-status')) { updates.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  };
}

test('the check-in names each stay the way guests see it, asks once, and has no links on WhatsApp', () => {
  const at = new Date('2026-11-23T06:00:00Z');
  const one = stays.weeklyCheckInMessage([{ ...STAY('63'), blocked: [] }], { at });
  assert.match(one, /^Good morning 👋 A quick weekly check on your stay on makaug\.com:/);
  assert.match(one, /\*1-bed apartment in Kisaasi\* \(ST-000063\), nothing blocked on its calendar\./);
  assert.match(one, /Is it open for bookings this week\? Reply \*1\* if it is, \*2\* if it is fully booked, or \*3\* to pause it\./);
  assert.doesNotMatch(one, /https?:\/\/|property for rent in Kisaasi|Monday check-in\n/);

  const two = stays.weeklyCheckInMessage([
    { ...STAY('51', { title: 'Studio in Kisaasi', bedrooms: 0, source: 'direct' }), blocked: [{ starts_on: '2026-11-24', ends_on: '2026-11-26' }] },
    { ...STAY('63'), blocked: [] }
  ], { at });
  assert.match(two, /your 2 stays on makaug\.com:\n1\. \*Studio in Kisaasi\* \(ST-000051\), booked 24–26 Nov\n2\. \*1-bed apartment in Kisaasi\* \(ST-000063\), nothing blocked/);
  assert.match(two, /Are they all open for bookings this week\? Reply \*1\* if they are/);
  assert.match(two, /\*2 3\* pauses \*1-bed apartment in Kisaasi\* \(ST-000063\)/);

  // By email there is no reply to read: the links are there.
  const email = stays.weeklyCheckInEmail([{ ...STAY('63'), blocked: [] }], { at });
  assert.match(email, /Or answer with a link:\nOpen: https?:\/\/\S+\nFully booked: https?:\/\/\S+\nPaused: https?:\/\/\S+/);
  assert.doesNotMatch(email, /\*/);
});

test('"Open" with one stay marks it open and says so, with the page guests book from', async () => {
  const fake = hostDb({ rows: [STAY('63')] });
  const reply = await stays.handleHostStayReply(fake, { phone: '+256700000232', body: 'Open' });
  assert.strictEqual(reply.handled, true);
  assert.strictEqual(fake.updates.length, 1);
  assert.deepStrictEqual(fake.updates[0], [STAY('63').id, 'available']);
  assert.match(reply.message, /^Thanks 👍 \*1-bed apartment in Kisaasi\* \(ST-000063\) is marked open for bookings this week\.\nGuests can book it here: https?:\/\/\S+\/short-term\/kisaasi-stay-st-000063$/);
  assert.doesNotMatch(reply.message, /Which stay/);
  // One row per stay, from the last few days' check-ins only.
  const lookup = fake.calls.find((call) => call.sql.includes('st-booking:weekly-reply'));
  assert.match(lookup.sql, /GROUP BY l\.id/);
  assert.match(lookup.sql, /c\.sent_at > NOW\(\) - \(\$2::int \* INTERVAL '1 day'\)/);
  assert.strictEqual(lookup.params[1], 4);
});

test('with several stays, "Open" answers the question asked of them all, and "2 3" pauses the second', async () => {
  const three = [STAY('63'), STAY('51', { title: 'Studio in Kisaasi', bedrooms: 0, source: 'direct' }), STAY('02')];
  const all = hostDb({ rows: three });
  const reply = await stays.handleHostStayReply(all, { phone: '+256700000232', body: 'all open' });
  assert.strictEqual(all.updates.length, 3);
  assert.match(reply.message, /^Thanks 👍 All 3 of your stays are marked open for bookings this week:\n• \*1-bed apartment in Kisaasi\* \(ST-000002\)\n• \*Studio in Kisaasi\* \(ST-000051\)/);

  const one = hostDb({ rows: three });
  const paused = await stays.handleHostStayReply(one, { phone: '+256700000232', body: '2 3' });
  assert.deepStrictEqual(one.updates, [[STAY('51').id, 'paused']]);
  assert.match(paused.message, /\*Studio in Kisaasi\* \(ST-000051\) is marked paused this week\.\nReply \*1\* when it is open again\./);

  const none = hostDb({ rows: three });
  const missing = await stays.handleHostStayReply(none, { phone: '+256700000232', body: '7 1' });
  assert.strictEqual(none.updates.length, 0);
  assert.match(missing.message, /There is no stay 7 in this week's check-in/);
});

test('a bare "1" is an answer to the check-in only while the check-in is the last thing we sent', async () => {
  const checkIn = stays.weeklyCheckInMessage([{ ...STAY('63'), blocked: [] }]);
  const answered = hostDb({ rows: [STAY('63')], lastSent: checkIn });
  assert.strictEqual((await stays.handleHostStayReply(answered, { phone: '+256700000232', body: '1' })).handled, true);
  const afterOurThanks = hostDb({ rows: [STAY('63')], lastSent: 'Thanks 👍 *Studio in Kisaasi* (ST-000051) is marked paused this week.' });
  assert.strictEqual((await stays.handleHostStayReply(afterOurThanks, { phone: '+256700000232', body: '1' })).handled, true);
  const somethingElse = hostDb({ rows: [STAY('63')], lastSent: 'Hi, we have a request for you: someone is looking for a single room.' });
  const reply = await stays.handleHostStayReply(somethingElse, { phone: '+256700000232', body: '1' });
  assert.strictEqual(reply.handled, false, 'the "1" is left for whatever asked it');
  assert.strictEqual(somethingElse.updates.length, 0);
  // No check-in in the last few days: not an answer to one.
  assert.strictEqual((await stays.handleHostStayReply(hostDb({ rows: [] }), { phone: '+256700000232', body: 'Open' })).handled, false);
  // How hosts say it.
  for (const said of ["It's open", 'both are open', 'Open.', 'pause it', 'fully booked']) {
    assert.ok(stays.parseStayWeeklyReply(said), said);
  }
  for (const said of ['yes', 'ok', 'opening hours?', 'is it open']) {
    assert.strictEqual(stays.parseStayWeeklyReply(said), null, said);
  }
});

test('one check-in a week per host, for all of their stays', async () => {
  const notices = [];
  const marked = [];
  const fakeDb = {
    async query(sql, params = []) {
      if (sql.includes('st-booking:weekly-listings')) {
        return { rows: [
          { ...STAY('63'), host_phone: '+256700000232', host_whatsapp: '+256700000232', host_email: 'host@example.com' },
          { ...STAY('51', { title: 'Studio in Kisaasi', bedrooms: 0, source: 'direct' }), host_phone: '0700000232', host_whatsapp: null, host_email: 'host@example.com' },
          { ...STAY('09', { area: 'Ntinda', title: 'Cottage in Ntinda' }), host_phone: '+256700000777', host_whatsapp: null, host_email: null }
        ] };
      }
      if (sql.includes('st-booking:weekly-mark')) { marked.push(params[0]); return { rows: [] }; }
      return { rows: [] };
    }
  };
  // Monday 10:00 in Kampala.
  const summary = await booking.tickAgentBookings(fakeDb, new Date('2026-10-26T07:00:00.000Z'), {
    deliverWhatsapp: async () => ({ status: 'queued' }),
    deliverStayNotice: async (notice) => { notices.push(notice); return { whatsapp_queued: true }; }
  });
  assert.strictEqual(notices.length, 2, 'two hosts, two check-ins');
  const kisaasi = notices.find((notice) => /ST-000063/.test(notice.text));
  assert.match(kisaasi.text, /your 2 stays on makaug\.com:\n1\. \*Studio in Kisaasi\* \(ST-000051\)[^\n]*\n2\. \*1-bed apartment in Kisaasi\* \(ST-000063\)/);
  assert.match(kisaasi.emailText, /Open: https?:\/\/\S+/);
  assert.doesNotMatch(kisaasi.text, /https?:\/\//);
  assert.strictEqual(kisaasi.event, 'weekly');
  assert.strictEqual(marked.length, 3, 'every stay is marked as asked this week');
  assert.strictEqual(summary.stay.weekly, 3);
});

// ------------------------------------------------------------ the renter

test('every place named is searched, and a main road is the places along it', () => {
  const two = route.withNamedPlaces({ hasSignal: true, area: 'Kiwatule' }, 'what about kungu, kiwatule');
  assert.deepStrictEqual(two.searchAreas.map((place) => place.key), ['wakiso:kungu', 'kampala:kiwatule']);
  assert.strictEqual(route.searchPlaceLabel(two), 'Kungu and Kiwatule');

  const road = route.withNamedPlaces({ hasSignal: true, propertyType: 'house', area: 'Gayaza' }, 'I want a house along gayaza road');
  assert.deepStrictEqual(road.road, { key: 'road:gayaza-road', name: 'Gayaza Road' });
  assert.strictEqual(road.area, '', 'not Gayaza town');
  for (const key of ['kampala:kisaasi', 'kampala:kyanja', 'wakiso:kasangati', 'wakiso:gayaza']) {
    assert.ok(road.searchAreas.some((place) => place.key === key), key);
  }
  assert.strictEqual(route.searchPlaceLabel(road), 'along Gayaza Road');
  assert.strictEqual(route.mainRoadInText('a plot on the Kampala Entebbe rd').name, 'Entebbe Road');
  assert.strictEqual(route.mainRoadInText('the road to my home'), null);
  assert.strictEqual(route.withNamedPlaces({ area: 'Kireka' }, 'what about kireka').searchAreas, undefined, 'one place is left as it was');
});

test('the search covers every place by its key on the map, with the budget', async () => {
  const originalQuery = db.query;
  const seen = [];
  db.query = async (sql, params = []) => { seen.push({ sql: String(sql), params }); return { rows: [] }; };
  try {
    const filters = route.withNamedPlaces({ hasSignal: true, searchType: 'rent', maxBudgetUgx: 150000, propertyType: 'single room' }, 'kisaasi, kyanja');
    await route.findPropertiesByNaturalFilters(filters);
    const search = seen.find((call) => /FROM properties p/.test(call.sql));
    assert.match(search.sql, /COALESCE\(p\.extra_fields->>'canonical_location_id', ''\) = ANY\(\$\d+\)/);
    assert.ok(search.params.some((value) => Array.isArray(value) && value.join() === 'kampala:kisaasi,kampala:kyanja'));
    assert.ok(search.params.includes(150000));
    assert.ok(search.params.includes('rent'));
  } finally {
    db.query = originalQuery;
  }
});

test('what they asked for goes on: a new place keeps the budget and the room, a budget keeps every place', () => {
  const brief = {
    ...route.searchBriefFromFilters({ searchType: 'rent', area: 'Kisaasi', maxBudgetUgx: 150000, budgetPeriod: 'month', propertyType: 'single room', searchAreas: [{ name: 'Kisaasi', key: 'kampala:kisaasi' }, { name: 'Kyanja', key: 'kampala:kyanja' }] }, 'kisaasi, kyanja 150k single room'),
    at: new Date().toISOString()
  };
  assert.deepStrictEqual(brief.places.map((place) => place.name), ['Kisaasi', 'Kyanja']);
  const kireka = route.continueFromLastSearch({ hasSignal: true, searchType: 'any', area: 'Kireka' }, { last_search_brief: brief });
  assert.strictEqual(kireka.searchType, 'rent');
  assert.strictEqual(kireka.maxBudgetUgx, 150000);
  assert.strictEqual(kireka.propertyType, 'single room');
  assert.strictEqual(kireka.area, 'Kireka');
  assert.strictEqual(route.searchPlacesOf(kireka).length, 0, 'the new place replaces the old ones');

  const budgetOnly = route.continueFromLastSearch({ hasSignal: true, searchType: 'rent', maxBudgetUgx: 200000 }, { last_search_brief: brief });
  assert.deepStrictEqual(route.searchPlacesOf(budgetOnly).map((place) => place.name), ['Kisaasi', 'Kyanja']);
  assert.strictEqual(budgetOnly.maxBudgetUgx, 200000);

  // A budget with no period, carried into a rent search, is a month's rent.
  const noPeriod = route.continueFromLastSearch({ hasSignal: true, area: 'Kireka' }, { last_search_brief: { ...brief, budget_period: null } });
  assert.strictEqual(noPeriod.budgetPeriod, 'month');
});

test('a budget search is remembered too: the next message keeps 150k and the single room', async () => {
  const originalQuery = db.query;
  const patches = [];
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions\s+SET session_data = session_data \|\| \$1::jsonb/i.test(sql)) patches.push(JSON.parse(params[0]));
    return { rows: [] };
  };
  try {
    await route.buildAffordabilityAdviceReply({
      phone: '+256700000670',
      text: 'my budget is 150k per month single room',
      lang: 'en',
      filters: { searchType: 'rent', propertyType: 'single room', maxBudgetUgx: 150000, budgetPeriod: 'month' }
    });
    await pause(); await pause();
    const memory = patches.find((patch) => patch.last_search_brief);
    assert.ok(memory, 'the search was remembered');
    assert.strictEqual(memory.last_search_brief.max_budget_ugx, 150000);
    assert.strictEqual(memory.last_search_brief.property_type, 'single room');
    assert.strictEqual(memory.last_search_brief.search_type, 'rent');
  } finally {
    db.query = originalQuery;
  }
});

test('renting or buying is asked when nobody said, before a home search; a budget or a room says it', () => {
  assert.strictEqual(route.asksRentOrBuyFirst({ searchType: 'any', propertyType: 'house' }), true);
  assert.strictEqual(route.asksRentOrBuyFirst({ searchType: 'any', bedsMin: 3 }), true);
  assert.strictEqual(route.asksRentOrBuyFirst({ searchType: 'rent', propertyType: 'house' }), false);
  assert.strictEqual(route.asksRentOrBuyFirst({ searchType: 'any', propertyType: 'house', maxBudgetUgx: 800000 }), false);
  assert.strictEqual(route.asksRentOrBuyFirst({ searchType: 'any', propertyType: 'single room' }), false);
  assert.strictEqual(route.asksRentOrBuyFirst({ searchType: 'any', propertyType: 'house', rentOrBuyAsked: true }), false, 'asked once');

  const road = route.withNamedPlaces({ hasSignal: true, searchType: 'any', propertyType: 'house' }, 'I want a house along gayaza road');
  assert.strictEqual(route.asksRentOrBuyFirst(road), true);
  assert.strictEqual(
    route.rentOrBuyQuestion(road),
    'Along Gayaza Road I look in Kisaasi, Kyanja, Gayaza and the places in between.\n\nHappy to help you find a house 🏡 Do you want to *rent* or to *buy*? And what is your budget?'
  );
  assert.match(route.rentOrBuyQuestion({ propertyType: 'house', area: 'Kyanja' }), /^Happy to help you find a house in Kyanja 🏡 Do you want to \*rent\* or to \*buy\*\?/);

  const prompt = route.naturalSearchPrompt('en', { searchType: 'any', propertyType: 'house' }, 'area');
  assert.match(prompt, /Sure, I can look for a house for you 🔎\nWhich area\? For example Ntinda, Kira or Kyanja\. And do you want to rent or to buy\?$/);
  assert.doesNotMatch(prompt, /Send the area or district|Filters:/);
  assert.doesNotMatch(route.naturalSearchPrompt('en', { searchType: 'rent', propertyType: 'house' }, 'area'), /rent or to buy/);
});

test('results open with what was looked for, in words', () => {
  assert.strictEqual(
    route.filtersLeadLine({ searchType: 'rent', propertyType: 'single room', maxBudgetUgx: 150000, budgetPeriod: 'month' }, 'en'),
    'Here is what I have for a single room to rent up to USh 150,000/month:\n'
  );
  assert.strictEqual(route.filtersLeadLine({ searchType: 'rent' }, 'en'), '', 'the results header says it');
  const places = route.withNamedPlaces({ searchType: 'rent', propertyType: 'single room', maxBudgetUgx: 150000, budgetPeriod: 'month' }, 'kungu, kiwatule');
  assert.match(route.filtersLeadLine(places, 'en'), /^Here is what I have in Kungu and Kiwatule for a single room to rent/);
  assert.match(route.filtersLeadLine({ searchType: 'rent', propertyType: 'house' }, 'lg'), /^✅ Filters applied:/, 'other languages as before');
});

// ---------------------------------------------- the conversations, end to end

function runtimeDb({ typedByTeam = null } = {}) {
  const sessions = new Map();
  const searches = [];
  const notes = [];
  const leads = [];
  async function query(sql, params = []) {
    const text = String(sql);
    if (/SELECT \* FROM whatsapp_sessions WHERE phone = \$1/i.test(text)) {
      const session = sessions.get(params[0]);
      return { rows: session ? [session] : [] };
    }
    if (/INSERT INTO whatsapp_sessions/i.test(text)) {
      const session = { phone: params[0], current_step: 'greeting', language: 'en', listing_draft: {}, session_data: {} };
      sessions.set(params[0], session);
      return { rows: [session] };
    }
    if (/UPDATE whatsapp_sessions\s+SET session_data = session_data \|\| \$1::jsonb/i.test(text)) {
      const session = sessions.get(params[1]);
      if (session) session.session_data = { ...(session.session_data || {}), ...JSON.parse(params[0]) };
      return { rows: [] };
    }
    const update = text.match(/^UPDATE whatsapp_sessions SET (.*), last_message_at = NOW\(\) WHERE phone = \$1/s);
    if (update) {
      const session = sessions.get(params[0]);
      if (session) update[1].split(',').map((part) => part.trim().split(/\s*=\s*\$/)).forEach(([key, index]) => { session[key] = params[Number(index) - 1]; });
      return { rows: [] };
    }
    if (/UNION ALL/.test(text) && /reply_kind/.test(text)) return { rows: typedByTeam ? [typedByTeam] : [] };
    if (/INSERT INTO notifications/i.test(text)) { notes.push(params); return { rows: [{ id: `n-${notes.length}` }] }; }
    if (/INSERT INTO property_leads/i.test(text)) { leads.push(params); return { rows: [{ id: `lead-${leads.length}` }] }; }
    if (/FROM properties p/i.test(text) && /^\s*SELECT/i.test(text)) searches.push({ sql: text, params });
    return { rows: [] };
  }
  return { sessions, searches, notes, leads, query };
}

async function say(phone, lines) {
  const replies = [];
  for (const body of lines) {
    const result = await route.processInboundRuntime({ phone, body, provider: 'whatsapp_web', metadata: { contact_name: 'Renter One' } });
    replies.push(result.message);
    for (let i = 0; i < 4; i += 1) await pause();
  }
  return replies;
}

function withRuntime(fake, run) {
  const originalQuery = db.query;
  const originalClient = db.getClient;
  const previousTeam = process.env.LEAD_DESK_ALERT_WHATSAPP;
  const previousQuiet = process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS;
  db.query = fake.query;
  db.getClient = async () => ({ query: fake.query, release() {} });
  process.env.LEAD_DESK_ALERT_WHATSAPP = '+256700000999';
  process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS = '0';
  return Promise.resolve(run()).finally(() => {
    db.query = originalQuery;
    db.getClient = originalClient;
    if (previousTeam === undefined) delete process.env.LEAD_DESK_ALERT_WHATSAPP; else process.env.LEAD_DESK_ALERT_WHATSAPP = previousTeam;
    if (previousQuiet === undefined) delete process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS; else process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS = previousQuiet;
  });
}

test('"what about kireka" after a single room at 150k is searched as a single room at 150k', async () => {
  const fake = runtimeDb();
  await withRuntime(fake, async () => {
    await say('+256700000670', ['my budget is 150k per month single room', 'what about kireka']);
    const kireka = fake.searches.filter((call) => call.params.some((value) => value === '%Kireka%' || (Array.isArray(value) && value.includes('wakiso:kireka'))));
    assert.ok(kireka.length, 'Kireka was searched');
    assert.ok(kireka[0].params.includes(150000), 'with the budget');
    assert.ok(kireka[0].params.some((value) => /single\[/.test(String(value))), 'and the single room');
    assert.ok(kireka[0].params.includes('rent'), 'to rent');
  });
});

test('"I want a house along gayaza road": asked rent or buy, then searched along the road', async () => {
  const fake = runtimeDb();
  await withRuntime(fake, async () => {
    const [question, results] = await say('+256700000420', ['I want a house along gayaza road', 'rent, 3 bedrooms, under 1m']);
    assert.match(question, /Along Gayaza Road I look in Kisaasi, Kyanja, Gayaza and the places in between\./);
    assert.match(question, /Do you want to \*rent\* or to \*buy\*\?/);
    assert.doesNotMatch(question, /Send the area or district/);
    const roadSearch = fake.searches.find((call) => call.params.some((value) => Array.isArray(value) && value.includes('wakiso:kasangati')));
    assert.ok(roadSearch, 'the places along the road were searched');
    assert.ok(roadSearch.params.includes('rent'));
    assert.ok(roadSearch.params.includes(1000000));
    assert.match(results, /along Gayaza Road/);
    assert.doesNotMatch(results, /Wakiso district|in along/);
  });
});

test('after Sam writes to a customer, her "i want a single one" goes to him, not to the menu', async () => {
  const fake = runtimeDb({ typedByTeam: { at: new Date(Date.now() - 2 * 60 * 1000), text: 'Hello, this is Sam from makaug.com. Do you want a single room?' } });
  await withRuntime(fake, async () => {
    const [reply] = await say('+256700000671', ['i want a single one']);
    await pause(); await pause();
    assert.strictEqual(reply, '', 'nothing sent over him');
    assert.strictEqual(fake.notes.length, 1, 'the team was told');
    assert.strictEqual(fake.notes[0][4], 'customer_wrote_back_to_person');
  });
  // With nobody on the team writing to her, she gets an answer as before.
  const alone = runtimeDb();
  await withRuntime(alone, async () => {
    const [reply] = await say('+256700000672', ['i want a single one']);
    assert.ok(reply, 'answered');
    assert.strictEqual(alone.notes.length, 0);
  });
});

test('a search she sends while Sam is talking to her is still answered', async () => {
  const fake = runtimeDb({ typedByTeam: { at: new Date(Date.now() - 60 * 1000), text: 'Hello, this is Sam from makaug.com.' } });
  await withRuntime(fake, async () => {
    const [reply] = await say('+256700000673', ['single room to rent in kireka under 150k']);
    assert.ok(reply && reply.length > 20, 'answered');
    assert.ok(fake.searches.length, 'searched');
  });
});

test('the opening replies are the ones stepped back from', () => {
  assert.strictEqual(route.isOpeningReply('I can help with that. Tell me what you need in one sentence, or pick:\n1️⃣ List a property'), true);
  assert.strictEqual(route.isOpeningReply("🏡 *makaug* · Uganda's property marketplace\nGood morning 👋 What can I help you with?"), true);
  assert.strictEqual(route.isOpeningReply(route.naturalSearchPrompt('en', { propertyType: 'house' }, 'area')), true);
  assert.strictEqual(route.isOpeningReply('🏡 *Single room in Kireka*\n💰 USh 140K a month'), false);
});

test("the website's help button gets its questions with the results", async () => {
  const fake = runtimeDb();
  await withRuntime(fake, async () => {
    const [reply] = await say('+256700000674', ["Hi makaug, I'm on the To Rent page and I'm looking for a rental. Please help me with area, budget, bedrooms, availability, and viewing options. Page: makaug.com/to-rent/kisaasi-kampala"]);
    assert.match(reply, /To find you the right place: what is your budget a month, how many bedrooms do you need, and when do you want to move in\?/);
  });
});

// --------------------------------------------------------------- the agent

test("an agent's question about a request we sent is a question, not a property", async () => {
  for (const asked of [
    'Is it a mistake or they really want something of 150k',
    'Is this still available for 2.5m per month?',
    'So the client wants a room of 150k?',
    'Can you send me the client number'
  ]) {
    assert.strictEqual(intake.isQuestionToUs(asked), true, asked);
  }
  for (const advert of [
    'Who wants a 3 bedroom house in Kira for 500m?',
    '64 DECIMALS IN KISSASI MALCOM SELLING 900M',
    'House on sale in naalya with 3bedrooms asking price 220m',
    'HOT DEAL: Commercial plot in Namugongo measuring 25 decimals at only 300m ugx. Ready title'
  ]) {
    assert.strictEqual(intake.isQuestionToUs(advert), false, advert);
  }
  const originalQuery = db.query;
  db.query = async () => ({ rows: [] });
  try {
    const reply = await route.agentUnplacedReply({
      phone: '+256700000232',
      data: { whatsapp_agent_self_intake: true, agent: { full_name: 'Agent Musa', preferred_name: 'Musa' } },
      cleanBody: 'Is it a mistake or they really want something of 150k'
    });
    assert.match(reply.message, /I have passed your question to our team\. They will answer you here shortly\./);
    assert.doesNotMatch(reply.message, /send the photos/i);
  } finally {
    db.query = originalQuery;
  }
});

test('in his posting session, the question goes to the team and he is told so, not asked for photos', async () => {
  const AGENT_PHONE = '256700000232';
  const AGENT = {
    id: '00000000-0000-4000-8000-000000000232',
    makaug_agent_number: 'MKA-AG-0000232',
    full_name: 'Agent Musa',
    phone: `+${AGENT_PHONE}`,
    whatsapp: `+${AGENT_PHONE}`,
    status: 'approved'
  };
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const before = process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = '256700000111';
  const sessionWrites = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(text)) { sessionWrites.push(JSON.stringify(params)); return { rows: [] }; }
    if (/FROM agents/i.test(text) && /status = 'approved'/i.test(text)) return { rows: [AGENT] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  route.agentTalkNotes.clear();
  route.agentUnplacedThankedAt.clear();
  try {
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: 'Is it a mistake or they really want something of 150k',
      runtime: {},
      session: { current_step: 'employee_property_media', session_data: { ...route.agentSelfIntakeSessionData(AGENT), property_ids: ['p1'] } }
    });
    assert.strictEqual(reply.handled, true);
    assert.match(reply.message, /I have passed your question to our team\. They will answer you here shortly\./);
    assert.doesNotMatch(reply.message, /Got the details|send the \*?photos/i);
    assert.ok(!sessionWrites.some((write) => /pending_property_caption":"Is it a mistake/.test(write)), 'not kept as a description');
    assert.deepStrictEqual(route.agentTalkNotes.get(AGENT_PHONE)?.lines, ['Is it a mistake or they really want something of 150k'], 'the team gets his words');
  } finally {
    for (const waiting of route.agentTalkNotes.values()) if (waiting.timer) clearTimeout(waiting.timer);
    route.agentTalkNotes.clear();
    route.agentUnplacedThankedAt.clear();
    db.query = originalQuery;
    db.getClient = originalGetClient;
    if (before === undefined) delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS; else process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = before;
  }
});
