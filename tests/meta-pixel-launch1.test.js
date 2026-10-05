const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const consent = fs.readFileSync(path.join(root, 'assets', 'measurement-consent.js'), 'utf8');

test('Meta Pixel is runtime-configured and disabled when no valid Pixel ID is configured', () => {
  assert.match(html, /window\.__makaugMetaPixelId = "__MAKAUG_META_PIXEL_ID__"/);
  assert.match(server, /process\.env\.META_PIXEL_ID/);
  assert.match(server, /\^\\d\{6,24\}\$/);
  assert.match(server, /injectRuntimeMetaPixelId\(injectRuntimeBundleVersion\(patchedHtml\)\)/);
  assert.doesNotMatch(server, /META_PIXEL_ID\s*\|\|\s*['"]\d+/);
});

test('Meta Pixel is loaded only by the advertising-consent controller', () => {
  assert.match(html, /<script src="\/assets\/measurement-consent\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(consent, /if \(choice\.advertising\) \{\s*initializeMetaPixel\(\);/);
  assert.match(consent, /script\.src = "https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js"/);
  assert.match(consent, /queue\("consent", "grant"\)/);
  assert.match(consent, /queue\("init", pixelId\)/);
  assert.match(consent, /queue\("track", "PageView"/);
  assert.match(consent, /windowObject\.fbq\("consent", "revoke"\)/);
});

test('Makaug analytics maps real property journeys to Meta standard events', () => {
  assert.match(app, /function fireClientMetaPixelEvent\(eventName, params = \{\}\)/);
  assert.match(app, /if \(!advertisingConsentGranted\(\) \|\| typeof window\.fbq !== "function"/);
  assert.match(app, /window\.fbq\("track", "PageView"/);
  assert.match(app, /window\.fbq\("track", "Search"/);
  assert.match(app, /window\.fbq\("track", "ViewContent"/);
  assert.match(app, /content_ids: \[String\(params\.property_id/);
  assert.match(app, /currency: "UGX"/);
  assert.match(app, /fireClientMetaPixelEvent\(eventName, analyticsParams\)/);
  assert.match(app, /content_name: getLocalizedPropertyTitle\(p\)/);
});
