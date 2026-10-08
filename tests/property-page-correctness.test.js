'use strict';

// PR B: public property page correctness (moderator report, 8 Oct 2026).

process.env.COUNTRY_CODE = 'UG';
process.env.S3_PUBLIC_BASE_URL = 'https://media.makaug.com';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'property-page-correctness-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const propertiesRouter = require('../routes/properties');
const staffRouter = require('../routes/staff');
const seo = require('../services/publicSeoRenderService');
const copy = require('../services/publicListingCopy');
const { compactUgx } = require('../utils/compactUgx');

const app = express();
app.use(express.json());
app.use('/api/properties', propertiesRouter);
app.use('/api/staff', staffRouter);

const appSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(name);
}

const INTERNAL_TAGS = ['Found online', 'TikTok source evidence', 'Agent follow-up required', 'HD photos to verify', 'Road access to verify', 'Title to verify'];
const created = [];
let staffUserId;
let staffToken;

async function foundOnlineFixture(overrides = {}) {
  const id = crypto.randomUUID();
  created.push(id);
  await db.query(
    `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, bedrooms, status,
                             extra_fields, listed_via, source, lister_type, amenities, latitude, longitude)
     VALUES ($1, 'sale', $2, $3, 'Wakiso', 'Kitende', 350000000, 'once', 3, 'pending', $4::jsonb,
             'found_online', 'social_search_sourced_listings', 'agent', $5::jsonb, 0.2, 32.5)`,
    [
      id,
      overrides.title || '3 bedroom house #kitende for sale call 0772000111 now',
      overrides.description || 'Raw TikTok caption #house #kitende call 0772000111',
      JSON.stringify({
        found_online: true,
        source_platform: 'TikTok',
        source_url: 'https://www.tiktok.com/@kitendehomes/video/7000000000000000001',
        source_name: 'Kitende Homes',
        source_contact_label: 'Contact through the public TikTok source',
        public_contact_phone: '+256772000111',
        ...(overrides.extra || {})
      }),
      JSON.stringify(overrides.amenities || [...INTERNAL_TAGS, 'parking', 'Security'])
    ]
  );
  await db.query(
    `INSERT INTO property_images (property_id, url, is_primary, sort_order) VALUES ($1, 'https://media.makaug.com/properties/kitende-front.jpg', true, 0)`,
    [id]
  );
  return id;
}

