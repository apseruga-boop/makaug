'use strict';

/**
 * P7 (10 Oct 2026): on listing aa89974b-1a27-4a9a-9739-c87e8d8e4ba7 (Luzira)
 * the staff Town dropdown only offered "Kampala", so Nakawa division couldn't
 * be chosen. Kampala's five divisions are now the towns under Kampala district,
 * with areas mapped to their division, and the review screen loads the
 * district's towns before drawing the dropdown.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { getDistrictLocationTree, normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');
const { KAMPALA_DIVISIONS, kampalaDivisionForArea } = require('../utils/kampalaDivisions');

test('Luzira resolves to Nakawa, Kampala', () => {
  const luzira = canonicalizeUgandaLocation('Luzira', 'Kampala');
  assert.equal(luzira.name, 'Luzira');
  assert.equal(luzira.town, 'Nakawa');
  assert.equal(luzira.district, 'Kampala');
});

test('the five divisions are towns under Kampala district', () => {
  const towns = getDistrictLocationTree('Kampala').map((node) => node.city);
  for (const division of KAMPALA_DIVISIONS) assert.ok(towns.includes(division), `${division} missing from ${towns.join(', ')}`);
  for (const old of ['Kampala Town', 'Kampala Central', 'Nakawa Division', 'Rubaga Division']) assert.ok(!towns.includes(old), `${old} should be folded into a division`);
  assert.deepEqual(KAMPALA_DIVISIONS, ['Central', 'Kawempe', 'Makindye', 'Nakawa', 'Rubaga']);
});

test('well-known areas sit in their division', () => {
  const expected = {
    Luzira: 'Nakawa', Bugolobi: 'Nakawa', Ntinda: 'Nakawa', Naguru: 'Nakawa', Kyanja: 'Nakawa',
    Kololo: 'Central', Nakasero: 'Central', 'Old Kampala': 'Central',
    Muyenga: 'Makindye', Kansanga: 'Makindye', Ggaba: 'Makindye', Nsambya: 'Makindye',
    Mengo: 'Rubaga', Nateete: 'Rubaga', Kasubi: 'Rubaga',
    Wandegeya: 'Kawempe', Bwaise: 'Kawempe', Mulago: 'Kawempe'
  };
  const tree = getDistrictLocationTree('Kampala');
  for (const [area, division] of Object.entries(expected)) {
    assert.equal(canonicalizeUgandaLocation(area, 'Kampala')?.town, division, area);
    assert.ok(tree.find((node) => node.city === division).neighborhoods.some((item) => item.name === area), `${area} listed under ${division}`);
  }
  assert.equal(kampalaDivisionForArea('Kololo Iii'), 'Central', 'gazetteer parish numbering');
});

test('a Luzira listing saved with town "Kampala" re-saves as Nakawa without errors', () => {
  const result = normalizeReviewLocationHierarchy({ area: 'Luzira', district: 'Kampala', city: 'Kampala' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.city, 'Nakawa');
  assert.equal(result.neighborhood, 'Luzira');
  assert.equal(result.region, 'Central');
  const nakawa = normalizeReviewLocationHierarchy({ area: 'Luzira', district: 'Kampala', city: 'Nakawa', neighborhood: 'Luzira' });
  assert.deepEqual(nakawa.errors, []);
});

test('other districts are unchanged', () => {
  assert.equal(canonicalizeUgandaLocation('Naalya', 'Wakiso')?.town, 'Kira');
  assert.equal(canonicalizeUgandaLocation('Lubowa', 'Wakiso')?.town, 'Makindye-Ssabagabo');
});

test('the location catalog API gives Luzira town Nakawa', async () => {
  const app = express();
  app.use('/api/properties', require('../routes/properties'));
  const res = await request(app).get('/api/properties/locations/catalog?district=Kampala');
  assert.equal(res.status, 200);
  const luzira = res.body.data.find((item) => item.name === 'Luzira');
  assert.ok(luzira, 'Luzira in the catalog');
  assert.equal(luzira.town, 'Nakawa');
  const towns = new Set(res.body.data.map((item) => item.town));
  for (const division of KAMPALA_DIVISIONS) assert.ok(towns.has(division), division);
});

test('the review Town dropdown loads the district first and picks the division', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = app.indexOf('function adminReviewTownForNeighborhood');
  const end = app.indexOf('function adminReviewRefreshHierarchyControls', start);
  assert.ok(start > 0 && end > start);
  const tree = [
    { city: 'Kampala', neighborhoods: [{ name: 'Gangu' }] },
    { city: 'Nakawa', neighborhoods: [{ name: 'Luzira' }, { name: 'Ntinda' }] }
  ];
  const context = { getDistrictLocationTree: () => tree };
  vm.createContext(context);
  vm.runInContext(`${app.slice(start, end)}; this.fn = adminReviewTownForNeighborhood;`, context);
  assert.equal(context.fn('Kampala', 'Kampala', 'Luzira'), 'Nakawa');
  assert.equal(context.fn('Kampala', 'Nakawa', 'Luzira'), 'Nakawa');
  assert.equal(context.fn('Kampala', 'Kampala', 'Gangu'), 'Kampala');
  assert.equal(context.fn('Kampala', 'Kampala', ''), 'Kampala');
  const refresh = app.slice(end, app.indexOf('function adminReviewOnRegionChange', end));
  assert.match(refresh, /loadSharedLocationCatalogForDistrict\(district\)/);
  assert.match(refresh, /catalogLoaded: true/);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
