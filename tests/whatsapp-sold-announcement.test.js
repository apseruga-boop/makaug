'use strict';

/**
 * "SOLD SOLD!!!! Kira Kitukutwe 330 million" — Francis Isabirye, 1 Nov 2026,
 * 13:31, with the photo of the house. Intake took it for a new property and
 * asked him for a caption. It is one of his live listings going, told the way
 * agents tell everyone. Find it, confirm with 1, mark it sold; it stays up with
 * a SOLD badge for 7 days.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const FRANCIS = '+256768524008';
const FRANCIS_AGENT = { id: '5674f6cb-37a0-4e1e-904f-06e03ec401ab', full_name: 'Francis Isabirye', greeting_name: 'Francis', phone: FRANCIS, whatsapp: FRANCIS, status: 'approved', user_id: null };

const LISTINGS = [
  { id: 'a1a1a1a1-0000-4000-8000-000000000001', title: '4-bed house for sale in Kira Kitukutwe', area: 'Kitukutwe', district: 'Wakiso', price: '330000000', price_period: null, listing_type: 'sale', bedrooms: 4, inquiry_reference: 'MK-20261020-AAA111', updated_at: '2026-10-20T10:00:00Z', extra_fields: { city: 'Kira' }, primary_image_url: '' },
  { id: 'b2b2b2b2-0000-4000-8000-000000000002', title: '2-bed apartment for rent in Ntinda', area: 'Ntinda', district: 'Kampala', price: '1200000', price_period: 'mo', listing_type: 'rent', bedrooms: 2, inquiry_reference: 'MK-20261022-BBB222', updated_at: '2026-10-22T10:00:00Z', extra_fields: {}, primary_image_url: '' },
  { id: 'c3c3c3c3-0000-4000-8000-000000000003', title: 'Plot for sale in Kira', area: 'Kira', district: 'Wakiso', price: '95000000', price_period: null, listing_type: 'land', bedrooms: null, inquiry_reference: 'MK-20261024-CCC333', updated_at: '2026-10-24T10:00:00Z', extra_fields: {}, primary_image_url: '' }
];

test('the words that mean "gone", and the words that do not', () => {
  for (const q of ['SOLD SOLD!!!! Kira Kitukutwe 330 million', 'Sold', 'sold out', 'This one is gone', 'Rented out already', 'no longer available', 'Imeuzwa', 'etundiddwa', 'SOLD at 330m']) {
    assert.strictEqual(route.isSoldAnnouncement(q), true, q);
  }
  for (const q of ['4 bedroom house for sale in Kira 330m', 'not yet sold, still available', 'Selling 5 bedroom house in Kololo @600m UGX', 'How do I mark as sold?', 'Hello', 'The plot is being sold by the owner at 95m']) {
    assert.strictEqual(route.isSoldAnnouncement(q), false, q);
  }
});

test('the words pick the right listing: area and price', () => {
  const scored = LISTINGS.map((row) => ({ id: row.id.slice(0, 2), score: route.soldTextScore(row, route.employeePropertyFacts('Kira Kitukutwe 330 million', {})) }));
  assert.strictEqual(scored[0].score, 7, JSON.stringify(scored));
  assert.ok(scored[1].score <= 1 && scored[2].score <= 3, JSON.stringify(scored));
});

function withFakeDb(run, { listings = LISTINGS, agent = FRANCIS_AGENT } = {}) {
  const originalQuery = db.query;
  const updates = [];
  const patches = [];
  const events = [];
  db.query = async (sql, params = []) => {
    if (/SET session_data = session_data \|\|/i.test(sql)) { patches.push(JSON.parse(params[0])); return { rows: [] }; }
    if (/FROM agents/i.test(sql)) return { rows: agent ? [agent] : [] };
    if (/FROM properties p\s+WHERE p\.agent_id = \$1::uuid/i.test(sql)) return { rows: listings };
    if (/UPDATE properties\s+SET status = 'sold'/i.test(sql)) {
      updates.push(params);
      const row = listings.find((item) => item.id === params[0]);
      return { rows: row ? [{ ...row, status: 'sold' }] : [] };
    }
    if (/INSERT INTO property_moderation_events/i.test(sql)) { events.push(params); return { rows: [] }; }
    if (/INSERT INTO outbound_message_queue|INSERT INTO notifications|FROM notifications/i.test(sql)) return { rows: [{ id: 'q' }] };
    return { rows: [] };
  };
  const sessionData = () => Object.assign({}, ...patches);
  return Promise.resolve(run({ updates, patches, events, sessionData }))
    .finally(() => { db.query = originalQuery; });
}

test("Francis's message: his Kitukutwe house is found and he is asked to confirm with 1", async () => {
  await withFakeDb(async ({ patches }) => {
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: FRANCIS,
      body: 'SOLD SOLD!!!! Kira Kitukutwe 330 million',
      mediaUrl: '',
      session: { current_step: 'main_menu', session_data: {} }
    });
    assert.strictEqual(reply.handled, true);
    assert.strictEqual(reply.nextStep, route.SOLD_CONFIRM_STEP);
    assert.match(reply.message, /Sold\? Let me mark it/);
    assert.match(reply.message, /4-bed house for sale in Kira Kitukutwe/);
    assert.match(reply.message, /Reply \*1\* = Yes, mark it SOLD/);
    assert.doesNotMatch(reply.message, /send the caption/i, 'this is not a new property');
    const pending = patches.find((p) => p.agent_sold)?.agent_sold;
    assert.ok(pending && pending.single && pending.candidates[0].id === LISTINGS[0].id, JSON.stringify(pending));
  });
});

test('1 marks it sold, says it stays up for 7 days, and tells the team', async () => {
  await withFakeDb(async ({ updates, events, patches }) => {
    const pending = { single: true, announcement: 'SOLD Kira Kitukutwe 330m', asked_at: new Date().toISOString(), candidates: [{ id: LISTINGS[0].id, title: LISTINGS[0].title, area: 'Kitukutwe', district: 'Wakiso', price: 330000000 }] };
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: FRANCIS,
      body: '1',
      session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } }
    });
    assert.strictEqual(reply.nextStep, 'main_menu');
    assert.match(reply.message, /Marked as SOLD/);
    assert.match(reply.message, /7 days/);
    assert.match(reply.message, /Congratulations, Francis/);
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0][0], LISTINGS[0].id);
    assert.strictEqual(events.length, 1, 'a moderation event records who marked it');
    assert.ok(patches.some((p) => p.agent_sold === null), 'the open question is cleared');
  });
});

test('2 asks for the link; a link of theirs is matched and confirmed', async () => {
  await withFakeDb(async () => {
    const pending = { single: true, candidates: [{ id: LISTINGS[0].id, title: LISTINGS[0].title }] };
    const no = await route.handleEmployeeWhatsappIntake({ phone: FRANCIS, body: '2', session: { current_step: route.SOLD_CONFIRM_STEP, session_data: { agent_sold: pending } } });
    assert.strictEqual(no.nextStep, route.SOLD_LINK_STEP);
    assert.match(no.message, /Send me the makaug link/);
    const link = await route.handleEmployeeWhatsappIntake({ phone: FRANCIS, body: `https://makaug.com/property/${LISTINGS[1].id}`, session: { current_step: route.SOLD_LINK_STEP, session_data: { agent_sold: pending } } });
    assert.strictEqual(link.nextStep, route.SOLD_CONFIRM_STEP);
    assert.match(link.message, /2-bed apartment for rent in Ntinda/);
    const ref = await route.handleEmployeeWhatsappIntake({ phone: FRANCIS, body: 'MK-20261024-CCC333', session: { current_step: route.SOLD_LINK_STEP, session_data: { agent_sold: pending } } });
    assert.match(ref.message, /Plot for sale in Kira/);
  });
});

test('when the words fit more than one listing, he is shown a numbered choice', async () => {
  await withFakeDb(async () => {
    const reply = await route.handleEmployeeWhatsappIntake({ phone: FRANCIS, body: 'Sold! Kira', session: { current_step: 'main_menu', session_data: {} } });
    assert.strictEqual(reply.nextStep, route.SOLD_CONFIRM_STEP);
    assert.match(reply.message, /Which one has gone/);
    assert.match(reply.message, /1\. \*/);
    assert.match(reply.message, /\*0\* = None of these/);
  });
});

