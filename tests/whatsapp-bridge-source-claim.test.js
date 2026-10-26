'use strict';

// The WhatsApp sender only drains outbox rows whose metadata.source is on its
// allow-list (whatsapp_runtime, whatsapp_missed_call). An agent_booking reply
// queued on 23 Oct 2026 sat there with 0 attempts because it used its own
// source. These tests pin the fix: chat replies go out under the chat-reply
// source with their origin in metadata, and anything queued under a source the
// sender ignores is logged loudly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const dbPath = require.resolve('../config/database');
const loggerPath = require.resolve('../config/logger');
const bridgePath = require.resolve('../services/whatsappWebBridgeService');

function loadBridge({ inserts, warnings }) {
  const saved = { db: require.cache[dbPath], logger: require.cache[loggerPath], bridge: require.cache[bridgePath] };
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (sql, params) => {
        if (/^\s*SELECT/i.test(sql)) return { rows: [] };
        if (/INSERT INTO outbound_message_queue/i.test(sql)) {
          inserts.push(params);
          return { rows: [{ id: 'q-1' }] };
        }
        return { rows: [] };
      }
    }
  };
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: { warn: (...args) => warnings.push(args), info() {}, error() {}, debug() {} }
  };
  delete require.cache[bridgePath];
  const bridge = require('../services/whatsappWebBridgeService');
  const restore = () => {
    for (const [key, p] of [['db', dbPath], ['logger', loggerPath], ['bridge', bridgePath]]) {
      if (saved[key]) require.cache[p] = saved[key];
      else delete require.cache[p];
    }
  };
  return { bridge, restore };
}

function insertedMetadata(params) {
  const json = params.find((value) => typeof value === 'string' && value.includes('"delivery_mode"'));
  return JSON.parse(json);
}

test('claimed sources default to the sender allow-list and follow its env var', () => {
  const inserts = []; const warnings = [];
  const { bridge, restore } = loadBridge({ inserts, warnings });
  const saved = { a: process.env.WHATSAPP_WEB_BRIDGE_CLAIMED_SOURCES, b: process.env.WHATSAPP_WEB_COPILOT_OUTBOX_ALLOWED_SOURCES };
  try {
    delete process.env.WHATSAPP_WEB_BRIDGE_CLAIMED_SOURCES;
    delete process.env.WHATSAPP_WEB_COPILOT_OUTBOX_ALLOWED_SOURCES;
    assert.deepEqual(bridge.bridgeClaimedSources(), ['whatsapp_runtime', 'whatsapp_missed_call']);
    assert.equal(bridge.isBridgeClaimedSource('whatsapp_runtime'), true);
    assert.equal(bridge.isBridgeClaimedSource('agent_booking'), false);
    assert.equal(bridge.isBridgeClaimedSource('short_stay_request'), false);
    process.env.WHATSAPP_WEB_COPILOT_OUTBOX_ALLOWED_SOURCES = 'whatsapp_runtime,agent_booking';
    assert.equal(bridge.isBridgeClaimedSource('agent_booking'), true);
    assert.equal(bridge.bridgeChatReplySource(), 'whatsapp_runtime');
  } finally {
    for (const [k, v] of [['WHATSAPP_WEB_BRIDGE_CLAIMED_SOURCES', saved.a], ['WHATSAPP_WEB_COPILOT_OUTBOX_ALLOWED_SOURCES', saved.b]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    restore();
  }
});

test('queuing under a source the sender ignores logs an alert and flags the row', async () => {
  const inserts = []; const warnings = [];
  const { bridge, restore } = loadBridge({ inserts, warnings });
  try {
    await bridge.queueWhatsappWebBridgeMessage({ recipient: '+256700000001', text: 'hello', source: 'agent_booking' });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /does not claim/);
    assert.equal(warnings[0][1].alert, 'whatsapp_bridge_source_unclaimed');
    assert.equal(warnings[0][1].source, 'agent_booking');
    assert.equal(warnings[0][1].recipient, '***0001');
    assert.equal(insertedMetadata(inserts[0]).bridge_source_unclaimed, true);
  } finally {
    restore();
  }
});

test('chat replies under the chat-reply source queue quietly with their origin kept', async () => {
  const inserts = []; const warnings = [];
  const { bridge, restore } = loadBridge({ inserts, warnings });
  try {
    await bridge.queueWhatsappWebBridgeMessage({
      recipient: '+256700000002',
      text: 'Your viewing is booked',
      source: bridge.bridgeChatReplySource(),
      metadata: { reply_origin: 'agent_booking' }
    });
    assert.equal(warnings.length, 0);
    const meta = insertedMetadata(inserts[0]);
    assert.equal(meta.source, 'whatsapp_runtime');
    assert.equal(meta.reply_origin, 'agent_booking');
    assert.equal(meta.bridge_source_unclaimed, undefined);
  } finally {
    restore();
  }
});

test('short-stay notices queue as chat replies with origin short_stay_request', async () => {
  const { deliverStayNotice } = require('../services/shortTermBookingService');
  const queued = [];
  await deliverStayNotice(
    { phone: '+256700000003', email: '', text: 'Stay request received', reference: 'ST-1', event: 'request', role: 'host' },
    { bridgeEnabled: true, queueWhatsappWebBridgeMessage: async (msg) => { queued.push(msg); return { id: 'q' }; }, sendSupportEmail: async () => ({ sent: false }) }
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].source, 'whatsapp_runtime');
  assert.equal(queued[0].metadata.reply_origin, 'short_stay_request');
});

test('bot replies for stays and agent bookings use the chat-reply source', () => {
  const src = read('routes/whatsapp.js');
  assert.doesNotMatch(src, /source:\s*'agent_booking'/);
  assert.doesNotMatch(src, /source:\s*'short_stay_request'/);
  assert.match(src, /source: bridgeChatReplySource\(\),\s*origin: 'agent_booking'/);
  assert.match(src, /source: bridgeChatReplySource\(\),\s*origin: 'short_stay_request'/);
  assert.match(src, /reply_origin: origin/);
  assert.doesNotMatch(read('services/shortTermBookingService.js'), /source:\s*'short_stay_request'/);
});

test('every literal source handed to the auto-reply helper is one the sender claims', () => {
  const src = read('routes/whatsapp.js');
  const claimed = ['whatsapp_runtime', 'whatsapp_missed_call'];
  const calls = src.split('queueWhatsappWebBridgeAutoReply({').slice(1).map((chunk) => chunk.slice(0, 400));
  assert.ok(calls.length >= 3);
  for (const call of calls) {
    const literal = call.match(/source:\s*'([^']+)'/);
    if (literal) assert.ok(claimed.includes(literal[1]), `unclaimed source ${literal[1]}`);
  }
});
