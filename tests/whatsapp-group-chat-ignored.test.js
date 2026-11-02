'use strict';

/**
 * A WhatsApp group is not a customer.
 *
 * 1 Nov 2026, 17:49: the makaug number was added to a group ("tours and
 * transportation"). The WAHA bridge forwards group messages like any other,
 * with the group's id as the sender: 120363423279489703@g.us. The inbound
 * route kept the digits — eighteen of them — and from then on the group was
 * a "guest" at the customer menu. 604 messages in fourteen hours, each
 * answered (in Swahili, the group's language): 60 search requests, 19 leads,
 * and 270 replies queued to "120363423279489703", each handed to the bridge
 * eight times and refused by WhatsApp every time:
 *
 *   no LID found for 120363423279489703@s.whatsapp.net from server
 *   ... info query returned status 429: rate-overlimit
 *
 * The second line is the cost: our own number rate-limited by WhatsApp for
 * looking up a user that does not exist, two thousand times.
 */

process.env.NODE_ENV = 'test';
process.env.WHATSAPP_WEB_BRIDGE_TOKEN = process.env.WHATSAPP_WEB_BRIDGE_TOKEN || 'group-chat-test-token';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const db = require('../config/database');
const bridge = require('../services/whatsappWebBridgeService');

const GROUP = '120363423279489703@g.us';
const GROUP_DIGITS = '120363423279489703';
const LID_ERROR = 'WAHA POST /api/sendText -> 500: {"statusCode":500,"exception":{"message":"2 UNKNOWN: no LID found for 120363423279489703@s.whatsapp.net from server","code":2}}';
const RATE_ERROR = 'WAHA POST /api/sendText -> 500: {"statusCode":500,"exception":{"message":"2 UNKNOWN: failed to get user info for 120363423279489703@s.whatsapp.net to fill LID cache: failed to send usync query: info query returned status 429: rate-overlimit"}}';

test('a group, a newsletter or a broadcast is recognised; a person is not mistaken for one', () => {
  assert.strictEqual(bridge.whatsappChatKind(GROUP), 'group');
  assert.strictEqual(bridge.whatsappChatKind('', GROUP_DIGITS), 'group', 'eighteen digits are not a phone number');
  assert.strictEqual(bridge.whatsappChatKind('256700111222-1600000000@g.us'), 'group', 'the older group id shape');
  assert.strictEqual(bridge.whatsappChatKind('120363001122334455@newsletter'), 'newsletter');
  assert.strictEqual(bridge.whatsappChatKind('status@broadcast'), 'broadcast');
  assert.strictEqual(bridge.whatsappChatKind('256700111222@c.us', '256700111222'), '');
  assert.strictEqual(bridge.whatsappChatKind('', '256768524008'), '');
  assert.strictEqual(bridge.whatsappChatKind('215908710641703@lid', '215908710641703'), '', 'a LID-addressed person is still a person');
  assert.strictEqual(bridge.whatsappChatKind('', '447757773202'), '');
});

test('only a phone number can be delivered to', () => {
  for (const ok of ['256700111222', '447757773202', '27821234567']) assert.strictEqual(bridge.isDeliverableWhatsappRecipient(ok), true, ok);
  for (const bad of [GROUP_DIGITS, GROUP, 'Ronald Okongo', '', '12345', '+256700111222 ']) assert.strictEqual(bridge.isDeliverableWhatsappRecipient(bad), false, bad);
});

test('"no LID found" is final; "rate-overlimit" means wait, not retry in a second', () => {
  assert.deepStrictEqual(bridge.classifyBridgeSendError(LID_ERROR), { permanent: true, reason: 'recipient_or_payload_rejected', retryDelaySeconds: null });
  assert.strictEqual(bridge.classifyBridgeSendError('unroutable recipient: ').permanent, true);
  assert.strictEqual(bridge.classifyBridgeSendError('WAHA POST /api/sendImage -> 400: {"message":"file url is required"}').permanent, true);
  const limited = bridge.classifyBridgeSendError(RATE_ERROR);
  assert.strictEqual(limited.permanent, false);
  assert.strictEqual(limited.reason, 'rate_limited');
  assert.ok(limited.retryDelaySeconds >= 300, 'a rate limit waits minutes, not a second');
  assert.deepStrictEqual(bridge.classifyBridgeSendError('WAHA POST /api/sendText -> 500: session status is not as expected'), { permanent: false, reason: '', retryDelaySeconds: null });
  assert.deepStrictEqual(bridge.classifyBridgeSendError('WhatsApp send was not confirmed after composer cleared'), { permanent: false, reason: '', retryDelaySeconds: null });
});

