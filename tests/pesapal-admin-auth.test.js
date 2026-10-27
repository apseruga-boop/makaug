'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const envKeys = ['NODE_ENV', 'ADMIN_API_KEY', 'JWT_SECRET', 'PESAPAL_ENABLED', 'PESAPAL_ENV', 'PESAPAL_CONSUMER_KEY', 'PESAPAL_CONSUMER_SECRET'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, { NODE_ENV: 'test', ADMIN_API_KEY: 'local-pesapal-admin-proof', JWT_SECRET: 'local-pesapal-jwt-proof',
  PESAPAL_ENABLED: 'false', PESAPAL_ENV: 'sandbox', PESAPAL_CONSUMER_KEY: 'DUMMY-PRIVATE-KEY', PESAPAL_CONSUMER_SECRET: 'DUMMY-PRIVATE-SECRET' });

const paths = ['../config/database', '../services/payLinkService', '../routes/admin', '../middleware/auth'].map(name => require.resolve(name));
const savedModules = new Map(paths.map(filename => [filename, require.cache[filename]]));
const state = { calls: [], sql: [], userRole: 'admin', attempt: { tracking_id: '11111111-1111-4111-8111-111111111111', merchant_reference: 'MKP-local-admin-proof' }, backendError: null };
const attemptId = '22222222-2222-4222-8222-222222222222';
const trackingId = '33333333-3333-4333-8333-333333333333';
const fakeDb = { query: async (sql, params) => {
  state.sql.push({ sql, params });
  if (sql.includes('FROM users WHERE id')) {
    if (state.backendError) throw state.backendError;
    return { rows: [{ id: 'local-user', role: state.userRole, status: 'active' }] };
  }
  if (sql.includes('FROM pesapal_payment_attempts')) return { rows: state.attempt ? [{ ...state.attempt }] : [] };
  if (sql.includes('INSERT INTO audit_logs')) return { rows: [] };
  throw new Error('Unexpected database call in protected-route proof.');
} };
const fakePayments = {
  listPesapalAttempts: async (_db, options) => { state.calls.push({ operation: 'list', options }); return [{ id: attemptId, creation_state: 'unknown', environment: 'sandbox' }]; },
  observePesapalPayment: async (_db, input) => { state.calls.push({ operation: 'check', input }); return { state: 'pending', paid: false }; },
  recoverPesapalAttempt: async (_db, input) => { state.calls.push({ operation: 'recover', input }); return { state: 'review', paid: false }; }
};
require.cache[paths[0]] = { id: paths[0], filename: paths[0], loaded: true, exports: fakeDb };
require.cache[paths[1]] = { id: paths[1], filename: paths[1], loaded: true, exports: fakePayments };
delete require.cache[paths[2]];
delete require.cache[paths[3]];
const nativeFetch = global.fetch;
global.fetch = async () => { throw new Error('External network forbidden in protected-route proof.'); };
const admin = require('../routes/admin');
const app = express();
app.use(express.json());
app.use('/api/admin', admin);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, error: 'Local test error', code: error.code }));

