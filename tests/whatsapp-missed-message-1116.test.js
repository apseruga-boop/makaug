'use strict';

/**
 * A message somebody sent while the number was unlinked.
 *
 * 16 Nov 2026: three people wrote while the WhatsApp link was down. WhatsApp
 * kept their messages on the phone; makaug never saw them. Two replies staff
 * approved were then held, because the only-to-people-who-wrote rule had no
 * record of them writing. Staff now record what they sent and when, and from
 * then the inbox shows it and the rule knows they wrote. Nothing is sent.
 *
 * Every number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const admin = require('../routes/admin');
const bridge = require('../services/whatsappWebBridgeService');

function handler() {
  const layer = admin.stack.find((l) => l.route && l.route.path === '/whatsapp/conversations/:phone/missed-message' && l.route.methods.post);
  assert.ok(layer, 'the endpoint exists');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function call(params, body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    handler()({ params, body, headers: {}, user: { id: 'staff-1' } }, res, reject);
  });
}

function withFakeDb(reply, run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return reply(String(sql), params) || { rows: [], rowCount: 0 };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

test('what they sent is recorded as theirs, at the time they sent it, and nothing is sent', async () => {
  const at = new Date(Date.now() - 14 * 3600 * 1000).toISOString();
  await withFakeDb((sql) => (/INSERT INTO whatsapp_messages/.test(sql) ? { rows: [{ id: 'x' }], rowCount: 1 } : null), async (calls) => {
    const result = await call({ phone: '0700000605' }, { text: 'Hello makaug, I need help finding a property', at, wa_message_id: 'false_256700000605@c.us_3EB0ABC' });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body, { ok: true, data: { recorded: 1 } });
    const insert = calls.find((c) => /INSERT INTO whatsapp_messages/.test(c.sql));
    assert.ok(insert, 'one inbound row');
    assert.match(insert.sql, /'inbound', 'text'/);
    assert.strictEqual(insert.params[0], '256700000605');
    assert.strictEqual(insert.params[1], 'missed:false_256700000605@c.us_3EB0ABC');
    assert.deepStrictEqual(JSON.parse(insert.params[2]).missed_while_unlinked, true);
    assert.strictEqual(JSON.parse(insert.params[2]).body, 'Hello makaug, I need help finding a property');
    assert.strictEqual(insert.params[3], at);
    assert.ok(!calls.some((c) => /outbound_message_queue/.test(c.sql)), 'nothing is queued to them');
  });
});

test('it needs what they sent and when, within the last fortnight', async () => {
  await withFakeDb(() => null, async (calls) => {
    assert.strictEqual((await call({ phone: '256700000605' }, { text: '', at: new Date().toISOString() })).status, 400);
    assert.strictEqual((await call({ phone: '256700000605' }, { text: 'Hi' })).status, 400);
    assert.strictEqual((await call({ phone: '256700000605' }, { text: 'Hi', at: new Date(Date.now() - 15 * 86400 * 1000).toISOString() })).status, 400);
    assert.strictEqual((await call({ phone: '256700000605' }, { text: 'Hi', at: new Date(Date.now() + 3600 * 1000).toISOString() })).status, 400);
    assert.strictEqual((await call({ phone: '12' }, { text: 'Hi', at: new Date().toISOString() })).status, 400);
    assert.strictEqual(calls.length, 0);
  });
});

test('the rule counts a recorded message as having written', () => {
  const sql = bridge.hasWrittenSql('q');
  assert.match(sql, /FROM whatsapp_messages m\s+WHERE m\.direction = 'inbound'/);
  assert.match(sql, /m\.message_type <> 'call'/);
});
