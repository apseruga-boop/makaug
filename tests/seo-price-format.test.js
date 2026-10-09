'use strict';

/**
 * S3: one currency spelling (UGX) and short prices in titles. Google's index still
 * shows "USh 30000000" from older crawls, and long titles were cut off.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const render = require('../services/publicSeoRenderService');
const { categoryPageSeoMeta } = require('../services/publicSeoService');
const { publicPriceLabelFor } = require('../services/publicListingCopy');

const GUARD = /(USh|UGX|R) \d{5,}/;

const listing = (overrides) => ({
  id: 'x', listing_type: 'sale', transaction_type: 'sale', property_type: 'Land',
  area: 'Namugongo', district: 'Wakiso', bedrooms: 0, price: 80000000, ...overrides
});

test('a 30M sale reads UGX 30M in the title', () => {
  const title = render.propertySeoTitle(listing({ price: 30000000 }));
  assert.match(title, /— UGX 30M \| /);
  assert.strictEqual(title, 'Land for Sale in Namugongo, Wakiso — UGX 30M | makaug.com');
});

test('a 1.55B sale reads UGX 1.55B and a 1.1B sale stays short', () => {
  assert.match(render.propertySeoTitle(listing({ price: 1550000000, property_type: 'house', bedrooms: 5 })), /— UGX 1\.55B \| /);
  const long = render.propertySeoTitle(listing({ price: 1100000000, property_type: 'house', bedrooms: 5, area: 'Naalya' }));
  assert.strictEqual(long, '5bdrm house for Sale in Naalya, Wakiso — UGX 1.1B | makaug.com');
  assert.ok(long.length < 70, `${long.length} chars`);
});

test('a monthly rent of 1,800,000 reads UGX 1.8M/month', () => {
  for (const period of ['month', 'monthly', 'per_month', 'mo']) {
    const title = render.propertySeoTitle(listing({ listing_type: 'rent', transaction_type: 'rent', property_type: 'apartment', bedrooms: 2, price: 1800000, price_period: period }));
    assert.match(title, /— UGX 1\.8M\/month \| /, period);
  }
});

test('a reviewed title also gets the short price', () => {
  const title = render.propertySeoTitle(listing({ title_reviewed: true, title: 'Plot in Namugongo', price: 80000000 }));
  assert.strictEqual(title, 'Plot in Namugongo — UGX 80M | makaug.com');
});

test('cards and descriptions keep the full, grouped price, spelled UGX', () => {
  assert.strictEqual(render.priceLabel(listing({ price: 80000000 })), 'UGX 80,000,000');
  assert.strictEqual(render.priceLabel(listing({ price: 1800000, price_period: 'monthly' })), 'UGX 1,800,000/month');
  assert.match(render.propertySeoDescription({ area: 'Kira', district: 'Wakiso', price: 120000000 }), /UGX 120,000,000/);
  assert.strictEqual(publicPriceLabelFor({ price: 80000000 }), 'UGX 80,000,000');
  assert.strictEqual(publicPriceLabelFor({ price: 1800000, price_period: 'mo' }), 'UGX 1,800,000/month');
});

test('the price is still left out of the title when it is out of bounds', () => {
  assert.doesNotMatch(render.propertySeoTitle(listing({ price: 2 })), /UGX|USh/);
});

test('no SEO title, card or description prints a long ungrouped number', () => {
  const prices = [1, 999, 20000, 35000, 99999, 100000, 450000, 999999, 1000000, 1234567, 30000000, 80000000, 999999999, 1550000000, 25000000000];
  const periods = ['', 'month', 'monthly', 'mo', 'once'];
  const types = ['sale', 'rent', 'land', 'commercial', 'student'];
  for (const price of prices) {
    for (const price_period of periods) {
      for (const listing_type of types) {
        const row = listing({ price, price_period, listing_type, transaction_type: listing_type === 'rent' ? 'rent' : 'sale' });
        for (const [name, text] of [
          ['title', render.propertySeoTitle(row)],
          ['reviewed title', render.propertySeoTitle({ ...row, title_reviewed: true, title: 'Reviewed' })],
          ['price label', render.priceLabel(row)],
          ['description fallback', render.propertySeoDescription({ area: 'Kira', district: 'Wakiso', price, price_period })],
          ['found-online price', publicPriceLabelFor(row)]
        ]) {
          assert.doesNotMatch(text, GUARD, `${name} for ${listing_type} ${price} ${price_period}: ${text}`);
          assert.doesNotMatch(text, /USh/, `${name}: ${text}`);
        }
      }
    }
  }
});

test('category meta says "Prices start from UGX 35M", never an ungrouped number', () => {
  const floor = (value) => ({
    categoryTotals: { sale: 100 }, counts: {}, directCounts: {}, generatedAt: '2026-10-09T00:00:00Z',
    categoryPriceFloors: { sale: value, land: value, rent: value }, locationPriceFloors: {}
  });
  const meta = categoryPageSeoMeta('/for-sale', floor(35000000), 'https://makaug.com/');
  assert.match(meta.description, /Prices start from UGX 35M\./);
  assert.doesNotMatch(`${meta.title} ${meta.description}`, GUARD);
  assert.doesNotMatch(`${meta.title} ${meta.description}`, /USh/);
  const rent = categoryPageSeoMeta('/to-rent', floor(800000), 'https://makaug.com/');
  assert.match(rent.description, /Prices start from UGX 800k\./);
});

test('facet landing copy uses the compact UGX form', () => {
  const source = read('services/publicSeoLandingService.js');
  assert.match(source, /priced up to UGX \$\{compactUgx\(landing\.facet\.value\)\}/);
  assert.match(source, /priced from UGX \$\{compactUgx\(landing\.facet\.value\)\}/);
});

test('no SEO string builder still spells the currency USh', () => {
  for (const file of ['services/publicSeoRenderService.js', 'services/publicSeoService.js', 'services/publicSeoLandingService.js', 'services/publicListingCopy.js']) {
    const code = read(file).split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
    assert.doesNotMatch(code, /['"`]USh|USh \$\{|\bUSh [0-9]/, file);
  }
});

test('South Africa keeps R with en-ZA grouping', () => {
  const script = `
    const r = require('./services/publicSeoRenderService');
    const row = { id: 'x', listing_type: 'sale', transaction_type: 'sale', property_type: 'house', area: 'Sandton', district: 'Gauteng', bedrooms: 3, price: 2500000 };
    process.stdout.write('@@' + JSON.stringify({ title: r.propertySeoTitle(row), label: r.priceLabel(row) }));
  `;
  const stdout = execFileSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, COUNTRY_CODE: 'ZA', DATABASE_URL: '' }, encoding: 'utf8' });
  const out = JSON.parse(stdout.slice(stdout.indexOf('@@') + 2));
  assert.match(out.label, /^R 2\s500\s000$/);
  assert.match(out.title, /— R 2\s500\s000 \|/);
  assert.doesNotMatch(`${out.title} ${out.label}`, /UGX|USh/);
});
