'use strict';

/**
 * 27 Nov 2026, Arthur: an agent who has been removed and messages us first is
 * welcomed back kindly ("you were removed as a member, but we'd love to have
 * you back"; never "unfortunately") and given two options: 1, continue as a
 * customer looking for a property, or 2, rejoin as an agent. Rejoining: they
 * are told Ronald will call, they get the payment link, and Arthur and Ronald
 * are told to call them urgently. Once they pay they are back by themselves,
 * everything they sent is pulled through so nothing is missed, and they are
 * told as their properties go live. Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const billing = require('../services/billingOpsService');
const goodbye = require('../services/agentGoodbyeService');
const desk = require('../services/leadDeskService');
const whatsapp = require('../routes/whatsapp');
const route = whatsapp.__test;

const PHONE = '256700000171';
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

function agentWith(snapshot = {}, extra = {}) {
  return {
    id: '0a0a0a0a-0000-4000-8000-000000000171',
    full_name: 'Testa Agent',
    greeting_name: 'Testa',
    phone: `+${PHONE}`,
    whatsapp: `+${PHONE}`,
    status: 'suspended',
    makaug_agent_number: 'MKA-AG-0000171',
    removed_at: '2026-11-23T14:11:00Z',
    removed_reason: 'Has not paid yet',
    removal_snapshot: { reason_code: 'not_paying', ...snapshot },
    ...extra
  };
}

async function withAgent(agent, run) {
  const saved = { query: db.query, send: billing.sendRejoinMessage, team: desk.sendToTeam };
  const writes = [];
  const notes = [];
  const team = [];
  db.query = async (sql, params = []) => {
    const s = String(sql);
    if (/FROM agents\s+WHERE RIGHT\(REGEXP_REPLACE\(COALESCE\(whatsapp/i.test(s)) return { rows: [agent] };
    if (/UPDATE agents SET removal_snapshot/i.test(s)) {
      const patch = JSON.parse(params[1]);
      writes.push(patch);
      Object.assign(agent.removal_snapshot, patch);
    }
    return { rows: [] };
  };
  billing.sendRejoinMessage = async (_db, args) => { notes.push(args); agent.removal_snapshot.rejoin_sent_at = new Date().toISOString(); return { status: 'queued' }; };
  desk.sendToTeam = async (_db, body, kind) => { team.push({ body, kind }); return []; };
  route.formerAgentAckedAt.clear();
  try {
    return await run({ writes, notes, team });
  } finally {
    db.query = saved.query;
    billing.sendRejoinMessage = saved.send;
    desk.sendToTeam = saved.team;
    for (const [key, entry] of route.formerAgentWords) { clearTimeout(entry.timer); route.formerAgentWords.delete(key); }
  }
}

test('their first message: welcome back, kindly, and the two options', async () => {
  const agent = agentWith();
  await withAgent(agent, async ({ writes, notes, team }) => {
    const reply = await route.removedAgentReply({ phone: PHONE, body: 'Hello', hasMedia: false });
    assert.strictEqual(reply.message, [
      'Hi Testa, welcome back 👋',
      '',
      'You were removed as a makaug agent on 23 Nov, but we\'d love to have you back.',
      '',
      'What would you like to do? Reply with the number:',
      '1️⃣ Look for a property',
      '2️⃣ Rejoin as an agent'
    ].join('\n'));
    assert.ok(!/unfortunately/i.test(reply.message));
    assert.ok(writes.some((patch) => patch.welcome_back_at), 'remembered');
    assert.strictEqual(notes.length, 0, 'no payment link before they choose');
    assert.ok(team.some((t) => t.kind === 'former_agent_wrote' && /welcomed back and asked/.test(t.body)));
  });
  const left = route.formerAgentWelcomeBack(agentWith({ reason_code: 'cancelled' }), { left: true });
  assert.match(left, /^Hi Testa, welcome back 👋\n\nYou left makaug as an agent on 23 Nov, but we'd love to have you back\./);
});

test('2: Ronald will call, the payment link goes, and Arthur and Ronald are told to call urgently', async () => {
  const agent = agentWith({ welcome_back_at: hoursAgo(1) });
  await withAgent(agent, async ({ writes, notes, team }) => {
    const reply = await route.removedAgentReply({ phone: PHONE, body: '2', hasMedia: false });
    assert.deepStrictEqual(reply, { message: '', silent: true }, 'the note with the link is the answer');
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0].callBack, true);
    assert.ok(writes.some((patch) => patch.former_agent_choice === 'rejoin'));
    const call = team.find((t) => t.kind === 'former_agent_rejoin_request');
    assert.ok(call, 'the team is asked to call');
    assert.strictEqual(call.body, [
      '📞 *Testa Agent wants to rejoin as an agent* · number ending 171',
      'Removed 23 Nov: Has not paid yet.',
      'They have the payment link and have been told Ronald will call. Please call them urgently (agent MKA-AG-0000171 in King).',
      'When they pay they come back by themselves, and everything they sent while away goes to staff review.'
    ].join('\n'));
    assert.ok(!call.body.includes('700000171'), 'only the last three digits');
  });
  const note = billing.rejoinMessage({ agent: { full_name: 'Testa Agent' }, fee: 50000, payLink: 'https://makaug.com/pay/MKTEST02', howToPay: 'HOW', callBack: 'Ronald' });
  assert.strictEqual(note, [
    'Great, Testa 🙌 Ronald from our team will give you a call shortly.',
    '',
    'To rejoin, pay UGX 50,000 here: https://makaug.com/pay/MKTEST02',
    'HOW',
    '',
    "As soon as it's in, you're back on makaug: your profile and earlier listings go straight back up, and everything you've sent us while you were away goes to our team for review. I'll let you know as each one goes live.",
    '',
    'Any questions, just reply here.',
    '',
    'Phillip, MakaUG'
  ].join('\n'));
});

test('1: they look for a property as anybody would, and REJOIN still brings them back', async () => {
  const agent = agentWith({ welcome_back_at: hoursAgo(1) });
  await withAgent(agent, async ({ notes, team }) => {
    const reply = await route.removedAgentReply({ phone: PHONE, body: '1', hasMedia: false });
    assert.strictEqual(reply.message, 'Of course, Testa 🙂 What are you looking for? Tell me in one message, e.g. _3 bedroom house to rent in Kira under 1.5m_.\n\nIf you would like to rejoin as an agent later, just reply *REJOIN*.');
    assert.strictEqual(agent.removal_snapshot.former_agent_choice, 'customer');
    // Now a customer: the usual conversation.
    assert.strictEqual(await route.removedAgentReply({ phone: PHONE, body: '2 bedroom house in Kira under 1m', hasMedia: false }), null);
    assert.strictEqual(await route.removedAgentReply({ phone: PHONE, body: '2', hasMedia: false }), null, 'a menu number is the menu\'s');
    assert.strictEqual(notes.length, 0);
    // And back to rejoining whenever they say so.
    const back = await route.removedAgentReply({ phone: PHONE, body: 'REJOIN', hasMedia: false });
    assert.deepStrictEqual(back, { message: '', silent: true });
    assert.strictEqual(notes.length, 1);
    assert.ok(team.some((t) => t.kind === 'former_agent_rejoin_request'));
  });
});

test('a hello while the question waits: the options again, not every time', async () => {
  const agent = agentWith({ welcome_back_at: hoursAgo(2) });
  await withAgent(agent, async () => {
    const first = await route.removedAgentReply({ phone: PHONE, body: 'Hello', hasMedia: false });
    assert.strictEqual(first.message, 'Hi Testa 👋 Reply *1* to look for a property, or *2* to rejoin as an agent.');
    const again = await route.removedAgentReply({ phone: PHONE, body: 'Hi', hasMedia: false });
    assert.deepStrictEqual(again, { message: '', silent: true });
    // A real question is for a person.
    const asked = await route.removedAgentReply({ phone: PHONE, body: 'Can I pay half this month?', hasMedia: false });
    assert.match(asked.message, /^Thank you, Testa 🙏 I've passed your message to our team/);
  });
});

test('their choices are read as people write them', () => {
  for (const said of ['2', '2️⃣', 'Two', 'rejoin', 'Rejoin as an agent', 'I want to rejoin', 'resign', 're-sign', 'join again']) {
    assert.strictEqual(route.formerAgentChoice(said, { asked: true }), 'rejoin', said);
  }
  for (const said of ['1', '1️⃣', 'one', 'Look for a property', 'looking for a house', 'customer']) {
    assert.strictEqual(route.formerAgentChoice(said, { asked: true }), 'customer', said);
  }
  assert.strictEqual(route.formerAgentChoice('2', { asked: false }), '', 'a number only answers the question');
  assert.strictEqual(route.formerAgentChoice('I would like to rejoin please', { asked: false }), 'rejoin', 'rejoining is understood any time');
  assert.strictEqual(route.formerAgentChoice('Hello', { asked: true }), '');
  assert.strictEqual(route.formerAgentChoice('How much is it to rejoin?', { asked: false }), 'rejoin', 'answered by the way back: the price, the link and the call');
  assert.strictEqual(route.formerAgentChoice("I don't want to rejoin", { asked: false }), '', 'not a yes');
});

test('when they come back nothing is missed: what could not be saved by itself is named for the team', async () => {
  const saved = { groups: whatsapp.groupForwardedAdverts, importOne: whatsapp.importForwardedAdvert };
  whatsapp.groupForwardedAdverts = async () => ({
    groups: [
      { caption: 'House for sale in Testville at 58m', caption_message_id: 'c1', media: [] },
      { caption: 'Plot for sale near the trading centre 15m', caption_message_id: 'c2', media: [] },
      { caption: 'Plot for sale in Testville at 55m', caption_message_id: 'c3', media: [] }
    ],
    orphans: [{ message_id: 'm9' }, { message_id: 'm10' }]
  });
  whatsapp.importForwardedAdvert = async ({ group }) => {
    if (group.caption_message_id === 'c2') return { skipped: 'missing', missing: ['exact area and district'] };
    if (group.caption_message_id === 'c3') throw new Error('media gone');
    return { property_id: 'p-1' };
  };
  const fake = { query: async (sql) => (/FROM whatsapp_messages/i.test(String(sql)) ? { rows: [{ user_phone: PHONE }] } : { rows: [{ id: 'a-1', full_name: 'Testa Agent', status: 'approved' }] }) };
  try {
    const result = await goodbye.importAdvertsSentWhileAway(fake, { agent: { id: 'a-1', phone: `+${PHONE}`, whatsapp: `+${PHONE}` }, since: '2026-11-23T14:11:00Z' });
    assert.strictEqual(result.imported, 1);
    assert.deepStrictEqual(result.not_saved, [
      { caption: 'Plot for sale near the trading centre 15m', why: 'needs exact area and district' },
      { caption: 'Plot for sale in Testville at 55m', why: 'could not be saved' }
    ]);
    assert.strictEqual(result.loose_media, 2);
  } finally {
    whatsapp.groupForwardedAdverts = saved.groups;
    whatsapp.importForwardedAdvert = saved.importOne;
  }
  const source = require('fs').readFileSync(require('path').join(__dirname, '../services/billingOpsService.js'), 'utf8');
  assert.match(source, /could not be saved by \$\{notSaved\.length === 1 \? 'itself' : 'themselves'\}\. Please load \$\{notSaved\.length === 1 \? 'it' : 'them'\} from their chat:/);
  assert.match(source, /came without a description: check their chat\./);
});

test('the note at their removal does not stand in for the welcome back; what is kept says how to rejoin', async () => {
  // Removed with the kind note and its link, never greeted: their next message is welcomed back.
  const agent = agentWith({ rejoin_sent_at: hoursAgo(30) });
  await withAgent(agent, async ({ notes }) => {
    const reply = await route.removedAgentReply({ phone: PHONE, body: 'Good deal!!! House for sale in Testville at 58m', hasMedia: true });
    assert.match(reply.message, /^Hi Testa, welcome back 👋\n\nYou were removed as a makaug agent on 23 Nov, but we'd love to have you back\.\n\nI've kept what you've just sent safe: it goes to our team for review when you rejoin\.\n\nWhat would you like to do\? Reply with the number:\n1️⃣ Look for a property\n2️⃣ Rejoin as an agent$/);
    assert.strictEqual(notes.length, 0);
  });
  const kept = route.keptAdvertsMessage({ agent: { full_name: 'Testa Agent' }, groups: [{ caption: 'House for sale in Testville at 58m', facts: route.employeePropertyFacts('House for sale in Testville at 58m', {}) }], fresh: 1, fee: 50000, linkSent: false });
  assert.match(kept, /It goes to our team for review as soon as you rejoin \(the agent plan is UGX 50,000 a month\), and your earlier listings come back up at the same time\. Reply \*REJOIN\* and Ronald will call you, with the payment link\.\n\nAny questions, just reply here\.$/);
});

test('looking for a property is a search, not an advert they want kept', async () => {
  const agent = agentWith({ welcome_back_at: hoursAgo(3), former_agent_choice: 'customer', former_agent_choice_at: hoursAgo(2) });
  await withAgent(agent, async () => {
    assert.strictEqual(await route.removedAgentReply({ phone: PHONE, body: '2 bedroom house to rent in Kira under 1m', hasMedia: false }), null, 'the search goes to the usual conversation');
    assert.strictEqual(await route.removedAgentReply({ phone: PHONE, body: 'need land in Wakiso budget 30m', hasMedia: false }), null);
    // An advert with its photos is still kept.
    const advert = await route.removedAgentReply({ phone: PHONE, body: '', hasMedia: true });
    assert.deepStrictEqual(advert, { message: '', silent: true });
  });
});
