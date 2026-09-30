'use strict';

/**
 * Talking to an agent like a person.
 *
 * 29–30 Sep 2026. The agent intake worked — four of Tuyisengye Innocent's
 * properties reached staff review from his own number. What he heard back did
 * not:
 *
 *   17:07:10  📋 *All 1 saved* for staff review.
 *             Nothing is live until a moderator approves it.
 *             Type *COMPLETE* when the whole batch is done.
 *   17:07:58  him: "Okay please"
 *   17:08:00  I did not save that, because it does not describe a property and
 *             I did not want to create an empty one.
 *
 * He got two messages for one property — the confirmation he had already been
 * sent, then a batch summary in a vocabulary he never signed up to. And when he
 * was polite, he was told his politeness failed to describe a property and that
 * we had avoided creating an empty one on his behalf.
 *
 * Katamba Bonny, the day before, asked "So how do I post" and was handed a
 * five-option buyer menu.
 *
 * None of that is a conversation. These tests hold the shape of one.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  agentConversationalAside,
  agentSelfIntakeSessionData
} = require('../routes/whatsapp').__test;

const TUYISENGYE = {
  id: 'b6dca5cd-0000-1111-2222-333344445555',
  full_name: 'Tuyisengye Innocent',
  phone: '256708020927',
  whatsapp: '256708020927'
};

const session = (savedCount = 0) => ({
  ...agentSelfIntakeSessionData(TUYISENGYE),
  property_ids: Array.from({ length: savedCount }, (_, i) => `id-${i}`)
});

test('politeness is answered politely', () => {
  const reply = agentConversationalAside({ data: session(1), cleanBody: 'Okay please' });
  assert.ok(reply, '"Okay please" must get an answer, not a lecture');
  assert.doesNotMatch(reply, /does not describe a property/,
    'this is the sentence he actually got, and it must never come back');
  assert.doesNotMatch(reply, /empty one/);
  assert.match(reply, /with the team/, 'tell him where his property is');
  assert.match(reply, /next property/, 'and invite the next one');
});

test('every ordinary acknowledgement is covered, not just one', () => {
  for (const word of ['ok', 'Okay', 'thanks', 'Thank you', 'noted', 'Alright', 'sure', 'webale', '👍', 'Yes']) {
    assert.ok(agentConversationalAside({ data: session(2), cleanBody: word }),
      `"${word}" is a person being normal and must be handled`);
  }
});

test('"how do I post" is answered, once, with the answer', () => {
  const reply = agentConversationalAside({ data: session(), cleanBody: 'So how do I post' });
  assert.ok(reply);
  assert.match(reply, /send me the property/i, 'the actual answer, first');
  assert.match(reply, /exact area and district/, 'the two things intake always has to chase');
  assert.match(reply, /1\.2m a month/, 'shown, not described');
  assert.match(reply, /One property per message/);
  assert.doesNotMatch(reply, /1️⃣|2️⃣|House\/Property for SALE/,
    'the buyer menu is what Katamba got and it answered nothing');
});

test('the same question in the shapes people actually type it', () => {
  for (const q of [
    'how do i post',
    'How can I list a property?',
    'how to upload',
    'Where do I post',
    'how does this work',
    'what should I send'
  ]) {
    assert.ok(agentConversationalAside({ data: session(), cleanBody: q }), `"${q}" must be recognised`);
  }
});

test('"is it done?" gets a straight answer about their own properties', () => {
  const withNone = agentConversationalAside({ data: session(0), cleanBody: 'is it done' });
  assert.match(withNone, /Nothing from you is with the team yet/);

  const withOne = agentConversationalAside({ data: session(1), cleanBody: 'Is it live?' });
  assert.match(withOne, /it is with our team for review/);
  assert.match(withOne, /send you the link to share/);

  const withFour = agentConversationalAside({ data: session(4), cleanBody: 'did you get them' });
  assert.match(withFour, /all 4 are with our team/,
    'he sent four; the count he hears must be his, not a generic plural');
});

test('an actual property caption is left well alone', () => {
  // The aside must never swallow a property. These fall through to the intake.
  for (const caption of [
    '20 acres kayunga kitwe each at 8.5m last 8m with power available',
    'Commercial building for sale Komamboga, 12 decimals, private mailo, 1.2 billion',
    'Kira, Wakiso'
  ]) {
    assert.strictEqual(agentConversationalAside({ data: session(1), cleanBody: caption }), null,
      `"${caption.slice(0, 30)}…" is property information, not chat`);
  }
});

test('none of this applies to anyone who is not an agent posting', () => {
  assert.strictEqual(
    agentConversationalAside({ data: { whatsapp_employee_intake: true }, cleanBody: 'ok' }),
    null,
    'a staff batch keeps the staff replies'
  );
  assert.strictEqual(agentConversationalAside({ data: {}, cleanBody: 'how do i post' }), null);
  assert.strictEqual(agentConversationalAside({ data: session(1), cleanBody: '' }), null);
});

test('the go-live message is sent by makaug, not left on a staff member’s screen', () => {
  // Every approve button in the dashboard posts manual_notification_only, which
  // used to skip the send entirely and hand the moderator a wa.me link instead.
  // Four of Tuyisengye's listings were approved on 30 Sep and he heard nothing.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');

  assert.match(source, /const leaveToAHuman = manualNotificationOnly && nextStatus === 'rejected';/,
    'only a rejection is left to a person to word');
  assert.doesNotMatch(source, /if \(manualNotificationOnly && \['approved', 'rejected'\]\.includes\(nextStatus\)\)/,
    'an approval must never take the build-but-do-not-send branch again');

  // And the dashboard really does ask for it on every path, which is why the
  // fix has to live on the server rather than in the bundle.
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  assert.ok(bundle.includes('manual_notification_only'),
    'if this ever stops being sent, re-check that approvals still notify');
});
