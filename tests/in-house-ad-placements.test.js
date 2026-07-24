#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

const placements = [
  ['home-grid', 'home-featured'],
  ['home-brokers', 'home-brokers'],
  ['sale-grid', 'sale-grid'],
  ['rent-grid', 'rent-grid'],
  ['student-grid', 'student-grid'],
  ['commercial-grid', 'commercial-grid'],
  ['land-grid', 'land-grid'],
  ['marketplace-results', 'marketplace-results'],
  ['brokers-grid', 'brokers-grid'],
  ['mortgage-results', 'mortgage-results'],
  ['detail-content', 'property-detail']
];

for (const [anchorId, slotKey] of placements) {
  assert.ok(
    app.includes(`anchorId: "${anchorId}", slotKey: "${slotKey}"`),
    `${anchorId} must be in the dynamic ad-placement inventory`
  );
  assert.match(
    app,
    new RegExp(`"${slotKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*\\{\\s*image:\\s*"https://images\\.unsplash\\.com/`),
    `${slotKey} must have photography-led in-house creative`
  );
}

assert.ok(app.includes('function ensureRevenuePlacements()'), 'placements must be inserted into the rendered page');
assert.ok(app.includes('anchor.insertAdjacentElement("afterend", node)'), 'placement insertion must follow the real page anchor');
assert.ok(app.includes("openPageMod('advertise')"), 'empty house-ad inventory must lead to self-serve advertising');

console.log('in-house ad placement tests passed');
