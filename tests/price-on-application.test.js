'use strict';

/**
 * C17 + C7 (10 Oct 2026; Arthur: "use price upon application"). Impossible
 * prices were live: MK-20260725-758173 land in Nakasero at UGX 3.23e18 (USD
 * "850,000,000,000,000" parsed from "$850,000"), rentals at UGX 1B-28B a
 * month. A price outside the plausibility bounds is now never stored or shown
 * as a number: it is "Price on application", staff see "check price".
 * C17 addendum: MK-20261009-D2F081 showed "USh 407B/month" in the staff panel
 * because its own id 7918f050-f8f3-407b-… (in its staff photo URLs) was read
 * as "407 b(illion)".
 */

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PRICE_BOUNDS_UGX, applyPricePlausibility, isPriceImplausible, pricePlausibility } = require('../utils/pricePlausibility');
const { parseSourcePrice, propertyPriceMetadata } = require('../utils/propertyPriceCurrency');
const { listingPriceQuality } = require('../utils/listingPriceQuality');
const { publicListingPayload } = require('../utils/publicListingPayload');
const { normalizeFoundOnlineSourcePost } = require('../services/socialSearchSourcedListingsService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const found = (overrides) => normalizeFoundOnlineSourcePost({
  source_url: `https://www.tiktok.com/@agent/video/7${String(Math.random()).slice(2, 17)}`,
  source_platform: 'tiktok',
  source_name: 'agent',
  area: 'Kira',
  district: 'Wakiso',
  ...overrides
});

test('the bounds are the ones Arthur set', () => {
  assert.deepEqual(PRICE_BOUNDS_UGX.sale, [5_000_000, 50_000_000_000]);
  assert.deepEqual(PRICE_BOUNDS_UGX.land, [1_000_000, 50_000_000_000]);
  assert.deepEqual(PRICE_BOUNDS_UGX.monthly, [50_000, 100_000_000]);
  assert.equal(isPriceImplausible({ listing_type: 'land', price: 3.23e18, price_period: 'once' }), true);
  assert.equal(isPriceImplausible({ listing_type: 'sale', price: 28.2e12, price_period: 'once' }), true);
  assert.equal(isPriceImplausible({ listing_type: 'rent', price: 1_300_000_000, price_period: 'month' }), true);
  assert.equal(isPriceImplausible({ listing_type: 'rent', price: 1_300_000, price_period: 'month' }), false);
  // A yearly rent is compared as a monthly figure: 120M a year is 10M a month.
  assert.equal(isPriceImplausible({ listing_type: 'rent', price: 120_000_000, price_period: 'year' }), false);
  assert.equal(isPriceImplausible({ listing_type: 'sale', price: 406_600_000, price_period: 'once' }), false);
});

test('3.23e18 becomes Price on application, keeping the raw figures for staff', () => {
  const { record, changed } = applyPricePlausibility({ listing_type: 'land', price: 3.23e18, price_original: 850_000_000_000_000, price_original_currency: 'USD', price_period: 'once', extra_fields: { source_caption: 'Land in Nakasero $850,000' } });
  assert.equal(changed, true);
  assert.equal(record.price, null);
  assert.equal(record.price_on_application, true);
  assert.equal(record.extra_fields.price_review, 'implausible');
  assert.equal(record.extra_fields.implausible_price_raw.price, 3.23e18);
  assert.equal(record.extra_fields.source_caption, 'Land in Nakasero $850,000');
  // ...and the approval gate can't approve the number, even with an override.
  const quality = listingPriceQuality({ listing_type: 'land', price: 3.23e18, price_period: 'once' });
  assert.ok(quality.hard_reasons.includes('price_above_plausible_bounds'));
  assert.equal(quality.blocked_even_with_override, true);
  assert.equal(listingPriceQuality(record).ok, true, 'the POA record passes');
});

