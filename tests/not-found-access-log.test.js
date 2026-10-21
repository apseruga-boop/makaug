'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  USER_AGENT_LOG_MAX,
  NOT_FOUND_LOG_WINDOW_MS,
  sanitizeNotFoundPath,
  sanitizeReferer,
  isBotUserAgent,
  buildNotFoundLogEntry,
  createNotFoundAccessLogger
} = require('../utils/notFoundAccessLog');
const { notFound } = require('../middleware/errorHandler');

function request(overrides = {}) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    referer: 'https://makaug.com/for-sale?utm=1&token=sekret',
    cookie: 'makaug_auth_token=do-not-log',
    ...(overrides.headers || {})
  };
  return {
    method: overrides.method || 'GET',
    path: overrides.path,
    originalUrl: overrides.originalUrl,
    url: overrides.url,
    ip: '203.0.113.50',
    body: { password: 'hunter2' },
    headers,
    get(name) {
      return headers[String(name || '').toLowerCase()] || '';
    }
  };
}

test('404 path drops the query string and masks emails, phones and tokens', () => {
  assert.equal(sanitizeNotFoundPath('/missing?token=sekret&email=owner@example.com'), '/missing');
  assert.equal(sanitizeNotFoundPath('/user/owner@example.com/edit'), '/user/[email]/edit');
  assert.equal(sanitizeNotFoundPath('/call/+256700123456'), '/call/[phone]');
  assert.equal(sanitizeNotFoundPath('/user/owner%40example.com'), '/user/[email]');
  assert.equal(
    sanitizeNotFoundPath('/reset/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signatureok'),
    '/reset/[token]'
  );
  assert.equal(sanitizeNotFoundPath('/file/0123456789abcdef0123456789abcdef'), '/file/[token]');
  assert.equal(
    sanitizeNotFoundPath('/property/550e8400-e29b-41d4-a716-446655440000'),
    '/property/550e8400-e29b-41d4-a716-446655440000'
  );
  assert.equal(sanitizeNotFoundPath('/listing/MK-20261020-F01739'), '/listing/MK-20261020-F01739');
});

test('404 referer keeps origin and path only', () => {
  assert.equal(
    sanitizeReferer('https://news.example/story/owner@example.com?token=sekret'),
    'https://news.example/story/[email]'
  );
  assert.equal(sanitizeReferer('https://user:pass@makaug.com/for-sale?x=1'), 'https://makaug.com/for-sale');
  assert.equal(sanitizeReferer('javascript:alert(1)'), '');
  assert.equal(sanitizeReferer(''), '');
});

test('404 log entry records method, path, a short user agent, referer and is_bot', () => {
  const longAgent = `Mozilla/5.0 Chrome/${'A'.repeat(250)}`;
  const entry = buildNotFoundLogEntry(request({
    method: 'head',
    path: '/wp-login.php',
    originalUrl: '/wp-login.php?id=203.0.113.50',
    headers: { 'user-agent': longAgent, referer: 'https://makaug.com/for-sale?token=sekret' }
  }));
  assert.deepEqual(Object.keys(entry), ['event', 'method', 'path', 'user_agent', 'referer', 'is_bot']);
  assert.equal(entry.event, 'http_404');
  assert.equal(entry.method, 'HEAD');
  assert.equal(entry.path, '/wp-login.php');
  assert.equal(entry.user_agent.length, USER_AGENT_LOG_MAX);
  assert.equal(entry.referer, 'https://makaug.com/for-sale');
  assert.equal(entry.is_bot, false);
  const serialized = JSON.stringify(entry);
  assert.equal(serialized.includes('\n'), false);
  assert.equal(serialized.includes('203.0.113.50'), false);
  assert.equal(serialized.includes('hunter2'), false);
  assert.equal(serialized.includes('do-not-log'), false);
  assert.equal(serialized.includes('sekret'), false);
});

test('is_bot follows the user agent', () => {
  assert.equal(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBotUserAgent('curl/8.7.1'), true);
  assert.equal(isBotUserAgent('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36'), false);
  assert.equal(isBotUserAgent(''), false);
});

