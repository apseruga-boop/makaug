'use strict';

/**
 * Small things found on 14 Nov 2026 while capturing the assistant's real
 * replies for the new films, each one a place where a lister was left unsure:
 *
 *  - an agent who replied CANCEL to "send me your photo ... Reply CANCEL to
 *    leave it" had their whole session closed and was told to "start again
 *    with Agent 007", the team's code word;
 *  - a private owner's "submitted" message was two messages stitched together,
 *    with a link that did not work yet;
 *  - an owner with one live listing who said SOLD was asked "Which one has
 *    gone? 1.";
 *  - "Should viewers contact you on 256786886372".
 */

const test = require('node:test');
const assert = require('node:assert');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';
const db = require('../config/database');
const whatsapp = require('../routes/whatsapp');
const route = whatsapp.__test;
const ownerListing = require('../services/ownerListingCommandService');
const moderation = require('../services/listingModerationService');

const AGENT_PHONE = '+256772000222';
const AGENT = { id: '5674f6cb-37a0-4e1e-904f-06e03ec401ab', full_name: 'Kimuli Brian', greeting_name: 'Brian', phone: AGENT_PHONE, whatsapp: AGENT_PHONE, status: 'approved', user_id: null };
const HOUSE = { id: 'a1a1a1a1-0000-4000-8000-000000000001', title: '3 Bedroom House In Kira', area: 'Kira', district: 'Wakiso', price: '350000000', price_period: null, listing_type: 'sale', bedrooms: 3, inquiry_reference: 'MK-20261114-AAA111', updated_at: '2026-11-14T08:00:00Z', extra_fields: {} };

function withWorld(run, { listings = [HOUSE], agent = AGENT } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const world = { sessions: [], patches: [] };
  whatsapp.forgetAgentPhone?.(AGENT_PHONE);
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SET session_data = session_data \|\|/i.test(text)) { world.patches.push(JSON.parse(params[0])); return { rows: [] }; }
    if (/UPDATE whatsapp_sessions\s+SET current_step = \$2,\s+listing_draft/i.test(text)) { world.sessions.push({ step: params[1], data: JSON.parse(params[2]) }); return { rows: [] }; }
    if (/FROM agents/i.test(text)) return { rows: agent ? [agent] : [] };
    if (/FROM properties p\s+WHERE (p\.agent_id = \$1::uuid|p\.agent_id IS NULL)/i.test(text)) return { rows: listings };
    if (/INSERT INTO outbound_message_queue/i.test(text)) return { rows: [{ id: 'q', status: 'pending' }] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  return Promise.resolve(run(world)).finally(() => {
    db.query = originalQuery;
    db.getClient = originalGetClient;
    whatsapp.forgetAgentPhone?.(AGENT_PHONE);
  });
}

const agentSession = (extra = {}) => ({
  current_step: 'employee_property_media',
  session_data: { whatsapp_employee_intake: true, whatsapp_agent_self_intake: true, employee_role: 'agent', agent: AGENT, agent_phone: AGENT_PHONE, property_batch_mode: 'multiple', property_ids: [], ...extra }
});

test('an agent who changes their mind about the photo keeps their session, and is not sent to Agent 007', async () => {
  await withWorld(async (world) => {
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: AGENT_PHONE,
      body: 'cancel',
      session: agentSession({ awaiting_profile_photo: true, awaiting_profile_photo_at: new Date().toISOString(), property_ids: ['p1', 'p2'] })
    });
    assert.match(reply.message, /No problem — send \*my photo\* any time/);
    assert.match(reply.message, /You can keep sending properties here/);
    assert.doesNotMatch(reply.message, /Agent 007|Batch closed/);
    assert.strictEqual(reply.nextStep, 'employee_property_media');
    const saved = world.sessions[world.sessions.length - 1];
    assert.strictEqual(saved.step, 'employee_property_media', 'the posting session stays open');
    assert.strictEqual(saved.data.awaiting_profile_photo, undefined);
    assert.deepStrictEqual(saved.data.property_ids, ['p1', 'p2']);
  });
});

