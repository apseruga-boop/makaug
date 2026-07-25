#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '097_house_ads_v3.sql'), 'utf8');
const {
  getAdvertisingPlacements,
  getAdvertisingRateCard,
  mergePlacementRowsWithCatalog
} = require('../services/advertisingCatalogService');

const placements = [
  ['home-grid', 'home-featured', 'home-hero', 'Home starts here.'],
  ['home-brokers', 'home-brokers', 'agents', 'The right hands for your keys.'],
  ['sale-grid', 'sale-grid', 'sale', 'Say hello to yours.'],
  ['rent-grid', 'rent-grid', 'rent', 'Move in Monday.'],
  ['student-grid', 'student-grid', 'students', 'Your campus. Your room.'],
  ['commercial-grid', 'commercial-grid', 'commercial', 'Open for business.'],
  ['land-grid', 'land-grid', 'land', 'Own the hill.'],
  ['marketplace-results', 'marketplace-results', 'marketplace', 'Built by people who care.'],
  ['brokers-grid', 'brokers-grid', 'brokers', 'Walk in with an expert.'],
  ['mortgage-results', 'mortgage-results', 'mortgage', 'Closer than you think.'],
  ['detail-content', 'property-detail', 'detail', 'Open the door.']
];

for (const [anchorId, slotKey, assetName, headline] of placements) {
  assert.ok(
    app.includes(`anchorId: "${anchorId}", slotKey: "${slotKey}"`),
    `${anchorId} must be in the dynamic placement inventory`
  );
  assert.ok(app.includes(`/assets/house-ads-v3/${assetName}.webp`), `${slotKey} must use its approved desktop creative`);
  assert.ok(app.includes(`/assets/house-ads-v3/${assetName}-mobile.webp`), `${slotKey} must use its mobile creative`);
  assert.ok(app.includes(`headline: "${headline}"`), `${slotKey} must use its approved headline`);

  for (const suffix of ['.webp', '-mobile.webp']) {
    const file = path.join(root, 'assets', 'house-ads-v3', `${assetName}${suffix}`);
    assert.ok(fs.existsSync(file), `${file} must exist`);
    assert.ok(fs.statSync(file).size < 200 * 1024, `${file} must be below 200KB`);
  }
}

assert.ok(app.includes('function ensureRevenuePlacements()'), 'placements must be inserted into the rendered page');
assert.ok(app.includes('anchor.insertAdjacentElement("afterend", node)'), 'placement insertion must follow the real page anchor');
assert.ok(app.includes('fetch("/api/advertising/placements"'), 'public bands must hydrate from the live placement API');
assert.ok(app.includes('srcset="${adminAttr(mobileImage)}"'), 'public bands must use a mobile source');
assert.ok(app.includes('href="${adminAttr(ctaUrl)}"'), 'the sponsored label must link to the configured advertising route');
assert.ok(app.includes('data-copy-side="${copySide}"'), 'commercial must support mirrored copy');
assert.ok(!app.includes('const INHOUSE_AD_SAMPLES'), 'legacy Unsplash placement catalog must be removed');

for (const blockedClass of ['class="ad-unit"', 'class="ad-slot"', 'class="ad-wrap"', 'class="ad-tag"']) {
  assert.ok(!app.includes(blockedClass), `${blockedClass} must not remain in the renderer`);
  assert.ok(!html.includes(blockedClass), `${blockedClass} must not remain in the page`);
}

assert.ok(html.includes('.mk-house-band {'), 'the neutral house-band class must be defined');
assert.match(html, /\.mk-house-band\s*\{[\s\S]*?height:\s*200px;[\s\S]*?min-height:\s*200px;[\s\S]*?max-height:\s*200px;/);
assert.ok(html.includes('house-ads-v3-20260725'), 'release marker must be present');
assert.ok(html.includes('class="mk-top-strip bg-green-900'), 'the 44px top strip must use its stable class');
assert.match(html, /\.mk-top-strip\s*\{[\s\S]*?min-height:\s*44px;/);

const catalog = getAdvertisingPlacements();
assert.strictEqual(catalog.length, 11, 'catalog must contain exactly 11 house placements');
assert.strictEqual(getAdvertisingRateCard().placements.length, 11, 'rate card must expose the same placements');
assert.strictEqual(
  mergePlacementRowsWithCatalog([{ key: 'sale-grid', headline: 'King override' }])
    .find((placement) => placement.key === 'sale-grid').headline,
  'King override',
  'database settings must override the bundled catalog'
);
assert.ok(migration.includes("('commercial-grid'"), 'migration must seed the commercial placement');
assert.ok(migration.includes("'right center','left'"), 'commercial placement must be mirrored');

console.log('in-house ad placement tests passed');