test('parsers: the brief\'s examples', () => {
  // "$850,000" is USD 850,000, never 850,000,000,000,000.
  assert.deepEqual(parseSourcePrice('Prime land for sale in Nakasero at $850,000'), { amount: 850_000, currency: 'USD' });
  assert.equal(propertyPriceMetadata('$850,000').price, 850_000 * 3800);
  assert.deepEqual(parseSourcePrice('$7,422,794'), { amount: 7_422_794, currency: 'USD' });
  // "UGX 1.3m per month" stays 1,300,000; "1,300,000" isn't multiplied again.
  assert.equal(found({ title: 'Apartment for rent', caption: '2 bedroom apartment for rent in Ntinda UGX 1.3m per month', listing_type: 'rent' }).price, 1_300_000);
  assert.equal(found({ title: 'Apartment for rent', caption: 'Apartment for rent 1,300,000 per month Kyanja', listing_type: 'rent', price: '1.3m' }).price, 1_300_000);
  // "$2,000 Month" is about 7.6M UGX a month (it lost its price: "$2,000 M" read as USD 2 billion).
  const usdMonthly = found({ title: 'Apartment for rent', caption: 'Lovely apartment Kololo $2,000 Month', listing_type: 'rent' });
  assert.equal(usdMonthly.price, 7_600_000);
  assert.equal(usdMonthly.price_period, 'month');
  // A phone number run into a view count is not a price.
  assert.equal(parseSourcePrice('Call +2567507535461.2K views'), null);
  assert.equal(found({ title: 'House for rent Kira', caption: 'House for rent in Kira. Call +2567507535461.2K views', listing_type: 'rent' }).price, null);
  assert.equal(parseSourcePrice('Call 0772123456'), null);
  // A grouped 10-digit price is still a price.
  assert.deepEqual(parseSourcePrice('UGX 2,500,000,000'), { amount: 2_500_000_000, currency: 'UGX' });
});

test('found-online intake stores an implausible price as POA with price_review implausible', () => {
  const listing = found({ title: 'House for rent', caption: 'House for rent Kira at UGX 1,000,000,000 per month', listing_type: 'rent' });
  assert.equal(listing.price, null);
  assert.equal(listing.sourcePriceRejectionReason, 'implausible_price');
  assert.equal(listing.implausiblePriceRaw.price, 1_000_000_000);
  const source = read('services/socialSearchSourcedListingsService.js');
  assert.match(source, /\? \{ price_review: 'implausible', implausible_price_raw: item\.implausiblePriceRaw \|\| null \}/);
});

