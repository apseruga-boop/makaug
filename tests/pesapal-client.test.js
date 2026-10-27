'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, after } = require('node:test');
const { createPesapalClient, fromEnvironment, readiness, parseWholeUgx, PesapalError } = require('../services/pesapalClient');

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
after(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

const TRACKING = '11111111-1111-1111-1111-111111111111';
const NOTIFICATION = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const REFERENCE = 'MKP-44444444-4444-4444-4444-444444444444';
const CONFIG = {
  COUNTRY_CODE: 'UG', PESAPAL_ENABLED: 'true', PESAPAL_ENV: 'sandbox',
  PESAPAL_CONSUMER_KEY: 'dummy-consumer-key', PESAPAL_CONSUMER_SECRET: 'dummy-consumer-secret',
  PESAPAL_IPN_ID: NOTIFICATION, PUBLIC_BASE_URL: 'https://makaug.example/'
};

function statusBody(overrides = {}) {
  return { status: '200', error: null, merchant_reference: REFERENCE, amount: 50000, currency: 'UGX',
    status_code: 1, payment_method: 'MTN', confirmation_code: 'receipt-123', created_date: '2026-10-27T10:00:00', ...overrides };
}

async function fake(t, hooks = {}) {
  const requests = [];
  let clock = Date.parse('2026-10-27T10:00:00Z');
  let origin;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const call = { path: req.url, method: req.method, headers: req.headers, body };
    requests.push(call);
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    const kind = req.url.includes('RequestToken') ? 'token' : req.url.includes('SubmitOrderRequest') ? 'submit' : req.url.includes('GetTransactionStatus') ? 'status' : req.url.includes('GetIpnList') ? 'list' : 'register';
    if (hooks[kind]) return hooks[kind]({ req, res, call, reply, requests, origin, now: clock });
    if (kind === 'token') return reply(200, { status: '200', error: null, token: `dummy-token-${requests.filter(item => item.path.includes('RequestToken')).length}`, expiryDate: new Date(clock + 300000).toISOString() });
    if (kind === 'submit') return reply(200, { status: '200', error: null, merchant_reference: body.id, order_tracking_id: TRACKING, redirect_url: `${origin}/checkout?OrderTrackingId=${TRACKING}` });
    if (kind === 'status') return reply(200, statusBody());
    if (kind === 'list') return reply(200, []);
    return reply(200, { status: '200', error: null, url: body.url, ipn_id: NOTIFICATION, ipn_status: 1, ipn_notification_type_description: 'POST' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const options = { testBaseUrl: `${origin}/api/`, now: () => clock };
  return { origin, requests, options, client: fromEnvironment(CONFIG, options), advance: ms => { clock += ms; } };
}

function submitInput(overrides = {}) {
  return { reference: REFERENCE, amountUgx: 50000, description: 'Agent monthly fee',
    callbackUrl: 'https://makaug.example/pay/MK123/pesapal/return',
    customer: { phone: '256700000001', email: 'payer@example.test', firstName: 'Test', lastName: 'Payer' }, ...overrides };
}

test('whole UGX parsing retains exact positive safe-integer money', () => {
  for (const input of [50000, 50000n, '50000', '50000.00']) assert.equal(parseWholeUgx(input), 50000);
  for (const input of [undefined, null, '', ' 50000', '5e4', '-1', '0', 0, -1, 50000.1, '50000.000000000000001', '9007199254740992', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.throws(() => parseWholeUgx(input), error => error instanceof PesapalError && error.code === 'invalid_amount');
  }
});

test('readiness exposes configuration facts and enforces tenant/environment/approval gates', () => {
  assert.deepEqual(readiness({ ...CONFIG, NODE_ENV: 'test' }), {
    enabled: true, environment: 'sandbox', countryCode: 'UG', merchantApproved: false,
    credentialsConfigured: true, notificationConfigured: true, publicOrigin: 'https://makaug.example', production: false,
    merchantProfile: 'makaug_uganda', ready: true, reasons: []
  });
  assert.equal(readiness({ ...CONFIG, PESAPAL_ENV: 'live' }).ready, false);
  assert.deepEqual(readiness({ ...CONFIG, PESAPAL_ENV: 'live' }).reasons, ['merchant_not_approved']);
  assert.equal(readiness({ ...CONFIG, PESAPAL_ENV: 'live', PESAPAL_MERCHANT_APPROVED: 'true' }).ready, true);
  assert.deepEqual(readiness({ ...CONFIG, NODE_ENV: 'production' }).reasons, ['sandbox_in_production']);
  assert.deepEqual(readiness({ ...CONFIG, COUNTRY_CODE: 'KE' }).reasons, ['wrong_tenant']);
  assert.deepEqual(readiness({ ...CONFIG, PUBLIC_BASE_URL: 'https://user:secret@example.test/' }).reasons, ['public_origin_missing']);
  assert.equal(readiness({ HOME_URL: 'https://home.example/' }).publicOrigin, 'https://home.example');
  const serialized = JSON.stringify(readiness(CONFIG));
  assert.equal(serialized.includes('dummy-consumer'), false);
  assert.equal(readiness({}).ready, false);
});

test('submits the actual API3 request and returns only parsed order facts', async t => {
  const provider = await fake(t);
  assert.deepEqual(await provider.client.submit(submitInput()), {
    trackingId: TRACKING, reference: REFERENCE, checkoutUrl: `${provider.origin}/checkout?OrderTrackingId=${TRACKING}`
  });
  assert.deepEqual(provider.requests.map(call => [call.method, call.path]), [['POST', '/api/Auth/RequestToken'], ['POST', '/api/Transactions/SubmitOrderRequest']]);
  assert.deepEqual(provider.requests[0].body, { consumer_key: 'dummy-consumer-key', consumer_secret: 'dummy-consumer-secret' });
  assert.deepEqual(provider.requests[1].body, {
    id: REFERENCE, currency: 'UGX', amount: 50000, description: 'Agent monthly fee',
    callback_url: 'https://makaug.example/pay/MK123/pesapal/return', notification_id: NOTIFICATION,
    billing_address: { phone_number: '256700000001', email_address: 'payer@example.test', country_code: 'UG', first_name: 'Test', last_name: 'Payer' }
  });
  assert.equal(provider.requests[1].headers.authorization, 'Bearer dummy-token-1');
  assert.equal(Object.hasOwn(provider.client, 'consumerSecret'), false);
});

test('status preserves authenticated query identity and separates wrong payment facts for debt verification', async t => {
  const provider = await fake(t, { status: ({ reply }) => reply(200, statusBody({ amount: '51000.00', currency: 'USD', merchant_reference: 'ANOTHER-ORDER' })) });
  assert.deepEqual(await provider.client.status(TRACKING.toUpperCase()), {
    requestedTrackingId: TRACKING, reference: 'ANOTHER-ORDER', amountUgx: 51000, currency: 'USD', statusCode: 1,
    method: 'MTN', confirmationCode: 'receipt-123', paidAt: '2026-10-27T10:00:00.000Z'
  });
  assert.equal(provider.requests[1].path, `/api/Transactions/GetTransactionStatus?orderTrackingId=${TRACKING}`);
});

test('parallel callers share a token; its five-minute lifetime expires conservatively', async t => {
  const provider = await fake(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => provider.client.status(TRACKING)));
  assert.equal(results.length, 8);
  assert.equal(results[7].amountUgx, 50000);
  assert.equal(provider.requests.filter(call => call.path.includes('RequestToken')).length, 1);
  provider.advance(271000);
  assert.equal((await provider.client.status(TRACKING)).statusCode, 1);
  assert.equal(provider.requests.filter(call => call.path.includes('RequestToken')).length, 2);
});

test('one expired bearer read refreshes once, then returns the verified status', async t => {
  const provider = await fake(t, { status: ({ call, reply }) => call.headers.authorization === 'Bearer dummy-token-1' ? reply(401, { token: 'SECRET-RESPONSE' }) : reply(200, statusBody()) });
  assert.equal((await provider.client.status(TRACKING)).amountUgx, 50000);
  assert.deepEqual(provider.requests.map(call => call.path.split('/').pop().split('?')[0]), ['RequestToken', 'GetTransactionStatus', 'RequestToken', 'GetTransactionStatus']);
});

test('an endless expired bearer response stops after one safe read retry', async t => {
  const provider = await fake(t, { status: ({ reply }) => reply(401, { message: 'SECRET-PROVIDER-DETAIL' }) });
  await assert.rejects(provider.client.status(TRACKING), error => {
    assert.equal(error.httpStatus, 401);
    assert.equal(error.outcome, 'rejected');
    assert.equal(JSON.stringify(error).includes('SECRET'), false);
    return true;
  });
  assert.equal(provider.requests.filter(call => call.path.includes('GetTransactionStatus')).length, 2);
});

test('API-body authentication expiry also gets only one safe read retry', async t => {
  const provider = await fake(t, { status: ({ call, reply }) => call.headers.authorization === 'Bearer dummy-token-1' ? reply(200, { status: '401', error: { code: 'expired' } }) : reply(200, statusBody()) });
  assert.equal((await provider.client.status(TRACKING)).reference, REFERENCE);
  assert.equal(provider.requests.filter(call => call.path.includes('RequestToken')).length, 2);
  assert.equal(provider.requests.filter(call => call.path.includes('GetTransactionStatus')).length, 2);
});

test('accepted order with lost response is unknown and never automatically resubmitted', async t => {
  const orders = new Map();
  const provider = await fake(t, { submit: ({ call, res }) => { orders.set(call.body.id, TRACKING); res.destroy(); } });
  await assert.rejects(provider.client.submit(submitInput()), error => error instanceof PesapalError && error.outcome === 'unknown' && error.code === 'transport_error');
  assert.equal(orders.get(REFERENCE), TRACKING);
  assert.equal(provider.requests.filter(call => call.path.includes('SubmitOrderRequest')).length, 1);
  assert.equal((await provider.client.status(orders.get(REFERENCE))).reference, REFERENCE);
});

test('every pre-submit token failure is unavailable and permits a later explicit checkout retry', async t => {
  for (const failure of [401, 500, 'malformed', 'expired', 'lost']) {
    let failing = true;
    const provider = await fake(t, { token: ({ reply, res, now }) => {
      if (!failing) return reply(200, { status: '200', error: null, token: 'dummy-recovered-token', expiryDate: new Date(now + 300000).toISOString() });
      if (failure === 'lost') return res.destroy();
      if (failure === 'malformed') return reply(200, { status: '200', token: '' });
      if (failure === 'expired') return reply(200, { status: '200', token: 'dummy-expired-token', expiryDate: new Date(now - 1000).toISOString() });
      return reply(failure, { status: String(failure), error: 'PRIVATE-AUTH-DETAIL' });
    } });
    await assert.rejects(provider.client.submit(submitInput()), error => {
      assert.ok(error instanceof PesapalError);
      assert.equal(error.outcome, 'unavailable');
      assert.equal(JSON.stringify(error).includes('PRIVATE-AUTH-DETAIL'), false);
      return true;
    });
    assert.equal(provider.requests.filter(call => call.path.includes('SubmitOrderRequest')).length, 0);
    failing = false;
    assert.equal((await provider.client.submit(submitInput())).trackingId, TRACKING);
    assert.equal(provider.requests.filter(call => call.path.includes('SubmitOrderRequest')).length, 1);
  }
});

test('provider timeout is unknown for submit; explicit rejection is distinct and redacted', async t => {
  const provider = await fake(t, { submit: () => {} });
  const client = fromEnvironment(CONFIG, { ...provider.options, timeoutMs: 20 });
  await assert.rejects(client.submit(submitInput()), error => error.outcome === 'unknown' && error.code === 'timeout');
  assert.equal(provider.requests.filter(call => call.path.includes('SubmitOrderRequest')).length, 1);
  const rejected = await fake(t, { submit: ({ reply }) => reply(400, { message: 'dummy-consumer-secret SECRET-DETAIL' }) });
  await assert.rejects(rejected.client.submit(submitInput()), error => {
    assert.equal(error.outcome, 'rejected');
    assert.equal(error.retryable, false);
    assert.equal(error.message, 'Pesapal request failed (http_error).');
    assert.equal(JSON.stringify(error).includes('SECRET'), false);
    return true;
  });
});

test('submission never replays 401, 409 or 500 outcomes', async t => {
  for (const status of [401, 409, 500]) {
    const provider = await fake(t, { submit: ({ reply }) => reply(status, { status, error: 'private detail' }) });
    await assert.rejects(provider.client.submit(submitInput()), error => error.httpStatus === status && error.outcome === (status === 401 ? 'rejected' : 'unknown'));
    assert.equal(provider.requests.filter(call => call.path.includes('SubmitOrderRequest')).length, 1);
  }
});

test('submission rejects mismatched reference and unsafe redirect after creation as unknown', async t => {
  for (const override of [{ merchant_reference: 'WRONG' }, { order_tracking_id: 'not-a-uuid' }, { redirect_url: 'https://pay.pesapal.com.attacker.test/steal' }, { redirect_url: 'https://pay.pesapal.com/checkout' }, { redirect_url: 'https://cybqa.pesapal.com@attacker.test/checkout' }]) {
    const provider = await fake(t, { submit: ({ call, reply }) => reply(200, { status: '200', error: null, merchant_reference: call.body.id, order_tracking_id: TRACKING, redirect_url: 'https://cybqa.pesapal.com/checkout', ...override }) });
    await assert.rejects(provider.client.submit(submitInput()), error => error.code === 'invalid_provider_response' && error.outcome === 'unknown');
  }
});

test('status rejects missing, fractional, duplicate, unsafe and rounded numeric amounts', async t => {
  for (const amount of ['null', '50000.1', '50000.0000000000000000000001', '5e4', '9007199254740993']) {
    const provider = await fake(t, { status: ({ reply }) => reply(200, JSON.stringify(statusBody()).replace('"amount":50000', `"amount":${amount}`)) });
    await assert.rejects(provider.client.status(TRACKING), error => error instanceof PesapalError && error.code === 'invalid_provider_response');
  }
  const duplicate = await fake(t, { status: ({ reply }) => reply(200, JSON.stringify(statusBody()).replace('"amount":50000', '"amount":1,"amount":50000')) });
  await assert.rejects(duplicate.client.status(TRACKING), error => error.code === 'invalid_response');
});

test('malformed status identity or code is rejected without a raw response', async t => {
  for (const override of [{ merchant_reference: '' }, { currency: '' }, { status_code: 9 }, { status_code: '1' }, { error: { message: 'SECRET' } }, { status: '500' }, { created_date: 'not-a-date' }]) {
    const provider = await fake(t, { status: ({ reply }) => reply(200, statusBody(override)) });
    await assert.rejects(provider.client.status(TRACKING), error => error instanceof PesapalError && !JSON.stringify(error).includes('SECRET') && !Object.hasOwn(error, 'body'));
  }
});

test('response limits and invalid JSON fail safely, with unknown submission outcome', async t => {
  for (const body of ['not json SECRET-RESPONSE', JSON.stringify({ status: '200', token: 'x'.repeat(70000) })]) {
    const provider = await fake(t, { submit: ({ reply }) => reply(200, body) });
    await assert.rejects(provider.client.submit(submitInput()), error => error instanceof PesapalError && error.outcome === 'unknown' && !JSON.stringify(error).includes('SECRET'));
    assert.equal(provider.requests.filter(call => call.path.includes('SubmitOrderRequest')).length, 1);
  }
});

test('invalid local inputs make no HTTP request and valid later input still works', async t => {
  const provider = await fake(t);
  for (const override of [{ amountUgx: undefined }, { customer: {} }, { customer: { phone: 'not-phone' } }, { callbackUrl: 'http://production.example/callback' }, { reference: '../unsafe' }, { notificationId: 'bad' }]) {
    await assert.rejects(provider.client.submit(submitInput(override)), error => error instanceof PesapalError && error.outcome === 'rejected');
  }
  assert.deepEqual(provider.requests, []);
  assert.equal((await provider.client.submit(submitInput())).trackingId, TRACKING);
});

test('official hosts are fixed and loopback override is confined to test mode', async () => {
  const urls = [];
  const client = createPesapalClient({ environment: 'live', consumerKey: 'dummy', consumerSecret: 'dummy', fetch: async url => { urls.push(url); throw new Error('PRIVATE'); } });
  await assert.rejects(client.status(TRACKING), error => error.code === 'transport_error');
  assert.deepEqual(urls, ['https://pay.pesapal.com/v3/api/Auth/RequestToken']);
  assert.throws(() => fromEnvironment(CONFIG, { testBaseUrl: 'http://example.com/api/' }), error => error.code === 'invalid_test_url');
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => fromEnvironment(CONFIG, { testBaseUrl: 'http://127.0.0.1:1/api/' }), error => error.code === 'invalid_test_url');
  } finally { process.env.NODE_ENV = 'test'; }
});

test('disabled new checkout leaves authenticated reconciliation available', async t => {
  const provider = await fake(t);
  const env = { ...CONFIG, PESAPAL_ENABLED: 'false' };
  assert.equal(readiness(env).ready, false);
  assert.equal((await fromEnvironment(env, provider.options).status(TRACKING)).statusCode, 1);
});

test('IPN registration is explicit, lists first, and reuses only a verified active POST', async t => {
  const provider = await fake(t);
  assert.deepEqual(await provider.client.ensureNotification({ url: 'https://makaug.example/api/pay/webhooks/pesapal' }), {
    notificationId: NOTIFICATION, url: 'https://makaug.example/api/pay/webhooks/pesapal', method: 'POST', active: true, created: true
  });
  assert.deepEqual(provider.requests.map(call => call.path), ['/api/Auth/RequestToken', '/api/URLSetup/GetIpnList', '/api/URLSetup/RegisterIPN']);
  assert.deepEqual(provider.requests[2].body, { url: 'https://makaug.example/api/pay/webhooks/pesapal', ipn_notification_type: 'POST' });
  const existing = await fake(t, { list: ({ reply }) => reply(200, [{ status: '200', error: null, url: 'https://makaug.example/ipn', ipn_id: OTHER, ipn_status: 1, ipn_notification_type_description: 'POST' }]) });
  assert.deepEqual(await existing.client.ensureNotification({ url: 'https://makaug.example/ipn' }), {
    notificationId: OTHER, url: 'https://makaug.example/ipn', method: 'POST', active: true, created: false
  });
  assert.equal(existing.requests.filter(call => call.path.includes('RegisterIPN')).length, 0);
});

test('existing IPN without method/active evidence is not silently replaced', async t => {
  const provider = await fake(t, { list: ({ reply }) => reply(200, [{ status: '200', error: null, url: 'https://makaug.example/ipn', ipn_id: NOTIFICATION }]) });
  await assert.rejects(provider.client.ensureNotification({ url: 'https://makaug.example/ipn' }), error => error instanceof PesapalError && error.code === 'notification_method_unverified');
  assert.equal(provider.requests.filter(call => call.path.includes('RegisterIPN')).length, 0);
});

test('setup command defaults to dry run without credentials, fetch or provider calls', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '../scripts/pesapal-ipn-setup.js')], {
    env: { NODE_ENV: 'test', PUBLIC_BASE_URL: 'https://makaug.example/', PESAPAL_ENV: 'sandbox', COUNTRY_CODE: 'UG' }, encoding: 'utf8'
  });
  assert.deepEqual(JSON.parse(output), {
    mode: 'dry_run', environment: 'sandbox', countryCode: 'UG', url: 'https://makaug.example/api/pay/webhooks/pesapal',
    method: 'POST', credentialsConfigured: false, action: 'List registrations and register only if no URL match exists. No provider call was made.'
  });
});
