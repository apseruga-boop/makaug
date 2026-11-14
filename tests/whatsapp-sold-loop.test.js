'use strict';

/**
 * SOLD on WhatsApp, all the way round.
 *
 * 14 Nov 2026. A replay of the real inbound route: an approved agent wrote
 * "The Buwaate bungalow is sold", was asked "Reply 1 = Yes, mark it SOLD",
 * replied 1, and was answered "What are you listing?". The listing stayed up.
 * The question's step was returned to the runtime and never saved, so the
 * answer was read as a new message. The same replay showed "SOLD" with the
 * property's makaug link (what we tell people to send) offering three guesses
 * that did not include the linked listing, and a rented house marked SOLD.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';
const db = require('../config/database');
const whatsapp = require('../routes/whatsapp');
const route = whatsapp.__test;

const AGENT_PHONE = '+256772000111';
const AGENT = { id: '5674f6cb-37a0-4e1e-904f-06e03ec401ab', full_name: 'Brian Kato', greeting_name: 'Brian', phone: AGENT_PHONE, whatsapp: AGENT_PHONE, status: 'approved', user_id: null };
const BUNGALOW = { id: 'a1a1a1a1-0000-4000-8000-000000000001', title: '3-bed bungalow for sale in Buwaate', area: 'Buwaate', district: 'Wakiso', price: '280000000', price_period: null, listing_type: 'sale', bedrooms: 3, inquiry_reference: 'MK-20261114-AAA111', updated_at: '2026-11-14T08:00:00Z', extra_fields: {} };
const RENTAL = { id: 'b2b2b2b2-0000-4000-8000-000000000002', title: '2-bed house for rent in Kira', area: 'Kira', district: 'Wakiso', price: '900000', price_period: 'mo', listing_type: 'rent', bedrooms: 2, inquiry_reference: 'MK-20261114-BBB222', updated_at: '2026-11-13T08:00:00Z', extra_fields: {} };
const PLOT = { id: 'c3c3c3c3-0000-4000-8000-000000000003', title: 'Plot for sale in Matugga', area: 'Matugga', district: 'Wakiso', price: '35000000', price_period: null, listing_type: 'land', bedrooms: null, inquiry_reference: 'MK-20261114-CCC333', updated_at: '2026-11-12T08:00:00Z', extra_fields: {} };
const SHOP = { id: 'd4d4d4d4-0000-4000-8000-000000000004', title: 'Shop for rent in Kireka', area: 'Kireka', district: 'Wakiso', price: '600000', price_period: 'mo', listing_type: 'rent', bedrooms: null, inquiry_reference: 'MK-20261114-DDD444', updated_at: '2026-11-01T08:00:00Z', extra_fields: {} };

/** A stand-in database that keeps what the SOLD flow writes. */
function withWorld(run, { listings = [BUNGALOW], agent = AGENT } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const world = { steps: [], patches: [], sold: [], team: [] };
  whatsapp.forgetAgentPhone?.(AGENT_PHONE);
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SET session_data = session_data \|\|/i.test(text)) { world.patches.push(JSON.parse(params[0])); return { rows: [] }; }
    if (/UPDATE whatsapp_sessions SET current_step = \$2/i.test(text)) { world.steps.push(params[1]); return { rows: [] }; }
    if (/FROM agents/i.test(text)) return { rows: agent ? [agent] : [] };
    if (/FROM properties p\s+WHERE (p\.agent_id = \$1::uuid|p\.agent_id IS NULL)/i.test(text)) return { rows: listings };
    if (/UPDATE properties\s+SET status = 'sold'/i.test(text)) {
      world.sold.push({ id: params[0], sql: text });
      const row = listings.find((item) => item.id === params[0]);
      return { rows: row ? [{ ...row, status: 'sold', availability_status: /rent|short|student/.test(row.listing_type) ? 'let_agreed' : 'sold' }] : [] };
    }
    if (/INSERT INTO outbound_message_queue/i.test(text)) {
      world.team.push(JSON.stringify(params));
      return { rows: [{ id: `queued-${world.team.length}`, status: 'pending' }] };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  world.data = () => Object.assign({}, ...world.patches);
  world.step = () => world.steps[world.steps.length - 1];
  return Promise.resolve(run(world)).finally(() => {
    db.query = originalQuery;
    db.getClient = originalGetClient;
    whatsapp.forgetAgentPhone?.(AGENT_PHONE);
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test('what counts as an answer to "Reply 1 = Yes, mark it SOLD"', () => {
  const kinds = {
    1: 'number', '2': 'number', '0': 'number', '12': 'number',
    Yes: 'yes', 'YES!': 'yes', 'Yes it is sold': 'yes', 'Yeah that one': 'yes', "That's the one": 'yes', Yee: 'yes', Ndiyo: 'yes', Ok: 'yes',
    No: 'no', 'No, a different one': 'no', Nedda: 'no', Hapana: 'no', 'None': 'no',
    Cancel: 'leave', 'leave it': 'leave',
    Sold: 'sold_word', 'Taken': 'sold_word'
  };
  for (const [said, kind] of Object.entries(kinds)) assert.strictEqual(route.soldAnswerKind(said), kind, said);
  for (const said of [
    '1 bedroom house in Kira for sale 200m',
    'Yes I have 3 more houses in Kira to post',
    'No longer available',
    'Hello',
    'How much is the fee?',
    'Yes please I would like to know how many people have seen my other houses this week',
    ''
  ]) assert.strictEqual(route.soldAnswerKind(said), '', said);
});

test('the question saves its own step, so the 1 that follows is read as its answer', async () => {
  await withWorld(async (world) => {
    const asked = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: 'The Buwaate bungalow is sold',
      session: { current_step: 'main_menu', session_data: {} }
    });
    assert.strictEqual(asked.nextStep, route.SOLD_CONFIRM_STEP);
    assert.match(asked.message, /Sold\? Let me mark it/);
    assert.strictEqual(world.step(), route.SOLD_CONFIRM_STEP, 'the step is written to the session, not only returned');
    const pending = world.data().agent_sold;
    const answered = await route.settleOpenSoldQuestion({
      phone: AGENT_PHONE,
      body: '1',
      session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } }
    });
    assert.match(answered.reply.message, /Marked as SOLD/);
    assert.match(answered.reply.message, /SOLD badge for 7 days/);
    assert.match(answered.reply.message, /I will message you the day it does/);
    assert.deepStrictEqual(world.sold.map((item) => item.id), [BUNGALOW.id]);
    assert.strictEqual(world.step(), 'main_menu');
    await settle();
    assert.ok(world.team.some((body) => /Brian Kato marked a listing SOLD on WhatsApp/.test(body)), 'Arthur and Ronald are told');
  });
});

