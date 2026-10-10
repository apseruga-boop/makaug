'use strict';

// 10 Oct 2026: verified Wakiso listings could not be approved because the
// towns and neighbourhoods were missing or a chosen town was rewritten to
// "Wakiso Town".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const {
  canonicalizeUgandaLocation,
  canonicalLocationByKey,
  areaTextMatchesCanonicalLocation,
  resolveCanonicalUgandaLocation
} = require('../utils/ugandaLocationRegistry');
const { getDistrictLocationTree, normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');
const { normalizeStaffListingPatch } = require('../routes/staff')._test;

const highTraffic = require('./fixtures/uganda-high-traffic-locations.json');

function saveTwice(area, city, district = 'Wakiso') {
  const first = normalizeStaffListingPatch({}, { area, city, district, neighborhood: area });
  assert.deepEqual(first.errors, [], `${area} first save: ${first.errors.join('; ')}`);
  const existing = {
    area: first.patch.area,
    district: first.patch.district,
    extra_fields: {
      region: first.hierarchy.region,
      city: first.hierarchy.city,
      neighborhood: first.hierarchy.neighborhood
    }
  };
  const second = normalizeStaffListingPatch(existing, {
    area: existing.area,
    district: existing.district,
    city: existing.extra_fields.city,
    neighborhood: existing.extra_fields.neighborhood
  });
  assert.deepEqual(second.errors, [], `${area} reload save: ${second.errors.join('; ')}`);
  assert.equal(second.hierarchy.city, first.hierarchy.city, `${area} town changed on reload`);
  assert.equal(second.hierarchy.neighborhood, first.hierarchy.neighborhood, `${area} neighbourhood changed on reload`);
  assert.equal(second.patch.district, district);
  return second;
}

test('each missing Wakiso place saves under its town and survives reload', () => {
  const places = [
    ['Nansana', 'Nansana', 'Nansana'],
    ['Makindye-Ssabagabo', 'Makindye-Ssabagabo', 'Makindye-Ssabagabo'],
    ['Kira', 'Kira', 'Kira'],
    ['Kira Municipality', 'Kira', 'Kira'],
    ['Gayaza', 'Gayaza', 'Gayaza'],
    ['Buloba', 'Buloba', 'Buloba'],
    ['Nkoowe', 'Nansana', 'Nkoowe'],
    ['Gganda', 'Nansana', 'Gganda'],
    ['Shimoni Estate', 'Kira', 'Shimoni Estate'],
    ['Kigo', 'Makindye-Ssabagabo', 'Kigo'],
    ['Najjera', 'Kira', 'Najjera'],
    ['Kyaliwajjala', 'Kira', 'Kyaliwajjala'],
    ['Mbalwa', 'Kira', 'Mbalwa'],
    ['Manyangwa', 'Gayaza', 'Manyangwa'],
    ['Masooli', 'Gayaza', 'Masooli'],
    ['Matugga', 'Gombe', 'Matugga'],
    ['Bwebajja', 'Makindye-Ssabagabo', 'Bwebajja'],
    ['Maya', 'Nsangi', 'Maya']
  ];
  for (const [area, town, neighborhood] of places) {
    const saved = saveTwice(area, town);
    assert.equal(saved.hierarchy.city, town, area);
    assert.equal(saved.hierarchy.neighborhood, neighborhood, area);
    assert.equal(saved.hierarchy.district, 'Wakiso', area);
    assert.equal(saved.hierarchy.city.includes('Wakiso Town'), false, `${area} fell back to Wakiso Town`);
    const direct = normalizeReviewLocationHierarchy({ area, district: 'Wakiso', city: town, neighborhood: area });
    assert.deepEqual(direct.errors, [], `${area} hierarchy: ${direct.errors.join('; ')}`);
    assert.equal(direct.city, town, area);
  }
});

test('Bujuuko is the saved spelling and the old spelling still resolves', () => {
  for (const spelling of ['Bujuuko', 'Bujjuko', 'Bujuko']) {
    const saved = saveTwice(spelling, 'Wakiso');
    assert.equal(saved.hierarchy.neighborhood, 'Bujuuko', spelling);
    assert.equal(saved.hierarchy.city, 'Wakiso', spelling);
    assert.equal(saved.patch.area, 'Bujuuko', spelling);
  }
  const legacy = canonicalLocationByKey('wakiso:bujjuko');
  const current = canonicalizeUgandaLocation('Bujjuko', 'Wakiso');
  assert.equal(legacy.name, 'Bujuuko');
  assert.equal(legacy.key, 'wakiso:bujuuko');
  assert.equal(legacy.key, current.key);
  assert.equal(areaTextMatchesCanonicalLocation('Bujjuko', legacy), true);
  assert.equal(areaTextMatchesCanonicalLocation('Bujuuko', legacy), true);
  assert.equal(canonicalizeUgandaLocation('Akright', 'Wakiso').name, 'Akright City');
});

test('a staff-picked town is not rewritten to Wakiso Town', () => {
  const najjera = normalizeReviewLocationHierarchy({
    area: 'Najjera', district: 'Wakiso', city: 'Kira', neighborhood: 'Najjera'
  });
  assert.deepEqual(najjera.errors, []);
  assert.equal(najjera.city, 'Kira');
  assert.notEqual(najjera.city, 'Wakiso Town');

  const gayaza = normalizeReviewLocationHierarchy({
    area: 'Gayaza', district: 'Wakiso', city: 'Gayaza'
  });
  assert.deepEqual(gayaza.errors, []);
  assert.equal(gayaza.city, 'Gayaza');

  const gganda = normalizeStaffListingPatch({}, {
    area: 'Gganda', district: 'Wakiso', city: 'Nansana', neighborhood: 'Gganda'
  });
  assert.deepEqual(gganda.errors, []);
  assert.equal(gganda.hierarchy.city, 'Nansana');

  const zana = normalizeReviewLocationHierarchy({
    area: 'Zana', district: 'Wakiso', city: 'Nansana', neighborhood: 'Zana'
  }, { preferChosenCity: true });
  assert.deepEqual(zana.errors, [], zana.errors.join('; '));
  assert.equal(zana.city, 'Nansana');
  assert.equal(zana.neighborhood, 'Zana');
  const storedZana = normalizeReviewLocationHierarchy({
    area: 'Zana', district: 'Wakiso', city: 'Wakiso Town', neighborhood: 'Zana'
  });
  assert.equal(storedZana.city, 'Wakiso', 'a stored Wakiso Town follows the catalogue');
});

test('Kisaasi can be saved under Kawempe or Nakawa, and defaults to Nakawa', () => {
  const tree = getDistrictLocationTree('Kampala');
  for (const division of ['Kawempe', 'Nakawa']) {
    const node = tree.find((item) => item.city === division);
    assert.ok(node, division);
    assert.ok(node.neighborhoods.some((item) => item.name === 'Kisaasi'), `${division} lists Kisaasi`);
    const saved = normalizeReviewLocationHierarchy({
      area: 'Kisaasi', district: 'Kampala', city: division, neighborhood: 'Kisaasi'
    });
    assert.deepEqual(saved.errors, [], saved.errors.join('; '));
    assert.equal(saved.city, division);
    assert.equal(saved.neighborhood, 'Kisaasi');
  }
  const blank = normalizeReviewLocationHierarchy({ area: 'Kisaasi', district: 'Kampala' });
  assert.equal(blank.city, 'Nakawa');
  assert.equal(canonicalizeUgandaLocation('Kisaasi', 'Kampala').town, 'Nakawa');
  const luzira = normalizeReviewLocationHierarchy({ area: 'Luzira', district: 'Kampala', city: 'Kampala' });
  assert.deepEqual(luzira.errors, []);
  assert.equal(luzira.city, 'Nakawa');
});

test('existing high-traffic locations still resolve to the same keys', () => {
  for (const row of highTraffic) {
    const result = resolveCanonicalUgandaLocation(row.query);
    assert.equal(result.status, 'matched', row.query);
    assert.equal(result.match.key, row.canonical_key, row.query);
  }
  assert.equal(canonicalizeUgandaLocation('Lubowa', 'Wakiso').town, 'Makindye-Ssabagabo');
  assert.equal(canonicalizeUgandaLocation('Gayaza').key, 'wakiso:gayaza');
});

test('the location catalog lists Kisaasi under both Kampala divisions', async () => {
  const app = express();
  app.use('/api/properties', require('../routes/properties'));
  const res = await request(app).get('/api/properties/locations/catalog?district=Kampala');
  assert.equal(res.status, 200);
  const kisaasiTowns = res.body.data.filter((item) => item.name === 'Kisaasi').map((item) => item.town).sort();
  assert.deepEqual(kisaasiTowns, ['Kawempe', 'Nakawa']);
  const luzira = res.body.data.find((item) => item.name === 'Luzira');
  assert.equal(luzira.town, 'Nakawa');
});

test('the review screen keeps a chosen town and does not wipe a loaded place', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = app.indexOf('function adminReviewCityToSave');
  const end = app.indexOf('function adminReviewTownForNeighborhood', start);
  assert.ok(start > 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${app.slice(start, end)}; this.city = adminReviewCityToSave; this.keep = adminReviewTownAfterCanonicalResolve; this.clear = adminReviewShouldClearUnmatchedLocation;`, context);
  assert.equal(context.city('Kawempe', 'Nakawa'), 'Kawempe');
  assert.equal(context.city('', 'Nakawa'), 'Nakawa');
  const tree = [
    { city: 'Kawempe', neighborhoods: [{ name: 'Kisaasi' }] },
    { city: 'Nakawa', neighborhoods: [{ name: 'Kisaasi' }] }
  ];
  assert.equal(context.keep('Kawempe', 'Nakawa', tree, 'Kisaasi'), 'Kawempe');
  assert.equal(context.keep('', 'Nakawa', tree, 'Kisaasi'), 'Nakawa');
  assert.equal(context.keep('Kampala', 'Nakawa', tree, 'Kisaasi'), 'Nakawa');
  assert.equal(context.clear({ area: 'Nkoowe', district: 'Wakiso' }), false);
  assert.equal(context.clear({ area: '', district: '', neighborhood: '' }), true);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
