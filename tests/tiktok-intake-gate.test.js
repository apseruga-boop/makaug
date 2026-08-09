'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const frontend = read('assets/makaug-app.js');
const adminRoute = read('routes/admin.js');
const staffRoute = read('routes/staff.js');
const { buildExactSocialPostImportRows } = require('../services/socialPlatformPostDiscoveryService');
const {
  normalizeFoundOnlineSourcePost,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');

const bujukoUrl = 'https://www.tiktok.com/@wamalapropertyservices/video/7487217163334454533';
const bujukoRows = buildExactSocialPostImportRows({
  rawText: [
    bujukoUrl,
    'title: House for sale in Bujuko, Wakiso',
    'caption: Specific house for sale in Bujuko at USh 85M. Call +256774120320.',
    'location: Bujuko, Wakiso',
    'price: USh 85M',
    'posted: 2025-03-29',
    'phone: +256774120320',
  ].join('\n'),
  metadataByUrl: {
    [bujukoUrl]: {
      oembed: {
        title: 'House for sale in Bujuko at USh 85M. Call +256774120320.',
        author_name: 'Wamala Property Services',
        author_url: 'https://www.tiktok.com/@wamalapropertyservices',
        thumbnail_url: 'https://p16-sign.tiktokcdn-us.com/wamala-example.jpeg',
      },
    },
  },
});
const bujuko = normalizeFoundOnlineSourcePost(bujukoRows[0]);
const intake = sourcePostMeetsLaunchIntakeRule(bujuko, bujuko.sourceAgent);
assert.strictEqual(bujuko.area, 'Bujjuko');
assert.strictEqual(bujuko.district, 'Wakiso');
assert.strictEqual(bujuko.sourceAgent.phone, '+256774120320');
assert.strictEqual(intake.date_status, 'before_2026_source_window');
assert.strictEqual(intake.manual_exact_social_intake, true);
assert.strictEqual(intake.older_exact_source_requires_availability_review, true);
assert.strictEqual(intake.original_poster_comment_required, false);
assert.deepStrictEqual(intake.blocking_reasons, []);
assert.strictEqual(intake.eligible, true);

const kitendeRows = buildExactSocialPostImportRows({
  rawText: [
    'https://www.tiktok.com/@kitendehomes/video/7487217163334454999',
    'title: 3 bedroom house for rent in Kitende',
    'location: Kitende, Entebbe Road, Wakiso',
    'price: USh 1.2M/month',
    'posted: 2026-07-18',
  ].join('\n'),
});
const kitende = normalizeFoundOnlineSourcePost(kitendeRows[0]);
assert.strictEqual(kitendeRows[0].area, 'Kitende');
assert.strictEqual(kitendeRows[0].district, 'Wakiso');
assert.strictEqual(kitende.area, 'Kitende');
assert.strictEqual(kitende.district, 'Wakiso');
assert.strictEqual(kitende.lat, 0.198);
assert.strictEqual(kitende.lng, 32.533);

const noLocationRows = buildExactSocialPostImportRows({
  rawText: [
    'https://www.tiktok.com/@unknownhomes/video/7487217163334454000',
    'title: 3 bedroom house for sale',
    'price: USh 200M',
    'posted: 2026-07-18',
  ].join('\n'),
});
const noLocation = normalizeFoundOnlineSourcePost(noLocationRows[0]);
const noLocationIntake = sourcePostMeetsLaunchIntakeRule(noLocation, noLocation.sourceAgent);
assert.strictEqual(noLocation.locationEvidenceConfirmed, false);
assert.strictEqual(noLocationIntake.eligible, true);
assert.deepStrictEqual(noLocationIntake.blocking_reasons, []);

assert(frontend.includes('cache: "no-store"'));
assert(frontend.includes('preview_request_id'));
assert(frontend.includes('adminSocialQuickPasteRequestSerial'));
assert(frontend.includes('tiktok-intake-gate-20260719'));
assert(frontend.includes('__makaugTikTokIntakeGateMarker'));
assert(frontend.includes('Original-poster comments are optional supporting evidence'));
assert(adminRoute.includes("res.set('Cache-Control', 'no-store')"));
assert(staffRoute.includes("res.set('Cache-Control', 'no-store')"));

console.log('ok - TikTok manual intake gate keeps complete and unknown-location exact posts in human review');
