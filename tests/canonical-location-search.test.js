'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalLocationByKey,
  canonicalLocationRollupCounts,
  canonicalizeUgandaLocation,
  canonicalLocationSearchScope,
  canonicalLocationSuggestions,
} = require('../utils/ugandaLocationRegistry');

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
  const migration = read('db/migrations/105_canonical_location_search.sql');

  assert.match(app, /location_ids/);
  assert.match(app, /nearbyParam !== null && nearbyParam !== ""/);
  assert.match(app, /Choose a location from the suggestions before searching/);
  assert.match(app, /canonical-location-chip/);
  assert.match(app, /Nearby match/);
  assert.match(app, /fetchCanonicalAutoWidenedFirstPage/);
  assert.match(app, /maximum price was widened by 20%/);
  assert.match(app, /Similar properties nearby/);
  assert.match(app, /Create property alert/);
  assert.match(app, /student-accommodation\)\\\/\[a-z0-9-\]\+\$/);
  assert.match(html, /canonical-location-search-20260725/);
  assert.match(route, /router\.get\('\/locations\/suggest'/);
  assert.match(route, /invalid_location_ids/);
  assert.match(route, /location_match/);
  assert.match(migration, /canonical_location_id/);
});