test('"Yes it is sold" is a yes, not a second announcement', async () => {
  await withWorld(async (world) => {
    const pending = { single: true, asked_at: new Date().toISOString(), candidates: [{ id: BUNGALOW.id, title: BUNGALOW.title, listing_type: 'sale' }] };
    const answered = await route.settleOpenSoldQuestion({
      phone: AGENT_PHONE,
      body: 'Yes it is sold',
      session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } }
    });
    assert.match(answered.reply.message, /Marked as SOLD/);
    assert.strictEqual(world.sold.length, 1);
  });
});

test('an agent in the middle of posting goes back to posting once it is marked', async () => {
  await withWorld(async (world) => {
    const session = { current_step: 'employee_property_media', session_data: { whatsapp_agent_self_intake: true, whatsapp_employee_intake: true, agent: AGENT, property_ids: [] } };
    const asked = await route.handleEmployeeWhatsappIntake({ phone: AGENT_PHONE, body: 'Buwaate bungalow sold', session });
    assert.strictEqual(asked.nextStep, route.SOLD_CONFIRM_STEP);
    const pending = world.data().agent_sold;
    assert.strictEqual(pending.return_step, 'employee_property_media');
    const answered = await route.settleOpenSoldQuestion({
      phone: AGENT_PHONE,
      body: '1',
      session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { ...session.session_data, agent_sold: pending } }
    });
    assert.match(answered.reply.message, /Marked as SOLD/);
    assert.strictEqual(answered.reply.nextStep, 'employee_property_media');
    assert.strictEqual(world.step(), 'employee_property_media');
  });
});

