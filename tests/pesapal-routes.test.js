'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const vm = require('node:vm');
const fs = require('node:fs');
const acorn = require('acorn');

process.env.NODE_ENV = 'test';
const databasePath = require.resolve('../config/database');
const servicePath = require.resolve('../services/payLinkService');
const savedDatabase = require.cache[databasePath];
const savedService = require.cache[servicePath];
const debt = { code: 'MKTESTAA', status: 'open', description: '<Listing>', amount_ugx_text: 'UGX 50,000',
  pesapal_available: true, pesapal_needs_contact: true, pay_to_ready: true, pay_to: { number: '256780863394' } };
let current = { ...debt };
let checkout;
let observed = [];
let providerError;
const fakeService = {
  pageData: async () => ({ ...current }),
  startPesapalCheckout: async (_db, input) => { checkout = input; return { kind: 'pending', state: 'unknown' }; },
  observePesapalPayment: async (_db, input) => { observed.push(input); if (providerError) throw providerError; return { state: 'pending', paid: false }; }
};
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => { throw new Error('No SQL in route unit proof'); } } };
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: fakeService };
const routes = require('../routes/pay');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/pay', routes.pages);
app.use('/api/pay', routes.api);
after(() => {
  if (savedDatabase) require.cache[databasePath] = savedDatabase; else delete require.cache[databasePath];
  if (savedService) require.cache[servicePath] = savedService; else delete require.cache[servicePath];
});
const notification = { OrderTrackingId: '00000000-0000-4000-8000-000000000001', OrderMerchantReference: 'MKP-local-proof', OrderNotificationType: 'IPNCHANGE' };

test('public checkout renders UGX Pesapal form and escapes description', async () => {
  const response = await request(app).get('/pay/MKTESTAA');
  assert.equal(response.status, 200);
  assert.match(response.text, /action="\/pay\/MKTESTAA\/pesapal"/);
  assert.match(response.text, /name="phone"/);
  assert.match(response.text, /Airtel Money/);
  assert.match(response.text, /&lt;Listing&gt;/);
  for (const privateLabel of ['Admin Dashboard', 'Current Password', 'Admin API Key', 'CRM', 'Security']) assert.ok(!response.text.includes(privateLabel));
});

test('an uncertain checkout shows waiting state and does not invite another payment', async () => {
  const response = await request(app).post('/pay/MKTESTAA/pesapal').type('form').send({ phone: '+256700000001' });
  assert.equal(response.status, 200);
  assert.deepEqual(checkout, { code: 'MKTESTAA', phone: '+256700000001' });
  assert.match(response.text, /checking your Pesapal payment/);
  assert.doesNotMatch(response.text, /<button/);
});

test('settling is not a paid receipt and committed paid can carry a review notice', async () => {
  current = { ...debt, status: 'settling', pesapal_state: 'sending' };
  const settling = await request(app).get('/pay/MKTESTAA');
  assert.doesNotMatch(settling.text, /<h1>Paid/);
  current = { ...debt, status: 'paid', pesapal_review: true, paid_method: 'pesapal' };
  const paid = await request(app).get('/pay/MKTESTAA');
  assert.match(paid.text, /<h1>Paid/);
  assert.match(paid.text, /needs a team review/);
  current = { ...debt };
});

test('a reserved attempt can retry the same checkout while an unknown attempt waits', async () => {
  current = { ...debt, pesapal_state: 'reserved', pesapal_can_resume: true };
  const reserved = await request(app).get('/pay/MKTESTAA');
  assert.match(reserved.text, /Continue your existing Pesapal checkout/);
  assert.doesNotMatch(reserved.text, /I have paid/);
  current = { ...debt, pesapal_state: 'unknown', pesapal_can_resume: false };
  const uncertain = await request(app).get('/pay/MKTESTAA');
  assert.doesNotMatch(uncertain.text, /<button/);
  current = { ...debt };
});

test('return and IPN enforce distinct notification types before domain lookup', async () => {
  observed = [];
  for (const fields of [{ ...notification, OrderNotificationType: 'CALLBACKURL' }, { ...notification, OrderTrackingId: 'bad' }, { ...notification, OrderMerchantReference: ['a', 'b'] }]) {
    assert.equal((await request(app).post('/api/pay/webhooks/pesapal').send(fields)).status, 400);
  }
  assert.equal(observed.length, 0);
  const returned = await request(app).get('/pay/MKTESTAA/pesapal-return').query({ ...notification, OrderNotificationType: 'CALLBACKURL' });
  assert.equal(returned.status, 303);
  assert.equal(observed[0].expectedCode, 'MKTESTAA');
  assert.equal(observed[0].source, 'return');
  const ipn = await request(app).post('/api/pay/webhooks/pesapal').send(notification);
  assert.equal(ipn.status, 200);
  assert.deepEqual(ipn.body, { orderNotificationType: 'IPNCHANGE', orderTrackingId: notification.OrderTrackingId,
    orderMerchantReference: notification.OrderMerchantReference, status: 200 });
});

test('a transient status failure gives Pesapal a retry response without private details', async () => {
  providerError = Object.assign(new Error('PRIVATE-PROVIDER-DETAIL'), { code: 'status_unavailable' });
  try {
    const response = await request(app).post('/api/pay/webhooks/pesapal').send(notification);
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { status: 500 });
  } finally { providerError = undefined; }
});

function adminFunctions() {
  const source = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
  const names = new Set(['adminPesapalBlock', 'adminCheckPesapalAttempt', 'adminRecoverPesapalAttempt', 'adminRevenueStatusBadge']);
  const statements = acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
  const state = { calls: [], toasts: [], loads: 0, prompt: notification.OrderTrackingId };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const context = vm.createContext({ adminEscape: escape, adminAttr: escape, adminFormatUgx: value => `UGX ${value}`, adminAuthHeaders: () => ({ Authorization: 'local-proof' }),
    apiRequest: async (url, options) => { state.calls.push({ url, options }); return { data: { state: 'review' } }; },
    toast: message => state.toasts.push(message), loadAdminRevenue: () => { state.loads++; }, window: { prompt: () => state.prompt } });
  vm.runInContext(statements.map(node => source.slice(node.start, node.end)).join('\n'), context);
  return { context, state };
}

test('dashboard renders truthful review and queue states and escapes provider identifiers', () => {
  const { context } = adminFunctions();
  const html = context.adminPesapalBlock({ readiness: { ready: false, reasons: ['merchant_not_approved'] },
    notices: [{ status: 'queued', count: 2 }], attempts: [{ id: notification.OrderTrackingId, code: 'MKTESTAA', merchant_reference: '<script>', amount_ugx: 50000, creation_state: 'unknown', environment: 'sandbox' }] });
  assert.match(html, /Merchant approval is pending/);
  assert.match(html, /2 queued/);
  assert.match(html, /Submission uncertain/);
  assert.match(html, /Recover tracking ID/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(context.adminRevenueStatusBadge({ verified_status: 'verified', payment_application: 'excess' }), /extra collection/);
});

test('dashboard recovery submits only the selected attempt and entered tracking ID', async () => {
  const { context, state } = adminFunctions();
  await context.adminRecoverPesapalAttempt('attempt-1');
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].url, '/api/admin/revenue/pesapal/attempt-1/recover');
  assert.equal(state.calls[0].options.body.tracking_id, notification.OrderTrackingId);
  assert.equal(state.loads, 1);
  state.prompt = 'not-a-tracking-id';
  await context.adminRecoverPesapalAttempt('attempt-2');
  assert.equal(state.calls.length, 1);
});
