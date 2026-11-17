'use strict';

/**
 * A new agent who has never written to the makaug number (17 Nov 2026).
 *
 * Since 16 Nov the number writes to nobody who has not written to it first,
 * so a new agent's welcome, film, payment link and "your property is live"
 * messages wait in the queue until they send it something. On 17 Nov a new
 * agent was approved at 16:40 and the owner and the employee who signed him
 * up were told "is approved and the payment link has gone to them", while all
 * five of his messages sat waiting.
 *
 * Now staff are told the truth, with a link to send the agent ("Hi makaug"
 * typed, one tap to send), and told again when the welcome has gone.
 *
 * Every name and number here is made up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';
process.env.AI_CEO_OWNER_PHONES = '256700555099';
delete process.env.MAKAUG_WHATSAPP_NUMBER;
delete process.env.WHATSAPP_BUSINESS_NUMBER;

// The bridge's queue, before anything that sends is loaded.
const bridge = require('../services/whatsappWebBridgeService');
const queued = [];
bridge.queueWhatsappWebBridgeMessage = async (message) => {
  queued.push(message);
  return { id: `q-${queued.length}` };
};

const db = require('../config/database');
const payLinks = require('../services/payLinkService');
const welcome = require('../services/agentWelcomeService');
const filmLinks = require('../services/filmLinkService');
const admin = require('../routes/admin');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const HELLO = 'https://wa.me/256780863394?text=Hi%20makaug';
const AGENT_ID = '22222222-3333-4444-8555-666666666666';
const AGENT = { id: AGENT_ID, makaug_agent_number: 'MKA-AG-0077', full_name: 'Test Agent', phone: '+256701000137', whatsapp: '+256701000137', status: 'approved', fee_exempt: false, paid_until: null, registered_by_phone: '+256700555077' };
const MIDDAY = new Date('2026-11-17T13:40:00Z'); // 16:40 in Kampala

/** One agent; the database and pay links answered here; the rule and their history as given. */
async function withAgent({ rule = true, wrote = false } = {}, run) {
  const row = { ...AGENT };
  const original = {
    query: db.query,
    create: payLinks.createPayLink,
    page: payLinks.pageData,
    only: bridge.onlyToPeopleWhoWrote,
    wrote: bridge.hasWrittenToUs
  };
  const asked = [];
  db.query = async (sql) => {
    if (/FROM agents WHERE id = \$1/i.test(sql)) return { rows: [row] };
    return { rows: [] };
  };
  payLinks.createPayLink = async () => ({ url: 'https://makaug.com/pay/MKTEST01', link: { code: 'MKTEST01' } });
  payLinks.pageData = async () => ({ card_available: false });
  bridge.onlyToPeopleWhoWrote = () => rule;
  bridge.hasWrittenToUs = async (phone) => { asked.push(phone); return wrote; };
  queued.length = 0;
  try {
    return await run({ row, asked });
  } finally {
    db.query = original.query;
    payLinks.createPayLink = original.create;
    payLinks.pageData = original.page;
    bridge.onlyToPeopleWhoWrote = original.only;
    bridge.hasWrittenToUs = original.wrote;
  }
}

const digits = (value) => String(value || '').replace(/\D/g, '');
const toAgent = () => queued.filter((message) => digits(message.recipient) === '256701000137');
const toStaff = () => queued.filter((message) => ['256700555099', '256700555077'].includes(digits(message.recipient)));

test('the link: a chat with the makaug number, "Hi makaug" already typed', () => {
  assert.strictEqual(filmLinks.helloLink(), HELLO);
  assert.strictEqual(filmLinks.helloLink({ env: { MAKAUG_WHATSAPP_NUMBER: '+256 700 000 111' } }), 'https://wa.me/256700000111?text=Hi%20makaug');
});

