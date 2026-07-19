'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('assets/makaug-app.js');
const html = read('index.html');
const route = read('routes/marketplace.js');
const pricing = require('../config/marketplacePricing');

test('final Marketplace marker is exposed in HTML, client code and config API', () => {
  assert.equal(pricing.MARKETPLACE_FINAL_TWEAKS_MARKER, 'marketplace-final-tweaks-20260719');
  assert.match(html, /marketplace-final-tweaks-20260719/);
  assert.match(app, /MARKETPLACE_FINAL_TWEAKS_MARKER = "marketplace-final-tweaks-20260719"/);
  assert.match(route, /MARKETPLACE_FINAL_TWEAKS_MARKER/);
});

test('expanded tier explainer restores three compact bordered cards', () => {
  const tierCards = html.match(/<article class="marketplace-tier-card/g) || [];
  assert.equal(tierCards.length, 3);
  assert.match(html, /marketplace-tier-card rounded-lg border border-gray-200/);
  assert.match(html, /marketplace-tier-card rounded-lg border border-blue-100/);
  assert.match(html, /marketplace-tier-card rounded-lg border border-blue-200/);
  assert.match(html, /data-marketplace-i18n="verifiedPrice">UGX 150,000\/month/);
  assert.match(html, /data-marketplace-i18n="joinWaitlist">Join the Verified waitlist/);
});

test('business card and managed-profile names use the readable category colour', () => {
  assert.match(html, /\.marketplace-category-label,\s*\.marketplace-business-name \{ color: var\(--marketplace-category-text/);
  assert.match(app, /marketplace-business-name font-black leading-snug break-words/);
  assert.match(html, /id="marketplace-manage-title" class="marketplace-business-name/);
  assert.match(app, /--marketplace-category-text:\$\{theme\.text \|\| theme\.accent\}/);
  assert.match(app, /marketplace-manage-title"\)\?\.setAttribute\("style", marketplaceCategoryStyle/);
});
