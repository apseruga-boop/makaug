'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const server = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('bundle version is injected from the deployed commit identity', () => {
  assert.match(server, /function runtimeBundleVersion\(\)/);
  assert.match(server, /process\.env\.RENDER_GIT_COMMIT/);
  assert.match(server, /function injectRuntimeBundleVersion\(html\)/);
  assert.match(server, /document\.documentElement\.dataset\.makaugAppVersion/);
  assert.match(server, /injectRuntimeBundleVersion\(patchedHtml\)/);
});

test('both app asset references share one version and no marker chain mutates it', () => {
  assert.equal((html.match(/window\.__makaugAppVersion\s*=/g) || []).length, 1);
  assert.equal((html.match(/window\.__makaugAppVersion\s*\+=/g) || []).length, 0);
  assert.equal((html.match(/makaug-app\.js\?v=/g) || []).length, 2);
  assert.equal((html.match(/encodeURIComponent\(window\.__makaugAppVersion\)/g) || []).length, 2);
  assert.match(html, /window\.__makaugAppVersion = "__MAKAUG_BUNDLE_VERSION__"/);
  assert.match(html, /bundle-version-commit-key-20260719/);
});

test('release markers remain diagnostics and cannot alter the asset cache key', () => {
  assert.match(html, /window\.__makaugReleaseMarkers/);
  assert.doesNotMatch(server, /assets\\\/makaug-app\\\.js\\\?v=.*suffix/);
  assert.doesNotMatch(server, /window\\\.__makaugAppVersion\\s\*=\\s\*"\)\(\[\^"\]\+\)\("\)/);
});
