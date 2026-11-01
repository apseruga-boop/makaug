'use strict';

/**
 * "Are the brokers legitimate" — +256 781 9014.., 1 Nov 2026, 12:25, straight
 * after being shown 24 Kireka rentals. The bot heard "broker" and offered to
 * find him one. He was asking whether to trust the ones he had just seen.
 */

const test = require('node:test');
const assert = require('node:assert');

const { trustQuestionKind, trustQuestionReply } = require('../routes/whatsapp').__test;

test('the question from the screenshot is heard as a trust question about brokers', () => {
  assert.strictEqual(trustQuestionKind('Are the brokers legitimate'), 'brokers');
});

test('the ways people ask whether brokers are real', () => {
  for (const q of [
    'Are the brokers legitimate',
    'are these agents real?',
    'Is the agent genuine?',
    'can i trust these brokers',
    'Are your agents verified',
    'are the brokers registered?',
    'How do I know the agent is not a conman',
    'is this broker a scammer',
    'Agents on here, are they legit?',
    'Hi, r the agents real',
    'Je, mawakala hawa ni wa kweli?',
    'abo ba broker ba ddala?'
  ]) assert.strictEqual(trustQuestionKind(q), 'brokers', q);
});

test('questions about makaug itself, a listing, or paying get their own answer', () => {
  for (const q of ['Is makaug legit?', 'is this site real?', 'Is this a scam', 'can I trust you', 'are you a registered company?']) {
    assert.strictEqual(trustQuestionKind(q), 'platform', q);
  }
  for (const q of ['Is this listing genuine?', 'are these houses real', 'Is the property fake?', 'are the photos real?']) {
    assert.strictEqual(trustQuestionKind(q), 'listing', q);
  }
  for (const q of ['Is it safe to pay a deposit before viewing?', 'should I send him money first', 'is the booking fee legit', 'can i trust the agent with my deposit']) {
    assert.strictEqual(trustQuestionKind(q), 'payment', q);
  }
});

test('searches and ordinary chat are left alone', () => {
  for (const q of [
    'I want a genuine 2 bedroom house in Kireka',
    'looking for a real estate agent in Wakiso',
    'Kireka',
    'Yes',
    'house for rent in Ntinda under 1m',
    'I need a trusted plumber',
    'is the area safe',
    'Hello',
    'I am a registered agent, how do I post',
    'Selling 5 bedroom house in Kololo @600m UGX, genuine buyers only'
  ]) assert.strictEqual(trustQuestionKind(q), '', q);
});

test('the answer is short, points at the verified brokers, and gives the two rules', () => {
  const reply = trustQuestionReply('en', 'brokers');
  assert.match(reply, /Verified by makaug/);
  assert.match(reply, /\/brokers\b/);
  assert.match(reply, /Reply \*3\*/);
  assert.match(reply, /Never pay to book a viewing/);
  assert.match(reply, /report listing/);
  assert.ok(reply.length < 600, `too long for WhatsApp: ${reply.length}`);
  for (const kind of ['platform', 'listing', 'payment']) {
    const r = trustQuestionReply('en', kind);
    assert.ok(r.length < 600, `${kind} too long: ${r.length}`);
    assert.match(r, /\/safety\b|\/brokers\b/);
  }
  assert.match(trustQuestionReply('sw', 'brokers'), /Verified by makaug/);
  assert.match(trustQuestionReply('lg', 'brokers'), /Verified by makaug/);
  assert.match(trustQuestionReply('ny', 'brokers'), /Fair question/, 'languages without a version fall back to English');
});