function withFakeDb(run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/INSERT INTO outbound_message_queue/i.test(sql)) return { rows: [{ id: 'q-1', user_phone: params[0], status: /'failed'/.test(sql) ? 'failed' : 'pending' }] };
    if (/UPDATE outbound_message_queue/i.test(sql)) return { rows: [{ id: params[0], status: 'retry' }] };
    return { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

test('a reply to a group id is recorded as failed and never handed to the bridge', async () => {
  await withFakeDb(async (calls) => {
    const row = await bridge.queueWhatsappWebBridgeMessage({ recipient: GROUP_DIGITS, text: 'Naweza kusaidia.', source: 'whatsapp_runtime' });
    assert.strictEqual(row.rejected, true);
    assert.strictEqual(row.status, 'failed');
    const insert = calls.find((c) => /INSERT INTO outbound_message_queue/i.test(c.sql));
    assert.ok(insert && /'failed'/.test(insert.sql), 'inserted straight as failed');
    assert.match(insert.params[4], /invalid_recipient: group/);
    assert.ok(!calls.some((c) => /SELECT \*\s+FROM outbound_message_queue/i.test(c.sql)), 'no dedupe lookup for a row that will never be sent');
  });
  await withFakeDb(async (calls) => {
    const row = await bridge.queueWhatsappWebBridgeMessage({ recipient: '+256 768 524 008', text: 'Hello Francis', source: 'whatsapp_runtime' });
    assert.strictEqual(row.rejected, undefined);
    assert.strictEqual(row.user_phone, '256768524008', 'a real number still goes through, normalised');
    assert.ok(calls.some((c) => /INSERT INTO outbound_message_queue/i.test(c.sql) && /'pending'/.test(c.sql)));
  });
});

test('the claim query never hands out a recipient that is not a phone number', async () => {
  await withFakeDb(async (calls) => {
    await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
    const claim = calls.find((c) => /UPDATE outbound_message_queue q/i.test(c.sql));
    assert.ok(claim, 'the claim ran');
    assert.match(claim.sql, /~ '\^\[0-9\]\{9,15\}\$'/, 'nine to fifteen digits, nothing else');
  });
});

test('a failure report that WhatsApp will repeat is final; a rate limit backs off', async () => {
  await withFakeDb(async (calls) => {
    await bridge.markWhatsappWebBridgeMessageFailed('q-1', LID_ERROR, { bridge_client_id: 'makaug-waha-gows' });
    const update = calls.find((c) => /UPDATE outbound_message_queue/i.test(c.sql));
    assert.strictEqual(update.params[4], true, 'suppressRetry: the row is failed, not retried');
    assert.match(update.params[3], /"failure_class":"recipient_or_payload_rejected"/);
    assert.match(update.params[3], /"retry_suppressed":true/);
  });
  await withFakeDb(async (calls) => {
    await bridge.markWhatsappWebBridgeMessageFailed('q-2', RATE_ERROR, {});
    const update = calls.find((c) => /UPDATE outbound_message_queue/i.test(c.sql));
    assert.strictEqual(update.params[4], false, 'a rate limit is not final');
    assert.ok(Number(update.params[2]) >= 300, `retry delay ${update.params[2]}s`);
    assert.match(update.params[3], /"failure_class":"rate_limited"/);
  });
  await withFakeDb(async (calls) => {
    await bridge.markWhatsappWebBridgeMessageFailed('q-3', 'WAHA POST /api/sendText -> 500: session status is not as expected', {}, { retryDelaySeconds: 45 });
    const update = calls.find((c) => /UPDATE outbound_message_queue/i.test(c.sql));
    assert.strictEqual(update.params[4], false);
    assert.strictEqual(Number(update.params[2]), 45, 'the bridge may ask for a wait of its own');
  });
});

test('the inbound route ignores a group message outright: nothing stored, nothing answered', async () => {
  const route = require('../routes/whatsapp');
  const app = express();
  app.use(express.json());
  app.use('/api/whatsapp', route);
  const headers = { 'x-whatsapp-web-bridge-token': process.env.WHATSAPP_WEB_BRIDGE_TOKEN };
  await withFakeDb(async (calls) => {
    const res = await request(app).post('/api/whatsapp/web-bridge/inbound').set(headers).send({
      phone: GROUP,
      body: 'Nyumba ya single room Kireka, 150k',
      message_id: 'false_120363423279489703@g.us_ABC',
      contact_name: 'tours and transportation',
      metadata: { source: 'waha_gows_inbound', provider: 'waha', chat_id: GROUP, addressing_mode: 'lid' }
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ignored, true);
    assert.strictEqual(res.body.ignored_reason, 'group_chat');
    assert.strictEqual(calls.length, 0, `no database work for a group message: ${calls.map((c) => c.sql.slice(0, 60)).join(' | ')}`);
  });
  await withFakeDb(async (calls) => {
    // The bridge may already have stripped the suffix; the digits alone say group.
    const res = await request(app).post('/api/whatsapp/web-bridge/inbound').set(headers).send({
      phone: GROUP_DIGITS, body: 'hello', metadata: { source: 'waha_gows_inbound' }
    });
    assert.strictEqual(res.body.ignored_reason, 'group_chat');
    assert.strictEqual(calls.length, 0);
  });
  await withFakeDb(async (calls) => {
    const res = await request(app).post('/api/whatsapp/web-bridge/inbound').set(headers).send({
      phone: '120363001122334455@newsletter', body: 'New listings this week', metadata: { chat_id: '120363001122334455@newsletter' }
    });
    assert.strictEqual(res.body.ignored_reason, 'newsletter_chat');
    assert.strictEqual(calls.length, 0);
  });
});

test('a person still reaches the assistant', async () => {
  const route = require('../routes/whatsapp');
  const app = express();
  app.use(express.json());
  app.use('/api/whatsapp', route);
  const headers = { 'x-whatsapp-web-bridge-token': process.env.WHATSAPP_WEB_BRIDGE_TOKEN };
  const originalQuery = db.query;
  let touched = 0;
  db.query = async (sql) => { touched += 1; throw Object.assign(new Error(`stop here: ${String(sql).slice(0, 40)}`), { code: 'TEST_STOP' }); };
  try {
    const res = await request(app).post('/api/whatsapp/web-bridge/inbound').set(headers).send({
      phone: '256700111222@c.us', body: 'Do you have 2 bedroom in Ntinda?', metadata: { source: 'waha_gows_inbound', chat_id: '256700111222@c.us' }
    });
    assert.notStrictEqual(res.body.ignored_reason, 'group_chat');
    assert.ok(touched >= 1, 'a real customer message goes on to be claimed and handled');
  } finally {
    db.query = originalQuery;
  }
});
