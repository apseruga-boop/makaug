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
const lifecycle = read('services/marketplaceLifecycleService.js');
const pricing = require('../config/marketplacePricing');

test('Marketplace polish release marker and compact tier strip are present', () => {
  assert.match(html, /marketplace-polish-20260719/);
  assert.match(app, /MARKETPLACE_POLISH_MARKER = "marketplace-polish-20260719"/);
  assert.match(html, /<details id="marketplace-tiers"/);
  assert.match(html, /marketplace-tier-strip/);
  assert.doesNotMatch(html, /UGX 150,000\/year/);
});

test('Verified pricing is one monthly config exposed through the public config endpoint', () => {
  assert.equal(pricing.MARKETPLACE_VERIFIED_PRICE_UGX, 150000);
  assert.equal(pricing.MARKETPLACE_VERIFIED_BILLING_PERIOD, 'month');
  assert.match(route, /verified_pricing:\s*\{/);
  assert.match(route, /amount_ugx: MARKETPLACE_VERIFIED_PRICE_UGX/);
  assert.match(route, /billing_period: MARKETPLACE_VERIFIED_BILLING_PERIOD/);
  assert.doesNotMatch(lifecycle, /150,000\/year|buli mwaka|kwa mwaka|i mwaka|buri mwaka|سنويا|\/ዓመት/);
});

test('Marketplace business rows are mobile-safe and generated descriptions are localized', () => {
  assert.match(app, /text-gray-950 break-words/);
  assert.doesNotMatch(app, /text-gray-950 truncate/);
  assert.match(app, /flex flex-col items-start gap-1\.5 sm:flex-row/);
  assert.match(app, /w-full sm:w-auto sm:shrink-0/);
  assert.match(app, /inline-flex items-center gap-1/);
  assert.match(app, /marketplaceBusinessDescription/);
  assert.match(app, /foundOnlineDescriptionTemplate/);
  assert.match(app, /newBusiness: "Empya"/);
  assert.doesNotMatch(app, /newBusiness: "Mpya"[^\n]*Bano be baweereza b'eby'obutaka/);
});

test('Every Marketplace service category has a configured visual accent', () => {
  const required = [
    'painters', 'plumbers', 'electricians', 'builders', 'surveyors', 'property_lawyers',
    'brokers', 'valuers', 'movers', 'architects', 'security', 'solar', 'cleaning',
    'property_managers', 'mortgage_providers', 'insurance', 'interior_design',
    'borehole_water', 'developers', 'commercial_services'
  ];
  required.forEach((category) => assert.match(app, new RegExp(`\\b${category}: \\{ accent:`), `missing palette for ${category}`));
  assert.match(html, /border-left: 3px solid var\(--marketplace-category-accent/);
  assert.match(app, /marketplace-category-label/);
  assert.match(app, /marketplaceCategoryStyle\(item\.key \|\| "other"\)/);
});
