'use strict';

/**
 * A broker nobody knows forwards fourteen adverts.
 *
 * 26 Oct 2026, 09:31–19:24: "brandpro properties" (+256 773 216580), not yet
 * on makaug, forwarded fourteen adverts to the public number — a caption and
 * an album each, about 180 photos. The consumer assistant answered every
 * caption with a property search, a land-safety note or "I can help with
 * that", and he wrote "All this messages is for wat". Nothing was saved. When
 * staff later imported the chat, two captions written in WhatsApp's fancy
 * letters were missed, their albums glued to the advert before them, and six
 * albums that had arrived *before* their caption went to the wrong property.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const { foldAdvertText } = require('../services/whatsappEmployeeIntakeService');
const route = require('../routes/whatsapp').__test;

const PHONE = '256773216580';
const FANCY = '🔥 𝗤𝗨𝗜𝗖𝗞𝗘𝗦𝗧 𝗦𝗔𝗟𝗘...𝗛𝗢𝗧𝗧𝗘𝗦𝗧 𝗗𝗘𝗔𝗟 🔥 A Marvelous House Seated on 𝟮𝟱 𝗗𝗘𝗖𝗜𝗠𝗔𝗟𝗦 (𝟭𝟬𝟬×𝟭𝟬𝟬𝗙𝗧) With a 𝗣𝗥𝗜𝗩𝗔𝗧𝗘 𝗠𝗔𝗜𝗟𝗢 𝗟𝗔𝗡𝗗 𝗧𝗜𝗧𝗟𝗘 located at 𝗞𝗬𝗔𝗡𝗝𝗔 𝟰 𝗕𝗘𝗗𝗥𝗢𝗢𝗠𝗦 asking 𝟯𝟱𝟬𝗠';
const SEKIWUNGA = 'Plot for sale measuring 18decimals with perimeter wall of 3 sides located at sekiwunga viewing express highway and akright Estate with ready private mailo tittle on table asking price is 145m';
const KITENDE = 'HOUSE FOR SALE KITENDE KITOVU ENTEBBE ROAD. 3BEDROOMS SELF CONTAINED, SEATING, DINING, AND KITCHEN ON 18 DECIMALS WITH TITTLE AT ASKING PRICE 370M NEGOTIABLE.';

test('fancy letters, hashtags and "reduced from" prices are read as the broker meant them', () => {
  assert.strictEqual(foldAdvertText('𝟮𝟱 𝗗𝗘𝗖𝗜𝗠𝗔𝗟𝗦 #MUKONO_NSAMBWE #3BEDROOMS #180m m²'), '25 DECIMALS  MUKONO NSAMBWE  #3BEDROOMS #180m m²', 'word tags are words; a price written with # stays for the price scan');
  const fancy = route.employeePropertyFacts(FANCY, {});
  assert.strictEqual(fancy.listingType, 'sale');
  assert.strictEqual(fancy.price, 350000000);
  assert.strictEqual(fancy.locationPatch.area, 'Kyanja');
  assert.strictEqual(fancy.bedroomDraft.bedrooms, 4);
  const nsambwe = route.employeePropertyFacts('SHELL HOUSE🏠 ON QUICK SALE LOCATED AT #MUKONO_NSAMBWE ESTATE HAS #3BEDROOMS #2BATHROOMS ALL SEATED ON 25DECIMLS #TITLED PRICE 100M', {});
  assert.strictEqual(nsambwe.locationPatch.area, 'Nsambwe');
  assert.strictEqual(nsambwe.locationPatch.district, 'Mukono', 'the district written beside the area wins over the registry\'s Gomba');
  const reduced = route.employeePropertyFacts('Quick sale plot owner need money urgently price reduced from 350m now selling 200m it\'s 17decimals private mile land title located at bunamwaya', {});
  assert.strictEqual(reduced.price, 200000000, 'the old price is history');
  assert.strictEqual(route.employeePropertyFacts('they have monthly revenue of (2.5m ugx) At only 180m ugx apartments for sale in Seeta', {}).price, 180000000, 'the income rule still holds');
});

test('albums go to the nearest caption, whichever side of it they arrived on', () => {
  const t = (minutes, seconds = 0) => Date.UTC(2026, 9, 26, 9, minutes, seconds);
  const caption = (id, minutes, text) => ({ caption: text, caption_message_id: id, caption_at: new Date(t(minutes)).toISOString(), ms: t(minutes), facts: {}, missing: [], media: [] });
  const photo = (id, minutes, seconds, cap = '') => ({ message_id: id, at: new Date(t(minutes, seconds)).toISOString(), ms: t(minutes, seconds), url: `https://x/${id}`, mimeType: 'image/jpeg', caption: cap });
  const captions = [caption('c-sekiwunga', 39, SEKIWUNGA), caption('c-lutembe', 42, 'Plots for sale at lutembe 23decimals at 220m'), caption('c-kitende', 50, KITENDE)];
  const media = [
    photo('a1', 37, 50), photo('a2', 37, 55), photo('a3', 38, 2), photo('a4', 38, 10), // album before Sekiwunga's caption
    photo('b1', 43, 0), photo('b2', 43, 4), photo('b3', 43, 9), // album after Lutembe's caption
    photo('c1', 50, 30), photo('c2', 50, 40, 'with a caption of its own'), // album after Kitende's caption
    photo('z1', 0, 0) // forty minutes before anything: nobody's
  ];
  const orphans = route.pairForwardedAlbums(captions, media);
  assert.deepStrictEqual(captions[0].media.map((m) => m.message_id), ['a1', 'a2', 'a3', 'a4'], 'photos sent just before the caption are its');
  assert.deepStrictEqual(captions[1].media.map((m) => m.message_id), ['b1', 'b2', 'b3']);
  assert.deepStrictEqual(captions[2].media.map((m) => m.message_id), ['c1', 'c2']);
  assert.match(captions[2].caption, /with a caption of its own$/);
  assert.deepStrictEqual(orphans.map((m) => m.message_id), ['z1']);
  // Equidistant: the caption after the album wins.
  const tie = [caption('before', 10, 'x'), caption('after', 14, 'y')];
  route.pairForwardedAlbums(tie, [photo('m1', 12, 0)]);
  assert.deepStrictEqual(tie[1].media.map((m) => m.message_id), ['m1']);
  assert.deepStrictEqual(tie[0].media, []);
});

function fakeDb(run, { rows = [], agent = null } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const calls = [];
  const query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/FROM whatsapp_messages/i.test(text)) return { rows };
    if (/FROM agents/i.test(text)) return { rows: agent ? [agent] : [] };
    if (/INSERT INTO agents/i.test(text)) return { rows: [{ id: 'agent-new', full_name: params[0], status: 'pending', phone: params[3], whatsapp: params[3] }] };
    if (/INSERT INTO properties/i.test(text)) return { rows: [{ id: `prop-${calls.filter((c) => /INSERT INTO properties/i.test(c.sql)).length}`, inquiry_reference: 'MK-TEST' }] };
    if (/INSERT INTO notifications/i.test(text)) return { rows: [{ id: 'n-1' }] };
    return { rows: [] };
  };
  db.query = query;
  db.getClient = async () => ({ query, release() {} });
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

const session = (data = {}, step = 'main_menu') => ({ phone: PHONE, current_step: step, language: 'en', session_data: data });

test('a stranger\'s first advert gets one question; the photos are taken quietly; "2" lets them search', async () => {
  await fakeDb(async (calls) => {
    const first = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session(), cleanBody: SEKIWUNGA, runtime: { contactName: 'brandpro properties' }, currentStep: 'main_menu' });
    assert.strictEqual(first.handled, true);
    assert.match(first.message, /^📥 That looks like a property you are selling: \*Land · Akright City, Wakiso · USh 145M\*/);
    assert.match(first.message, /Reply \*1\* to list it on makaug/);
    const patched = JSON.parse(calls.find((c) => /UPDATE whatsapp_sessions/.test(c.sql)).params[0]);
    assert.strictEqual(patched.forwarded_adverts.captions, 1);
    assert.ok(patched.forwarded_adverts.prompted_at);
    const open = session({ forwarded_adverts: { ...patched.forwarded_adverts } });
    const photo = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: open, cleanBody: '', mediaUrl: 'https://bridge/media?p=1', runtime: { mediaCount: 1 }, currentStep: 'main_menu' });
    assert.deepStrictEqual(photo, { handled: true, nextStep: 'main_menu', message: '' }, 'a photo while the question is open gets no reply at all');
    const second = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: open, cleanBody: KITENDE, runtime: {}, currentStep: 'main_menu' });
    assert.strictEqual(second.message, '', 'the question is not asked again within fifteen minutes');
    const no = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: open, cleanBody: '2', runtime: {}, currentStep: 'main_menu' });
    assert.strictEqual(no, null, '"2" hands the message back to the consumer script');
    const declined = JSON.parse(calls[calls.length - 1].params[0]);
    assert.ok(declined.forwarded_adverts.declined_at);
    const later = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session({ forwarded_adverts: declined.forwarded_adverts }), cleanBody: KITENDE, runtime: {}, currentStep: 'main_menu' });
    assert.strictEqual(later, null, 'after "2", adverts go to the consumer script for a day');
  });
});

