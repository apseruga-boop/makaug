'use strict';

/**
 * C6 (10 Oct 2026, Marketing): on /property/346641f3-6b9c-4697-b44a-4e3bca78a52b
 * (UGX 650,000,000) choosing £ left the price in UGX. setCurrency() re-rendered
 * the grids but not the open property page (baked in once by openDetail), the
 * similar listings or the server-rendered text; the choice wasn't saved; and
 * the rates were hard-coded in the bundle.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'makaug-app.js'), 'utf8');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function grabFunction(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  // The body starts at ") {", after any default-parameter braces.
  for (let i = APP.indexOf(') {', start) + 2; i < APP.length; i += 1) {
    if (APP[i] === '{') depth += 1;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(name);
}

function grabConst(name) {
  const start = APP.indexOf(`const ${name} =`);
  assert.ok(start >= 0, name);
  const end = APP.indexOf(';\n', start);
  return APP.slice(start, end + 1);
}

function makeNode(dataset) {
  return { dataset, textContent: '', classList: { toggle() {} } };
}

function sandboxFor({ stored = null, fx = undefined } = {}) {
  const storage = new Map(stored ? [['makaug_display_currency', stored]] : []);
  const nodes = [];
  const notes = [];
  const calls = { openDetail: [] };
  const sandbox = {
    window: fx === undefined ? {} : { MAKAUG_FX: fx },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    document: {
      getElementById: (id) => (id === 'cur-sel' ? sandbox.__select : null),
      querySelectorAll: (selector) => (selector === '[data-price-ugx]' ? nodes : selector === '[data-fx-note]' ? notes : [])
    },
    __select: { value: 'UGX' },
    currentPage: 'detail',
    activeDetailPropertyId: '346641f3-6b9c-4697-b44a-4e3bca78a52b',
    renderAll() {},
    resetMaps() {},
    toast() {},
    openDetail(id) { calls.openDetail.push(id); },
    translateListingLabel: (text) => text,
    normalizeType: (value) => String(value || '').toLowerCase().replace(/^students$/, 'student'),
    adminEscape: (value) => String(value ?? '')
  };
  const code = [
    grabConst('FX_FALLBACK'), grabConst('CURRENCY_SYMBOLS'), grabConst('SUPPORTED_DISPLAY_CURRENCIES'),
    grabFunction('publicFx'), grabFunction('fxRateToUgx'), grabFunction('convertedPriceText'),
    APP.slice(APP.indexOf('const CURRENCIES = {'), APP.indexOf('};', APP.indexOf('const CURRENCIES = {')) + 2),
    grabFunction('readStoredDisplayCurrency'), 'var activeCur = readStoredDisplayCurrency();',
    grabFunction('formatCompact'), grabFunction('localizePricePeriod'), grabFunction('fmtP'),
    grabFunction('normalizeListingPricePeriodValue'), grabConst('PRICE_PLAUSIBILITY_BOUNDS_FALLBACK'), grabFunction('listingPriceIsPlausible'),
    grabFunction('listingPriceNeedsCheck'), grabFunction('fmtListingPrice'), grabFunction('listingPriceHtml'),
    grabFunction('listingFromPriceElement'), grabFunction('fxNoteText'), grabFunction('refreshDisplayedPrices'),
    grabFunction('syncCurrencySelect'), grabFunction('setCurrency'),
    'this.api = { setCurrency, listingPriceHtml, fmtListingPrice, refreshDisplayedPrices, fxNoteText, get activeCur() { return activeCur; } };'
  ].join('\n');
  vm.runInNewContext(code, sandbox);
  return { api: sandbox.api, nodes, notes, storage, calls, sandbox };
}

const LISTING = { id: '346641f3-6b9c-4697-b44a-4e3bca78a52b', listing_type: 'sale', price: 650_000_000, price_period: 'once' };
const SIMILAR = { id: 'b2', listing_type: 'rent', price: 2_450_000, price_period: 'month' };

test('choosing £ converts the open property page, similar listings and server-rendered prices', () => {
  const { api, nodes, notes, storage, calls, sandbox } = sandboxFor({ fx: { base: 'UGX', as_of: '2026-10-01', rates: { USD: 3800, GBP: 4900, EUR: 4100 } } });
  assert.equal(api.activeCur, 'UGX');
  assert.match(api.listingPriceHtml(LISTING), />USh 650M<\/span>$/);
  // The detail price, a similar card and the SSR <p> are all [data-price-ugx] elements.
  nodes.push(makeNode({ priceUgx: '650000000', pricePeriod: 'once', listingType: 'sale' }));
  nodes.push(makeNode({ priceUgx: '2450000', pricePeriod: 'month', listingType: 'rent' }));
  notes.push(makeNode({}));
  api.setCurrency('GBP');
  assert.equal(api.activeCur, 'GBP');
  assert.deepEqual(calls.openDetail, ['346641f3-6b9c-4697-b44a-4e3bca78a52b'], 'the open detail is re-rendered');
  assert.equal(nodes[0].textContent, '≈ £132,653', '650,000,000 / 4,900');
  assert.equal(nodes[1].textContent, '≈ £500/month');
  assert.match(api.listingPriceHtml(LISTING), />≈ £132,653<\/span>$/);
  assert.match(api.listingPriceHtml(SIMILAR), />≈ £500\/month<\/span>$/);
  assert.match(notes[0].textContent, /^Approximate: £1 = USh 4,900 \(rates as of 1 Oct 2026\)\. Prices are set in Uganda shillings\.$/);
  assert.equal(storage.get('makaug_display_currency'), 'GBP', 'the choice is saved');
  assert.equal(sandbox.__select.value, 'GBP');
});

test('a reload keeps the chosen currency', () => {
  const { api } = sandboxFor({ stored: 'GBP' });
  assert.equal(api.activeCur, 'GBP');
  assert.equal(api.fmtListingPrice(LISTING), '≈ £132,653');
  assert.equal(sandboxFor({ stored: 'XYZ' }).api.activeCur, 'UGX', 'an unknown stored value falls back to UGX');
});

test('the rates come from the server config, with the fallback only when it is missing', () => {
  const { api } = sandboxFor({ stored: 'GBP', fx: { base: 'UGX', as_of: '2026-10-09', rates: { USD: 3700, GBP: 5000, EUR: 4300 } } });
  assert.equal(api.fmtListingPrice(LISTING), '≈ £130,000');
  assert.match(api.fxNoteText(), /USh 5,000 \(rates as of 9 Oct 2026\)/);
  const { publicDisplayFx } = require('../utils/displayFx');
  const fx = publicDisplayFx({ GBP_TO_UGX_RATE: '5000', FX_RATES_AS_OF: '2026-10-09' });
  assert.equal(fx.rates.GBP, 5000);
  assert.equal(fx.as_of, '2026-10-09');
  assert.equal(fx.rates.USD, require('../utils/propertyPriceCurrency').configuredUsdToUgxRate());
  const server = read('server.js');
  assert.match(server, /`window\.MAKAUG_FX = \$\{JSON\.stringify\(publicDisplayFx\(\)\)\};`/);
  assert.match(server, /app\.get\('\/api\/fx'/);
  assert.doesNotMatch(APP, /Math\.round\(v \/ (3800|4900|4100)\)/, 'no hard-coded conversion left in the bundle');
});

test('a USD-original listing shows its exact original when USD is chosen; UGX stays canonical', () => {
  const { api } = sandboxFor({ stored: 'USD' });
  const usdListing = { listing_type: 'sale', price: 410_400_000, price_period: 'once', price_original: 108_000, price_original_currency: 'USD' };
  assert.equal(api.fmtListingPrice(usdListing), '$108,000');
  assert.equal(api.fmtListingPrice({ listing_type: 'sale', price: 410_400_000, price_period: 'once' }), '≈ $108,000');
  const ugx = sandboxFor({ stored: 'UGX' }).api;
  assert.equal(ugx.fmtListingPrice(usdListing), 'USh 410M');
});

test('cards, the detail page, map popups and found-online cards render updatable prices; SSR prices carry the data too', () => {
  assert.match(APP, /<div class="text-3xl font-black text-green-700">\$\{listingPriceHtml\(p\)\}<\/div>\n\s*<div data-fx-note/);
  assert.match(APP, /text-sm font-bold">\$\{listingPriceHtml\(p, studentMode \? \(p\.period \|\| "sem"\) : p\.period\)\}<\/div>/);
  assert.match(APP, /margin-bottom:8px;">\$\{listingPriceHtml\(property \|\| \{\}\)\}<\/div>/);
  assert.match(APP, /<div class="social-import-card-price">\$\{listingPriceHtml\(/);
  const seo = require('../services/publicSeoRenderService');
  const rendered = seo.renderPropertySeoHtml(read('index.html'), seo.normalizeSeoListingRow({ id: '346641f3-6b9c-4697-b44a-4e3bca78a52b', listing_type: 'sale', title: 'House for sale', area: 'Kira', district: 'Wakiso', price: '650000000', price_period: 'once' }), { baseUrl: 'https://makaug.com/' });
  assert.match(rendered.html, /data-price-ugx="650000000" data-price-period="once" data-listing-type="sale"/);
});