after(() => {
  global.fetch = nativeFetch;
  for (const [filename, prior] of savedModules) {
    if (prior) require.cache[filename] = prior;
    else delete require.cache[filename];
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const endpoints = [
  ['get', '/api/admin/revenue/pesapal'],
  ['post', `/api/admin/revenue/pesapal/${attemptId}/check`],
  ['post', `/api/admin/revenue/pesapal/${attemptId}/recover`]
];

test('all real admin Pesapal routes reject missing or wrong credentials before any payment/SQL call', async () => {
  state.calls = []; state.sql = [];
  for (const [method, url] of endpoints) {
    for (const headers of [{}, { 'x-api-key': 'wrong-local-key' }, { authorization: 'Bearer invalid-local-token' }]) {
      const response = await request(app)[method](url).set(headers).send({ tracking_id: trackingId });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { ok: false, error: 'Unauthorized' });
    }
  }
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.sql, []);
});

test('an authenticated non-admin user cannot inspect, check or recover payment attempts', async () => {
  state.userRole = 'staff'; state.calls = []; state.sql = [];
  const token = jwt.sign({ sub: 'local-user' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  for (const [method, url] of endpoints) {
    const response = await request(app)[method](url).set('Authorization', `Bearer ${token}`).send({ tracking_id: trackingId });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { ok: false, error: 'Unauthorized' });
  }
  assert.deepEqual(state.calls, []);
  assert.equal(state.sql.length, 3);
  assert.ok(state.sql.every(query => query.sql.includes('FROM users WHERE id')));
  state.userRole = 'admin';
});

test('authorized listing returns actual service data and nonsecret readiness', async () => {
  state.calls = []; state.sql = [];
  const response = await request(app).get('/api/admin/revenue/pesapal?limit=7').set('x-api-key', process.env.ADMIN_API_KEY);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.data.attempts, [{ id: attemptId, creation_state: 'unknown', environment: 'sandbox' }]);
  assert.deepEqual(state.calls, [{ operation: 'list', options: { limit: '7' } }]);
  assert.equal(response.body.data.readiness.ready, false);
  for (const secret of ['DUMMY-PRIVATE-KEY', 'DUMMY-PRIVATE-SECRET', process.env.ADMIN_API_KEY, process.env.JWT_SECRET]) assert.equal(response.text.includes(secret), false);
});

test('authorized check uses stored provider identifiers and writes a safe audit', async () => {
  state.calls = []; state.sql = [];
  const response = await request(app).post(`/api/admin/revenue/pesapal/${attemptId}/check`).set('x-api-key', process.env.ADMIN_API_KEY)
    .send({ tracking_id: trackingId, reference: 'FORGED-BROWSER-REFERENCE' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, data: { state: 'pending', paid: false } });
  assert.deepEqual(state.calls, [{ operation: 'check', input: { trackingId: state.attempt.tracking_id, reference: state.attempt.merchant_reference, source: 'admin' } }]);
  assert.deepEqual(state.sql[0].params, [attemptId]);
  const audit = state.sql.find(query => query.sql.includes('INSERT INTO audit_logs'));
  assert.equal(audit.params[1], 'pesapal_attempt_checked');
  assert.deepEqual(JSON.parse(audit.params[2]), { attempt_id: attemptId, state: 'pending' });
});

test('authorized missing or untracked attempts never trigger provider observation', async () => {
  const prior = state.attempt;
  state.calls = []; state.attempt = null;
  assert.equal((await request(app).post(`/api/admin/revenue/pesapal/${attemptId}/check`).set('x-api-key', process.env.ADMIN_API_KEY)).status, 404);
  state.attempt = { merchant_reference: 'MKP-unknown', tracking_id: null };
  const response = await request(app).post(`/api/admin/revenue/pesapal/${attemptId}/check`).set('x-api-key', process.env.ADMIN_API_KEY);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Recover tracking ID/);
  assert.deepEqual(state.calls, []);
  state.attempt = prior;
});

test('authorized recovery passes one selected attempt/tracking ID and authenticated actor only', async () => {
  state.calls = []; state.sql = [];
  const token = jwt.sign({ sub: 'local-user' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const response = await request(app).post(`/api/admin/revenue/pesapal/${attemptId}/recover`).set('Authorization', `Bearer ${token}`)
    .send({ tracking_id: trackingId, actor: 'forged-actor', amount: 1, reference: 'forged-reference' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, data: { state: 'review', paid: false } });
  assert.deepEqual(state.calls, [{ operation: 'recover', input: { attemptId, trackingId, actor: 'local-user' } }]);
  const audit = state.sql.find(query => query.sql.includes('INSERT INTO audit_logs'));
  assert.equal(audit.params[0], 'local-user');
  assert.equal(audit.params[1], 'pesapal_attempt_recovered');
});

test('malformed authenticated attempt IDs fail before SQL or domain payment actions', async () => {
  state.calls = []; state.sql = [];
  for (const action of ['check', 'recover']) {
    const response = await request(app).post(`/api/admin/revenue/pesapal/not-a-uuid/${action}`)
      .set('x-api-key', process.env.ADMIN_API_KEY).send({ tracking_id: trackingId });
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
  }
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.sql, []);
});

test('authentication backend failure fails closed without payment data or private details', async () => {
  state.calls = []; state.sql = [];
  state.backendError = Object.assign(new Error('SECRET_DB_DETAIL'), { code: 'LOCAL_BACKEND_FAILURE' });
  try {
    const token = jwt.sign({ sub: 'local-user' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const response = await request(app).get('/api/admin/revenue/pesapal').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 503);
    assert.equal(response.headers['retry-after'], '5');
    assert.equal(response.body.code, 'AUTH_BACKEND_UNAVAILABLE');
    assert.equal(response.text.includes('SECRET_DB_DETAIL'), false);
    assert.deepEqual(state.calls, []);
  } finally { state.backendError = null; }
});
