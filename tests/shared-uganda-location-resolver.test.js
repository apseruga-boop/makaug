'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalLocationOptions,
  canonicalLocationSuggestions,
  normalizeLocationKey,
  normalizeLocationQueryCandidates,
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
    Namasuba: ['Wakiso', 'Central'],
    Akright: ['Wakiso', 'Central'],
    Buwate: ['Wakiso', 'Central'],
    Lweeza: ['Wakiso', 'Central'],
    Mbalwa: ['Wakiso', 'Central'],
    Nakwero: ['Wakiso', 'Central'],
    Mayangayanga: ['Mukono', 'Central'],
    Nsaggu: ['Wakiso', 'Central'],
    MUBS: ['Kampala', 'Central']
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

test('genuinely comparable duplicate place names require an exact parent hint', () => {
  ['Gobero', 'Nakasajja', 'Busika', 'Lugogo', 'Labongo'].forEach((query) => {
    const result = resolveCanonicalUgandaLocation(query);
    assert.equal(result.status, 'ambiguous', query);
    assert.equal(result.confidence, 0, query);
  });
  assert.equal(resolveCanonicalUgandaLocation('Gobero', 'Wakiso').match.district, 'Wakiso');
  assert.equal(resolveCanonicalUgandaLocation('Nakasajja', 'Mukono').match.district, 'Mukono');
  assert.equal(resolveCanonicalUgandaLocation('Busika', 'Luwero').match.district, 'Luwero');
  assert.equal(resolveCanonicalUgandaLocation('Lugogo', 'Kampala').match.district, 'Kampala');
});

test('administratively prominent duplicate names auto-resolve while retaining every alternative', () => {
  const expected = {
    Mateete: ['sembabule:mateete', ['Kyenjojo', 'Sembabule']],
    Migyera: ['nakasongola:migyera', ['Isingiro', 'Nakasongola']],
    Bukuuku: ['kabarole:bukuuku', ['Kabarole', 'Nakaseke']],
    Kyeeya: ['kyenjojo:kyeeya', ['Kamuli', 'Kyenjojo']]
  };
  Object.entries(expected).forEach(([query, [canonicalKey, districts]]) => {
    const result = resolveCanonicalUgandaLocation(query);
    assert.equal(result.status, 'matched', query);
    assert.equal(result.match?.key, canonicalKey, query);
    assert.equal(result.confidence, 1, query);
    assert.deepEqual([...new Set(result.candidates.map((item) => item.district))].sort(), districts, query);
  });
  const comparable = resolveCanonicalUgandaLocation('Labongo');
  assert.equal(comparable.status, 'ambiguous');
  assert.deepEqual([...new Set(comparable.candidates.map((item) => item.district))].sort(), ['Kitgum', 'Masindi', 'Pader']);
});

test('country wrappers, punctuation and safe road noise normalize before exact matching', () => {
  const variants = [
    'Sentema, Uganda',
    'uganda, Sentema',
    'Sentema, UG',
    'Sentema, East Africa',
    'Sentema, South Africa',
    'Sentema, ZA',
    '  Sentema,   Uganda.  ',
    'Sentema Road, Wakiso, Central Region, Uganda'
  ];
  variants.forEach((query) => {
    const result = resolveCanonicalUgandaLocation(query);
    assert.equal(result.status, 'matched', query);
    assert.equal(result.match?.key, 'wakiso:sentema', query);
  });
  assert.deepEqual(normalizeLocationQueryCandidates('Sentema Road, Wakiso, Uganda').slice(0, 4), [
    'Sentema Road, Wakiso, Uganda',
    'Sentema Road, Wakiso',
    'Sentema Road',
    'Sentema'
  ]);
  assert.equal(resolveCanonicalUgandaLocation('Kampala Road').status, 'unmatched');
  assert.equal(resolveCanonicalUgandaLocation('Hoima Rd').status, 'unmatched');
  assert.equal(resolveCanonicalUgandaLocation('Zzxq, Uganda').status, 'unmatched');
});

test('major Kampala and Wakiso localities beat obscure lower-level namesakes with alternatives retained', () => {
  const expected = {
    Nakasero: 'kampala:nakasero',
    Muyenga: 'kampala:muyenga',
    Kitende: 'wakiso:kitende',
    Gayaza: 'wakiso:gayaza',
    Ndeeba: 'kampala:ndeeba',
    Mengo: 'kampala:mengo',
    Nsambya: 'kampala:nsambya',
    Wandegeya: 'kampala:wandegeya'
  };
  Object.entries(expected).forEach(([query, canonicalKey]) => {
    for (const value of [query, `${query}, Uganda`]) {
      const result = resolveCanonicalUgandaLocation(value);
      assert.equal(result.status, 'matched', value);
      assert.equal(result.match?.key, canonicalKey, value);
      assert.ok(result.candidates.length > 1, `${value} must retain alternatives`);
    }
    const suggestions = canonicalLocationSuggestions(query, new Map(), 8);
    assert.equal(suggestions[0]?.canonical_key, canonicalKey, query);
    assert.equal(suggestions[0]?.auto_resolvable, true, query);
    assert.ok(suggestions.some((item) => item.match === 'alternative_exact_alias' && item.did_you_mean), query);
  });
});

