'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseShortTermSearchText,
  suggestPartnerHotels,
  shortTermAssistantText
} = require('../services/shortTermQuery');

const kololo = parseShortTermSearchText('2 bedroom Kololo under 150k');
assert.strictEqual(kololo.bedrooms, 2);
assert.strictEqual(kololo.max_price, 150000);
assert.strictEqual(kololo.place, 'Kololo');
assert.notStrictEqual(kololo.q, '2 bedroom Kololo under 150k');

const naguru = parseShortTermSearchText('3 bed Naguru below 200000');
assert.strictEqual(naguru.bedrooms, 3);
assert.strictEqual(naguru.max_price, 200000);
assert.strictEqual(naguru.place, 'Naguru');

const muyenga = parseShortTermSearchText('4-bedroom house in Muyenga max 2m');
assert.strictEqual(muyenga.bedrooms, 4);
assert.strictEqual(muyenga.max_price, 2000000);
assert.strictEqual(muyenga.place, 'Muyenga');

const placeOnly = parseShortTermSearchText('Entebbe');
assert.strictEqual(placeOnly.bedrooms, null);
assert.strictEqual(placeOnly.max_price, null);
assert.strictEqual(placeOnly.place, 'Entebbe');

const ugx = parseShortTermSearchText('under UGX 1,500,000 in Kololo');
assert.strictEqual(ugx.max_price, 1500000);
assert.strictEqual(ugx.place, 'Kololo');

const partners = [
  { title: 'Kololo Sky Hotel', district: 'Kampala', area: 'Kololo' },
  { title: 'Entebbe Lake Hotel', district: 'Wakiso', area: 'Entebbe' }
];
const matched = suggestPartnerHotels(partners, kololo, 4);
assert.strictEqual(matched.matched_place, true);
assert.deepStrictEqual(matched.hotels.map((hotel) => hotel.title), ['Kololo Sky Hotel']);
assert.strictEqual(matched.hotels[0].guide_only, true);

const fallback = suggestPartnerHotels(partners, { place: 'Gulu' }, 4);
assert.strictEqual(fallback.matched_place, false);
assert.strictEqual(fallback.hotels.length, 2);

const withPartners = shortTermAssistantText({ total: 0, parsed: kololo, suggestion: matched });
assert.match(withPartners, /guide only/i);
assert.match(withPartners, /Kololo Sky Hotel/);
assert.match(withPartners, /not showing a phone number or a live price/i);
assert.strictEqual(
  shortTermAssistantText({ total: 2, parsed: kololo, suggestion: matched }),
  'I found 2 short stays matching that search.'
);

const root = path.join(__dirname, '..');
const ai = fs.readFileSync(path.join(root, 'routes', 'ai.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'services', 'shortTermService.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets', 'short-term.js'), 'utf8');
assert.ok(ai.includes('parseShortTermSearchText'), 'short-term AI search must parse beds, price and place');
assert.ok(ai.includes('suggestPartnerHotels'), 'short-term AI search must suggest partner hotels when listings are empty');
assert.ok(service.includes('applyShortTermFreeText'), 'short-term search must not keep the whole phrase as one LIKE match');
assert.ok(!client.includes("The number is the hotel's own phone"), 'partner hotel copy must not claim a phone number');
assert.ok(!client.includes('Compare prices opens the partner site'), 'partner hotel copy must not claim Compare prices opens a site');
assert.ok(client.includes("t('checkPrices')"), 'Check prices is rendered from translated copy');
assert.ok(client.includes('!cfg.enabled || !cfg.brands || !cfg.brands.length) return \'\''), 'Check prices stays off until a hotel brand is enabled');

console.log('short-term query checks passed');