test('a photo, a greeting or a new property closes the question and marks nothing', async () => {
  const pending = { single: true, asked_at: new Date().toISOString(), return_step: 'employee_property_media', candidates: [{ id: BUNGALOW.id, title: BUNGALOW.title, listing_type: 'sale' }] };
  const open = () => ({ current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } });
  for (const message of [
    { body: '4 bedroom house for sale in Kira, Wakiso. UGX 450m', hasMedia: true },
    { body: '', hasMedia: true },
    { body: 'Hello' },
    { body: 'STATUS' },
    { body: '1 bedroom house in Kira for sale 200m' }
  ]) {
    await withWorld(async (world) => {
      const result = await route.settleOpenSoldQuestion({ phone: AGENT_PHONE, session: open(), ...message });
      assert.strictEqual(result.closed, true, JSON.stringify(message));
      assert.strictEqual(result.reply, undefined);
      assert.strictEqual(result.step, 'employee_property_media', 'back where they were');
      assert.strictEqual(world.sold.length, 0);
      assert.ok(world.patches.some((patch) => patch.agent_sold === null), 'the question is cleared');
      assert.strictEqual(world.step(), 'employee_property_media');
    });
  }
});

test('a 1 that arrives after the question has timed out marks nothing and says so', async () => {
  await withWorld(async (world) => {
    const old = new Date(Date.now() - (route.SOLD_QUESTION_OPEN_HOURS + 1) * 3600 * 1000).toISOString();
    const pending = { single: true, asked_at: old, candidates: [{ id: BUNGALOW.id, title: BUNGALOW.title, listing_type: 'sale' }] };
    const late = await route.settleOpenSoldQuestion({ phone: AGENT_PHONE, body: '1', session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } } });
    assert.match(late.reply.message, /timed out/);
    assert.match(late.reply.message, /send \*SOLD\* again/);
    assert.strictEqual(world.sold.length, 0);
    assert.strictEqual(world.step(), 'main_menu');
    const other = await route.settleOpenSoldQuestion({ phone: AGENT_PHONE, body: 'Good morning', session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } } });
    assert.strictEqual(other.closed, true);
    assert.strictEqual(other.reply, undefined, 'anything else is simply read the ordinary way');
  });
  assert.strictEqual(route.SOLD_QUESTION_OPEN_HOURS, 3);
});

test('no question open: nothing to settle', async () => {
  await withWorld(async (world) => {
    const result = await route.settleOpenSoldQuestion({ phone: AGENT_PHONE, body: '1', session: { current_step: 'main_menu', session_data: {} } });
    assert.deepStrictEqual(result, {});
    assert.strictEqual(world.steps.length, 0);
  });
});

test('SOLD with the makaug link, or the reference, names the listing: no guessing', async () => {
  const listings = [BUNGALOW, RENTAL, PLOT, SHOP];
  await withWorld(async (world) => {
    const asked = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: `SOLD https://makaug.com/property/${SHOP.id}`,
      session: { current_step: 'main_menu', session_data: {} }
    });
    assert.match(asked.message, /Shop for rent in Kireka/);
    assert.doesNotMatch(asked.message, /Which one has gone/);
    assert.strictEqual(world.data().agent_sold.candidates.length, 1);
    assert.strictEqual(world.data().agent_sold.candidates[0].id, SHOP.id);
  }, { listings });
  await withWorld(async (world) => {
    const asked = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: `${PLOT.inquiry_reference} sold`,
      session: { current_step: 'main_menu', session_data: {} }
    });
    assert.match(asked.message, /Plot for sale in Matugga/);
    assert.strictEqual(world.data().agent_sold.candidates[0].id, PLOT.id);
  }, { listings });
  assert.deepStrictEqual(route.soldListingNamedIn('Sold! Kira 330m', listings), { named: false });
});

test('a link that is not one of their live listings changes nothing and the team is told', async () => {
  await withWorld(async (world) => {
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: 'SOLD https://makaug.com/property/99999999-0000-4000-8000-000000000009',
      session: { current_step: 'main_menu', session_data: {} }
    });
    assert.match(reply.message, /could not find that one among your live listings/);
    assert.match(reply.message, /not changed anything/);
    assert.strictEqual(world.sold.length, 0);
    assert.strictEqual(world.data().agent_sold, undefined, 'no question is opened');
    await settle();
    assert.ok(world.team.some((body) => /wants a listing marked SOLD/.test(body)));
  }, { listings: [BUNGALOW, RENTAL] });
});

