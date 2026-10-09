'use strict';

// Maps are free by default (Leaflet + OpenStreetMap). Google Maps is paid and
// only used when the server sets MAP_PROVIDER=google; the Google key is not
// sent to browsers otherwise.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const brochure = fs.readFileSync('services/offPlanBrochureService.js', 'utf8');

test('the app defaults to OpenStreetMap and only loads Google when told to', () => {
  assert.match(app, /const MAP_PROVIDER = String\(window\.MAKAUG_MAP_PROVIDER \|\| window\.MAKAUG_CONFIG\?\.mapProvider \|\| "osm"\)\.toLowerCase\(\) === "google" \? "google" : "osm";/);
  assert.match(app, /function ensureGoogleMapsApi\(\) \{\n  if \(MAP_PROVIDER !== "google"\) return Promise\.resolve\(false\);/);
  assert.doesNotMatch(app, /\{s\}\.tile\.openstreetmap\.org/, 'use the current OSM tile host, not the old a/b/c subdomains');
  const layers = app.match(/L\.tileLayer\(/g) || [];
  assert.equal(layers.length, (app.match(/L\.tileLayer\(OSM_TILE_URL,/g) || []).length, 'every tile layer uses the shared OSM URL');
  assert.ok(layers.length >= 6);
  assert.equal((app.match(/attribution: OSM_TILE_ATTRIBUTION/g) || []).length, layers.length, 'every OSM map credits OpenStreetMap');
});

test('config.js sends the Google key only when MAP_PROVIDER=google', () => {
  assert.match(server, /const mapProvider = String\(process\.env\.MAP_PROVIDER \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'google' \? 'google' : 'osm';/);
  assert.match(server, /googleMapsApiKey: mapProvider === 'google' \? \(process\.env\.GOOGLE_MAPS_API_KEY \|\| ''\) : '',/);
  assert.match(server, /window\.MAKAUG_MAP_PROVIDER = \$\{JSON\.stringify\(publicConfig\.mapProvider\)\};/);
});

test('the off-plan brochure skips the paid Google static map unless Google is chosen', () => {
  assert.match(brochure, /if \(String\(process\.env\.MAP_PROVIDER \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'google'\) return null;/);
});
