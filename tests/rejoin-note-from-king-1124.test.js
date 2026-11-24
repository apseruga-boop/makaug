'use strict';

/**
 * 24 Nov 2026. An agent removed the day before for not paying had sent a plot
 * that morning, before the kind note existed. King sends him the note now, the
 * same way it goes at removal and when a removed agent writes: an older one
 * still waiting is replaced, the day it went is kept so he is not sent it
 * again when he replies, and it thanks him for the plot he sent.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const billingOps = require('../services/billingOpsService');
const payLinks = require('../services/payLinkService');
const adminRouter = require('../routes/admin');

const AGENT_ID = '0e0e0e0e-0000-4000-8000-000000000011';

function routeHandler(method, routePath) {
  const layer = adminRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(body) { this.body = body; return this; }
  };
}

async function withStubs(stubs, run) {
  const saved = [];
  for (const [target, key, value] of stubs) {
    saved.push([target, key, target[key]]);
    target[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [target, key, value] of saved.reverse()) target[key] = value;
  }
}

const send = routeHandler('post', '/revenue/agents/:id/billing-message');
const preview = routeHandler('get', '/revenue/agents/:id/billing-message/:kind');

test('King sends a removed agent the kind note the same way as at removal, thanking them for the plot', async () => {
  const notes = [];
  const audit = [];
  const res = fakeRes();
  await withStubs([
    [billingOps, 'sendRejoinMessage', async (_db, args) => { notes.push(args); return { kind: 'rejoin', to: '256700000111', status: 'queued', text: 'Hi Moses' }; }],
    [billingOps, 'sendAgentBillingMessage', async () => { throw new Error('not this way'); }],
    [db, 'query', async (sql, params = []) => {
      if (/INSERT INTO audit_logs/.test(sql)) audit.push({ action: params[1], details: JSON.parse(params[2]) });
      return { rows: [] };
    }]
  ], () => send({ params: { id: AGENT_ID }, body: { kind: 'rejoin', sent_thing: 'plot' }, adminAuth: { userId: 'admin-1' } }, res, (error) => { throw error; }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.deepStrictEqual(notes, [{ agentId: AGENT_ID, sentThing: 'plot', actor: 'admin-1' }]);
  assert.deepStrictEqual(audit, [{ action: 'agent_billing_message_sent', details: { agent_id: AGENT_ID, kind: 'rejoin', status: 'queued' } }]);
});

test('only a plot or a property is named; anything else gives the note without it', async () => {
  for (const [given, want] of [['property', 'property'], ['Plot', 'plot'], ['house', ''], ['', ''], [undefined, '']]) {
    const notes = [];
    await withStubs([
      [billingOps, 'sendRejoinMessage', async (_db, args) => { notes.push(args); return { kind: 'rejoin', status: 'queued' }; }],
      [db, 'query', async () => ({ rows: [] })]
    ], () => send({ params: { id: AGENT_ID }, body: { kind: 'rejoin', sent_thing: given } }, fakeRes(), (error) => { throw error; }));
    assert.strictEqual(notes[0].sentThing, want, String(given));
  }
});

test('an agent who was not removed, or was removed for the rules, is told why nothing went', async () => {
  for (const [skipped, wording] of [['not_removed', /has not been removed/], ['not_rejoinable', /not invited back/]]) {
    const res = fakeRes();
    await withStubs([
      [billingOps, 'sendRejoinMessage', async () => ({ skipped })],
      [db, 'query', async () => ({ rows: [] })]
    ], () => send({ params: { id: AGENT_ID }, body: { kind: 'rejoin' } }, res, (error) => { throw error; }));
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.ok, false);
    assert.match(res.body.error, wording);
  }
});

test('the other billing messages go as before', async () => {
  const sent = [];
  const res = fakeRes();
  await withStubs([
    [billingOps, 'sendRejoinMessage', async () => { throw new Error('not this way'); }],
    [billingOps, 'sendAgentBillingMessage', async (_db, args) => { sent.push(args); return { kind: args.kind, status: 'queued' }; }],
    [db, 'query', async () => ({ rows: [] })]
  ], () => send({ params: { id: AGENT_ID }, body: { kind: 'reminder' } }, res, (error) => { throw error; }));
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(sent, [{ agentId: AGENT_ID, kind: 'reminder', actor: 'admin_api_key' }]);
});

test('the preview of the note shows the payment link and the thing they sent', async () => {
  const res = fakeRes();
  const agent = {
    id: AGENT_ID, full_name: 'Moses Testname', greeting_name: 'Moses', paid_until: '2026-11-12', monthly_fee_ugx: 50000,
    removed_at: '2026-11-23T14:11:14Z', removed_reason: 'Has not paid yet', removal_snapshot: { reason_code: 'not_paying' }
  };
  await withStubs([
    [db, 'query', async (sql) => (/FROM agents WHERE id/.test(sql) ? { rows: [agent] } : { rows: [] })],
    [billingOps, 'getSettings', async () => ({ agent_fee: { monthly_ugx: 50000 } })],
    [payLinks, 'createPayLink', async () => ({ url: 'https://makaug.com/pay/TESTCODE' })]
  ], () => preview({ params: { id: AGENT_ID, kind: 'rejoin' }, query: { sent_thing: 'plot' } }, res, (error) => { throw error; }));
  assert.strictEqual(res.body.ok, true);
  const text = res.body.data.text;
  assert.match(text, /^Hi Moses, thank you for sending this plot, and for all the properties you've shared with makaug\./);
  assert.match(text, /https:\/\/makaug\.com\/pay\/TESTCODE/);
  assert.match(text, /the plot you've just sent goes to our team for review/);
  assert.match(text, /Phillip, MakaUG$/);
});
