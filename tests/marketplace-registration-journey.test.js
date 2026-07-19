'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const lifecycle = require('../services/marketplaceLifecycleService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('db/migrations/084_marketplace_registration_journey.sql');
const route = read('routes/marketplace.js');
const service = read('services/marketplaceLifecycleService.js');
const app = read('assets/makaug-app.js');
const html = read('index.html');
const server = read('server.js');

test('registration lifecycle schema stores ownership, tokens, notifications and the waitlist', () => {
  assert.match(migration, /registration_reference TEXT/);
  assert.match(migration, /owner_name TEXT/);
  assert.match(migration, /profile_view_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_edit_tokens/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /\btoken TEXT\b/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_owner_notifications/);
  assert.match(migration, /trigger_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_verified_waitlist/);
});

test('magic links hash secrets and all nine message templates are usable', () => {
  const first = lifecycle.hashMagicToken('a-secret-owner-link');
  const second = lifecycle.hashMagicToken('a-secret-owner-link');
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, 'a-secret-owner-link');
  for (const language of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    for (const type of ['received', 'live', 'rejected', 'day7', 'lead']) {
      const copy = lifecycle.lifecycleCopy(language, type, {
        name: 'Acme Surveyors', reference: 'MKT-123', publicUrl: 'https://makaug.com/marketplace?business=acme',
        editUrl: 'https://makaug.com/marketplace#manage=secret', waitlistUrl: 'https://makaug.com/marketplace?verified_waitlist=1',
        reason: 'Contact details could not be verified', resubmitUrl: 'https://makaug.com/marketplace#register',
        views: 4, category: 'surveyors', district: 'Wakiso'
      });
      assert.ok(copy.length > 20, `${language}.${type} is missing`);
      if (type === 'day7') assert.match(copy, /150,000/, `${language}.${type} is missing the approved price`);
    }
  }
});

test('public registration, secure owner management, waitlist and protected moderation are wired', () => {
  assert.match(route, /const ownerName = clean\(input\.owner_name/);
  assert.match(route, /registration_reference, owner_name, owner_phone, owner_email/);
  assert.match(route, /sendMarketplaceRegistrationAcknowledgement/);
  assert.match(route, /review_target_hours: 24/);
  assert.match(route, /router\.post\('\/manage\/resolve'/);
  assert.match(route, /router\.patch\('\/manage\/update'/);
  assert.match(route, /prepareMediaUrlForStorage/);
  assert.match(route, /router\.post\('\/verified-waitlist'/);
  assert.match(route, /sendMarketplaceApprovalNotification/);
  assert.match(route, /sendMarketplaceRejectionNotification/);
  assert.match(route, /Choose a structured rejection reason/);
  assert.match(route, /router\.get\('\/admin\/pending', requireListingModerationAccess/);
});

test('owner and moderator interfaces expose the complete journey without enabling payment', () => {
  assert.match(html, /marketplace-regjourney-20260719/);
  assert.match(html, /id="marketplace-register-owner-name"/);
  assert.match(html, /id="marketplace-manage-modal"/);
  assert.match(html, /id="marketplace-manage-images"/);
  assert.match(html, /id="marketplace-waitlist-modal"/);
  assert.match(html, /id="marketplace-rejection-code"/);
  assert.match(app, /marketplaceOpenManageProfile/);
  assert.match(app, /submitMarketplaceManagedProfile/);
  assert.match(app, /submitMarketplaceVerifiedWaitlist/);
  assert.match(app, /submitMarketplaceRejection/);
  assert.match(app, /MARKETPLACE_REGJOURNEY_MARKER = "marketplace-regjourney-20260719"/);
  assert.match(route, /paid_verification_enabled: false/);
  assert.match(route, /verified_waitlist_enabled: true/);
});

test('owner edit and direct profile routes bypass the broad marketplace search', () => {
  const start = app.indexOf('async function loadMarketplacePage');
  const end = app.indexOf('async function searchMarketplaceBusinesses', start);
  const loader = app.slice(start, end);
  assert.match(loader, /if \(marketplaceManageTokenFromRoute\(\)\)/);
  assert.match(loader, /if \(directBusinessSlug\)/);
  assert.ok(
    loader.indexOf('if (marketplaceManageTokenFromRoute())') < loader.indexOf('await searchMarketplaceBusinesses()'),
    'owner magic links must be resolved before the broad search'
  );
  assert.ok(
    loader.indexOf('if (directBusinessSlug)') < loader.indexOf('await searchMarketplaceBusinesses()'),
    'direct business profiles must be resolved before the broad search'
  );
  assert.match(html, /marketplace-owner-direct-fast-20260719/);
});

test('new lifecycle interface strings are translated in all nine languages', () => {
  const start = app.indexOf('const MARKETPLACE_UI_EN');
  const end = app.indexOf('const MARKETPLACE_CATEGORY_LABELS');
  const dictionarySource = app.slice(start, end).replace(/const MARKETPLACE_/g, 'var MARKETPLACE_');
  const context = {};
  vm.createContext(context);
  vm.runInContext(dictionarySource, context);
  const required = [
    'contactName', 'reviewTitle', 'reviewCopy', 'acknowledgementWhatsApp', 'acknowledgementEmail',
    'acknowledgementPending', 'manageProfile', 'manageSubtitle', 'loadingProfile', 'profileViews',
    'servicesOffered', 'servesRegions', 'profilePhotos', 'profilePhotosHelp', 'saveChanges',
    'changesSaved', 'privateUpsellTitle', 'privateUpsellCopy', 'joinWaitlist', 'verifiedComing',
    'waitlistTitle', 'waitlistSubtitle', 'businessOrOwnerName', 'waitlistSent'
  ];
  required.forEach((key) => assert.equal(typeof context.MARKETPLACE_UI_EN[key], 'string', `English missing ${key}`));
  for (const language of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const missing = required.filter((key) => !Object.hasOwn(context.MARKETPLACE_UI_OVERRIDES[language], key));
    assert.deepEqual(missing, [], `${language} falls back to English for ${missing.join(', ')}`);
  }
});

test('one-time day-seven and lead-triggered upsell hooks start on the server', () => {
  assert.match(service, /marketplace-day7:\$\{business\.id\}/);
  assert.match(service, /marketplace-lead:\$\{lead\.id\}:\$\{business\.id\}/);
  assert.match(service, /WHERE marketplace_owner_notifications\.status IN \('failed', 'skipped'\)/);
  assert.match(service, /day7_followup_sent_at IS NULL/);
  assert.match(service, /startMarketplaceLifecycleScheduler/);
  assert.match(server, /startMarketplaceLifecycleScheduler\(db\)/);
});