test('a stranger saying sold is not ours to answer; an agent with nothing live is told so', async () => {
  await withFakeDb(async () => {
    const stranger = await route.handleEmployeeWhatsappIntake({ phone: '+256700111222', body: 'sold', session: { current_step: 'main_menu', session_data: {} } });
    assert.strictEqual(stranger.handled, false);
  }, { agent: null, listings: [] });
  await withFakeDb(async () => {
    const empty = await route.handleEmployeeWhatsappIntake({ phone: FRANCIS, body: 'SOLD Kitukutwe 330m', session: { current_step: 'main_menu', session_data: {} } });
    assert.strictEqual(empty.handled, true);
    assert.match(empty.message, /cannot see a live listing/);
  }, { listings: [] });
});

test('staff mid-batch for somebody else are left alone; an agent mid-batch is not', () => {
  assert.strictEqual(route.soldAnnouncementAppliesTo({ session_data: { employee_role: 'staff', whatsapp_employee_intake: true } }, true), false);
  assert.strictEqual(route.soldAnnouncementAppliesTo({ session_data: { whatsapp_agent_self_intake: true } }, true), true);
  assert.strictEqual(route.soldAnnouncementAppliesTo({ session_data: {} }, false), true);
});

test('the public inventory keeps a sold listing for 7 days, then drops it', () => {
  const { publicLivePropertyStatusSql, SOLD_PUBLIC_WINDOW_DAYS } = require('../utils/publicInventoryStatus');
  const sql = publicLivePropertyStatusSql('p');
  assert.strictEqual(SOLD_PUBLIC_WINDOW_DAYS, 7);
  assert.match(sql, /= 'sold' AND p\.sold_at >= NOW\(\) - INTERVAL '7 days'/);
  assert.match(sql, /IN \('approved', 'live', 'published'\)/);
});

test('the broker dashboard can mark a listing sold, and "Sold" as a removal reason does the same', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const agents = fs.readFileSync(path.join(__dirname, '../routes/agents.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const ep = agents.slice(agents.indexOf("router.post('/me/listings/:id/mark-sold'"), agents.indexOf("router.get('/:id/listings'"));
  assert.match(ep, /SET status = 'sold'/);
  assert.match(ep, /sold_at = NOW\(\)/);
  assert.match(ep, /INTERVAL '7 days'/);
  assert.match(ep, /broker_listing_marked_sold/);
  assert.match(app, /requestBrokerListingSold\(/);
  assert.match(app, /\/mark-sold`, \{ method: "POST", body: \{ note: reason \} \}/);
});
