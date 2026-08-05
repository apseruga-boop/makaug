const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

test('Meta Pixel is runtime-configured and disabled when no valid Pixel ID is configured', () => {
  assert.match(html, /window\.__makaugMetaPixelId = "__MAKAUG_META_PIXEL_ID__"/);
  assert.match(server, /process\.env\.META_PIXEL_ID/);
  assert.match(server, /\^\\d\{6,24\}\$/);
  assert.match(server, /injectRuntimeMetaPixelId\(injectRuntimeBundleVersion\(patchedHtml\)\)/);
  assert.doesNotMatch(server, /META_PIXEL_ID\s*\|\|\s*['"]\d+/);
});

test('Meta Pixel loads once and records the initial PageView', () => {
  assert.match(html, /meta-pixel-launch1-20260805/);
  assert.match(html, /https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(html, /queue\("init", pixelId\)/);
  assert.match(html, /queue\("track", "PageView"/);
});

test('Makaug analytics maps real property journeys to Meta standard events', () => {
  assert.match(app, /function fireClientMetaPixelEvent\(eventName, params = \{\}\)/);
  assert.match(app, /window\.fbq\("track", "PageView"/);
  assert.match(app, /window\.fbq\("track", "Search"/);
  assert.match(app, /window\.fbq\("track", "ViewContent"/);
  assert.match(app, /content_ids: \[String\(params\.property_id/);
  assert.match(app, /currency: "UGX"/);
  assert.match(app, /fireClientMetaPixelEvent\(eventName, analyticsParams\)/);
  assert.match(app, /content_name: getLocalizedPropertyTitle\(p\)/);
});
