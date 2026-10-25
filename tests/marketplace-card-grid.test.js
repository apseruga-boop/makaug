'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = app.indexOf('function renderMarketplaceBusinesses');
const end = app.indexOf('function renderMarketplaceCategoryChips', start);
const block = app.slice(start, end);

// The 25 Oct 2026 directory redesign replaced photo cards with compact rows:
// two columns on desktop, one on mobile, initials instead of stock photos.
test('marketplace results are a responsive list of compact rows', () => {
  assert.match(html, /id="marketplace-results" class="marketplace-card-grid mk-list"/);
  assert.match(html, /#marketplace-results\.mk-list \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /#marketplace-results\.mk-list \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /\.mk-row-actions \{ display: flex;/);
});

test('a business row is an initials avatar or owner photo, a short line, and real contact buttons', () => {
  assert.match(block, /marketplaceAvatarHtml\(business, photo\)/);
  assert.match(block, /marketplace-business-name mk-name/);
  assert.match(block, /mk-btn mk-btn-call/);
  assert.match(block, /marketplaceTr\("call"\)/);
  assert.match(block, /mk-btn mk-btn-wa/);
  assert.match(block, /marketplaceTr\("whatsappAction"\)/);
  assert.match(block, /unsplash\\.com/);
  assert.doesNotMatch(block, /https:\/\/images\.unsplash\.com/);
  assert.match(block, /marketplaceToggleProfile/);
  assert.match(block, /marketplaceOpenClaimForm/);
  assert.match(block, /profile_images/);
});
