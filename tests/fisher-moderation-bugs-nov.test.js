'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inferSourcePropertyType, inferSourceTitleType } = require('../services/socialSearchSourcedListingsService');
const { cleanListingTitle } = require('../services/publicListingCopy');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');

function extractFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = app.indexOf(') {', start) + 2; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    if (app[i] === '}') { depth -= 1; if (depth === 0) return app.slice(start, i + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

test('importer reads property type and title type from the caption', () => {
  assert.equal(inferSourcePropertyType({ title: 'Najjera House for sale at 1.2B ugx Negotiable' }).label, 'House');
  assert.equal(inferSourcePropertyType({ caption: '2-bedroom house for sale in Bulenga' }).physical_type, 'residential');
  assert.equal(inferSourceTitleType({ caption: 'Mansion on private mailo land title' }, 'sale'), 'Private Mailo');
  assert.equal(inferSourceTitleType({ caption: 'freehold' }, 'rent'), null);
});

test('generic "Property for sale" titles use the type the text gives', () => {
  assert.equal(cleanListingTitle({ title: 'Property for sale in Najjera', description: 'Najjera House for sale', listing_type: 'sale' }), 'House for sale in Najjera');
  assert.equal(cleanListingTitle({ title: '5-bed Property for rent in Bugolobi', description: '5-bedroom home for rent', listing_type: 'rent', bedrooms: 5 }), '5-bed house for rent in Bugolobi');
  assert.doesNotMatch(cleanListingTitle({ title: 'Property for sale in Najjera', description: 'House', property_type: 'Office', listing_type: 'sale' }), /^House/);
});

test('a USD amount from the facts reader never lands in the UGX field', () => {
  const fn = new Function(`${extractFunction('adminReviewCanonicalPriceFromFacts')}; return adminReviewCanonicalPriceFromFacts;`)();
  assert.deepEqual(fn({ price: 4000, currency: 'USD' }, { price_fx_rate_ugx: 3800 }), { ugx: 15200000, originalUsd: 4000 });
  assert.deepEqual(fn({ price: 4000 }, { price_original_currency: 'USD', price_original: 4000, price_fx_rate_ugx: 3800 }), { ugx: 15200000, originalUsd: 4000 });
  assert.deepEqual(fn({ price: 1300000000, currency: 'UGX' }, {}), { ugx: 1300000000, originalUsd: '' });
});

test('duplicate warning shows once', () => {
  const card = extractFunction('staffReviewQueueCardHtml');
  assert.match(card, /staffPossibleDuplicateOfHtml\(item\.extra_fields\?\.possible_duplicate_of\) \|\| \(duplicateCount \?/);
  assert.equal((card.match(/possible duplicate\$\{/g) || []).length, 1);
});

test('queue: search stays on screen, loads time out, counts settle, approved cards link, first click works', () => {
  assert.match(extractFunction('staffPaintReviewQueue'), /segment === "main" && staffReviewQueueState\.search\.term\) return/);
  assert.match(extractFunction('staffLoadMoreReviewQueue'), /staffApiRequestWithTimeout\(/);
  assert.match(extractFunction('staffFillReviewQueue'), /staffReviewQueueSettleCount\(state\)/);
  assert.match(extractFunction('staffFillFoundOnlineQueue'), /staffFoundOnlineSettleCount\(\)/);
  assert.match(extractFunction('staffReviewQueueCardHtml'), /href="\/property\/\$\{encodeURIComponent/);
  assert.match(extractFunction('staffSetQueueHtml'), /staffQueueCardOrder\(wrap\) !== orderBefore/);
  assert.match(extractFunction('openStaffListingPreview'), /STAFF_PREVIEW_OPEN_TIMEOUT_MS/);
  assert.match(extractFunction('staffRefreshPreviewMedia'), /staffPreviewMediaTargetOpen\(propertyId, data\)/);
});
