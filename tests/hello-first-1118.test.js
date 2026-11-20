'use strict';

/**
 * Hello first, then the welcome (18 Nov 2026). Every name and number here is
 * made up.
 *
 * Since 16 Nov the makaug number writes to nobody who has not written to it
 * first. A new agent approved without having written got none of their
 * welcome until they did. The fix is the order: the new agent says hi first,
 * and their welcome goes the moment they are approved.
 *
 * 1. Agent 007, adding a new agent who has never written: the end of the batch
 *    gives the employee the link to send them now.
 * 2. A new agent saying hi before approval is told their welcome comes the
 *    moment they are approved, not handed the customer menu.
 * 3. The website, after an agent signs up: "Say hi on WhatsApp" first, with a
 *    button, not "We WhatsApp you", which the number can no longer do.
 * 4. A sign-in code for a number that has never written cannot be sent: the
 *    person is told to say hi first, then ask again.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const STAFF = '+256700000111';
const NEW_AGENT = {
  id: '00000000-0000-4000-8000-000000000666',
  full_name: 'Replay Newcomer',
  greeting_name: 'Replay',
  company_name: 'Independent agent',
  phone: '+256700000666',
  whatsapp: '+256700000666',
  email: null,
  status: 'pending'
};

function withWorld(run, { wrote = false, pending = [] } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const before = {
    staff: process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS,
    onlyWrote: process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE
  };
  process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = STAFF.replace(/\D/g, '');
  process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = 'on';
  db.query = async (sql, params = []) => {
    if (/FROM whatsapp_messages/i.test(sql) && /direction = 'inbound'/i.test(sql)) return { rows: wrote ? [{ '?column?': 1 }] : [] };
    if (/FROM agents/i.test(sql) && /status = 'pending'/i.test(sql)) {
      return { rows: pending.filter((agent) => String(agent.whatsapp).replace(/\D/g, '').slice(-9) === String(params[0])) };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  const at = (phone, step, body, data = {}) => route.handleEmployeeWhatsappIntake({ phone, body, session: { current_step: step, session_data: data } });
  return Promise.resolve(run({ at })).finally(() => {
    db.query = originalQuery;
    db.getClient = originalGetClient;
    for (const [key, name] of [['staff', 'WHATSAPP_EMPLOYEE_INTAKE_NUMBERS'], ['onlyWrote', 'WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE']]) {
      if (before[key] === undefined) delete process.env[name];
      else process.env[name] = before[key];
    }
  });
}

const batchFor = (agent) => ({
  employee_role: 'agent',
  property_batch_mode: 'one',
  agent,
  property_ids: ['00000000-0000-4000-8000-000000000001'],
  total_media_count: 1,
  properties_shared_count: 1,
  properties_duplicate_count: 0,
  properties_failed_count: 0
});

test('Agent 007: a new agent who has never written is to be sent the link now, so the welcome goes on approval', async () => {
  await withWorld(async ({ at }) => {
    const done = await at(STAFF, 'employee_property_media', 'COMPLETE', batchFor(NEW_AGENT));
    assert.strictEqual(done.batchComplete, true, done.message);
    assert.match(done.message, /Replay Newcomer has not been notified yet\. The agent profile card is waiting for founder approval\./);
    assert.match(done.message, /Replay Newcomer hasn't written to the makaug WhatsApp number in the last 7 days/);
    assert.match(done.message, /Send them this to tap and send now, and their welcome goes the moment they are approved:\nhttps:\/\/wa\.me\/\d+\?text=Hi%20makaug/);
  });
  await withWorld(async ({ at }) => {
    const done = await at(STAFF, 'employee_property_media', 'COMPLETE', batchFor(NEW_AGENT));
    assert.match(done.message, /waiting for founder approval\./);
    assert.doesNotMatch(done.message, /hasn't written|wa\.me/, 'somebody who has written needs no link');
  }, { wrote: true });
  // With the rule off nothing is asked and nothing changes.
  const off = process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE;
  process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = 'off';
  try {
    assert.strictEqual(await route.pendingAgentBatchLine('Replay Newcomer', NEW_AGENT.whatsapp),
      'Replay Newcomer has not been notified yet. The agent profile card is waiting for founder approval.');
  } finally {
    if (off === undefined) delete process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE;
    else process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = off;
  }
});

test('a new agent who says hi before approval is told the welcome comes the moment they are approved', async () => {
  const reply = route.pendingAgentHelloReply(NEW_AGENT);
  assert.match(reply, /^👋 Hello Replay, thanks for saying hi!/);
  assert.match(reply, /application is with our team\. The moment you are approved, your welcome comes here/);
  await withWorld(async () => {
    const found = await route.findPendingAgentByPhone('0700 000666');
    assert.strictEqual(found && found.id, NEW_AGENT.id, 'found by their number, in any form');
    assert.strictEqual(await route.findPendingAgentByPhone('+256700000777'), null);
  }, { pending: [NEW_AGENT] });
  // Wired in where an agent's greeting is answered: after the approved agent,
  // before the staff and customer replies.
  const source = read('routes/whatsapp.js');
  const approvedMenu = source.indexOf('message: agentMenuReply({ agent: askingAgent, greet: true })');
  const pendingHello = source.indexOf('message: pendingAgentHelloReply(pendingAgent)');
  const staffReply = source.indexOf('const staffReply = staffIntakeGreetingReply({ phone, session, cleanBody });');
  assert.ok(approvedMenu > 0 && pendingHello > approvedMenu && staffReply > pendingHello);
  assert.match(source.slice(approvedMenu, pendingHello), /if \(AGENT_GREETING\.test\(askedText\)\) \{\s+const pendingAgent = await findPendingAgentByPhone\(phone\);/);
});

test('the website asks a new agent to say hi on WhatsApp first, with a button, and no longer promises "We WhatsApp you"', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('function showBrokerApplicationReceived(');
  const dialog = app.slice(start, app.indexOf('async function submitAccountAccessOtp(', start));
  assert.ok(start > 0 && dialog.length > 0);
  assert.match(dialog, /<strong>Say hi to makaug on WhatsApp<\/strong>/);
  assert.match(dialog, /WhatsApp only lets us message people who have written to us first/);
  // Kept as "Hi makaug": the site rewrites its other WhatsApp links into a
  // support request, which a new agent's hello is not.
  assert.match(dialog, /href="https:\/\/wa\.me\/\$\{MAKAUG_SUPPORT_WHATSAPP\}\?text=Hi%20makaug" target="_blank" rel="noopener" data-say-hi data-whatsapp-static="true"/);
  assert.match(app, /if \(!link \|\| link\.dataset\.whatsappStatic === "true"\) return;/);
  assert.match(dialog, /💬 Say hi on WhatsApp/);
  assert.doesNotMatch(dialog, /We WhatsApp you/);
  assert.match(app, /const MAKAUG_SUPPORT_WHATSAPP = "256780863394";/, 'the number the link uses');
  const bundle = read('assets/build/makaug-app.min.js');
  assert.match(bundle, /Say hi on WhatsApp/, 'and the bundle the site loads is rebuilt');
});

test('a sign-in code for a number that has never written: say hi first, then ask again', async () => {
  const bridge = require('../services/whatsappWebBridgeService');
  const { sendPhoneOtp } = require('../services/phoneOtpDeliveryService');
  const original = {
    hasWrittenToUs: bridge.hasWrittenToUs,
    needsLinking: bridge.whatsappSessionNeedsLinking,
    enabled: process.env.WHATSAPP_WEB_BRIDGE_ENABLED,
    onlyWrote: process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE
  };
  process.env.WHATSAPP_WEB_BRIDGE_ENABLED = 'true';
  process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = 'on';
  bridge.hasWrittenToUs = async () => false;
  bridge.whatsappSessionNeedsLinking = async () => false;
  try {
    const result = await sendPhoneOtp({ to: '+256700000888', message: 'your code is 123456', otp: '123456' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'they_have_not_written_to_the_number');
  } finally {
    bridge.hasWrittenToUs = original.hasWrittenToUs;
    bridge.whatsappSessionNeedsLinking = original.needsLinking;
    for (const [key, name] of [['enabled', 'WHATSAPP_WEB_BRIDGE_ENABLED'], ['onlyWrote', 'WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE']]) {
      if (original[key] === undefined) delete process.env[name];
      else process.env[name] = original[key];
    }
  }
  const auth = read('routes/auth.js');
  assert.match(auth, /if \(deliveryResult\.failureReason === 'they_have_not_written_to_the_number'\) sendError\.reason = deliveryResult\.failureReason;/);
  assert.match(auth, /const neverWrote = !isEmail && error\?\.reason === 'they_have_not_written_to_the_number';/);
  assert.match(auth, /WhatsApp only lets makaug message people who have written to it first\. Send "Hi" to makaug on WhatsApp \(\$\{supportLocal\}\) from this number, then ask for the code again\. Or use your email\./);
});