test('a scanner flood is capped and the remainder is counted', () => {
  let clock = 1_000;
  const lines = [];
  const { logNotFound } = createNotFoundAccessLogger({
    limit: 2,
    now: () => clock,
    write: (line) => lines.push(line)
  });
  const hit = () => logNotFound(request({ path: '/.env', headers: { 'user-agent': 'sqlmap/1.8', referer: '' } }));
  assert.equal(hit(), true);
  assert.equal(hit(), true);
  assert.equal(hit(), false);
  assert.equal(hit(), false);
  assert.equal(lines.length, 2);
  clock += NOT_FOUND_LOG_WINDOW_MS;
  assert.equal(hit(), true);
  assert.equal(lines.length, 4);
  const summary = JSON.parse(lines[2]);
  assert.deepEqual(summary, { event: 'http_404_suppressed', suppressed: 2, window_seconds: 60 });
  const first = JSON.parse(lines[0]);
  assert.equal(first.path, '/.env');
  assert.equal(first.is_bot, true);
  assert.equal(lines.every((line) => !line.includes('\n') && !line.includes('203.0.113.50')), true);
});

test('suppressed 404s are summarized when the minute ends', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 5_000;
  const lines = [];
  const { logNotFound } = createNotFoundAccessLogger({
    limit: 1,
    windowMs: 1_000,
    now: () => clock,
    write: (line) => lines.push(line)
  });
  assert.equal(logNotFound(request({ path: '/scanner.php' })), true);
  assert.equal(logNotFound(request({ path: '/scanner.php' })), false);
  assert.equal(lines.length, 1);
  clock = 6_000;
  t.mock.timers.tick(1_000);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), {
    event: 'http_404_suppressed',
    suppressed: 1,
    window_seconds: 1
  });
});

test('API and HTML catch-all 404 handlers call the access log', () => {
  const server = read('server.js');
  const errors = read('middleware/errorHandler.js');
  const html = server.slice(server.indexOf('function sendPublicNotFound'), server.indexOf('async function sendPublicIndex'));
  const missingFile = server.slice(server.indexOf('Anything else with a file extension'), server.indexOf("app.get('*'"));
  const api = errors.slice(errors.indexOf('function notFound'), errors.indexOf('function errorHandler'));
  assert.match(html, /logNotFound\(req\)/);
  assert.match(missingFile, /logNotFound\(req\)/);
  assert.match(api, /logNotFound\(req\)/);
  assert.doesNotMatch(read('utils/notFoundAccessLog.js'), /req\.ip|req\.body|req\.cookies|headers\.cookie/);

  const lines = [];
  let statusCode = 0;
  const original = console.info;
  console.info = (...args) => lines.push(args.map((part) => String(part)).join(' '));
  try {
    const req = request({
      path: '/api/does-not-exist',
      originalUrl: '/api/does-not-exist?token=sekret',
      headers: { 'user-agent': 'curl/8.0', referer: 'https://makaug.com/help?token=sekret' }
    });
    notFound(req, {
      status(code) { statusCode = code; return this; },
      json() { return this; }
    });
  } finally {
    console.info = original;
  }
  assert.equal(statusCode, 404);
  const logged = lines.find((line) => line.includes('"event":"http_404"'));
  assert.ok(logged, 'API 404 must write one http_404 line');
  const entry = JSON.parse(logged.slice(logged.indexOf('{')));
  assert.equal(entry.method, 'GET');
  assert.equal(entry.path, '/api/does-not-exist');
  assert.equal(entry.user_agent, 'curl/8.0');
  assert.equal(entry.referer, 'https://makaug.com/help');
  assert.equal(entry.is_bot, true);
  assert.equal(logged.includes('sekret'), false);
  assert.equal(logged.includes('203.0.113.50'), false);
  assert.equal(logged.includes('hunter2'), false);
  assert.equal(logged.includes('do-not-log'), false);
});