test('an agent who has never written: staff are told it waits, given the link, and not told it went', async () => {
  await withAgent({ rule: true, wrote: false }, async ({ row, asked }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    assert.deepStrictEqual(asked.map(digits), ['256701000137'], 'their own history is asked about, once');

    // The welcome is still queued in full: it goes the moment they write.
    assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film', 'welcome_plan']);
    const plan = toAgent()[2];
    assert.strictEqual(plan.metadata.held_for_first_message, true);
    assert.strictEqual(plan.metadata.agent_name, 'Test Agent');
    assert.deepStrictEqual([...plan.metadata.tell_when_sent].sort(), ['256700555077', '256700555099']);

    const notes = toStaff();
    assert.strictEqual(notes.length, 2, 'the employee who signed them up, and the owner');
    for (const note of notes) {
      assert.match(note.text, /^💳 \*Test Agent is approved\*, but nothing has reached them yet\./);
      assert.match(note.text, /They have never written to the makaug WhatsApp number, and it only writes to people who have written to it first\./);
      assert.match(note.text, /Their welcome, the payment link and any "your property is live" messages are waiting, and go the moment they send it a message\./);
      assert.ok(note.text.includes(`Send them this to tap and send:\n${HELLO}`));
      assert.match(note.text, /Amount: UGX 50,000 a month\nNumber: 256701000137\nPaid: not yet/);
      assert.match(note.text, /I will tell you when their messages go, and when the payment lands\.$/);
      assert.doesNotMatch(note.text, /has gone to them/);
    }

    assert.strictEqual(result.waiting_for_first_message, true);
    assert.strictEqual(result.hello_link, HELLO);
    assert.strictEqual(result.fee_link.waiting_for_first_message, true);
    // And what the employee who approved them on WhatsApp reads.
    const line = welcome.welcomeSentLine(result);
    assert.match(line, /^Nothing has reached them yet: they have never written to the makaug WhatsApp number/);
    assert.ok(line.endsWith(HELLO));
    assert.doesNotMatch(line, /have gone to them/);
  });
});

test('an agent who has written to us before: unchanged, it went and they are told so', async () => {
  await withAgent({ rule: true, wrote: true }, async ({ row }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    assert.strictEqual(toAgent()[2].metadata.held_for_first_message, undefined);
    assert.match(toStaff()[0].text, /^💳 \*Test Agent is approved and the payment link has gone to them\.\*/);
    assert.match(toStaff()[0].text, /I will tell you when the payment lands\.$/);
    assert.strictEqual(result.waiting_for_first_message, undefined);
    assert.strictEqual(welcome.welcomeSentLine(result), 'Their welcome and the how-to-post video have gone to them on WhatsApp.');
  });
});

test('with the rule off nobody is asked about, and nothing waits', async () => {
  await withAgent({ rule: false, wrote: false }, async ({ row, asked }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    assert.strictEqual(asked.length, 0);
    assert.match(toStaff()[0].text, /has gone to them/);
    assert.strictEqual(result.waiting_for_first_message, undefined);
  });
});

test('the payment link on its own, to an agent who never wrote, says only the payment link waits', async () => {
  await withAgent({ rule: true, wrote: false }, async ({ row }) => {
    const sent = await admin._test.sendAgentFeeLinkOnApproval({ agent: row, actor: 'test', force: true });
    assert.strictEqual(sent.waiting_for_first_message, true);
    assert.match(toStaff()[0].text, /Their payment link is waiting, and goes the moment they send it a message\./);
  });
});

