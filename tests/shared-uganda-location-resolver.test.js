'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalLocationSuggestions,
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText,
} = require('../utils/ugandaLocationRegistry');
const {
  normalizeFoundOnlineSourcePost,
} = require('../services/socialSearchSourcedListingsService');
const { regionForDistrict } = require('../utils/ugandaLocationHierarchy');
const worklist = require('./fixtures/uganda-location-coverage-worklist.json');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('wrong-region regression names resolve only as unique confidence-one aliases', () => {
  const expected = {
    Banda: ['Kampala', 'Central'],
    Bala: ['Kole', 'Northern'],
    Aber: ['Oyam', 'Northern'],
    Kapir: ['Ngora', 'Eastern'],
    Bunya: ['Mayuge', 'Eastern'],
    Sanga: ['Kiruhura', 'Western'],
    Kuru: ['Yumbe', 'Northern'],
    Ngoma: ['Nakaseke', 'Central'],
    Bugongi: ['Sheema', 'Western'],
    'Senior Quarters': ['Gulu', 'Northern'],
    Sentema: ['Wakiso', 'Central'],
    Namasuba: ['Wakiso', 'Central']
  };
  Object.entries(expected).forEach(([query, [district, region]]) => {
    const result = resolveCanonicalUgandaLocation(query);
    assert.equal(result.status, 'matched', query);
    assert.equal(result.match_type, 'exact_alias', query);
    assert.equal(result.confidence, 1, query);
    assert.equal(result.match?.district, district, query);
    assert.equal(regionForDistrict(result.match?.district), region, query);
  });
});

test('junk and non-exact spelling never auto-resolve', () => {
  assert.equal(resolveCanonicalUgandaLocation('Zzxq').status, 'unmatched');
  assert.equal(resolveCanonicalUgandaLocation('Namassuba').status, 'unmatched');
  const didYouMean = canonicalLocationSuggestions('Namassuba', new Map(), 8);
  assert.equal(didYouMean[0]?.location, 'Namasuba');
  assert.equal(didYouMean[0]?.match, 'fuzzy');
  assert.equal(didYouMean[0]?.auto_resolvable, false);
  assert.ok(canonicalLocationSuggestions('Band', new Map(), 8).every((item) => item.auto_resolvable === false));
});

test('harvest captions use the same exact-alias resolver without district guessing', () => {
  const sentema = resolveCanonicalUgandaLocationFromText('House for sale in Sentema, Wakiso at UGX 90M.');
  assert.equal(sentema.status, 'matched');
  assert.equal(sentema.match_type, 'exact_alias_in_text');
  assert.equal(sentema.confidence, 1);
  assert.equal(sentema.match.name, 'Sentema');
  assert.equal(sentema.match.district, 'Wakiso');

  const unknown = resolveCanonicalUgandaLocationFromText('House for sale in Zzxq at UGX 90M.');
  assert.equal(unknown.status, 'unmatched');
  assert.equal(unknown.match, null);

  const normalized = normalizeFoundOnlineSourcePost({
    source_url: 'https://www.tiktok.com/@example/video/7670000000000000000',
    source_platform: 'tiktok',
    title: 'House for sale in Banda',
    caption: 'House for sale in Banda, Kampala at UGX 250M.',
    price: 250000000,
    listing_type: 'sale',
  });
  assert.equal(normalized.area, 'Banda');
  assert.equal(normalized.district, 'Kampala');
  assert.equal(normalized.locationResolutionConfidence, 1);
});

test('the full supplied missing-worklist has registry coverage without unsafe ambiguity acceptance', () => {
  assert.equal(worklist.locations.length, worklist.meta.parsed_names);
  const totals = { matched: 0, ambiguous: 0, unmatched: 0 };
  worklist.locations.forEach((query) => {
    const result = resolveCanonicalUgandaLocation(query);
    totals[result.status] += 1;
    if (result.status === 'matched') {
      assert.equal(result.confidence, 1, query);
      assert.equal(result.match_type, 'exact_alias', query);
      assert.ok(regionForDistrict(result.match?.district), query);
    }
    if (result.status === 'ambiguous') {
      assert.equal(result.match, null, query);
      assert.equal(result.confidence, 0, query);
      assert.ok(result.candidates.length > 1, query);
    }
  });
  assert.equal(totals.unmatched, 0);
  assert.ok(totals.matched >= 600, JSON.stringify(totals));
});

test('public and King forms use the same resolver and clear stale hierarchy on unmatched pins', () => {
  const app = read('assets/makaug-app.js');
  const route = read('routes/properties.js');
  assert.match(app, /async function resolveUgandaLocationFromSharedRegistry/);
  assert.match(app, /async function adminReviewFindAddressOrPlace[\s\S]+resolveUgandaLocationWithLabelFallback/);
  assert.match(app, /async function applyLpAddressPlaceResult[\s\S]+resolveLpCanonicalLocation/);
  assert.match(app, /Location not recognised — pin set but region\/district\/area could NOT be auto-filled\./);
  assert.match(app, /function clearAdminReviewCanonicalLocation[\s\S]+admin-review-region-edit[\s\S]+admin-review-area-edit/);
  assert.match(app, /function clearLpCanonicalLocationCascade[\s\S]+populateLpRegionOptions\(""\)[\s\S]+lp-area/);
  assert.match(app, /Resolve the area through the shared canonical location registry before approving/);
  assert.match(route, /router\.get\('\/locations\/resolve'/);
  assert.match(route, /Canonical location confirmation is required before approval/);
  assert.match(route, /disambiguation_required/);
  assert.match(route, /did_you_mean_suggestions/);
});

test('browser code has no copied locality registry', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /const UG_LOCATION_TREE = \{\};/);
  assert.match(app, /const UG_MAJOR_DISTRICT_LOCATIONS = \{\};/);
  assert.doesNotMatch(app, /const UG_LOCATION_TREE = \{\s*Kampala:/);
  assert.match(app, /\/api\/properties\/locations\/catalog\?district=/);
});

test('harvest services do not carry private locality or district-regex registries', () => {
  const discovery = read('services/socialPlatformPostDiscoveryService.js');
  const intake = read('services/socialSearchSourcedListingsService.js');
  assert.doesNotMatch(discovery, /const AREA_HINTS =/);
  assert.doesNotMatch(discovery, /AREA_PIN_OVERRIDES/);
  assert.doesNotMatch(discovery, /if \(\/kira\|naalya\|najjera/);
  assert.doesNotMatch(intake, /SOCIAL_AREA_PIN_OVERRIDES/);
  assert.match(discovery, /resolveCanonicalUgandaLocationFromText/);
  assert.match(intake, /resolveCanonicalUgandaLocationFromText/);
});

test('Ask AI canonicalizes locations through the shared resolver and blocks unknown names', () => {
  const ai = read('routes/ai.js');
  assert.match(ai, /function resolveAssistantParsedLocation/);
  assert.match(ai, /resolveCanonicalUgandaLocation\(rawArea, rawDistrict\)/);
  assert.match(ai, /resolveCanonicalUgandaLocationFromText\(userMessage\)/);
  assert.match(ai, /needs_location_confirmation: locationConfirmationRequired/);
  assert.match(ai, /did_you_mean_suggestions/);
});

test('release exposes the shared resolver audit marker', () => {
  const server = read('server.js');
  assert.match(server, /'shared-uganda-location-resolver-coverage'/);
});
