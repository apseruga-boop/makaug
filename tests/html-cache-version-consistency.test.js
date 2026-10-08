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
  assert.match(server, /const RUNTIME_BUILD_ID = 'bundle-version-commit-key-20260719'/);
  assert.match(server, /app\.get\('\/api\/version'/);
  assert.match(server, /process\.env\.RENDER_GIT_COMMIT/);
  assert.match(server, /process\.env\.RENDER_INSTANCE_ID/);
  assert.match(server, /res\.set\('Cache-Control', 'no-store'\)/);
  assert.match(html, /bundle-version-commit-key-20260719/);
});

test('static assets: a year immutable only when the URL is versioned, otherwise an hour', () => {
  assert.match(server, /const VERSIONED_STATIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';/);
  assert.match(server, /const UNVERSIONED_STATIC_CACHE_CONTROL = 'public, max-age=3600';/);
  assert.doesNotMatch(server, /max-age=604800/);
  assert.match(server, /setHeaders\(res, filePath\) \{[\s\S]{0,300}staticCacheControlForUrl\(req\.originalUrl \|\| req\.url\)/);
  // Every local script/stylesheet the page loads gets ?v= (content hash at
  // serve time for the static ones, the build version for the app bundles).
  assert.match(server, /function versionLocalAssetUrls\(html\)/);
  assert.match(html, /"\/assets\/makaug-app\.js\?v=" \+ encodeURIComponent\(window\.__makaugAppVersion\)/);
  assert.match(html, /"\/assets\/makaug-admin\.js\?v=" \+ encodeURIComponent\(window\.__makaugAppVersion\)/);
});