test('when the waiting welcome goes, the staff who were told it was waiting hear that it went', async () => {
  const sentNotes = [];
  const queue = async (message) => { sentNotes.push(message); return { id: 'n' }; };
  const row = {
    id: 'row-1',
    user_phone: '256701000137',
    metadata: {
      message_kind: 'agent_fee_link_on_approval',
      held_for_first_message: true,
      agent_name: 'Test Agent',
      agent_id: AGENT_ID,
      tell_when_sent: ['256700555099', '+256 700 555099', '256700555077', '256701000137']
    }
  };
  assert.strictEqual(await welcome.tellTeamHeldWelcomeWent(row, { queue }), 2, 'each once, and never the agent');
  assert.deepStrictEqual(sentNotes.map((note) => note.recipient), ['256700555099', '256700555077']);
  assert.strictEqual(sentNotes[0].text, '✅ *Test Agent has their welcome and payment link now.* They wrote to the makaug number, so what was waiting for them is going out.');
  assert.strictEqual(sentNotes[0].metadata.message_kind, 'agent_welcome_went_notice');
  assert.strictEqual(sentNotes[0].metadata.reply_dedupe_key, `agent_welcome_went:${AGENT_ID}:256700555099`);

  // Anything else that goes is not that.
  for (const other of [
    { ...row, metadata: { ...row.metadata, held_for_first_message: false } },
    { ...row, metadata: { ...row.metadata, message_kind: 'agent_welcome' } },
    { id: 'x', metadata: {} },
    {}
  ]) {
    assert.strictEqual(await welcome.tellTeamHeldWelcomeWent(other, { queue }), 0);
  }
  assert.strictEqual(sentNotes.length, 2);
});

test('the agent taps the link: "Hi makaug" is a greeting, answered with their welcome, not the menu', () => {
  const route = require('../routes/whatsapp').__test;
  for (const said of ['Hi makaug', 'hi makaug.com', 'Hello makaug 👋', 'Hi', 'good morning']) {
    assert.ok(route.AGENT_GREETING.test(said), said);
  }
  for (const said of ['hi makaug I want a house in Kira', 'makaug', 'hi makaugs']) {
    assert.ok(!route.AGENT_GREETING.test(said), said);
  }
  const agent = { full_name: 'Test Agent' };
  assert.strictEqual(
    route.agentWelcomeArrivingReply(agent, { now: new Date('2026-11-17T14:00:00Z') }),
    '👋 Hello Test, and welcome to makaug! Your welcome is in the messages here: your agent ID and page, a one-minute video on how to post, and how to pay.'
  );
  assert.match(route.agentWelcomeArrivingReply(agent, { now: new Date('2026-11-17T20:30:00Z') }), /It is night in Kampala, so your welcome comes at 7 in the morning:/);

  const source = read('routes/whatsapp.js');
  const branch = source.slice(source.indexOf('if (AGENT_GREETING.test(askedText) && await agentWelcomeIsWaiting(phone))'));
  assert.ok(branch.indexOf('agentWelcomeArrivingReply(askingAgent)') < branch.indexOf('agentMenuReply({ agent: askingAgent, greet: true })'), 'before the menu');
  const waiting = source.slice(source.indexOf('async function agentWelcomeIsWaiting'), source.indexOf('function agentWelcomeArrivingReply'));
  assert.match(waiting, /status IN \('pending', 'retry'\)/);
  assert.match(waiting, /metadata->>'message_kind' = 'agent_welcome'/);
});

test('wired in: told when it goes, and King says it waits instead of "sent"', () => {
  const route = read('routes/whatsapp.js');
  const sent = route.slice(route.indexOf("router.post('/web-bridge/outbox/:id/sent'"), route.indexOf("router.post('/web-bridge/outbox/:id/failed'"));
  assert.ok(sent.indexOf('tellTeamHeldWelcomeWent(updated)') > sent.indexOf('markWhatsappWebBridgeMessageSent('), 'after it is marked sent');
  assert.ok(sent.indexOf('tellTeamHeldWelcomeWent(updated)') > sent.indexOf('if (duplicateSuppressed)'), 'and never for a duplicate');

  const app = read('assets/makaug-app.js');
  assert.match(app, /function adminWelcomeWaitsNote\(/);
  assert.strictEqual((app.match(/adminWelcomeWaitsNote\(/g) || []).length, 4, 'defined once, used by the three approval toasts');
  assert.match(app, /res\?\.data\?\.waiting_for_first_message \? adminWelcomeWaitsNote/);
});
