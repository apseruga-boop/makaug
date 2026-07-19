'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const marketplace = require('../services/marketplaceService');

const migration = read('db/migrations/081_marketplace.sql');
const route = read('routes/marketplace.js');
const server = read('server.js');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const sanitizer = read('services/publicHtmlSanitizer.js');

test('marketplace schema creates the P1 business, review, lead, payment and audit models', () => {
  for (const table of ['marketplace_businesses', 'marketplace_reviews', 'marketplace_leads', 'marketplace_payments', 'marketplace_events']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /CHECK \(tier IN \('verified', 'private', 'found_online'\)\)/);
  assert.match(migration, /CHECK \(status IN \('pending_review', 'live', 'hidden', 'removed'\)\)/);
  assert.match(migration, /idx_marketplace_businesses_live_sort/);
  assert.match(migration, /idx_marketplace_businesses_category_location/);
  assert.match(migration, /idx_marketplace_businesses_search/);
  for (const field of ['secondary_categories', 'verified_until', 'services_text', 'year_established', 'latitude', 'longitude', 'owner_user_id', 'first_seen', 'last_refreshed']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`), `missing marketplace business field ${field}`);
  }
  for (const field of ['plan', 'provider', 'paid_until']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`), `missing marketplace payment field ${field}`);
  }
  assert.match(migration, /Paid verification remains disabled until P3/);
});

test('marketplace service uses canonical categories, Uganda districts and hard tier ordering', () => {
  assert.equal(marketplace.MARKETPLACE_CATEGORIES.length, 20);
  assert.equal(marketplace.DISTRICTS.length, 146);
  assert.equal(marketplace.normalizeCategory('Property lawyers'), 'property_lawyers');
  assert.equal(marketplace.validateUgandaLocation({ district: 'Wakiso', area: 'Kira' }).ok, true);
  assert.equal(marketplace.validateUgandaLocation({ district: 'Lagos' }).ok, false);
  assert.equal(marketplace.isCompetitorPortal({ website: 'https://property24.example' }), 'property24');
  assert.equal(marketplace.isCompetitorPortal({ social_links: { primary: 'https://facebook.com/lamudi' } }), 'lamudi');
  assert.match(read('services/marketplaceService.js'), /CASE tier WHEN 'verified' THEN 0 WHEN 'private' THEN 1 ELSE 2 END ASC/);
  assert.match(read('services/marketplaceService.js'), /MARKETPLACE_SEARCH_TTL_MS/);
});

test('marketplace Ask parser identifies a service and Uganda location', () => {
  const parsed = marketplace.parseMarketplaceQuery('I need a surveyor in Wakiso');
  assert.equal(parsed.category, 'surveyors');
  assert.equal(parsed.district, 'Wakiso');
});

test('marketplace card search caches compact results without losing the authoritative total', async () => {
  let queryCount = 0;
  const fakeDb = {
    async query(sql) {
      queryCount += 1;
      assert.match(sql, /LEFT JOIN paged ON TRUE/);
      return { rows: [{ id: 'business-1', name: 'Wakiso Survey Services', tier: 'private', total_count: 27 }] };
    }
  };
  marketplace.invalidateMarketplaceStats();
  const first = await marketplace.searchMarketplace(fakeDb, { query: 'cache-proof-marketplace', page: 1, limit: 20 });
  const second = await marketplace.searchMarketplace(fakeDb, { query: 'cache-proof-marketplace', page: 1, limit: 20 });
  assert.equal(first.total, 27);
  assert.equal(first.businesses.length, 1);
  assert.equal(second.total, 27);
  assert.equal(queryCount, 1);
});

test('marketplace routes expose public contracts and protect staff/King moderation', () => {
  assert.match(server, /app\.use\('\/api\/marketplace', marketplaceRoutes\)/);
  for (const endpoint of ["'/config'", "'/stats'", "'/search'", "'/ask'", "'/register'", "'/leads'"]) {
    assert(route.includes(endpoint), `missing marketplace endpoint ${endpoint}`);
  }
  assert.match(route, /router\.get\('\/admin\/pending', requireListingModerationAccess/);
  assert.match(route, /router\.patch\('\/admin\/:id\/status', requireListingModerationAccess/);
  assert.match(route, /createLead\(db/);
  assert.match(route, /logNotification\(db/);
  assert.match(route, /recordMarketplaceEvent\(db/);
  assert.match(route, /paid_verification_enabled: false/);
  assert.match(route, /source_drip_enabled: false/);
  assert.match(route, /Website must be a valid HTTP or HTTPS URL/);
  assert.match(route, /Choose a valid marketplace business/);
});

test('public Marketplace page, nav order and route are visible with the release marker', () => {
  assert.match(html, /marketplace-p1-20260719/);
  assert.match(app, /MARKETPLACE_P1_MARKER = "marketplace-p1-20260719"/);
  assert.match(html, /id="page-marketplace"/);
  assert.match(app, /marketplace: "\/marketplace"/);
  assert.match(app, /"\/marketplace": "marketplace"/);
  const aiIndex = html.indexOf('id="nav-ai"');
  const marketplaceIndex = html.indexOf('id="nav-marketplace"');
  const aboutIndex = html.indexOf('id="nav-about"');
  assert(aiIndex >= 0 && marketplaceIndex > aiIndex && aboutIndex > marketplaceIndex);
  assert.match(html, />AI Chatbot<\/a>/);
  assert.match(html, /marketplace-ai-input/);
  assert.match(html, /marketplace-register-form/);
  assert.match(html, /marketplace-category-chips/);
  assert.match(html, /id="marketplace-area"/);
  assert.match(html, /marketplace-pagination/);
  assert.match(html, /id="marketplace-live-total"/);
  assert.match(app, /marketplacePrimarySocialUrl/);
});

test('marketplace UI has all nine language packs and localized category labels', () => {
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    assert.match(app, new RegExp(`\\n  ${lang}: \\{`), `missing ${lang} marketplace UI pack`);
    assert.match(app, new RegExp(`${lang}: "`), `missing ${lang} category labels`);
  }
  assert.match(app, /root\.dir = currentLang === "ar" \? "rtl" : "ltr"/);
  assert.match(app, /applyMarketplaceLanguageUI\(\)/);

  const start = app.indexOf('const MARKETPLACE_UI_EN');
  const end = app.indexOf('const marketplaceState');
  const dictionarySource = app.slice(start, end).replace(/const MARKETPLACE_/g, 'var MARKETPLACE_');
  const context = {};
  vm.createContext(context);
  vm.runInContext(dictionarySource, context);
  const englishKeys = Object.keys(context.MARKETPLACE_UI_EN);
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const missing = englishKeys.filter((key) => !Object.hasOwn(context.MARKETPLACE_UI_OVERRIDES[lang], key));
    assert.deepEqual(missing, [], `${lang} falls back to English for ${missing.join(', ')}`);
  }
});

test('staff and King dashboards share the protected Marketplace approval queue', () => {
  assert.match(html, /id="staff-marketplace-queue"/);
  assert.match(html, /id="admin-marketplace-queue"/);
  assert.match(app, /refreshMarketplaceModerationQueue\("staff"/);
  assert.match(app, /refreshMarketplaceModerationQueue\("admin"/);
  assert.match(app, /\/api\/marketplace\/admin\/pending/);
  assert.match(app, /marketplaceModerateBusiness/);
});

test('public route sanitizer recognizes Marketplace as a standalone public page', () => {
  assert.match(sanitizer, /'page-marketplace'/);
  assert.match(sanitizer, /'\/marketplace': \['page-marketplace'\]/);
});