test('an agent closing their own session is spoken to as an agent', async () => {
  await withWorld(async () => {
    const two = await route.handleEmployeeWhatsappIntake({ phone: AGENT_PHONE, body: 'CANCEL', session: agentSession({ property_ids: ['p1', 'p2'] }) });
    assert.match(two.message, /^Okay, closed\. The 2 properties you sent are with our team for review, and I will send you the link when each one is live\./);
    assert.match(two.message, /Send the next property any time: photos and a caption\./);
    assert.doesNotMatch(two.message, /Agent 007|Batch closed|moderator/);
    const one = await route.handleEmployeeWhatsappIntake({ phone: AGENT_PHONE, body: 'CANCEL', session: agentSession({ property_ids: ['p1'] }) });
    assert.match(one.message, /The property you sent is with our team for review, and I will send you the link when it is live\./);
    const none = await route.handleEmployeeWhatsappIntake({ phone: AGENT_PHONE, body: 'CANCEL', session: agentSession() });
    assert.match(none.message, /^Okay, closed\. Nothing was sent for review\./);
    assert.doesNotMatch(none.message, /Agent 007/);
  });
});

test('staff closing a batch still hear about the batch and Agent 007', async () => {
  await withWorld(async () => {
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: '+447757773202',
      body: 'CANCEL',
      session: { current_step: 'employee_property_media', session_data: { whatsapp_employee_intake: true, employee_role: 'agent', agent: AGENT, property_batch_mode: 'multiple', property_ids: ['p1'] } }
    });
    assert.match(reply.message, /Batch closed\. 1 property stays in staff review/);
    assert.match(reply.message, /Start again any time with \*Agent 007\*/);
  });
});

test('one live listing and the word SOLD: they are asked about that one, not given a list of one', async () => {
  await withWorld(async (world) => {
    const reply = await route.handleEmployeeWhatsappIntake({ phone: '+256786000333', body: 'SOLD', session: { current_step: 'main_menu', session_data: {} } });
    assert.match(reply.message, /Sold\? Let me mark it/);
    assert.match(reply.message, /3 Bedroom House In Kira/);
    assert.match(reply.message, /Reply \*1\* = Yes, mark it SOLD/);
    assert.doesNotMatch(reply.message, /Which one has gone/);
    assert.strictEqual(Object.assign({}, ...world.patches).agent_sold.single, true);
  }, { agent: null });
});

test("the owner's number is written the way people write it", () => {
  assert.match(route.whatsappContactConfirmationPrompt('en', '256786886372'), /Should viewers contact you on \*\+256 786 886 372\*, the WhatsApp number you are using now\? Reply \*YES\* or \*NO\*\./);
  assert.match(route.whatsappContactConfirmationPrompt('lg', '256786886372'), /\+256 786 886 372/);
  assert.match(route.whatsappContactConfirmationPrompt('en', ''), /this WhatsApp number/);
});

test('"sent for review" says what was sent and the three things that happen next', () => {
  const message = ownerListing.submittedMessage({ name: 'Sarah Nakato', title: '3 Bedroom House In Kira', location: 'Kira, Wakiso', price: 'USh 350M', reference: 'MK-20261114-F905DF', monthlyFee: 'UGX 20,000' });
  assert.match(message, /^🎉 \*Sent for review, Sarah\.\*/);
  assert.match(message, /🏠 \*3 Bedroom House In Kira\*\n📍 Kira, Wakiso · 💰 USh 350M\nReference: MK-20261114-F905DF/);
  assert.match(message, /1️⃣ Our team checks it, usually within 24 hours\./);
  assert.match(message, /2️⃣ I send you the link the moment it is live\./);
  assert.match(message, /3️⃣ With the link comes how to pay: \*UGX 20,000 a month\* keeps it live\. Nothing is charged automatically\./);
  assert.match(message, /Buyers and tenants then call or WhatsApp you directly\. makaug takes no commission\./);
  assert.match(message, /Reply \*STATUS\* to check on it, or \*REMOVE\* to take it off, any time\.$/);
  // Nothing that is not true yet, and no free days.
  assert.doesNotMatch(message, /makaug\.com\/property|set up your profile|free/i);
  assert.ok(message.length < 620, `${message.length} characters`);
  assert.doesNotMatch(ownerListing.submittedMessage({ monthlyFee: 'UGX 20,000' }), /undefined|\n\n\n/);
});

test('the "your listing is live" message tells an owner about SOLD and STATUS as well as REMOVE', () => {
  const listing = { id: '4f4f4f4f-0000-4000-8000-000000000004', title: '3 Bedroom House In Kira', area: 'Kira', district: 'Wakiso', price: 350000000, inquiry_reference: 'MK-20261114-F905DF', agent_id: null, lister_name: 'Sarah N' };
  const text = moderation.buildOwnerStatusMessage({ listing, status: 'approved' }).whatsapp;
  assert.match(text, /reply REMOVE MK-20261114-F905DF/);
  assert.match(text, /Sold or let it\? Reply SOLD\. To check on it, reply STATUS\.$/);
});