test.before(async () => {
  const user = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, email, role, password_hash, status)
     VALUES ('Page', 'Moderator', $1, $2, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`, `page-mod-${Date.now()}@example.com`]
  )).rows[0];
  staffUserId = user.id;
  staffToken = jwt.sign({ sub: user.id, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

test.after(async () => {
  await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [created]).catch(() => {});
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [staffUserId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [staffUserId]).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});

// ---- B1 ---------------------------------------------------------------------

test('B1: staff-edited title and description reach the API and the server-rendered page after approval', async () => {
  const id = await foundOnlineFixture();
  // Warm the SSR cache while pending (it caches "not found"); approval must clear it.
  assert.equal(await seo.loadPublicSeoListing(db, id), null);

  const title = '3-bedroom family house for sale in Kitende with garden';
  const description = 'Three bedrooms, two bathrooms and a fenced garden on a quiet road off Entebbe Road. #tiktok';
  const edit = await request(app)
    .patch(`/api/staff/properties/${id}/review`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ listing: { title, description }, stage: 'in_review' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body).slice(0, 300));
  const stored = (await db.query('SELECT extra_fields FROM properties WHERE id = $1', [id])).rows[0].extra_fields;
  assert.deepEqual([...stored.staff_corrected_fields].sort(), ['description', 'title']);
  assert.ok(stored.staff_corrected_at);

  const approve = await request(app)
    .patch(`/api/properties/${id}/status`)
    .set('x-api-key', process.env.ADMIN_API_KEY)
    .send({ status: 'approved' });
  assert.equal(approve.status, 200, JSON.stringify(approve.body).slice(0, 300));
  const row = (await db.query('SELECT title, description FROM properties WHERE id = $1', [id])).rows[0];
  assert.equal(row.title, title, 'approval does not regenerate the title');

  const api = await request(app).get(`/api/properties/${id}`);
  assert.equal(api.body.data.title, title);
  assert.match(api.body.data.description, /^Three bedrooms, two bathrooms and a fenced garden/);
  assert.doesNotMatch(api.body.data.description, /#tiktok/);
  assert.doesNotMatch(api.body.data.description, /third-party property result/);
  assert.match(api.body.data.description, /Found on TikTok from Kitende Homes\. Check the original post before paying\./);

  const listing = await seo.loadPublicSeoListing(db, id);
  assert.equal(listing.title, title);
  const rendered = seo.renderPropertySeoHtml('<html><head><title>x</title></head><body><div id="detail-content"></div><footer></footer></body></html>', listing, { baseUrl: 'https://makaug.com' });
  assert.match(rendered.html, new RegExp(`<h1[^>]*>${title}</h1>`));
  assert.ok(rendered.meta.title.startsWith(title), rendered.meta.title);
  assert.match(rendered.meta.description, /^Three bedrooms, two bathrooms and a fenced garden/);
  assert.match(rendered.html, /Found on TikTok from Kitende Homes/);
});

test('B1: editing a live listing clears the cached API and server-rendered copy', async () => {
  const id = await foundOnlineFixture();
  await db.query("UPDATE properties SET status = 'approved', moderation_stage = 'approved' WHERE id = $1", [id]);
  const before = await request(app).get(`/api/properties/${id}`);
  assert.match(before.body.data.title, /for sale in Kitende/);
  assert.match((await seo.loadPublicSeoListing(db, id)).title, /for sale in Kitende/);
  const title = 'Kitende 3-bedroom bungalow for sale';
  const edit = await request(app)
    .patch(`/api/staff/properties/${id}/review`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ listing: { title }, stage: 'approved' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body).slice(0, 300));
  assert.equal((await request(app).get(`/api/properties/${id}`)).body.data.title, title);
  assert.equal((await seo.loadPublicSeoListing(db, id)).title, title);
});

test('B1: without a staff edit, the API and SSR show the same generated copy (not the raw caption)', async () => {
  const id = await foundOnlineFixture();
  await db.query("UPDATE properties SET status = 'approved' WHERE id = $1", [id]);
  const api = await request(app).get(`/api/properties/${id}`);
  const listing = await seo.loadPublicSeoListing(db, id);
  assert.equal(listing.title, api.body.data.title);
  assert.doesNotMatch(listing.title, /#kitende|0772/);
  assert.doesNotMatch(listing.description, /Raw TikTok caption/);
});

test('B1: staff copy keeps the # strip and a 2,000-character cap, and skips the copied-text heuristics', () => {
  const long = `${'Spacious home. '.repeat(200)}#ad`;
  const property = { title: 'A very long staff title that has more than fourteen words in it so the old heuristic would reject it', description: long, extra_fields: { staff_corrected_fields: ['title', 'description'] } };
  const extra = { source_platform: 'TikTok' };
  assert.equal(copy.buildThirdPartyPublicTitle(property, extra), property.title);
  const summary = copy.buildThirdPartyPublicSummary(property, extra);
  assert.ok(summary.split('\n\n')[0].length <= copy.STAFF_COPY_MAX_CHARS);
  assert.doesNotMatch(summary, /#ad/);
});

// ---- B2 ---------------------------------------------------------------------

test('B2: compact price never more than 1% off (server and frontend agree)', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(appSource, 'formatCompact'), sandbox);
  const cases = [[2300000, '2.3M'], [1250000, '1.25M'], [850000, '850k'], [1500000000, '1.5B'], [1000000000, '1B']];
  for (const [value, expected] of cases) {
    assert.equal(compactUgx(value), expected, `server ${value}`);
    assert.equal(sandbox.formatCompact(value), expected, `frontend ${value}`);
  }
  for (const value of [999999, 1234567, 2345678, 45000000, 123456789, 7777777777]) {
    const text = compactUgx(value);
    const unit = { k: 1e3, M: 1e6, B: 1e9, T: 1e12 }[text.slice(-1)];
    assert.ok(Math.abs(Number(text.slice(0, -1)) * unit - value) / value <= 0.01, `${value} → ${text}`);
    assert.equal(sandbox.formatCompact(value), text);
  }
});

