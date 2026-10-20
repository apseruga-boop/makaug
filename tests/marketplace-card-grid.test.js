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

test('marketplace results are a responsive photo grid', () => {
  assert.match(html, /id="marketplace-results" class="marketplace-card-grid"/);
  assert.match(html, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(html, /@media \(max-width: 1100px\)/);
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /@media \(max-width: 700px\)/);
  assert.match(html, /grid-template-columns: 1fr/);
});

test('a business card is a photo, a short line, and real contact buttons', () => {
  assert.match(block, /marketplace-card-photo/);
  assert.match(block, /marketplace-card-badge/);
  assert.match(block, /marketplace-business-name font-black leading-snug break-words/);
  assert.match(block, /marketplace-card-call/);
  assert.match(block, /marketplaceTr\("call"\)/);
  assert.match(block, /marketplace-card-wa/);
  assert.match(block, /marketplaceTr\("whatsappAction"\)/);
  assert.match(block, /unsplash\\.com/);
  assert.doesNotMatch(block, /https:\/\/images\.unsplash\.com/);
  assert.match(block, /marketplaceToggleProfile/);
  assert.match(block, /marketplaceOpenClaimForm/);
  assert.match(block, /profile_images/);
});
