'use strict';

// 20 Nov 2026: Find on "Kamuvobe, Mityana, Central" in listing review set a
// pin but could not auto-fill region/district/area, so approval was blocked.
// The village was missing from the gazetteer. The census also writes some
// nearby names with a doubled letter, so the everyday spelling failed the
// same way.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canonicalizeUgandaLocation,
  resolveCanonicalUgandaLocation
} = require('../utils/ugandaLocationRegistry');
const { isOnUgandaLand } = require('../utils/ugandaLand');
const {
  getDistrictLocationTree,
  normalizeReviewLocationHierarchy
} = require('../utils/ugandaLocationHierarchy');

function almostEqual(actual, expected, delta = 0.0005) {
  assert.ok(Math.abs(Number(actual) - expected) < delta, `${actual} !~ ${expected}`);
}

function assertKamuvobe(place, query) {
  assert.ok(place, `${query} should resolve to Kamuvobe`);
  assert.equal(place.name, 'Kamuvobe', query);
  assert.equal(place.district, 'Mityana', query);
  assert.equal(place.town, 'Busimbi', query);
  assert.equal(place.level, 'neighborhood', query);
  assert.equal(place.key, 'mityana:kamuvobe', query);
  almostEqual(place.lat, 0.42815);
  almostEqual(place.lng, 32.11308);
  assert.equal(isOnUgandaLand(place.lat, place.lng), true);
}

test('Kamuvobe is a Mityana neighbourhood with the GeoNames pin', () => {
  const place = canonicalizeUgandaLocation('Kamuvobe', 'Mityana');
  assertKamuvobe(place, 'Kamuvobe');
  assertKamuvobe(canonicalizeUgandaLocation('Kamuvoobe', 'Mityana'), 'Kamuvoobe');

  const hierarchy = normalizeReviewLocationHierarchy({
    area: 'Kamuvobe, Mityana, Central',
    district: 'Mityana'
  });
  assert.deepEqual(hierarchy.errors, []);
  assert.equal(hierarchy.neighborhood, 'Kamuvobe');
  assert.equal(hierarchy.city, 'Busimbi');
  assert.equal(hierarchy.district, 'Mityana');
  assert.equal(hierarchy.region, 'Central');
  assert.equal(hierarchy.canonical.key, 'mityana:kamuvobe');

  const busimbi = getDistrictLocationTree('Mityana').find((node) => node.city === 'Busimbi');
  assert.ok((busimbi?.neighborhoods || []).some((item) => item.name === 'Kamuvobe'));
});

test('Find on Place, District, Region fills Kamuvobe, not just Mityana district', () => {
  const queries = [
    'Kamuvobe',
    'Kamuvobe, Mityana, Central',
    'Kamuvobe, Mityana, Central Region',
    'Kamuvobe, Mityana District, Central Region, Uganda',
    'Kamuvoobe, Mityana, Central'
  ];
  for (const query of queries) {
    const resolution = resolveCanonicalUgandaLocation(query);
    assert.equal(resolution.status, 'matched', query);
    assert.equal(resolution.match_type, 'exact_alias', query);
    assert.equal(resolution.confidence, 1, query);
    assertKamuvobe(resolution.match, query);
    assert.notEqual(resolution.match.level, 'district', query);
  }
});

test('an unknown village in Place, District, Region is not resolved as the district', () => {
  const resolution = resolveCanonicalUgandaLocation('Unknownville, Mityana, Central');
  assert.equal(resolution.status, 'unmatched');
  assert.equal(resolution.match, null);
});

test('a district written as District, Region still resolves to that district', () => {
  const resolution = resolveCanonicalUgandaLocation('Mityana, Central Region');
  assert.equal(resolution.status, 'matched');
  assert.equal(resolution.match.name, 'Mityana');
  assert.equal(resolution.match.level, 'district');
  assert.equal(resolution.match.district, 'Mityana');
});

test('known places in the Place, District, Region form are unchanged', () => {
  const ntinda = resolveCanonicalUgandaLocation('Ntinda, Kampala, Central Region');
  assert.equal(ntinda.status, 'matched');
  assert.equal(ntinda.match.name, 'Ntinda');
  assert.equal(ntinda.match.district, 'Kampala');

  const sentema = resolveCanonicalUgandaLocation('Sentema Road, Wakiso, Central Region, Uganda');
  assert.equal(sentema.status, 'matched');
  assert.equal(sentema.match.name, 'Sentema');
  assert.equal(sentema.match.district, 'Wakiso');

  const busunju = resolveCanonicalUgandaLocation('Busunju, Mityana, Central');
  assert.equal(busunju.status, 'matched');
  assert.equal(busunju.match.name, 'Busunju');
  assert.equal(busunju.match.district, 'Mityana');
});

test('everyday Mityana spellings resolve to the census names', () => {
  const kalangalo = resolveCanonicalUgandaLocation('Kalangalo, Mityana, Central');
  assert.equal(kalangalo.status, 'matched');
  assert.equal(kalangalo.match.name, 'Kalangaalo');
  assert.equal(kalangalo.match.district, 'Mityana');
  assert.equal(kalangalo.match.key, 'mityana:kalangaalo');

  const tamu = resolveCanonicalUgandaLocation('Tamu, Mityana');
  assert.equal(tamu.status, 'matched');
  assert.equal(tamu.match.name, 'Ttamu');
  assert.equal(tamu.match.district, 'Mityana');
  assert.equal(tamu.match.key, 'mityana:ttamu');
  almostEqual(tamu.match.lat, 0.43);
  almostEqual(tamu.match.lng, 32.09);

  const sekanyonyi = resolveCanonicalUgandaLocation('Sekanyonyi, Mityana, Central');
  assert.equal(sekanyonyi.status, 'matched');
  assert.equal(sekanyonyi.match.name, 'Ssekanyonyi');
  assert.equal(sekanyonyi.match.district, 'Mityana');
  assert.equal(sekanyonyi.match.key, 'mityana:ssekanyonyi');

  const bandaMityana = resolveCanonicalUgandaLocation('Banda, Mityana');
  assert.equal(bandaMityana.status, 'matched');
  assert.equal(bandaMityana.match.name, 'Bbanda');
  assert.equal(bandaMityana.match.district, 'Mityana');
  assert.equal(bandaMityana.match.key, 'mityana:bbanda');

  // Bare "Banda" is still the Kampala suburb people usually mean.
  const banda = resolveCanonicalUgandaLocation('Banda');
  assert.equal(banda.status, 'matched');
  assert.equal(banda.match.name, 'Banda');
  assert.equal(banda.match.district, 'Kampala');
});
