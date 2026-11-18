'use strict';

/**
 * 18 Nov 2026. Every name and number here is made up.
 *
 * Somebody said Hello and was greeted by their WhatsApp user name ("Good
 * afternoon, <name>189"). They picked 5, Join makaug as an agent, and asked
 * "What do you need": the menu. Then "Me I want to be sending my properties
 * to you such that I get customs is ok": the menu again, opened with
 * "Here it is again". Then they picked 6, Talk to a person.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('a user name is not a name', () => {
  assert.strictEqual(route.cleanDisplayName('replayname189'), '');
  assert.strictEqual(route.cleanDisplayName('Kato2'), '');
  assert.strictEqual(route.cleanDisplayName('Replay Kato'), 'Replay Kato');
  assert.strictEqual(route.cleanDisplayName('Kato'), 'Kato');
});

test('after asking to join, "what do you need" and "I want to send my properties" are answered with what joining takes', async () => {
  for (const q of ['What do you need', 'what are the requirements?', 'How do I start', 'what next']) {
    assert.ok(route.JOIN_FOLLOW_UP_QUESTION.test(q), q);
  }
  assert.ok(route.WANTS_TO_SEND_PROPERTIES.test('Me I want to be sending my properties to you such that I get customs is ok'));
  for (const not of ['I need a 2 bedroom house in Kira', 'What is the price', 'How much is the plot in Kira', 'Hello']) {
    assert.ok(!route.JOIN_FOLLOW_UP_QUESTION.test(not) && !route.WANTS_TO_SEND_PROPERTIES.test(not), not);
  }
  const needs = route.agentJoinNeedsReply();
  assert.match(needs, /^🧑‍💼 \*To join makaug as an agent, we need:\*/);
  assert.match(needs, /1\. Your full name, and the area and district you work in\n2\. A clear photo of your ID/);
  assert.match(needs, /Sign up yourself here: https:\/\/makaug\.com\/broker-signup/);
  const sending = route.agentJoinNeedsReply({ sendingProperties: true });
  assert.match(sending, /^✅ Yes, that is exactly how makaug works/);
  assert.notStrictEqual(sending, needs, 'two different answers, so neither is sent as a repeat');

  const original = db.query;
  let seen = null;
  db.query = async (sql, params) => { seen = { sql: String(sql), params }; return { rows: [{ '?column?': 1 }] }; };
  try {
    assert.strictEqual(await route.askedToJoinRecently('+256 700 000 278'), true);
    assert.match(seen.sql, /action = 'agent_join_requested'[\s\S]*details->>'phone' = \$1[\s\S]*INTERVAL '2 days'/);
    assert.deepStrictEqual(seen.params, ['256700000278']);
  } finally {
    db.query = original;
  }
  const source = read('routes/whatsapp.js');
  const guard = source.indexOf('if ((JOIN_FOLLOW_UP_QUESTION.test(cleanBody) || WANTS_TO_SEND_PROPERTIES.test(cleanBody)) && await askedToJoinRecently(phone)) {');
  const fallback = source.indexOf('const fallback = await conversationalAssistantFallback({', guard);
  assert.ok(guard > 0 && fallback > guard && fallback - guard < 400);
});

test('the menu a second time in half an hour is a loop: a person takes it', async () => {
  const source = read('routes/whatsapp.js');
  const start = source.indexOf('const fallback = await conversationalAssistantFallback({');
  const block = source.slice(start, start + 1200);
  assert.match(block, /if \(fallback === friendlyUnknownReply\(lang\)\) \{/);
  assert.match(block, /Date\.now\(\) - before < 30 \* 60 \* 1000/);
  assert.match(block, /return respond\(await notUnderstoodTwiceReply\(/);
  assert.match(block, /await patchSessionData\(phone, \{ last_unknown_fallback_at: new Date\(\)\.toISOString\(\) \}\);/);

  const original = db.query;
  db.query = async () => ({ rows: [] });
  try {
    const reply = await route.notUnderstoodTwiceReply({ phone: '256700000279', lang: 'en', text: 'I still do not get it' });
    assert.match(reply, /^Sorry, I did not understand that\.\n\n👋 I have told the makaug team\./);
  } finally {
    db.query = original;
  }
});
