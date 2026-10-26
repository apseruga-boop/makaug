'use strict';

/**
 * 26 Oct 2026: "Find on map" for Kira Junior School set the pin but said
 * "Location not recognised — region/district/area could NOT be auto-filled".
 * OSM answers: school, suburb Jjanda, city Kira, state Wakiso. The page asked
 * the catalogue for "Kira Junior School" and "Jjanda" only — neither is a
 * catalogue place — and never used Kira, Wakiso or the pin.
 *
 * Fixtures are real Nominatim answers fetched on 26 Oct 2026, so this test
 * calls no geocoder.
 */

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const db = require('../config/database');
// Listing counts only rank suggestions; the catalogue answer does not need them.
db.query = async () => ({ rows: [] });

const registry = require('../utils/ugandaLocationRegistry');
const { UGANDA_AREA_CENTROIDS } = require('../utils/ugandaAreaCentroids');
const app = express();
app.use('/api/properties', require('../routes/properties'));

const FIXTURE = require('./fixtures/nominatim-kwm-places.json').results;
const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const byQuery = (q) => FIXTURE.find((row) => row.q === q);

// Same split as lpNominatimAddressParts in assets/makaug-app.js.
function addressParts(address = {}) {
  const pick = (keys) => [...new Set(keys.map((key) => String(address[key] || '').trim()).filter(Boolean))];
  return {
    specific: pick(['neighbourhood', 'quarter', 'suburb', 'village', 'hamlet', 'residential', 'city_district']),
    broad: pick(['town', 'city', 'municipality', 'county', 'state_district', 'state'])
  };
}

async function resolveText(q) {
  return (await request(app).get('/api/properties/locations/resolve').query({ q })).body;
}

async function resolveAddress(row) {
  const parts = addressParts(row.address);
  return (await request(app).get('/api/properties/locations/resolve-address').query({
    specific: parts.specific.join('|'),
    broad: parts.broad.join('|'),
    lat: row.lat,
    lng: row.lon
  })).body;
}

test('Kira Junior School: the old lookups miss, the address parts and pin fill the cascade', async () => {
  const row = byQuery('Kira Junior School');
  assert.equal((await resolveText('Kira Junior School')).data, null, 'the school is not a catalogue place');
  assert.equal((await resolveText('Jjanda')).data, null, 'nor is its OSM suburb');
  const body = await resolveAddress(row);
  assert.equal(body.ok, true);
  assert.equal(body.data.district, 'Wakiso');
  assert.equal(body.data.region, 'Central');
  assert.equal(body.data.city || body.data.town, 'Kira');
  assert.equal(body.data.canonical_location_id, 'wakiso:kira mulawa');
  // The page fills the cascade only for one exact catalogue place.
  assert.equal(body.data.match, 'exact_alias');
  assert.equal(body.data.confidence, 1);
  assert.equal(body.data.resolved_by, 'nearest_area');
  assert.ok(body.data.distance_km < 2, String(body.data.distance_km));
});

test('every fixture place lands in the right district through text or address parts', async () => {
  const expected = {
    'Kira Junior School': 'Wakiso', Kira: 'Wakiso', 'Kira Mulawa': 'Wakiso', Najjera: 'Wakiso',
    Namugongo: 'Wakiso', Kyaliwajjala: 'Wakiso', Bweyogerere: 'Wakiso', Seeta: 'Mukono',
    Ntinda: 'Kampala', Kansanga: 'Kampala', Muyenga: 'Kampala', Entebbe: 'Wakiso', Gayaza: 'Wakiso',
    'Wakiso town': 'Wakiso', 'Mukono town': 'Mukono', Namasuba: 'Wakiso', Kikajjo: 'Wakiso'
  };
  for (const row of FIXTURE) {
    let data = (await resolveText(row.q)).data;
    if (!data) data = (await resolveAddress(row)).data;
    assert.ok(data, `${row.q} resolved`);
    assert.equal(data.district, expected[row.q], row.q);
    assert.equal(data.match, 'exact_alias', row.q);
  }
});

