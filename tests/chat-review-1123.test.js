'use strict';

/**
 * Lessons from the WhatsApp chats of 22–23 Nov 2026, and the rest of the
 * weekend review that Arthur approved on 22 Nov.
 *
 * - A renter's voice note asked for a room "per night" for a friend in Kenya
 *   staying 20 days; it was read as a property in Kenya under UGX 20.
 * - The website's help button got three listings and no questions.
 * - "kisaasi, kyanja, 150k per month" got Kisaasi from 250k, no word about
 *   Kyanja, and nothing on the lead desk.
 * - An agent's description with nine photos right behind it got "now send the
 *   photos", then "1 photo saved — send more".
 * - Waiting "your property is live" notices would all go at once.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const sendOrder = require('../services/whatsappSendOrder');
const bridge = require('../services/whatsappWebBridgeService');
const shortTerm = require('../services/shortTermService');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const VOICE = "Good morning, Philip. I'm very happy to listen to you. Can you see some pictures of how much is the room per night? You send some pictures for your hotel, then I see. I want to send those photos to my friend. He's in Kenya. He wants to spend like there over 20 days. Now you tell me the price for the room per night, if you can give him the discount, like that.";

test('a room by the night is a short stay: the nights are not a budget, and Kenya is where the guest is', () => {
  assert.deepStrictEqual(route.shortStayAsk(VOICE), { nights: 20, guests: null, nightlyMax: null });
  assert.strictEqual(route.shortStayArea(VOICE, {}), '', 'Kenya is not where they will stay');
  assert.strictEqual(route.shortStayArea(VOICE, { search_location_label: 'Kyanja' }), 'Kyanja', 'the place they searched before');
  assert.deepStrictEqual(route.shortStayAsk('short stay in Ntinda for 3 nights 2 people'), { nights: 3, guests: 2, nightlyMax: null });
  assert.strictEqual(route.shortStayAsk('room in Kyanja under 100k a night').nightlyMax, 100000);
  assert.strictEqual(route.shortStayAsk('I want to visit Kampala for 2 weeks').nights, 14);
  assert.ok(route.shortStayAsk('I need a hotel in Kisaasi'));
  for (const notOne of ['3 bedroom house for rent in Kira 1.5m per month', 'land for sale 50 decimals', 'plot for sale, 7 days a week access', 'security guard at night']) {
    assert.strictEqual(route.shortStayAsk(notOne), null, notOne);
  }
});

test('the short-stay reply lists stays with a link each, asks dates, people and budget, and puts it on the lead desk', async () => {
  const originalSearch = shortTerm.searchShortTermListings;
  const originalQuery = db.query;
  const searches = [];
  const leads = [];
  shortTerm.searchShortTermListings = async (_db, query) => {
    searches.push(query);
    if (query.area === 'Kyanja') return { listings: [] };
    return { listings: [
      { title: 'Studio in Kisaasi', area: 'Kisaasi', nightly_display: 'UGX 80,000', url: '/short-term/studio-kisaasi-st-000051' },
      { title: '1-bed apartment in Kyanja', area: 'Kyanja', nightly_display: 'UGX 180,000', url: '/short-term/one-bed-kyanja-st-000055' }
    ] };
  };
  db.query = async (sql, params = []) => {
    if (/INSERT INTO property_leads/i.test(sql)) leads.push(params);
    return { rows: [] };
  };
  try {
    const reply = await route.shortStayGuestReply({ phone: '+256700000834', text: VOICE, ask: route.shortStayAsk(VOICE), sessionData: { search_location_label: 'Kyanja' } });
    await tick(); await tick();
    assert.match(reply, /Short stays near Kampala/, 'none in Kyanja itself, so its district');
    assert.match(reply, /1\. Studio in Kisaasi — UGX 80,000 a night\nhttps?:\/\/\S+\/short-term\/studio-kisaasi-st-000051/);
    assert.match(reply, /More places: https?:\/\/\S+\/short-term/);
    assert.match(reply, /For 20 nights a host will often give a lower price/);
    assert.match(reply, /which date do you arrive, how many people are staying, and what is your budget a night\?/);
    assert.doesNotMatch(reply, /Kenya|× your budget|for sale/i);
    assert.deepStrictEqual(searches.map((q) => q.area || q.district || ''), ['Kyanja', 'Kampala']);
    assert.strictEqual(leads.length, 1, 'on the lead desk');
    assert.strictEqual(leads[0][2], 'short_term');
    assert.strictEqual(leads[0][1], 'Kyanja');
    assert.match(leads[0][4], /About 20 nights/);
  } finally {
    shortTerm.searchShortTermListings = originalSearch;
    db.query = originalQuery;
  }
  // It is asked before the general property search.
  const hook = source.indexOf('const stayAsk = ');
  assert.ok(hook > 0 && hook < source.indexOf('isAffordabilityAdviceQuestion(cleanBody)', hook));
});

test("the website's help button gets the questions that find the right place", () => {
  const prefill = "Hi makaug, I'm on the To Rent page and I'm looking for a rental. Please help me with area, budget, bedrooms, availability, and viewing options. Page: makaug.com/to-rent/kisaasi-kampala";
  assert.deepStrictEqual(route.websiteHelpPrefill(prefill), { page: 'to-rent', kind: 'rent' });
  assert.match(route.websiteHelpQuestions('rent'), /budget a month, how many bedrooms .* when do you want to move in\?/);
  assert.match(route.websiteHelpQuestions('land'), /what size/);
  assert.strictEqual(route.websiteHelpPrefill('3 bedroom house in Kira'), null);
  assert.match(source, /const helpLine = prefill \? `\\n\\n\$\{websiteHelpQuestions\(prefill\.kind \|\| naturalFilters\.searchType\)\}` : '';/);
});

test('a budget nothing fits goes on the lead desk with every place they named, and they are told', async () => {
  assert.deepStrictEqual(route.namedSearchAreas('hallo am looking for a place to rent in the areas of kisaasi, kyanja my budget is 150k per month near the church'), ['Kisaasi', 'Kyanja']);
  const originalQuery = db.query;
  const leads = [];
  db.query = async (sql, params = []) => {
    if (/INSERT INTO property_leads/i.test(sql)) leads.push(params);
    return { rows: [] };
  };
  try {
    const reply = await route.buildAffordabilityAdviceReply({
      phone: '+256700000670',
      text: 'hallo am looking for a place to rent in the areas of kisaasi, kyanja my budget is 150k per month',
      lang: 'en',
      filters: { searchType: 'rent', area: 'Kisaasi', maxBudgetUgx: 150000, budgetPeriod: 'month' }
    });
    await tick(); await tick();
    assert.match(reply, /Nothing in Kisaasi and Kyanja is live at .*150.* yet, so I have passed your request to our team\. They will ask our agents in Kisaasi and Kyanja and send you what they find\./);
    assert.strictEqual(leads.length, 1);
    assert.strictEqual(leads[0][1], 'Kisaasi, Kyanja');
    assert.strictEqual(Number(leads[0][3]), 150000);
  } finally {
    db.query = originalQuery;
  }
});

test("an agent's photos already in line: no 'send the photos', and one Saved with every photo counted", () => {
  const data = { whatsapp_agent_self_intake: true, agent: { full_name: 'Agent One', profile_photo_url: 'x' } };
  const caption = 'Land for sale in Kira, Wakiso 3 acres 39M';
  route.holdAgentSavedReply(data, { propertyId: 'p-1', caption, storedMedia: [{ kind: 'image' }] });
  assert.strictEqual(route.releaseAgentSavedReply(data, { mediaWaiting: 7 }), '', 'eight more photos in line: it waits');
  for (let i = 0; i < 8; i += 1) route.countAgentSavedMedia(data, 'p-1', [{ kind: 'image' }], 1);
  const saved = route.releaseAgentSavedReply(data, { mediaWaiting: 0 });
  assert.match(saved, /Saved — your property in Kira is with our team for review/);
  assert.match(saved, /📸 9 photos saved/);
  assert.doesNotMatch(saved, /send more and I will add them/);
  assert.strictEqual(data.agent_saved_reply_waiting, undefined, 'said once');
  assert.strictEqual(route.releaseAgentSavedReply(data, { mediaWaiting: 0 }), '');
  // The three places the intake uses it.
  assert.match(source, /const photosOnTheirWay = Number\(runtime\.mediaWaiting \|\| 0\) > 0;/);
  assert.match(source, /const holdSaved = data\.whatsapp_agent_self_intake === true && Number\(runtime\.mediaWaiting \|\| 0\) > 0;/);
  assert.match(source, /const savedNow = releaseAgentSavedReply\(data, \{ mediaWaiting: runtime\.mediaWaiting \}\);/);
  assert.match(source, /mediaWaiting: typeof sendOrder\.mediaWaiting === 'function' \? sendOrder\.mediaWaiting\(whatsappLineKey\(phone\)\) : 0,/);
});

test('the send-order line says how many photos are still waiting behind the one being handled', async () => {
  sendOrder.resetSendOrderForTests();
  let t = 0;
  // A burst of photos: the first waits the settle time, so the rest are in line.
  const opts = { now: () => t, sleep: async (ms) => { t += ms; await tick(); }, settleMs: 1200 };
  const seen = [];
  const job = (name) => async () => { seen.push([name, sendOrder.mediaWaiting('256700000111')]); };
  const all = [
    sendOrder.runInSendOrder('256700000111', { senderMs: 2, media: true, seq: 2 }, job('photo 1'), opts),
    sendOrder.runInSendOrder('256700000111', { senderMs: 3, media: true, seq: 3 }, job('photo 2'), opts),
    sendOrder.runInSendOrder('256700000111', { senderMs: 4, media: true, seq: 4 }, job('photo 3'), opts),
    sendOrder.runInSendOrder('256700000111', { senderMs: 5, media: false, seq: 5 }, job('a word after'), opts)
  ];
  await Promise.all(all);
  assert.deepStrictEqual(seen, [['photo 1', 2], ['photo 2', 1], ['photo 3', 0], ['a word after', 0]]);
  sendOrder.resetSendOrderForTests();
});

test('several waiting "your property is live" for one agent go as one message, once they can be written to', async () => {
  const text = (title, place, id) => `🎉 *Your property is live on makaug.com*\n${title}\n${place} · USh 39,000,000\n🔗 https://makaug.com/property/${id}\n\n👤 Your profile page is updated with it:\nhttps://makaug.com/agents/abc\n\nShare both on your WhatsApp status and in your groups — buyers see your name and number.\nGot another one? Send it here.`;
  const one = bridge.combinedLiveNotice([text('Land in Kira', 'Kira, Wakiso', '1111'), text('Land in Gayaza', 'Gayaza, Wakiso', '2222')]);
  assert.match(one, /^🎉 \*2 of your properties are live on makaug\.com\*/);
  assert.match(one, /1\. Land in Kira — Kira, Wakiso · USh 39,000,000\n🔗 https:\/\/makaug\.com\/property\/1111\n2\. Land in Gayaza/);
  assert.match(one, /👤 Your profile page has them all:\nhttps:\/\/makaug\.com\/agents\/abc/);
  assert.strictEqual(bridge.combinedLiveNotice([text('Land in Kira', 'Kira, Wakiso', '1111')]), '', 'one on its own is left as it is');

  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/GROUP BY 1/.test(sql)) return { rows: [{ tail: '700000111', ids: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], texts: [text('Land in Kira', 'Kira, Wakiso', '1111'), text('Land in Gayaza', 'Gayaza, Wakiso', '2222')] }] };
    return { rowCount: 1, rows: [] };
  };
  try {
    assert.strictEqual(await bridge.combineWaitingLiveNotices({ force: true }), 1);
  } finally {
    db.query = originalQuery;
  }
  assert.match(calls[0].sql, /message_kind', ''\) = 'listing_status_approved'/);
  assert.match(calls[0].sql, /HAVING COUNT\(\*\) >= 2/);
  assert.match(calls[0].sql, /AND m\.created_at >= NOW\(\) - INTERVAL '\d+ days'/, 'only for someone who can be written to now');
  assert.strictEqual(calls[1].params[0], '00000000-0000-4000-8000-000000000001');
  assert.match(calls[1].params[1], /2 of your properties are live/);
  assert.deepStrictEqual(calls[2].params[0], ['00000000-0000-4000-8000-000000000002']);
  assert.match(calls[2].sql, /combined_into_one/);
  const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'whatsappWebBridgeService.js'), 'utf8');
  const sessionCheck = bridgeSource.indexOf('if (await bridgeSessionCannotSend(normalizedClientId)) return [];');
  const sweep = bridgeSource.indexOf('await combineWaitingLiveNotices();', sessionCheck);
  assert.ok(sessionCheck > 0 && sweep > sessionCheck && sweep < bridgeSource.indexOf('WITH claimable AS', sessionCheck));
});
