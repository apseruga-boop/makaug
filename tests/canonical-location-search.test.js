'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalLocationByKey,
  canonicalDisplayLocationForRow,
  canonicalLocationRollupCounts,
  canonicalLocationOptions,
  canonicalizeLocationRows,
  canonicalizeUgandaLocation,
  canonicalLocationSearchScope,
  canonicalLocationSuggestions,
} = require('../utils/ugandaLocationRegistry');
const {
  getDistrictLocationTree,
  normalizeReviewLocationHierarchy,
  regionForDistrict
} = require('../utils/ugandaLocationHierarchy');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('common Uganda spelling aliases resolve to stable canonical nodes', () => {
  assert.equal(canonicalizeUgandaLocation('Kiira', 'Wakiso')?.name, 'Kira');
  assert.equal(canonicalizeUgandaLocation('Bukotto', 'Kampala')?.name, 'Bukoto');
  assert.equal(canonicalizeUgandaLocation('Mmengo', 'Kampala')?.name, 'Mengo');
  assert.equal(canonicalLocationByKey('wakiso:kira')?.level, 'city');
  assert.equal(canonicalizeUgandaLocation('Imaginary Estate', 'Kampala'), null);
});

test('all valid districts can resolve to a canonical district node', () => {
  assert.equal(canonicalizeUgandaLocation('', 'Abim')?.key, 'abim:abim');
  assert.equal(canonicalLocationByKey('abim:abim')?.level, 'district');
  assert.equal(canonicalLocationByKey('kabarole:kabarole')?.level, 'district');
});

test('definitive coverage additions resolve to the correct district and region', () => {
  const expected = {
    Kawempe: 'Kampala',
    Bwaise: 'Kampala',
    Kalerwe: 'Kampala',
    Mulago: 'Kampala',
    Kanyanya: 'Kampala',
    Mpererwe: 'Kampala',
    Kyebando: 'Kampala',
    Nsambya: 'Kampala',
    Namirembe: 'Kampala',
    Matugga: 'Wakiso',
    Garuga: 'Wakiso',
    Zana: 'Wakiso',
    Kyengera: 'Wakiso',
    Njeru: 'Buikwe'
  };
  Object.entries(expected).forEach(([area, district]) => {
    const canonical = canonicalizeUgandaLocation(area);
    assert.equal(canonical?.district, district, `${area} must resolve to ${district}`);
    assert.equal(regionForDistrict(canonical?.district), 'Central');
  });
  assert.equal(canonicalLocationByKey('wakiso:kyebando'), null);
  assert.equal(canonicalLocationByKey('jinja:njeru'), null);
});

test('roads, regions, water bodies and impossible district combinations stay unmatched', () => {
  ['Kampala Road', 'Hoima Rd', 'Northern Bypass', 'Central Region', 'Lake Victoria'].forEach((query) => {
    assert.equal(canonicalizeUgandaLocation(query, 'Kampala'), null, query);
    assert.deepEqual(canonicalLocationSuggestions(query), [], query);
  });
  assert.equal(canonicalizeUgandaLocation('Kyebando', 'Wakiso'), null);
  assert.equal(canonicalizeUgandaLocation('Njeru', 'Jinja'), null);
  assert.deepEqual(canonicalLocationSuggestions('Imaginary Estate'), []);
});

