'use strict';

// Short-stay review fixes (Arthur, 16 Nov 2026): clean titles, guest
// estimates, USD prices, POA last, the found-online public rule, noindex on
// filtered grids and the posting page copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const display = require('../services/shortStayDisplay');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('found-online captions become short structured titles', () => {
  assert.equal(display.cleanStayTitle({
    source: 'imported', title: '🔥🔥 #kololo #airbnb Lovely 2 bedroom apartment available now call', bedrooms: 2, area: 'Kololo', district: 'Kampala'
  }), '2-bed apartment in Kololo');
  assert.equal(display.cleanStayTitle({ source: 'imported', title: 'Studio for short stay #kisaasi', bedrooms: 1, area: 'Kisaasi', district: 'Kampala' }), 'Studio in Kisaasi');
  const villa = display.cleanStayTitle({ source: 'imported', title: 'Luxury villa with pool', bedrooms: 5, area: 'Kyanja', district: 'Kampala' });
  assert.equal(villa, '5-bed villa in Kyanja');
  for (const title of [villa]) {
    assert.ok(title.length <= 70);
    assert.ok(!/#|\p{Extended_Pictographic}/u.test(title));
  }
});

test("a host's own title is kept, without emoji", () => {
  assert.equal(display.cleanStayTitle({ source: 'host', title: 'Garden cottage in Muyenga', bedrooms: 1, area: 'Muyenga' }), 'Garden cottage in Muyenga');
});

test('internal template sentences never reach the page', () => {
  const out = display.cleanStayDescription('Nice place near the mall. Original post date is being confirmed. Found online. Pending short-stay moderation. Do not message this source.');
  assert.match(out, /Nice place near the mall/);
  assert.doesNotMatch(out, /being confirmed|Pending short-stay moderation|Do not message/i);
});

test('guests are estimated from bedrooms when the importer left the default of 2', () => {
  assert.equal(display.effectiveGuests({ max_guests: 2, bedrooms: 3 }), 6);
  assert.equal(display.effectiveGuests({ max_guests: 2, bedrooms: 1 }), 2);
  assert.equal(display.effectiveGuests({ max_guests: 8, bedrooms: 2 }), 8);
  assert.match(display.effectiveGuestsSql('l'), /l\.bedrooms/);
});

test('USD nightly prices are read only when the text says per night', () => {
  assert.equal(display.parseUsdNightly('USD 120 per night'), 120);
  assert.equal(display.parseUsdNightly('Only $100 a night'), 100);
  assert.equal(display.parseUsdNightly('22$ per month'), null);
});

test('a found-online stay needs a price and a specific location to go public', () => {
  const base = { source: 'imported', base_nightly_ugx: 150000, area: 'Kololo', district: 'Kampala', extra_fields: {} };
  assert.deepEqual(display.foundOnlineStayPublicRule(base), { ok: true, missing: [] });
  assert.deepEqual(display.foundOnlineStayPublicRule({ ...base, base_nightly_ugx: 0, extra_fields: { price_on_application: true } }).missing, ['price']);
  assert.deepEqual(display.foundOnlineStayPublicRule({ ...base, area: 'Kampala' }).missing, ['location']);
  assert.ok(display.foundOnlineStayPublicRule({ ...base, base_nightly_ugx: 0, description: 'USD 120 per night' }).ok);
});

test('the importer marks a stay with no price or place as not publishable', () => {
  const { buildFoundOnlineShortStayRecord } = require('../services/foundOnlineShortStayIntake');
  const record = buildFoundOnlineShortStayRecord({ title: 'Apartment', description: 'Lovely apartment, call for price', district: 'Kampala', area: '', beds: 2 });
  assert.equal(record.status, 'pending');
  assert.equal(record.extra_fields.public_rule.ok, false);
  assert.deepEqual(record.extra_fields.public_rule.missing, ['price', 'location']);
  assert.equal(record.max_guests, 4);
});

test('moderators cannot approve a found-online stay that breaks the rule', () => {
  const src = read('services/shortTermModerationService.js');
  assert.equal((src.match(/assertFoundOnlinePublicRule\(listing\);/g) || []).length, 2, 'staff and King approval both check it');
});

test('POA sorts last and never matches a price cap', () => {
  const src = read('services/shortTermService.js');
  assert.match(src, /POA_LAST_SQL/);
  assert.match(src, /l\.base_nightly_ugx > 0 AND \$\{PRICED_SQL\} AND l\.base_nightly_ugx <=/);
});

test('filtered or empty short-stay grids are noindex; the plain grid is indexable', () => {
  const src = read('server.js');
  assert.match(src, /function shortTermGridShouldNoindex/);
  assert.match(src, /'noindex,follow'/);
});

test('the posting page offers no free days', () => {
  const src = read('services/publicSeoService.js');
  assert.doesNotMatch(src, /Pay nothing for 7 days/);
  assert.match(src, /agents pay UGX 50,000 a month/);
  assert.match(read('assets/makaug-app.js'), /pathname === '\/list-property'/);
});

test('the stay page carries the aggregator notice, safety tips, share links and a lead card under the map', () => {
  const src = read('assets/short-term-options.js');
  assert.match(src, /We do not take bookings or payments/);
  assert.match(src, /Contact the original poster/);
  assert.match(src, /Do not send a deposit/);
  assert.match(src, /facebook\.com\/sharer/);
  assert.match(src, /id="st-map-lead-slot"/);
  assert.doesNotMatch(src, /\d{9,}/, 'no phone numbers in the client');
});