test('1,000 unique Uganda localities resolve identically bare and country-suffixed with zero wrong districts', () => {
  const allOptions = canonicalLocationOptions();
  const options = allOptions.filter((item) => !['district', 'region'].includes(item.level));
  const aliasCounts = new Map();
  allOptions.forEach((item) => item.aliases.forEach((alias) => {
    const key = normalizeLocationKey(alias);
    aliasCounts.set(key, (aliasCounts.get(key) || 0) + 1);
  }));
  const seen = new Set();
  const corpus = options.filter((item) => {
    const key = normalizeLocationKey(item.location);
    if (seen.has(key) || aliasCounts.get(key) !== 1) return false;
    seen.add(key);
    return true;
  }).slice(0, 1000);
  assert.equal(corpus.length, 1000);
  corpus.forEach((item) => {
    const bare = resolveCanonicalUgandaLocation(item.location);
    const suffixed = resolveCanonicalUgandaLocation(`${item.location}, Uganda`);
    assert.equal(bare.status, 'matched', item.location);
    assert.equal(suffixed.status, 'matched', `${item.location}, Uganda`);
    assert.equal(bare.match?.key, item.canonical_key, item.location);
    assert.equal(suffixed.match?.key, item.canonical_key, `${item.location}, Uganda`);
  });
});

test('Bushenyi-Ishaka municipality spellings resolve to Bushenyi in Western region', () => {
  ['Bushenyi-Ishaka', 'Bushenyi Ishaka', 'Bushenyi-Ishaka Municipality'].forEach((query) => {
    const result = resolveCanonicalUgandaLocation(query);
    assert.equal(result.status, 'matched', query);
    assert.equal(result.match?.district, 'Bushenyi', query);
    assert.equal(result.match?.level, 'city', query);
    assert.equal(regionForDistrict(result.match?.district), 'Western', query);
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

test('suggestions retain the canonical town needed to populate the full form cascade', () => {
  const expected = {
    Sentema: ['Wakiso', 'Wakiso'],
    Namasuba: ['Wakiso', 'Makindye-Ssabagabo'],
    MUBS: ['Kampala', 'Kampala']
  };
  Object.entries(expected).forEach(([query, [district, town]]) => {
    const exact = canonicalLocationSuggestions(query, new Map(), 8)
      .find((item) => item.match === 'exact_alias' && item.auto_resolvable === true);
    assert.equal(exact?.district, district, query);
    assert.equal(exact?.town, town, query);
  });
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
    const suffixed = resolveCanonicalUgandaLocation(`${query}, Uganda`);
    totals[result.status] += 1;
    assert.equal(suffixed.status, result.status, query);
    assert.equal(suffixed.match?.key, result.match?.key, query);
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
  const page = read('index.html');
  const route = read('routes/properties.js');
  assert.match(app, /async function resolveUgandaLocationFromSharedRegistry/);
  assert.match(app, /async function adminReviewFindAddressOrPlace[\s\S]+resolveUgandaLocationWithLabelFallback/);
  assert.match(app, /async function applyLpAddressPlaceResult[\s\S]+resolveLpCanonicalLocation/);
  assert.match(app, /function extractCanonicalLocationQueryFromGoogleResult[\s\S]+sublocality_level_1[\s\S]+administrative_area_level_2/);
  assert.match(app, /canonicalQuery: extractCanonicalLocationQueryFromGoogleResult/);
  assert.match(app, /resolveUgandaLocationWithLabelFallback\(query, point\.canonicalQuery \|\| ""\)/);
  assert.doesNotMatch(app, /resolveUgandaLocationWithLabelFallback\(query, point\.label \|\| ""\)/);
  assert.match(app, /Location not recognised — pin set but region\/district\/area could NOT be auto-filled\./);
  assert.match(app, /function clearAdminReviewCanonicalLocation[\s\S]+admin-review-region-edit[\s\S]+admin-review-area-edit/);
  assert.match(app, /function clearLpCanonicalLocationCascade[\s\S]+populateLpRegionOptions\(""\)[\s\S]+lp-area/);
  assert.match(app, /function updateLpCanonicalLocationGuardState[\s\S]+lp-location-unresolved-notice[\s\S]+lp-submit-btn[\s\S]+aria-disabled/);
  assert.match(app, /function applyLpCanonicalLocation[\s\S]+updateLpCanonicalLocationGuardState\(\)/);
  assert.match(app, /async function submitListProperty[\s\S]+finally[\s\S]+updateLpCanonicalLocationGuardState\(\)/);
  assert.match(page, /id="lp-location-unresolved-notice" role="alert" aria-live="polite" class="hidden/);
  assert.match(page, /id="lp-submit-btn"[^>]+disabled[^>]+aria-disabled="true"[^>]+aria-describedby="lp-location-unresolved-notice"/);
  assert.match(app, /function canonicalTownForLocation/);
  assert.match(app, /return \/\\b\(\?:town\|city\|municipality\|tc\)\\b\/i\.test\(name\) \? name : `\$\{name\} Town`/);
  assert.match(app, /data-approval-blocker-host/);
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
  assert.match(server, /'location-query-normalization-prominence-20260811'/);
});