test('"1" opens a pending agent profile named after the sender, imports what was forwarded, and hands over to the posting session', async () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 26, 9, m)).toISOString();
  const rows = [
    { id: 1, wa_message_id: 'cap-1', created_at: at(39), message_type: 'text', payload: { body: SEKIWUNGA } },
    { id: 2, wa_message_id: 'chat-1', created_at: at(40), message_type: 'text', payload: { body: 'All this messages is for wat' } },
    { id: 3, wa_message_id: 'cap-2', created_at: at(50), message_type: 'text', payload: { body: KITENDE } }
  ];
  await fakeDb(async (calls) => {
    const state = { since: at(30), captions: 2, media: 0, prompted_at: at(39), awaiting_name: false };
    const reply = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session({ forwarded_adverts: state }), cleanBody: '1', runtime: { contactName: 'brandpro properties' }, currentStep: 'main_menu' });
    assert.strictEqual(reply.handled, true);
    assert.strictEqual(reply.nextStep, 'employee_property_media');
    assert.match(reply.message, /^✅ Saved 2 properties for our team to review:\n1\. Land · Akright City, Wakiso · USh 145M\n2\. For sale · 3-bed · Kitende, Wakiso · USh 370M/);
    assert.match(reply.message, /agent profile under \*brandpro properties\*/);
    const agentInsert = calls.find((c) => /INSERT INTO agents/.test(c.sql));
    assert.ok(agentInsert, 'a pending profile is opened');
    assert.strictEqual(agentInsert.params[0], 'brandpro properties');
    assert.match(agentInsert.sql, /'pending', 'whatsapp_forwarded_adverts'/);
    assert.strictEqual(calls.filter((c) => /INSERT INTO properties/.test(c.sql)).length, 2, 'one review listing per advert; the chat line is not one');
    const handover = calls.find((c) => /UPDATE whatsapp_sessions/.test(c.sql) && /current_step = \$2/.test(c.sql));
    assert.strictEqual(handover.params[1], 'employee_property_media');
    const data = JSON.parse(handover.params[2]);
    assert.strictEqual(data.whatsapp_agent_self_intake, true);
    assert.strictEqual(data.agent.id, 'agent-new');
    assert.strictEqual(data.identity_followup_required, true, 'staff chase the ID of a profile the assistant opened');
    assert.strictEqual(data.agent_profile_pending, true);
    assert.deepStrictEqual(data.property_ids, ['prop-1', 'prop-2']);
  }, { rows });
});

