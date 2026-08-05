'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const propertiesRoute = require('../routes/properties');
const adminRoute = require('../routes/admin');
const {
  foundOnlinePerUrlResults,
  normalizeFoundOnlineSourcePost,
} = require('../services/socialSearchSourcedListingsService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('K31 found-online approval exemption is provenance-driven and location remains mandatory', () => {
  const policy = propertiesRoute._test.sourcedInventoryApprovalPolicy({
    nextStatus: 'approved',
    row: {
      area: 'Kira',
      district: 'Wakiso',
      source: 'found_online_property_source_v1',
      listed_via: 'found_online',
      extra_fields: JSON.stringify({ found_online_candidate: true })
    }
  });
  assert.equal(policy.isSourcedCandidate, true);
  assert.equal(policy.usesExemption, true);
  assert.equal(policy.hasLocation, true);
  assert.equal(policy.requestedOverride, false);

  const missingLocation = propertiesRoute._test.sourcedInventoryApprovalPolicy({
    nextStatus: 'approved',
    row: { source: 'found_online_property_source_v1' }
  });
  assert.equal(missingLocation.usesExemption, true);
  assert.equal(missingLocation.hasLocation, false);

  const serializedLocation = propertiesRoute._test.sourcedInventoryApprovalPolicy({
    nextStatus: 'approved',
    row: {
      source: 'found_online_property_source_v1',
      extra_fields: JSON.stringify({ source_location: 'Kitende, Wakiso' })
    }
  });
  assert.equal(serializedLocation.usesExemption, true);
  assert.equal(serializedLocation.hasLocation, true);

  const ordinaryOwner = propertiesRoute._test.sourcedInventoryApprovalPolicy({
    nextStatus: 'approved',
    row: { area: 'Kira', source: 'owner_listing' },
    requestedOverride: true
  });
  assert.equal(ordinaryOwner.usesExemption, false);
  assert.equal(ordinaryOwner.invalidOverride, true);
});

test('K31 source prices prefer caption evidence over mangled upstream numerics', () => {
  const sevenBillion = normalizeFoundOnlineSourcePost({
    post_url: 'https://x.com/example/status/7000000000000000001',
    platform: 'X',
    title: 'Commercial property for sale in Kololo',
    caption: 'Commercial property for sale in Kololo at 7 Billions UGX.',
    area: 'Kololo',
    district: 'Kampala',
    price: 1870000
  });
  assert.equal(sevenBillion.price, 7000000000);
  assert.equal(sevenBillion.priceOriginal, 7000000000);

  const onePointSixBillion = normalizeFoundOnlineSourcePost({
    post_url: 'https://x.com/example/status/1600000000000000001',
    platform: 'X',
    title: 'House for sale in Kira',
    caption: 'House for sale in Kira at 1.6B UGX.',
    area: 'Kira',
    district: 'Wakiso',
    price: 16000000
  });
  assert.equal(onePointSixBillion.price, 1600000000);
  assert.equal(onePointSixBillion.priceOriginal, 1600000000);
});

test('K31 admin review accepts legacy top-level edits and rejects arbitrary stages', () => {
  const topLevel = adminRoute._test.adminReviewListingPatchFromBody({
    price: 7000000000,
    area: 'Kololo',
    notes: 'checked',
    stage: 'in_review'
  });
  assert.deepEqual(topLevel, { price: 7000000000, area: 'Kololo' });
  assert.deepEqual(
    adminRoute._test.adminReviewListingPatchFromBody({ listing_patch: { price: 1600000000, area: 'Kira' } }),
    { price: 1600000000, area: 'Kira' }
  );
  assert.equal(adminRoute._test.ADMIN_REVIEW_STAGES.has('in_review'), true);
  assert.equal(adminRoute._test.ADMIN_REVIEW_STAGES.has('made_up_stage'), false);
  assert.match(read('routes/admin.js'), /if \(!ADMIN_REVIEW_STAGES\.has\(stage\)\)/);
});

test('K31 import response accounts for every normalized source URL', () => {
  const items = [
    { key: 'created-x', sourceUrl: 'https://x.com/example/status/1', sourcePlatform: 'X', title: 'Created' },
    { key: 'existing-youtube', sourceUrl: 'https://youtube.com/watch?v=abc', sourcePlatform: 'YouTube', title: 'Existing' },
    { key: 'skipped-tiktok', sourceUrl: 'https://tiktok.com/@example/video/2', sourcePlatform: 'TikTok', title: 'Skipped' }
  ];
  const breakdown = foundOnlinePerUrlResults(items, {
    created: [{ id: 'p1', source_url: items[0].sourceUrl, status: 'pending', moderation_stage: 'submitted', title: 'Created' }],
    alreadyPresent: [{ id: 'p2', key: items[1].key, source_url: items[1].sourceUrl, status: 'approved', reason: 'exact_source_url_duplicate', title: 'Existing' }],
    sourceReviewRecords: [{ key: items[2].key, source_url: items[2].sourceUrl, reason: 'low_signal_source_location', title: 'Skipped' }]
  });
  assert.deepEqual(breakdown.results.map((item) => item.outcome), ['created', 'existing', 'skipped']);
  assert.deepEqual(breakdown.summary, { created: 1, existing: 1, skipped: 1 });
  assert.equal(breakdown.results.every((item) => item.source_url && item.reason), true);
});

test('K31 release marker is present', () => {
  assert.match(read('index.html'), /k31-found-online-moderation-20260805/);
});

test('K31 King importer renders a visible result for every source URL', () => {
  const frontend = read('assets/makaug-app.js');
  assert.match(frontend, /Per-URL outcome/);
  assert.match(frontend, /importResult\.per_url_results/);
  assert.match(frontend, /adminSocialQuickPerUrlResultHtml/);
});
