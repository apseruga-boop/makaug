'use strict';

/**
 * 24 Nov 2026, the day's chats. Every name and number here is made up.
 *
 * 1. A new agent said Hi after a call and was approved, but his welcome pack
 *    (his page, the agent terms, the how-to film) went four hours later, and
 *    only because the site restarted then.
 * 2. He was greeted by his company's full registered name, "Hi … Property
 *    Services Ltd!", the name typed for his page.
 * 3. His "Sorry", a minute after the welcome, went to Arthur and Ronald as a
 *    message the assistant could not place.
 * 4. An agent who picked "Talk to a person" six days before, and was called,
 *    said "Ok thanks" to her listing going live and was told a team member
 *    would reply shortly, as every message of hers had been since. The chat
 *    stays with the team until someone replies from King, or MENU (Arthur);
 *    a thank-you gets no answer, and "in the inbox" is said once in 12 hours.
 * 5. Two agents removed for not paying had not written in a week, so their
 *    kind notes waited for them, and King said the notes had been sent.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const route = require('../routes/whatsapp').__test;
const names = require('../services/agentNameService');
const followThrough = require('../services/callingFollowThrough');
const goodbye = require('../services/agentGoodbyeService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const NEW_AGENT = { id: '0e0e0e0e-0000-4000-8000-000000000021', full_name: 'Testco Property Services Ltd', greeting_name: 'Testco Property Services Ltd', whatsapp: '256700000121' };

test('sorry, thanks and ok are courtesy, not something to pass to the team', () => {
  for (const said of ['Sorry', 'sorry boss', 'So sorry', 'Ok thanks', 'Okay thank you so much', 'Thanks a lot', 'Noted', '👍', '🙏', 'God bless', 'Ok']) {
    assert.strictEqual(route.isCourtesyOnly(said), true, said);
    assert.strictEqual(route.agentTalkKind(said), 'courtesy', said);
  }
  for (const said of ['Sorry, is the house in Kira still available?', 'I will send the photos tomorrow', 'Where is the house?', 'Plot for sale in Kira at 45m', '']) {
    assert.strictEqual(route.isCourtesyOnly(said), false, said);
  }
});

test('a new agent\'s sorry or thanks gets a kind word back, by his own name', () => {
  const data = route.agentSelfIntakeSessionData(NEW_AGENT);
  const sorry = route.agentConversationalAside({ data, cleanBody: 'Sorry' });
  assert.strictEqual(sorry, 'No problem at all, Testco 😊 Send the property whenever you are ready — photos and a caption with the type, area and price.');
  const thanks = route.agentConversationalAside({ data, cleanBody: 'Ok thanks' });
  assert.match(thanks, /^You're welcome, Testco 😊 Send the property whenever you are ready/);
  assert.doesNotMatch(`${sorry}\n${thanks}`, /passed that to our team/);
  assert.match(route.agentConversationalAside({ data: { ...data, property_ids: ['p-1'] }, cleanBody: 'Noted' }), /^👍 That one is with the team\. Send the next property whenever you are ready\.$/);
});

test('a company is greeted by its own name; a person as before', () => {
  assert.strictEqual(names.agentGreetingName(NEW_AGENT), 'Testco');
  assert.strictEqual(names.greetingFromCompanyName('Green Acres Realtors Limited'), 'Green Acres');
  assert.strictEqual(names.greetingFromCompanyName('ABC (U) Ltd'), 'ABC');
  assert.strictEqual(names.greetingFromCompanyName('Testco construction limited'), 'Testco construction');
  for (const kept of ['Moses Testname', 'Amos', 'Testco properties', 'Testco Homes']) {
    assert.strictEqual(names.greetingFromCompanyName(kept), kept, 'not a registered company name');
  }
  names.setCachedGreetingName(NEW_AGENT.id, 'Testco Property Services Ltd');
  assert.strictEqual(names.agentGreetingName({ id: NEW_AGENT.id }), 'Testco');
  names.setCachedGreetingName(NEW_AGENT.id, '');
  assert.match(read('services/callingFollowThrough.js'), /const name = clean\(require\('\.\/agentNameService'\)\.agentGreetingName\(approved, ''\), 60\) \|\| 'there';/);
});

test('the hello after a call says hello, and the welcome pack follows a few seconds later', async () => {
  const hello = followThrough.welcomeText('Testco', 'Ronald');
  assert.strictEqual(hello, [
    'Hi Testco! 👋 Welcome to makaug.com. Ronald told us you would say Hi.',
    '',
    'Your agent account is ready, with 3 free days to load your places. Your welcome is on its way: your page, the agent terms and a one-minute video on how to post.'
  ].join('\n'));

  const admin = require('../routes/admin');
  const real = admin.runAgentApprovalFollowUps;
  const calls = [];
  admin.runAgentApprovalFollowUps = async (args) => { calls.push(args); return {}; };
  try {
    route.sendCalledAgentWelcomePack(NEW_AGENT, { delayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    admin.runAgentApprovalFollowUps = real;
  }
  assert.deepStrictEqual(calls, [{ agentId: NEW_AGENT.id, wasApproved: true, actor: 'calling_hello' }]);

  const runtime = read('routes/whatsapp.js');
  assert.match(runtime, /if \(calledHello\?\.message && calledHello\.agent\) \{\n\s+await replaceEmployeeSession\(phone, 'employee_property_media', agentSelfIntakeSessionData\(calledHello\.agent\)\);\n\s+sendCalledAgentWelcomePack\(calledHello\.agent\);/);
  assert.match(read('routes/moneySms.js'), /if \(hello\?\.agent\?\.id\) \{\n\s+require\('\.\/admin'\)\.runAgentApprovalFollowUps\(\{ agentId: hello\.agent\.id, wasApproved: true, actor: 'calling_hello_sms' \}\)/);
});

test('in a chat the team has: no answer to a thank-you, and "in the inbox" once in 12 hours', () => {
  const now = Date.parse('2026-11-24T06:31:39Z');
  const control = (hoursAgo) => ({ status: 'needs_human', metadata: hoursAgo === null ? {} : { handoff_ack_at: new Date(now - hoursAgo * 3600e3).toISOString() } });
  assert.strictEqual(route.handoffAckIsQuiet({ conversationControl: control(null), said: 'Ok thanks', now }), true);
  assert.strictEqual(route.handoffAckIsQuiet({ conversationControl: control(null), said: 'When can I see the house?', now }), false, 'first time: said');
  assert.strictEqual(route.handoffAckIsQuiet({ conversationControl: control(2), said: 'When can I see the house?', now }), true, 'said two hours ago');
  assert.strictEqual(route.handoffAckIsQuiet({ conversationControl: control(13), said: 'When can I see the house?', now }), false);

  const runtime = read('routes/whatsapp.js');
  const start = runtime.indexOf('async function processInboundRuntimeUnlocked');
  assert.ok(!/personRequestHasLapsed|a_day_passed/.test(runtime), 'the chat stays with the team until someone replies from King, or MENU (Arthur)');
  const pause = runtime.indexOf('  if (shouldPauseAutomation) {\n', start);
  assert.ok(pause > start);
  const paused = runtime.slice(pause, runtime.indexOf('humanHandoffAck(activeLang)', pause));
  assert.match(paused, /if \(handoffAckIsQuiet\(\{ conversationControl, said: transcriptRecord\?\.text \? '' : effectiveBody \}\)\) \{\n\s+return \{ message: '', nextStep: sessionStep \};/);
  assert.match(paused, /await safeConversationControl\(phone, \{ metadata: \{ handoff_ack_at: new Date\(\)\.toISOString\(\) \} \}, 'whatsapp_handoff_ack'\);/);
});

test('King says when a removed agent\'s kind note is waiting for them to write', () => {
  const waiting = goodbye.buildRemovalAlert({ agent: { full_name: 'Test Agent' }, reason: goodbye.removalReason('not_paying'), listingsHidden: 17, rejoinNote: 'waiting_for_them' });
  assert.match(waiting, /• A kind note with their payment link is ready\. They haven't written to makaug in the last 7 days, so it goes the moment they do; when they pay, everything comes back by itself/);
  assert.doesNotMatch(waiting, /They were sent/);
  const sent = goodbye.buildRemovalAlert({ agent: { full_name: 'Test Agent' }, reason: goodbye.removalReason('not_paying'), listingsHidden: 3, rejoinNote: 'sending' });
  assert.match(sent, /• They were sent a kind note with their payment link/);
  const remove = read('routes/admin.js');
  const block = remove.slice(remove.indexOf("if (reason.code === 'not_paying') {"), remove.indexOf("if (reason.code === 'not_paying') {") + 900);
  assert.match(block, /\.waitsForThem\(String\(agent\.whatsapp \|\| agent\.phone \|\| ''\)\)/);
  assert.match(block, /result\.rejoin_note = waits \? 'waiting_for_them' : 'sending';/);
  assert.match(remove, /rejoinNote: result\.rejoin_note \|\| false,/);
});