test('with no push name the assistant asks whose name goes on the listings', async () => {
  await fakeDb(async () => {
    const state = { since: '2026-10-26T09:30:00Z', captions: 1, media: 0, prompted_at: '2026-10-26T09:39:00Z', awaiting_name: false };
    const ask = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session({ forwarded_adverts: state }), cleanBody: 'yes', runtime: { contactName: '' }, currentStep: 'main_menu' });
    assert.match(ask.message, /What name should go on your listings/);
    const named = await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session({ forwarded_adverts: { ...state, awaiting_name: true } }), cleanBody: 'Brandpro Properties Ltd', runtime: {}, currentStep: 'main_menu' });
    assert.match(named.message, /agent profile under \*Brandpro Properties Ltd\*/);
  });
});

test('staff, owners, agents mid-flow and ordinary chat are left alone', async () => {
  await fakeDb(async () => {
    assert.strictEqual(await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session({}, 'price'), cleanBody: SEKIWUNGA, runtime: {}, currentStep: 'price' }), null, 'a listing flow under way is not interrupted');
    assert.strictEqual(await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session({ employee_role: 'agent' }), cleanBody: SEKIWUNGA, runtime: {}, currentStep: 'main_menu' }), null, 'staff have their own intake');
    assert.strictEqual(await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session(), cleanBody: '2 bedroom house in Ntinda under 1m', runtime: {}, currentStep: 'main_menu' }), null, 'a search is a search');
    assert.strictEqual(await route.handleUnknownForwardedAdvert({ phone: PHONE, session: session(), cleanBody: 'ok', runtime: {}, currentStep: 'main_menu' }), null, '"ok" with no question asked means nothing');
  });
});
