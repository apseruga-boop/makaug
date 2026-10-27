'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function assertDisposableDatabase(pool) {
  const url = new URL(process.env.PESAPAL_TEST_DATABASE_URL || 'postgresql://invalid/');
  assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname), 'test DB URL must be loopback');
  assert.match(url.pathname, /^\/makaug_pesapal_test_[a-f0-9]+$/);
  assert.equal(process.env.DATABASE_URL, url.href, 'application and proof clients must share the owned test database');
  const identity = (await pool.query(`SELECT current_database() AS database, current_user AS role,
    host(inet_server_addr()) AS host, rolsuper, rolcreatedb, rolcreaterole
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.equal(identity.database, url.pathname.slice(1));
  assert.equal(identity.role, process.env.PESAPAL_TEST_ROLE);
  assert.ok(['127.0.0.1', '::1'].includes(identity.host));
  assert.equal(identity.rolsuper, false);
  assert.equal(identity.rolcreatedb, false);
  assert.equal(identity.rolcreaterole, false);
  const guard = (await pool.query('SELECT sentinel::text FROM pesapal_test_guard')).rows;
  assert.deepEqual(guard, [{ sentinel: process.env.PESAPAL_TEST_SENTINEL }]);
}

async function fakePesapal() {
  const orders = new Map();
  const counters = { token: 0, submit: 0, status: 0 };
  let origin;
  let lostSubmit = false;
  let rejectStatusOnce = false;
  let rejectTokenOnce = false;
  let statusGate;
  let submitGate;
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const json = (value, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100000) throw new Error('Oversized local provider request');
      }
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/api/Auth/RequestToken') {
        counters.token += 1;
        if (rejectTokenOnce) { rejectTokenOnce = false; return json({ status: '500', error: { code: 'LOCAL_TOKEN_FAILURE' } }, 500); }
        assert.equal(body.consumer_key, 'local-test-key');
        assert.equal(body.consumer_secret, 'local-test-secret');
        return json({ status: '200', error: null, token: `local-token-${counters.token}`, expiryDate: new Date(Date.now() + 300000).toISOString() });
      }
      assert.match(req.headers.authorization || '', /^Bearer local-token-/);
      if (url.pathname === '/api/Transactions/SubmitOrderRequest') {
        counters.submit += 1;
        const trackingId = crypto.randomUUID();
        const order = { trackingId, reference: body.id, amount: body.amount, currency: body.currency, statusCode: 0, request: body };
        orders.set(trackingId, order);
        if (submitGate) {
          const gate = submitGate; submitGate = null;
          gate.entered.resolve(order);
          await gate.release.promise;
        }
        if (lostSubmit) { lostSubmit = false; return res.destroy(); }
        return json({ status: '200', error: null, order_tracking_id: trackingId, merchant_reference: body.id, redirect_url: `${origin}/checkout/${trackingId}` });
      }
      if (url.pathname === '/api/Transactions/GetTransactionStatus') {
        counters.status += 1;
        if (rejectStatusOnce) { rejectStatusOnce = false; return json({ status: '401' }, 401); }
        const order = orders.get(url.searchParams.get('orderTrackingId'));
        if (!order) return json({ status: '404' }, 404);
        const observation = { payment_method: 'MTN', amount: order.amount, currency: order.currency,
          merchant_reference: order.reference, confirmation_code: `LOCAL-${order.trackingId}`,
          status_code: order.statusCode, payment_status_description: ['INVALID', 'COMPLETED', 'FAILED', 'REVERSED'][order.statusCode],
          created_date: '2026-10-27T10:00:00.000Z', error: null, status: '200' };
        if (statusGate) {
          const gate = statusGate; statusGate = null;
          gate.entered.resolve(order);
          await gate.release.promise;
        }
        return json(observation);
      }
      if (url.pathname === '/api/URLSetup/GetIpnList') return json([]);
      if (url.pathname === '/api/URLSetup/RegisterIPN') return json({ status: '200', error: null,
        ipn_id: '11111111-1111-4111-8111-111111111111', url: body.url, ipn_status: 1, ipn_notification_type_description: 'POST' });
      return json({ status: '404' }, 404);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  function gate(kind) {
    const value = { entered: deferred(), release: deferred() };
    if (kind === 'status') statusGate = value; else submitGate = value;
    return { entered: value.entered.promise, release: () => value.release.resolve() };
  }
  return {
    origin, baseUrl: `${origin}/api/`, orders, counters,
    loseNextSubmit: () => { lostSubmit = true; },
    failNextToken: () => { rejectTokenOnce = true; },
    expireNextStatusToken: () => { rejectStatusOnce = true; },
    holdNextStatus: () => gate('status'), holdNextSubmit: () => gate('submit'),
    complete(id, extra = {}) { Object.assign(orders.get(id), { statusCode: 1 }, extra); },
    reverse(id) { orders.get(id).statusCode = 3; },
    close: async () => {
      if (statusGate) statusGate.release.resolve();
      if (submitGate) submitGate.release.resolve();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function checkoutInSeparateProcess(code) {
  const source = `
    const fetchHttp = global.fetch;
    global.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!['127.0.0.1','[::1]','localhost'].includes(url.hostname)) throw new Error('Nonlocal provider refused');
      return fetchHttp(input, options);
    };
    const db = require('./config/database');
    const pay = require('./services/payLinkService');
    (async () => {
      try { await pay.startPesapalCheckout(db, {code:process.argv[1]}); }
      catch (error) { if (error.outcome !== 'unknown' && !['transport_error','timeout'].includes(error.code)) throw error; }
      finally { await Promise.all([db.pool.end(),db.backgroundPool.end()]); }
    })().catch(error => { console.error(error.code || error.message); process.exitCode=1; });
  `;
  const child = spawn(process.execPath, ['-e', source, code], {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output = (output + data).slice(-4000); });
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(exitCode, 0, `Isolated checkout process failed: ${output}`);
}

module.exports = { assertDisposableDatabase, fakePesapal, deferred, checkoutInSeparateProcess };