test('B2: "/month" for mo, monthly and per_month', () => {
  for (const period of ['month', 'mo', 'monthly', 'per_month']) {
    assert.equal(copy.publicPriceLabelFor({ price: 2300000, price_period: period }), 'USh 2,300,000/month', period);
  }
  assert.equal(copy.publicPriceLabelFor({ price: 350000000, price_period: 'once' }), 'USh 350,000,000');
});

// ---- B3 ---------------------------------------------------------------------

test('B3: internal moderation tags never come back as amenities (API and detail HTML)', async () => {
  const id = await foundOnlineFixture();
  await db.query("UPDATE properties SET status = 'approved' WHERE id = $1", [id]);
  const api = await request(app).get(`/api/properties/${id}`);
  assert.deepEqual(api.body.data.amenities, ['parking', 'Security']);
  const list = await request(app).get('/api/properties?status=approved&public_only=1&limit=50');
  const listed = (list.body.data || []).find((row) => row.id === id);
  for (const tag of INTERNAL_TAGS) assert.ok(!((listed && listed.amenities) || []).includes(tag), `search leaks ${tag}`);
  const listing = await seo.loadPublicSeoListing(db, id);
  const rendered = seo.renderPropertySeoHtml('<div id="detail-content"></div><footer></footer>', listing, {});
  for (const tag of INTERNAL_TAGS) {
    assert.ok(!JSON.stringify(api.body.data).includes(tag) || tag === 'Found online', `API leaks ${tag}`);
    assert.ok(!rendered.html.includes(tag), `HTML leaks ${tag}`);
  }
  assert.equal(api.body.data.extra_fields.original_publish_date_status ?? null, null);
});

test('B3: imports keep moderation reminders out of amenities; the frontend shows only known amenities', () => {
  const importer = fs.readFileSync(path.join(__dirname, '..', 'services', 'socialSearchSourcedListingsService.js'), 'utf8');
  assert.match(importer, /amenities: postgresSafeJsonStringify\(\[\]\)/);
  assert.match(importer, /internal_review_tags: internalReviewTagsFor\(item, agent\)/);
  const sandbox = { LP_CONFIG: { sale: { amenities: [{ value: 'parking', label: '🚗 Parking' }] } }, translateListingLabel: (text) => text };
  vm.createContext(sandbox);
  const start = appSource.indexOf('const INTERNAL_AMENITY_TAG_PATTERN');
  const end = appSource.indexOf('function isGeneratedPropertyNarrative');
  vm.runInContext(appSource.slice(start, end).replace(/^const /gm, 'var '), sandbox);
  for (const tag of INTERNAL_TAGS) assert.equal(sandbox.getAmenityDisplayLabel(tag), '', tag);
  assert.equal(sandbox.getAmenityDisplayLabel('parking'), '🚗 Parking');
  assert.equal(sandbox.getAmenityDisplayLabel('Swimming pool'), 'Swimming Pool');
  assert.equal(sandbox.getAmenityDisplayLabel('random junk'), '');
});

test('B3: the strip script plans a move of only the internal tags', () => {
  const { plan } = require('../scripts/strip-internal-amenity-tags');
  const [item] = plan([{ id: 'a', status: 'approved', amenities: [...INTERNAL_TAGS, 'parking'], existing_tags: null }]);
  assert.deepEqual(item.keep, ['parking']);
  assert.deepEqual(item.tags, INTERNAL_TAGS);
  assert.deepEqual(plan([{ id: 'b', amenities: ['parking'] }]), []);
});