test('canonical row ids drive aggregation and public display instead of raw area text', () => {
  const rows = canonicalizeLocationRows([
    { area: 'Kampala', district: 'Wakiso', canonical_location_id: 'wakiso:kira', listing_count: 2 },
    { area: 'Kira Town', district: 'Wakiso', canonical_location_id: 'wakiso:kira', listing_count: 3 }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonical_key, 'wakiso:kira');
  assert.equal(rows[0].listing_count, 5);

  assert.deepEqual(
    canonicalDisplayLocationForRow({ area: 'Kampala', district: 'Wakiso', canonical_location_id: 'wakiso:kira' }),
    {
      canonical: canonicalLocationByKey('wakiso:kira'),
      area: 'Kira',
      district: 'Wakiso',
      level: 'city'
    }
  );
  assert.equal(canonicalDisplayLocationForRow({
    area: 'Wakiso',
    district: 'Wakiso',
    canonical_location_id: 'wakiso:wakiso'
  }).area, null);
});

test('moderation hierarchy rejects unknown, road and cross-district area values', () => {
  assert.ok(normalizeReviewLocationHierarchy({ area: 'Kampala Road', district: 'Kampala' }).errors.length);
  assert.ok(normalizeReviewLocationHierarchy({ area: 'Imaginary Estate', district: 'Kampala' }).errors.length);
  assert.ok(normalizeReviewLocationHierarchy({ area: 'Kyebando', district: 'Wakiso' }).errors.length);
  assert.deepEqual(normalizeReviewLocationHierarchy({ area: 'Kyebando', district: 'Kampala' }).errors, []);
});

test('30 inventory districts have real canonical neighbourhood choices and no fabricated compass areas', () => {
  const inventoryDistricts = [
    'Kampala', 'Wakiso', 'Mukono', 'Luwero', 'Jinja', 'Mbarara', 'Gulu', 'Mbale', 'Lira', 'Arua',
    'Kabarole', 'Hoima', 'Masindi', 'Masaka', 'Kabale', 'Buikwe', 'Mpigi', 'Mityana', 'Kayunga', 'Kamuli',
    'Iganga', 'Busia', 'Tororo', 'Soroti', 'Kasese', 'Bushenyi', 'Ntungamo', 'Rukungiri', 'Sheema', 'Rakai'
  ];
  inventoryDistricts.forEach((district) => {
    const tree = getDistrictLocationTree(district);
    assert.ok(tree.length, `${district} must have a canonical location tree`);
    const names = tree.flatMap((item) => (item.neighborhoods || []).map((area) => area.name));
    assert.ok(names.length, `${district} must have canonical area choices`);
    assert.ok(names.every((name) => !new RegExp(`^${district} (East|West)$`, 'i').test(name)));
  });
});

test('canonical registry exceeds the 95-location coverage gate with valid regions and zero road nodes', () => {
  const areaNodes = canonicalLocationOptions().filter((item) => !['district', 'region'].includes(item.level));
  assert.ok(areaNodes.length >= 95, `expected at least 95 canonical locations, received ${areaNodes.length}`);
  assert.ok(areaNodes.every((item) => regionForDistrict(item.district)), 'every canonical location must map to a region');
  assert.ok(areaNodes.every((item) => !/\b(?:road|rd|street|avenue|highway|bypass|expressway)\b/i.test(item.location)));
});

test('location suggestions rank exact aliases first and never exceed eight', () => {
  const counts = new Map([
    ['wakiso:kira', 120],
    ['wakiso:kira mulawa', 12],
    ['wakiso:kira nsasa', 9],
  ]);
  const suggestions = canonicalLocationSuggestions('Kiira', counts, 8);
  assert.equal(suggestions[0].canonical_key, 'wakiso:kira');
  assert.equal(suggestions[0].match, 'exact_alias');
  assert.equal(suggestions[0].listing_count, 120);
  assert.ok(suggestions.length <= 8);
});

test('city and district suggestion counts use the same descendant scope as search', () => {
  const direct = new Map([
    ['wakiso:kira', 10],
    ['wakiso:najjera', 4],
    ['wakiso:namugongo', 3],
    ['kampala:ntinda', 7],
  ]);
  const rolled = canonicalLocationRollupCounts(direct);
  assert.ok(rolled.get('wakiso:kira') > direct.get('wakiso:kira'));
  assert.ok(rolled.get('wakiso:wakiso') >= 17);
  assert.equal(rolled.get('kampala:ntinda'), 7);
});

test('multi-select location scope supports exact and nearby results without silent district rollup', () => {
  const exact = canonicalLocationSearchScope(['kampala:ntinda', 'wakiso:naalya'], 0);
  assert.equal(exact.selected.length, 2);
  assert.deepEqual(
    exact.exact.map((item) => item.key).sort(),
    ['kampala:ntinda', 'wakiso:naalya']
  );
  assert.equal(exact.nearby.length, 0);

  const widened = canonicalLocationSearchScope(['kampala:ntinda'], 3);
  assert.ok(widened.nearby.some((item) => item.key !== 'kampala:ntinda'));
  assert.ok(widened.nearby.every((item) => item.distance_km <= 3));
});

test('public category search is canonical-only and includes visible nearby and alert UX', () => {
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  const route = read('routes/properties.js');
  const adminRoute = read('routes/admin.js');
  const staffRoute = read('routes/staff.js');
  const migration = read('db/migrations/105_canonical_location_search.sql');
  const repairMigration = read('db/migrations/115_canonical_location_source_of_truth.sql');

  assert.match(app, /location_ids/);
  assert.match(app, /nearbyParam !== null && nearbyParam !== ""/);
  assert.match(app, /Choose a location from the suggestions before searching/);
  assert.match(app, /canonical-location-chip/);
  assert.match(app, /Nearby match/);
  assert.match(app, /data-location-match="nearby"/);
  assert.match(app, /socialImportListingCardHtml[\s\S]+propertyLocationMatchHtml/);
  assert.match(app, /PUBLIC_CANONICAL_LOCATION_MATCH_BY_PROPERTY_ID/);
  assert.match(app, /responseSnapshot\?\.meta\?\.location_search\?\.canonical === true/);
  assert.match(app, /key !== "students" && !publicCategoryActiveSearchPath\(key\)/);
  assert.match(app, /restoredRouteSearchPath = publicInventoryRouteSearchPath\(activeCategory\)/);
  assert.match(app, /activeCategoryPath = restoredRouteSearchPath/);
  assert.match(app, /currentRouteSearchPath && currentRouteSearchPath !== firstPagePath/);
  assert.match(app, /fetchCanonicalAutoWidenedFirstPage/);
  assert.match(app, /maximum price was widened by 20%/);
  assert.match(app, /Similar properties nearby/);
  assert.match(app, /Create property alert/);
  assert.ok(app.includes('(?:for-sale|to-rent|land|commercial|student-accommodation)(?:\\/[a-z0-9-]+)+$/i.test(pathname)'), 'nested canonical SEO routes must preserve their server title');
  assert.match(html, /canonical-location-search-20260725/);
  assert.match(route, /router\.get\('\/locations\/suggest'/);
  assert.match(route, /invalid_location_ids/);
  assert.match(route, /location_match/);
  assert.match(route, /canonicalDisplayLocationForRow/);
  assert.match(route, /location: \[publicArea, publicDistrict\]/);
  assert.match(route, /unmatched: suggestions\.length === 0/);
  assert.match(route, /COALESCE\(p\.extra_fields->>'canonical_location_id', ''\) = ANY/);
  assert.doesNotMatch(route, /OR LOWER\(TRIM\(COALESCE\(p\.area, ''\)\)\) = ANY/);
  assert.match(migration, /canonical_location_id/);
  assert.match(repairMigration, /source_area_raw/);
  assert.match(repairMigration, /CREATE TEMP TABLE location_snapshot_115/);
  assert.match(repairMigration, /district_only_needs_review/);
  assert.match(repairMigration, /unmatched_needs_review/);
  assert.match(repairMigration, /- 'canonical_location_id'/);
  assert.match(repairMigration, /status = 'pending'/);
  assert.match(repairMigration, /moderation_stage = 'source_review'/);
  assert.match(repairMigration, /location_review_required', true/);
  assert.match(repairMigration, /location_review_previous_area/);
  assert.match(repairMigration, /location_review_proposed_canonical_location_id/);
  assert.match(repairMigration, /location_auto_reclassified_source_review/);
  assert.match(repairMigration, /automatic_publish', false/);
  assert.doesNotMatch(repairMigration, /area = NULL/);
  assert.match(app, /data-location-reclassification-review="1"/);
  assert.match(app, /admin-review-location-reclassification-confirm/);
  assert.match(app, /location_reclassification_confirmed: locationReclassificationConfirmed/);
  assert.match(app, /Compare and confirm the reclassified canonical location before approving/);
  assert.match(route, /Human confirmation of the reclassified location is required before approval/);
  assert.match(route, /Choose and save a specific canonical area before approval/);
  assert.match(route, /location_review_confirmation: 'individual_king_moderation_approval'/);
  assert.match(route, /location_review_required: false/);
  assert.match(staffRoute, /location_reclassification_requires_individual_review/);
  assert.match(adminRoute, /individual canonical location reclassification review/);
  assert.match(repairMigration, /wakiso:kyebando/);
  assert.match(repairMigration, /buikwe:njeru/);
  assert.match(app, /findLpCanonicalAreaOption/);
  assert.match(app, /area: \[canonicalDisplay\.area, canonicalDisplay\.district\]/);
  assert.match(app, /getDistrictLocationTree\(district\)\.forEach/);
  assert.doesNotMatch(app, /LOCATION_HINTS/);
  assert.doesNotMatch(app, /Namasuba Entebbe Road/);
  assert.doesNotMatch(app, /Kakiri Masulita Hoima Road/);
  assert.doesNotMatch(app, /const UGANDA_REGIONS/);
  assert.doesNotMatch(app, /name: "Kampala Road"/);
});