test('address-part matching: double letters, ignored region words, far namesakes and junk', () => {
  // OSM spells it Najjeera; the catalogue says Najjera.
  const najjera = registry.resolveCanonicalUgandaLocationFromAddress({ specific: ['Najjeera'], broad: ['Wakiso'], lat: 0.381, lng: 32.626 });
  assert.equal(najjera.match.key, 'wakiso:najjera');
  assert.equal(najjera.resolved_by, 'address_part');
  // "Kampala Capital City" is the district hint, not a place to match.
  const ntinda = registry.resolveCanonicalUgandaLocationFromAddress({ specific: ['Ntinda'], broad: ['Kampala Capital City', 'Central Region'], lat: 0.3544, lng: 32.6136 });
  assert.equal(ntinda.match.key, 'kampala:ntinda');
  assert.equal(ntinda.district_hint, 'Kampala');
  // A same-name place 15+ km from the pin is not the place the pin is on.
  const far = registry.resolveCanonicalUgandaLocationFromAddress({ specific: ['Ntinda'], broad: [], lat: 0.0612, lng: 32.4699 });
  assert.notEqual(far.match?.key, 'kampala:ntinda');
  // Nothing to go on.
  assert.equal(registry.resolveCanonicalUgandaLocationFromAddress({ specific: ['Zzxq'], broad: ['Uganda'] }).status, 'unmatched');
  // "Wakiso town" is the town, not a Kawempe shop OSM happened to return.
  assert.equal(registry.resolveCanonicalUgandaLocation('Wakiso town', '').match?.key, 'wakiso:wakiso');
});

test('the endpoint answers unmatched without a geocoder and rejects nothing it cannot parse', async () => {
  const body = (await request(app).get('/api/properties/locations/resolve-address').query({ specific: 'Zzxqfakeplace', lat: 'x', lng: '' })).body;
  assert.equal(body.ok, true);
  assert.equal(body.data, null);
  assert.equal(body.meta.status, 'unmatched');
});

test('borrowed centroids: every area centroid sits in its district and fills a catalogue place', () => {
  const centres = { kampala: [0.3476, 32.5825, 15], wakiso: [0.3476, 32.5825, 50], mukono: [0.353, 32.753, 50] };
  for (const item of UGANDA_AREA_CENTROIDS) {
    const centre = centres[String(item.district).toLowerCase()];
    assert.ok(centre, item.district);
    const km = registry.haversineKm({ lat: centre[0], lng: centre[1] }, item);
    assert.ok(km <= centre[2], `${item.name} ${km}`);
    const entry = registry.canonicalLocationByKey(`${item.district.toLowerCase()}:${registry.normalizeLocationKey(item.name)}`);
    assert.ok(entry, `${item.district}:${item.name} is a catalogue place`);
    assert.ok(Number.isFinite(entry.lat) && Number.isFinite(entry.lng), item.name);
  }
  // Nakawa had no point before: a curated override without coordinates hid the detailed one.
  const nakawa = registry.canonicalLocationByKey('kampala:nakawa');
  assert.ok(Number.isFinite(nakawa.lat));
});

test('the page sends the address parts and the pin, caches Nominatim, and fixes a far OSM pin', () => {
  assert.match(APP, /const lpNominatimSearchCache = new Map\(\);/);
  assert.match(APP, /let rows = lpNominatimSearchCache\.get\(url\);/);
  assert.match(APP, /addressParts: lpNominatimAddressParts\(row\?\.address \|\| \{\}\),/);
  assert.match(APP, /\/api\/properties\/locations\/resolve-address\?/);
  assert.match(APP, /await resolveLpCanonicalLocation\(query, point\.canonicalQuery \|\| "", point\)/);
  const resolver = APP.slice(APP.indexOf('async function resolveLpCanonicalLocation('), APP.indexOf('function adminReviewSetAddressSearchStatus('));
  assert.ok(resolver.indexOf('onlyCandidate') < resolver.indexOf('resolveUgandaLocationFromAddressParts(point)'), 'typed text wins over the pin');
  assert.match(APP, /Nearest known area: \$\{placeText\}/);
  assert.match(APP, /haversineKm\(Number\(point\.lat\), Number\(point\.lng\), placeLat, placeLng\) > 10/);
  const bundle = path.join(__dirname, '../assets/build/makaug-app.min.js');
  if (fs.existsSync(bundle)) {
    const built = fs.readFileSync(bundle, 'utf8');
    assert.ok(built.includes('function lpNominatimAddressParts'), 'public bundle has the parts helper');
    assert.ok(built.includes('function resolveUgandaLocationFromAddressParts'), 'public bundle has the resolver');
  }
});
