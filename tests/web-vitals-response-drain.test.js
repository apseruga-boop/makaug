'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === 'sendWebVitalMetric');
assert.ok(node, 'sendWebVitalMetric exists in the actual application');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(fetchImpl = () => Promise.resolve({ text: () => Promise.resolve('accepted') })) {
  const calls = [];
  const context = vm.createContext({
    window: { location: { pathname: '/property/example-home' }, innerWidth: 390 },
    navigator: { connection: { effectiveType: '4g' } },
    apiUrl: (url) => `https://makaug.com${url}`,
    getAnalyticsClientId: () => 'visitor-session-1',
    fetch(url, options) { calls.push({ url, options, body: JSON.parse(options.body) }); return fetchImpl(url, options); }
  });
  vm.runInContext(`const sentWebVitalMetrics = new Set();\n${source.slice(node.start, node.end)}`, context);
  return { context, calls, send: context.sendWebVitalMetric };
}

test('a metric keeps its payload and keepalive request, then consumes the successful response body', async () => {
  let resolveResponse;
  const pending = new Promise((resolve) => { resolveResponse = resolve; });
  const reads = [];
  const f = fixture(() => pending);
  f.send('LCP', 2345.6, 'good');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://makaug.com/api/analytics/web-vitals');
  assert.equal(f.calls[0].options.method, 'POST');
  assert.equal(f.calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(f.calls[0].options.keepalive, true);
  assert.deepEqual(f.calls[0].body, {
    metricName: 'LCP', value: 2345.6, rating: 'good', route: '/property/example-home',
    sessionId: 'visitor-session-1', device: 'mobile', connection: '4g'
  });
  assert.deepEqual(reads, [], 'the response cannot be consumed before fetch resolves');
  resolveResponse({ text() { reads.push('accepted response'); return Promise.resolve('{"success":true}'); } });
  await flush();
  assert.deepEqual(reads, ['accepted response']);
});

test('duplicate metric and route send once, while a different route preserves its own payload and drain', async () => {
  const reads = [];
  const f = fixture(() => Promise.resolve({ text() { reads.push('response'); return Promise.resolve('accepted'); } }));
  f.send('CLS', 0, 'good');
  f.send('CLS', 0.4, 'needs_improvement');
  await flush();
  assert.deepEqual(f.calls.map((call) => call.body.value), [0]);
  assert.deepEqual(reads, ['response']);
  f.context.window.location.pathname = '/';
  f.context.window.innerWidth = 1024;
  f.context.navigator.connection = undefined;
  f.send('CLS', 0.05);
  await flush();
  assert.deepEqual(f.calls.map((call) => call.body.route), ['/property/example-home', '/']);
  assert.deepEqual(f.calls[1].body, {
    metricName: 'CLS', value: 0.05, rating: '', route: '/', sessionId: 'visitor-session-1', device: 'desktop', connection: ''
  });
  assert.deepEqual(reads, ['response', 'response']);
});

test('invalid metrics are ignored without preventing a valid zero-valued metric and its response drain', async () => {
  const reads = [];
  const f = fixture(() => Promise.resolve({ text() { reads.push('zero metric'); return Promise.resolve('accepted'); } }));
  f.send('', 100);
  for (const value of [NaN, Infinity, -Infinity, undefined, '100']) f.send('LCP', value);
  f.send('LCP', 0, 'good');
  await flush();
  assert.deepEqual(f.calls.map((call) => [call.body.metricName, call.body.value]), [['LCP', 0]]);
  assert.deepEqual(reads, ['zero metric']);
});

test('fetch and response-text failures are swallowed, preserving dedup and subsequent metrics', async () => {
  const reads = [];
  let index = 0;
  const f = fixture(() => {
    index += 1;
    if (index === 1) throw new Error('fetch threw');
    if (index === 2) return Promise.reject(new Error('fetch rejected'));
    if (index === 3) return Promise.resolve({ text() { reads.push('text threw'); throw new Error('body read threw'); } });
    if (index === 4) return Promise.resolve({ text() { reads.push('text rejected'); return Promise.reject(new Error('body read rejected')); } });
    return Promise.resolve({ text() { reads.push('final accepted response'); return Promise.resolve('accepted'); } });
  });
  f.send('LCP', 500, 'good');
  f.send('LCP', 600, 'good');
  f.send('CLS', 0.01, 'good');
  f.send('FCP', 450, 'observed');
  f.send('INP', 80, 'good');
  f.send('TTFB', 150, 'good');
  await flush();
  await flush();
  assert.deepEqual(f.calls.map((call) => call.body.metricName), ['LCP', 'CLS', 'FCP', 'INP', 'TTFB']);
  assert.deepEqual(reads, ['text threw', 'text rejected', 'final accepted response']);
  assert.equal(f.calls.at(-1).body.value, 150);
  assert.ok(f.calls.every((call) => call.options.keepalive === true));
});