test('B3: the internal "original post date" sentence is not public', async () => {
  const id = await foundOnlineFixture({ extra: { source_post_date_status: 'needs_source_platform_date_confirmation', first_seen_online_at: '2026-10-01T00:00:00Z' } });
  await db.query("UPDATE properties SET status = 'approved' WHERE id = $1", [id]);
  const api = await request(app).get(`/api/properties/${id}`);
  assert.doesNotMatch(JSON.stringify(api.body.data), /Original post date is being confirmed/);
});

test('B3: the internal date sentence stored by imports is replaced too (live 662e6f08 / dfc9d41c)', async () => {
  const sentence = 'Original post date is being confirmed from the source platform.';
  const id = await foundOnlineFixture({ extra: {
    original_publish_date_status: sentence,
    first_posted_online_label: sentence,
    source_published_label: `${sentence.replace(/\.$/, '')} for the 2026+ found-online window.`
  } });
  await db.query("UPDATE properties SET status = 'approved' WHERE id = $1", [id]);
  const api = await request(app).get(`/api/properties/${id}`);
  const extra = api.body.data.extra_fields;
  assert.doesNotMatch(JSON.stringify(api.body.data), /being confirmed from the source platform/);
  assert.equal(extra.original_publish_date_status, 'Posted date not confirmed');
  assert.equal(extra.first_posted_online_label, 'Posted date not confirmed');
  assert.equal(extra.source_published_label, 'Posted date not confirmed');
});

// ---- B4 ---------------------------------------------------------------------

test('B4: a row with a phone and a stale TikTok label says "Call or WhatsApp the agent"', async () => {
  const id = await foundOnlineFixture();
  await db.query("UPDATE properties SET status = 'approved' WHERE id = $1", [id]);
  const api = await request(app).get(`/api/properties/${id}`);
  assert.equal(api.body.data.extra_fields.source_contact_label, 'Call or WhatsApp the agent');
  assert.equal(copy.publicContactLabelFor({ email: 'a@b.co' }), 'Email the agent');
  assert.equal(copy.publicContactLabelFor({ platform: 'TikTok', hasSourceUrl: true }), 'Contact via TikTok source');
  assert.match(appSource, /shownContactPhone\s*\?\s*"Call or WhatsApp the agent"/);
});

// ---- B5 ---------------------------------------------------------------------

test('B5: Google is not used after an auth failure; the static map is an area card', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(appSource, 'shouldUseGoogleMaps'), sandbox);
  assert.equal(sandbox.shouldUseGoogleMaps({ hasKey: true, authFailed: false, loaded: true }), true);
  assert.equal(sandbox.shouldUseGoogleMaps({ hasKey: true, authFailed: true, loaded: true }), false);
  assert.equal(sandbox.shouldUseGoogleMaps({ hasKey: false, authFailed: false, loaded: true }), false);
  assert.equal(sandbox.shouldUseGoogleMaps({ hasKey: true, authFailed: false, loaded: false }), false);
  assert.match(appSource, /window\.gm_authFailure = function makaugGoogleMapsAuthFailure\(\)/);
  assert.match(extractFunction(appSource, 'ensureGoogleMapsApi'), /authFailed: googleMapsAuthFailed/);
  const fallback = extractFunction(appSource, 'renderStaticDetailMapFallback');
  assert.doesNotMatch(fallback, /staticUrl|<img /);
  assert.match(fallback, /data-map-area-card/);
});

// ---- B6 ---------------------------------------------------------------------

