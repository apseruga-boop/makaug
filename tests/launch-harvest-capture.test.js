'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const {
  FOUND_ONLINE_LAUNCH_INTAKE_POLICY,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');

async function main() {
  const socialSearchService = read('services/socialSearchSourcedListingsService.js');
  const socialDiscoveryService = read('services/socialPlatformPostDiscoveryService.js');
  const html = read('index.html');

  assert(html.includes('launch-harvest-capture-20260715'), 'production HTML marker should include widened launch capture');
  assert(FOUND_ONLINE_LAUNCH_INTAKE_POLICY.queue_rule.includes('queue every supported public social property post'), 'policy should describe review-first capture');
  assert(FOUND_ONLINE_LAUNCH_INTAKE_POLICY.queue_rule.includes('Missing phone'), 'policy should explicitly allow missing phone/media/price/exact pin into review');
  assert(socialSearchService.includes("capture_mode: 'launch_review_first'"), 'intake metadata should expose launch review-first mode');
  assert(socialSearchService.includes('weak_contact_captured_for_review'), 'intake metadata should flag missing direct contact captured for review');
  assert(socialSearchService.includes('weak_media_captured_for_review'), 'intake metadata should flag missing media captured for review');
  assert(socialSearchService.includes('weak_location_captured_for_review'), 'intake metadata should flag fuzzy location captured for review');
  assert(!socialSearchService.includes('hasContact && hasImageOrEvidence && dateStatus'), 'capture eligibility should not depend on phone/media/exact-location strictness');
  assert(socialDiscoveryService.includes('sourceLimit * resultLimit'), 'sweep import cap should scale with batch results instead of only source count');

  const weakXPost = {
    key: 'launch-capture-weak-x-test',
    title: 'House for sale in Kampala',
    description: 'House for sale in Kampala. Inbox for viewing.',
    listingType: 'sale',
    propertyType: 'house',
    district: 'Kampala',
    area: '',
    address: '',
    importedFromSourcePost: true,
    sourcePlatform: 'x',
    sourceUrl: 'https://x.com/randomposter/status/1812345678901234567',
    sourcePublishedAt: '2026-07-01T10:00:00.000Z',
  };
  const intake = sourcePostMeetsLaunchIntakeRule(weakXPost, {});
  assert.strictEqual(intake.capture_mode, 'launch_review_first', 'weak social posts should be evaluated under review-first capture');
  assert.strictEqual(intake.eligible, true, 'weak but property-like social post should be captured to review');
  assert.strictEqual(intake.allowed_social_source, true, 'X source URL should be accepted as an allowed social source');
  assert.strictEqual(intake.weak_contact_captured_for_review, true, 'missing direct phone/email should be review metadata, not a blocker');
  assert.strictEqual(intake.weak_media_captured_for_review, true, 'missing attached media should be review metadata, not a blocker');
  assert.strictEqual(intake.weak_location_captured_for_review, true, 'district/fuzzy location should be review metadata, not a blocker');

  const foreignPost = {
    ...weakXPost,
    key: 'launch-capture-foreign-x-test',
    title: 'Land for sale in Lekki Lagos Nigeria',
    description: 'Affordable land for sale in Lekki Lagos Nigeria.',
    district: '',
    area: '',
    address: 'Lekki, Lagos, Nigeria',
    sourceUrl: 'https://x.com/randomposter/status/1812345678901234568',
  };
  const foreignIntake = sourcePostMeetsLaunchIntakeRule(foreignPost, {});
  assert.strictEqual(foreignIntake.eligible, false, 'obvious foreign property noise should still stay out');
  assert.strictEqual(foreignIntake.positive_listing_gate_hard_blocked, true, 'foreign hard blocks should remain in place');

  const noCountryPost = {
    ...weakXPost,
    key: 'launch-capture-no-country-test',
    area: '',
    district: '',
    address: '',
    sourceText: 'House for sale. Three bedrooms. Price 250 million.',
  };
  const noCountryIntake = sourcePostMeetsLaunchIntakeRule(noCountryPost, {});
  assert.strictEqual(noCountryIntake.eligible, true, 'unknown place names should remain recoverable in Uganda review');
  assert.strictEqual(noCountryIntake.positive_listing_gate_reason, 'unknown_uganda_location_review');
  assert.strictEqual(noCountryIntake.positive_listing_gate_hard_blocked, false);

  console.log('ok - launch harvest capture widens intake to review while preserving hard non-property/foreign blocks');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