test('a rental that has gone is LET, in the question, the answer and the record', async () => {
  await withWorld(async (world) => {
    const asked = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: `Rented out https://makaug.com/property/${RENTAL.id}`,
      session: { current_step: 'main_menu', session_data: {} }
    });
    assert.match(asked.message, /Taken\? Let me mark it/);
    assert.match(asked.message, /Reply \*1\* = Yes, mark it LET/);
    const answered = await route.settleOpenSoldQuestion({
      phone: AGENT_PHONE,
      body: 'Yes',
      session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: world.data().agent_sold } }
    });
    assert.match(answered.reply.message, /Marked as LET/);
    assert.match(answered.reply.message, /LET badge for 7 days/);
    assert.doesNotMatch(answered.reply.message, /SOLD/);
    assert.match(world.sold[0].sql, /availability_status = CASE WHEN LOWER\(COALESCE\(listing_type, ''\)\) ~ 'rent\|short\|student' THEN 'let_agreed' ELSE 'sold' END/);
    await settle();
    assert.ok(world.team.some((body) => /marked a listing LET on WhatsApp/.test(body)));
  }, { listings: [BUNGALOW, RENTAL] });
  const { soldWord } = require('../services/ownerListingCommandService');
  assert.strictEqual(soldWord({ listing_type: 'rent' }), 'LET');
  assert.strictEqual(soldWord({ listing_type: 'short_stay' }), 'LET');
  assert.strictEqual(soldWord({ listing_type: 'student' }), 'LET');
  assert.strictEqual(soldWord({ listing_type: 'sale' }), 'SOLD');
  assert.strictEqual(soldWord({ listing_type: 'land' }), 'SOLD');
  assert.strictEqual(soldWord({ listing_type: 'sale', availability_status: 'let_agreed' }), 'LET');
});

test('2 asks for the link once more at most, then leaves it', async () => {
  await withWorld(async (world) => {
    const pending = { single: true, asked_at: new Date().toISOString(), candidates: [{ id: BUNGALOW.id, title: BUNGALOW.title, listing_type: 'sale' }] };
    const no = await route.settleOpenSoldQuestion({ phone: AGENT_PHONE, body: '2', session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } } });
    assert.match(no.reply.message, /Send me the makaug link/);
    assert.strictEqual(world.step(), route.SOLD_LINK_STEP);
    const declined = world.data().agent_sold;
    const first = await route.handleSoldLinkReply({ phone: AGENT_PHONE, cleanBody: 'the other one', session: { current_step: route.SOLD_LINK_STEP, session_data: { agent_sold: declined } } });
    assert.match(first.message, /Send the makaug link of the property/);
    const second = await route.handleSoldLinkReply({ phone: AGENT_PHONE, cleanBody: 'the other one', session: { current_step: route.SOLD_LINK_STEP, session_data: { agent_sold: world.data().agent_sold } } });
    assert.match(second.message, /I will leave it/);
    assert.strictEqual(world.step(), 'main_menu');
    assert.strictEqual(world.sold.length, 0);
  });
});

test('the runtime settles an open SOLD question before anything else reads the reply', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const runtime = source.slice(source.indexOf('async function processInboundRuntimeUnlocked('));
  const settleAt = runtime.indexOf('await settleOpenSoldQuestion({');
  assert.ok(settleAt > 0, 'the runtime settles the question');
  for (const later of ['await handleOwnerListingCommand({', 'await handleOwnerFilmReply({', 'await handleAgentFilmReply({', 'await handleReplyPlaybook({', 'await handleEmployeeWhatsappIntake({']) {
    assert.ok(runtime.indexOf(later) > settleAt, `${later} comes after the SOLD question`);
  }
});

test('a landlord is asked for the rent, a seller for the asking price', () => {
  assert.match(route.listingPricePrompt('en', { listing_type: 'rent' }), /What is the rent per month in Uganda Shillings\? You can type 800000, 800k or 1\.2m\./);
  assert.match(route.listingPricePrompt('en', { listing_type: 'sale' }), /asking price/);
  assert.match(route.listingPricePrompt('en', { listing_type: 'land' }), /asking price/);
  // Other languages keep their own neutral question.
  assert.doesNotMatch(route.listingPricePrompt('lg', { listing_type: 'rent' }), /rent per month/);
  const next = route.fastListingProgressReply('en', { title: '3 bedroom house in Kira' }, { listing_type: 'rent', ownership: 'owner', title: '3 bedroom house in Kira', district: 'Wakiso', area: 'Kira' });
  if (next.nextStep === 'price') assert.match(next.message, /rent per month/);
});

test('on the site a rental that has gone wears a LET badge, a sale a SOLD badge', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  assert.match(app, /const isLet = String\(p\.availability_status \|\| p\.availabilityStatus \|\| ""\)\.toLowerCase\(\) === "let_agreed"\s+\|\| \/rent\|short\|student\/i\.test\(String\(p\.listing_type \|\| p\.type \|\| ""\)\);/);
  assert.match(app, /label: isLet \? "LET" : "SOLD"/);
});
