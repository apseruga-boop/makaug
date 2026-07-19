'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const marketplace = require('../services/marketplaceService');

const migration = read('db/migrations/082_marketplace_report_fixes.sql');
const route = read('routes/marketplace.js');
const html = read('index.html');
const app = read('assets/makaug-app.js');

test('marketplace ownership claims have a durable moderated schema', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_claims/);
  assert.match(migration, /business_id UUID NOT NULL REFERENCES marketplace_businesses\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CHECK \(status IN \('pending_review', 'approved', 'rejected'\)\)/);
  assert.match(migration, /reviewed_by UUID REFERENCES users\(id\)/);
  assert.match(migration, /idx_marketplace_claims_status_created/);
  assert.match(migration, /idx_marketplace_claims_business_status/);
});

test('invalid Marketplace filters fail validation instead of broadening results', () => {
  assert.deepEqual(marketplace.validateMarketplaceFilters({ category: 'casino' }).ok, false);
  assert.deepEqual(marketplace.validateMarketplaceFilters({ district: 'Lagos' }).ok, false);
  assert.deepEqual(marketplace.validateMarketplaceFilters({ tier: 'sponsored' }).ok, false);
  assert.deepEqual(marketplace.validateMarketplaceFilters({ min_rating: '9' }).ok, false);
  assert.deepEqual(marketplace.validateMarketplaceFilters({ page: '0' }).ok, false);
  assert.deepEqual(marketplace.validateMarketplaceFilters({ limit: '500' }).ok, false);
  assert.deepEqual(marketplace.validateMarketplaceFilters({ category: 'surveyors', district: 'Wakiso', tier: 'verified', min_rating: '4' }).ok, true);
  assert.match(route, /res\.status\(400\)\.json\(\{ ok: false, error: 'Invalid marketplace filters\.'/);
});

test('claim submission and moderation share the protected staff and King queue', () => {
  assert.match(route, /router\.post\('\/claims'/);
  assert.match(route, /marketplace_business_claim/);
  assert.match(route, /router\.get\('\/admin\/pending', requireListingModerationAccess/);
  assert.match(route, /router\.patch\('\/admin\/claims\/:id\/status', requireListingModerationAccess/);
  assert.match(route, /SET tier = 'private', source_type = 'private'/);
  assert.match(route, /business_claim_\$\{status\}/);
  assert.match(app, /marketplaceClaimCardHtml/);
  assert.match(app, /marketplaceModerateClaim/);
  assert.match(app, /Pending ownership claims/);
});

test('public Marketplace exposes provenance, claim UI, disclaimer and full tier explanation', () => {
  assert.match(html, /marketplace-report-fixes-20260719/);
  assert.match(app, /MARKETPLACE_REPORT_FIXES_MARKER = "marketplace-report-fixes-20260719"/);
  assert.match(html, /id="marketplace-tiers"/);
  assert.match(html, /data-marketplace-i18n="tierFound">Found online/);
  assert.match(html, /data-marketplace-i18n="tierPrivate">Privately listed/);
  assert.match(html, /data-marketplace-i18n="tierVerified">Verified/);
  assert.match(app, /tierPrivate: "Privately listed"/);
  assert.match(html, /UGX 150,000\/year/);
  assert.match(html, /id="marketplace-claim-form"/);
  assert.match(html, /onsubmit="submitMarketplaceClaim\(event\)"/);
  assert.match(app, /marketplaceOpenClaimForm/);
  assert.match(app, /sourceFirstFound/);
  assert.match(app, /sourceLastRefreshed/);
  assert.match(app, /publicSourceDisclaimer/);
  assert.match(app, /rel="noopener nofollow"/);
});

test('new claim, provenance, disclaimer and tier strings are complete in all nine languages', () => {
  const start = app.indexOf('const MARKETPLACE_UI_EN');
  const end = app.indexOf('const marketplaceState');
  const dictionarySource = app.slice(start, end).replace(/const MARKETPLACE_/g, 'var MARKETPLACE_');
  const context = {};
  vm.createContext(context);
  vm.runInContext(dictionarySource, context);
  const required = [
    'tiersTitle', 'tiersSubtitle', 'tierFoundDesc', 'tierPrivateDesc', 'tierVerifiedDesc', 'verifiedPrice',
    'claimBusiness', 'claimTitle', 'claimSubtitle', 'claimReviewNote', 'claimantName', 'claimantRole',
    'roleOwner', 'roleDirector', 'roleEmployee', 'roleAgent', 'proofUrl', 'proofNotes', 'claimConsent',
    'submitClaim', 'claimSent', 'claimReference', 'sourceFoundGoogle', 'sourceFirstFound',
    'sourceLastRefreshed', 'publicSourceDisclaimer'
  ];
  required.forEach((key) => assert.equal(typeof context.MARKETPLACE_UI_EN[key], 'string', `English missing ${key}`));
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const missing = required.filter((key) => !Object.hasOwn(context.MARKETPLACE_UI_OVERRIDES[lang], key));
    assert.deepEqual(missing, [], `${lang} falls back to English for ${missing.join(', ')}`);
  }
});