test('read-time guard: the public API never sends an implausible number', () => {
  assert.match(read('routes/properties.js'), /payload\.data = payload\.data\.map\(\(out, index\) => \{/);
  const out = publicListingPayload({ id: 'x', listing_type: 'land', title: 'Land in Nakasero', price: 3.23e18, price_period: 'once', price_original: 8.5e14, price_original_currency: 'USD' });
  assert.equal(out.price, null);
  assert.equal(out.price_original, null);
  assert.equal(out.price_on_application, true);
  assert.doesNotMatch(JSON.stringify(out), /3230000000000000000|3\.23e\+18/);
  const fine = publicListingPayload({ id: 'y', listing_type: 'rent', title: 'Flat', price: 1_000_000, price_period: 'month' });
  assert.equal(fine.price, 1_000_000);
  const staffMarked = publicListingPayload({ id: 'z', listing_type: 'sale', title: 'House', price: 450_000_000, price_period: 'once', extra_fields: { price_review: 'implausible' } });
  assert.equal(staffMarked.price, null);
});

test('SSR, SEO title, OG and WhatsApp show "Price on application"; no display prints more than 12 digits', () => {
  const seo = require('../services/publicSeoRenderService');
  const row = seo.normalizeSeoListingRow({ id: '8e25bf4a-230b-4577-a424-70bf19d8664f', listing_type: 'land', title: 'Land in Nakasero', area: 'Nakasero', district: 'Kampala', price: '3230000000000000000', price_period: 'once' });
  assert.equal(row.price, 0);
  assert.equal(row.price_implausible, true);
  const rendered = seo.renderPropertySeoHtml('<html><head><title>x</title></head><body><div id="app"></div></body></html>', row, { baseUrl: 'https://makaug.com/' });
  const html = rendered.html + JSON.stringify(rendered.meta || {}) + JSON.stringify(rendered.structuredData || {});
  assert.match(String(rendered.meta?.title || ''), /Price on application/);
  assert.match(html, /Price on application/);
  assert.doesNotMatch(html, /3,230,000,000|3230000000000/);
  assert.doesNotMatch(html.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ''), /\d{13,}/);
  const { formatWhatsappPropertyPrice } = require('../services/whatsappPropertyCardService');
  if (typeof formatWhatsappPropertyPrice === 'function') {
    assert.equal(formatWhatsappPropertyPrice({ listing_type: 'land', price: 3.23e18, price_period: 'once' }), 'Price on application (POA)');
  }
  assert.match(read('routes/whatsapp.js'), /lines\.push\(`   💰 \$\{formatListingPrice\(r\)\}`\);/);
  assert.match(read('server.js'), /if \(listing\.thin \|\| listing\.price_implausible\) \{/, 'implausible pages are noindexed');
});

test('the staff "Extracted from source text" panel: MK-20261009-D2F081 reads UGX 1,000,000, not 407B', () => {
  const src = read('assets/makaug-app.js');
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    return '';
  };
  // eslint-disable-next-line no-new-func
  const parse = Function(`const REVIEW_USD_TO_UGX_GUIDE_RATE = 3800; ${grab('adminReviewPriceTextForParsing')} ${grab('adminReviewMoneyFromText')} return adminReviewMoneyFromText;`)();
  const listingText = [
    '1-bedroom apartment for rent in Kyanja',
    'Spacious 1-bedroom apartment on the 3rd floor in Kyanja, Kampala, for rent at UGX 1,000,000 per month.',
    'Found-online TikTok property post 52 Kyanja, Uganda - SPACIOUS 1-BEDROOM APARTMENT FOR RENT — KYANJA! Rent: UGX 1,000,000/month',
    'Staff photos: https://media.makaug.com/properties/7918f050-f8f3-407b-aabe-718de3deb2c8/staff-images/1760084340-staff-photo-1.jpg',
    'Listing 7918f050-f8f3-407b-aabe-718de3deb2c8'
  ].join(' ');
  assert.equal(parse(listingText), 1_000_000);
  assert.equal(parse('house 4 bedrooms 450m'), 450_000_000);
  assert.equal(parse('Land 2.5bn negotiable'), 2_500_000_000);
  // An absurd extracted figure is "couldn't read a price".
  assert.match(src, /facts\.price_unreadable \? "Price: couldn't read a price"/);
  assert.match(src, /if \(partial\.price && !listingPriceIsPlausible\(partial\.price, listingType, pricePeriod, review\.transaction_type \|\| ""\)\) \{/);
});

test('staff queue rows show "Price on application" and a red "check price" tag', () => {
  const src = read('assets/makaug-app.js');
  assert.match(src, /data-check-price="1"[^>]*>check price<\/span>/);
  assert.match(src, /\$\{adminEscape\(item\.title \|\| "Untitled listing"\)\} \$\{brokerBadge\} \$\{checkPriceTag\}<\/div>/);
  assert.match(src, /function fmtListingPrice\(p = \{\}, periodOverride = null\)/);
  assert.match(read('server.js'), /window\.MAKAUG_PRICE_BOUNDS = \$\{String\(process\.env\.COUNTRY_CODE \|\| 'UG'\)\.trim\(\)\.toUpperCase\(\) === 'UG' \? JSON\.stringify\(PRICE_BOUNDS_UGX\) : 'false'\};/);
});

test('write paths: the submit form stores POA; staff and admin edits refuse an implausible number', () => {
  const properties = read('routes/properties.js');
  assert.match(properties, /extraFields\.price_review = 'implausible';/);
  assert.match(properties, /price_saved_as_poa: true/);
  assert.match(properties, /That price is outside the plausible range for this listing \(up to UGX/);
  assert.match(read('routes/staff.js'), /That price is outside the plausible range for this listing \(UGX/);
});

test('scripts/fix-implausible-prices.js: dry run lists and writes nothing; --apply sets POA', async () => {
  const { run } = require('../scripts/fix-implausible-prices');
  const rows = [
    { id: '8e25bf4a-230b-4577-a424-70bf19d8664f', inquiry_reference: 'MK-20260725-758173', status: 'approved', listing_type: 'land', price: '3230000000000000000', price_period: 'once', price_original: '850000000000000', price_original_currency: 'USD', source_text: 'Prime land for sale in Nakasero at $850,000', extra_fields: {} },
    { id: '54f27f64-a885-4f2b-bee0-5ca16930ddcb', inquiry_reference: 'MK-20260810-0C609F', status: 'approved', listing_type: 'rent', price: '1000000000', price_period: 'month', source_text: 'House for rent at only UGX 1,000,000 per month', extra_fields: {} },
    { id: 'c3483393-66f6-4add-869c-d9668c422b03', inquiry_reference: 'MK-20260927-5661B0', status: 'approved', listing_type: 'sale', price: '406600000', price_period: 'once', extra_fields: {} }
  ];
  const writes = [];
  const db = { query: async (sql, values) => {
    if (/^\s*SELECT/i.test(sql)) return { rows };
    writes.push({ sql, values });
    return { rowCount: 1, rows: [] };
  } };
  const lines = [];
  const dry = await run(db, { log: (line) => lines.push(line) });
  assert.equal(dry.applied, false);
  assert.equal(dry.found, 2);
  assert.equal(writes.length, 0);
  assert.match(lines.join('\n'), /MK-20260725-758173 \[approved\] land UGX 3,230,000,000,000,000,000\/once \(from USD 850000000000000\) — price_above_plausible_bounds/);
  assert.match(lines.join('\n'), /MK-20260810-0C609F .* source text reads UGX 1,000,000 \(confirm\)/);
  assert.doesNotMatch(lines.join('\n'), /MK-20260927-5661B0/);
  const applied = await run(db, { apply: true, log: () => {} });
  assert.equal(applied.updated, 2);
  const update = writes.find((write) => /UPDATE properties/.test(write.sql));
  assert.match(update.sql, /price_on_application = TRUE/);
  assert.equal(JSON.parse(update.values[1]).price_review, 'implausible');
  assert.ok(writes.some((write) => /property_moderation_events/.test(write.sql)));
});

test('the list and search API send an implausible price as Price on application', { skip: !process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL }, async () => {
  const db = require('../config/database');
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use('/api/properties', require('../routes/properties'));
  const tag = `POAGUARD${Date.now().toString(36)}`;
  const ids = [];
  try {
    for (const [title, price] of [[`${tag} flat a billion a month`, 1_000_000_000], [`${tag} flat one million a month`, 1_000_000]]) {
      ids.push((await db.query(
        `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage, source, listed_via)
         VALUES ('rent', $1, 'Two-bedroom flat for rent in Ntinda with parking and water.', 'Kampala', 'Ntinda', $2, 'month', 'approved', 'approved', 'website', 'website') RETURNING id`,
        [title, price]
      )).rows[0].id);
    }
    for (const url of [`/api/properties?limit=100`, `/api/properties/search?status=approved&public_only=1&listing_type=rent&limit=100&page=1`]) {
      const res = await request(app).get(url);
      assert.equal(res.status, 200, url);
      const rows = (res.body.data || []).filter((row) => ids.includes(row.id));
      assert.ok(rows.some((row) => /a billion/.test(row.title)), `${url}: ${JSON.stringify((res.body.data || []).map((row) => row.title))}`);
      for (const row of rows) {
        if (/a billion/.test(row.title)) { assert.equal(row.price, null, url); assert.equal(row.price_on_application, true, url); }
        else assert.equal(Number(row.price), 1_000_000, url);
      }
    }
  } finally {
    if (ids.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
  }
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});

test('the found-online summary never prints an implausible "Guide price" (live check, 10 Oct)', () => {
  const { buildThirdPartyPublicSummary, publicPriceLabelFor } = require('../services/publicListingCopy');
  const land = { listing_type: 'land', area: 'Nakasero', district: 'Kampala', price: '3230000000000000000', price_period: 'once', source: 'found_online_property_source_v1' };
  assert.equal(publicPriceLabelFor(land), 'Price on application');
  const summary = buildThirdPartyPublicSummary(land, { found_online: true, source_name: 'agent', source_platform: 'x' });
  assert.doesNotMatch(summary, /3,230,000|\d{13,}/);
  assert.match(summary, /Guide price: Price on application/);
  assert.equal(publicPriceLabelFor({ listing_type: 'rent', price: 1000000, price_period: 'month' }), 'UGX 1,000,000/month');
  const seo = require('../services/publicSeoRenderService');
  const row = seo.normalizeSeoListingRow({ id: '8e25bf4a-230b-4577-a424-70bf19d8664f', listing_type: 'land', title: 'Land in Nakasero', area: 'Nakasero', district: 'Kampala', price: '3230000000000000000', price_period: 'once', source: 'found_online_property_source_v1', copy_extra: { found_online: true, source_name: 'agent', source_platform: 'x', source_url: 'https://x.com/agent/status/1' } });
  assert.doesNotMatch(JSON.stringify(row), /3,230,000|3230000000000/);
});
