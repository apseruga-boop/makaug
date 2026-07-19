'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const server = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('public HTML must revalidate and cannot be stored by an edge cache', () => {
  assert.match(server, /'no-cache, max-age=0, must-revalidate'/);
  assert.match(server, /res\.setHeader\('CDN-Cache-Control', 'no-store'\)/);
  assert.match(server, /res\.setHeader\('Surrogate-Control', 'no-store'\)/);
  assert.match(server, /res\.setHeader\('Pragma', 'no-cache'\)/);
  assert.match(server, /res\.setHeader\('Expires', '0'\)/);
});

test('runtime version endpoint exposes a non-cacheable build identity', () => {
  assert.match(server, /const RUNTIME_BUILD_ID = 'html-cache-consistency-20260719'/);
  assert.match(server, /app\.get\('\/api\/version'/);
  assert.match(server, /process\.env\.RENDER_GIT_COMMIT/);
  assert.match(server, /process\.env\.RENDER_INSTANCE_ID/);
  assert.match(server, /res\.set\('Cache-Control', 'no-store'\)/);
  assert.match(html, /html-cache-consistency-20260719/);
});
