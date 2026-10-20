'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

const pageStart = html.indexOf('id="page-ai-chatbot"');
const pageEnd = html.indexOf('id="page-fraud"', pageStart);
const page = html.slice(pageStart, pageEnd);

assert(pageStart > 0 && pageEnd > pageStart, 'discover page block is missing');
assert(!html.includes('id="web-ai-chatbot"'), 'the describe-what-you-want box must be gone');
assert(!page.includes('data-ask-ai-inline-scope'), 'discover must not mount the free-text Ask AI bar');
assert(!page.includes('unsplash.com'), 'discover must not use a stock photo');
assert(page.includes('id="ai-cta-btn"'), 'the WhatsApp button stays');
assert(page.includes('data-public-whatsapp-link data-whatsapp-context="ai-chatbot"'), 'the WhatsApp button keeps its public context');
assert(page.includes('data-howto-video-grid="ai-chatbot"'), 'the how-to videos stay on the page');

for (const id of ['rent-ntinda', 'buy-kira', 'land-mukono', 'near-makerere', 'short-stay', 'broker']) {
  assert(page.includes(`data-discover-chip="${id}"`), `missing chip ${id}`);
}
assert(page.includes('grid-cols-1') && page.includes('sm:grid-cols-2') && page.includes('xl:grid-cols-4'), 'result cards must be one column on a phone and four on a desktop');
assert(app.includes('function loadDiscoverChip'), 'chips need a loader');
assert(app.includes('/api/properties?'), 'property chips must read live listings');
assert(app.includes('/api/short-term/search?'), 'the short-stay chip must read published stays');
assert(app.includes('/api/agents?'), 'the broker chip must read approved brokers');
assert(app.includes('response?.listings'), 'partner hotels must not be painted as short stays');
assert(/function discoverPhotoUrl[\s\S]{0,240}unsplash\\.com/.test(app), 'discover photos reject stock urls');
assert(app.includes("if (targetPage === \"ai-chatbot\") loadDiscoverChip(discoverChipId);"), 'opening Discover loads results');

const start = app.indexOf('const DISCOVER_UI_I18N =');
const end = app.indexOf('function aiTr', start);
assert(start > 0 && end > start, 'discover copy table is missing');
const sandbox = {};
vm.runInNewContext(`${app.slice(start, end)}\nthis.table = DISCOVER_UI_I18N;`, sandbox);
const table = sandbox.table;
const langs = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const keys = Object.keys(table.en);
assert(keys.includes('chipRentNtinda') && keys.includes('resultsShortEmpty') && keys.includes('cta'));
langs.forEach((code) => {
  assert(table[code], `missing ${code}`);
  keys.forEach((key) => {
    assert(table[code][key], `${code} is missing ${key}`);
  });
  if (code === 'en') return;
  const copied = keys.filter((key) => table[code][key] === table.en[key]);
  assert.strictEqual(copied.length, 0, `${code} left English copy: ${copied.join(', ')}`);
});

console.log('discover chips: ok');