test('B6: "once", "month" and "Land title" resolve to each language\'s own pack value', () => {
  const langs = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
  const packs = Object.fromEntries(langs.map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'i18n', `site-${lang}.json`), 'utf8')).phrases]));
  const sandbox = {
    currentLang: 'en',
    LANG_FALLBACK: { en: 'en', lg: 'en', sw: 'en', ac: 'sw', ny: 'en', rn: 'en', sm: 'en', am: 'en', ar: 'en' },
    LISTING_LABEL_I18N: { en: {}, lg: {}, sw: {} },
    // What the bundle registers today: native lg/sw values, and the Luganda copies
    // that used to override Acholi/Runyankole/... now land in BORROWED.
    LISTING_LABEL_I18N_SUPPLEMENTAL: { lg: { once: 'omulundi gumu', month: 'omwezi' }, sw: { once: 'mara moja', month: 'mwezi' } },
    LISTING_LABEL_I18N_BORROWED: Object.fromEntries(['ac', 'ny', 'rn', 'sm'].map((lang) => [lang, { once: 'omulundi gumu', month: 'omwezi', 'Land title': "Title y'ettaka" }])),
    siteTranslate: (text, lang) => (packs[lang] && packs[lang][text]) || text
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(appSource, 'translateListingLabel'), sandbox);
  for (const lang of langs) {
    sandbox.currentLang = lang;
    for (const key of ['once', 'month', 'Land title']) {
      const expected = lang === 'lg' || lang === 'sw' ? (sandbox.LISTING_LABEL_I18N_SUPPLEMENTAL[lang][key] || packs[lang][key]) : packs[lang][key];
      assert.equal(vm.runInContext(`translateListingLabel(${JSON.stringify(key)})`, sandbox), expected, `${lang} ${key}`);
    }
  }
  assert.equal(packs.ac.once, 'kicel');
  assert.equal(packs.ny['Land title'], "Ekyapa ky'eitaka");
  // The bundle no longer copies Luganda into the other languages' own dictionaries.
  assert.doesNotMatch(appSource, /sourceAndDetailLabels\[lang\] = \{ \.\.\.sourceAndDetailLabels\.lg/);
  assert.doesNotMatch(appSource, /sharedLabels\[lang\] = \{ \.\.\.\(sharedLabels\[lang\] \|\| \{\}\), \.\.\.sharedLabels\.lg \}/);
  assert.doesNotMatch(appSource, /contactIdLabels\[lang\] = \{ \.\.\.contactIdLabels\.lg/);
});

test('B6: the i18n audit runs read-only and reports per language', () => {
  const { audit } = require('../scripts/i18n-audit');
  const report = audit({ keys: ['once', 'month', 'Land title'] });
  assert.equal(report.ac.same_as_english.length, 0);
  assert.equal(report.ac.missing.length, 0);
  assert.ok(report.ny.phrases > 1000);
});

// ---- B7 ---------------------------------------------------------------------

test('B7: the outlier report lists impossible, USD-looks-UGX, monthly and one-off outliers (read-only)', async () => {
  const ids = [];
  const add = async (fields) => {
    const id = crypto.randomUUID();
    ids.push(id);
    created.push(id);
    await db.query(
      `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, price_original, price_original_currency, status, extra_fields, listed_via)
       VALUES ($1, $2, 'Outlier', 'x', 'Kampala', 'Ntinda', $3, $4, $5, $6, 'approved', '{}'::jsonb, 'website')`,
      [id, fields.type, fields.price, fields.period, fields.original || null, fields.currency || null]
    );
    return id;
  };
  const impossible = await add({ type: 'sale', price: '3230000000000000000', period: 'once' });
  const usd = await add({ type: 'sale', price: '3230000000000', period: 'once', original: 850000000, currency: 'USD' });
  const monthly = await add({ type: 'rent', price: '28300000000', period: 'mo' });
  const oneOff = await add({ type: 'land', price: '25000000000', period: 'once' });
  const fine = await add({ type: 'sale', price: '350000000', period: 'once' });
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'report-price-outliers.js'), 'utf8');
  assert.doesNotMatch(script, /UPDATE properties|DELETE FROM|INSERT INTO|includes\('--apply'\)/);
  const { reportPriceOutliers } = require('../scripts/report-price-outliers');
  const rows = (await reportPriceOutliers(db)).filter((row) => ids.includes(row.id));
  const reasons = Object.fromEntries(rows.map((row) => [row.id, row.reason]));
  assert.equal(reasons[impossible], 'price_above_1e12');
  assert.equal(reasons[usd], 'price_above_1e12');
  assert.equal(reasons[monthly], 'monthly_above_100m');
  assert.equal(reasons[oneOff], 'one_off_above_20bn');
  assert.equal(reasons[fine], undefined);
});
