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

test('the app uses OpenStreetMap only and never loads Google Maps (C18)', () => {
  assert.match(app, /const MAP_PROVIDER = "osm";/);
  assert.match(app, /const GOOGLE_MAPS_API_KEY = "";/);
  assert.match(app, /function ensureGoogleMapsApi\(\) \{\n  return Promise\.resolve\(false\);\n\}/);
  assert.doesNotMatch(app, /maps\.googleapis\.com|places\.googleapis\.com/);
  assert.doesNotMatch(app, /\{s\}\.tile\.openstreetmap\.org/, 'use the current OSM tile host, not the old a/b/c subdomains');
  const layers = app.match(/L\.tileLayer\(/g) || [];
  assert.equal(layers.length, (app.match(/L\.tileLayer\(OSM_TILE_URL,/g) || []).length, 'every tile layer uses the shared OSM URL');
  assert.ok(layers.length >= 6);
  assert.equal((app.match(/attribution: OSM_TILE_ATTRIBUTION/g) || []).length, layers.length, 'every OSM map credits OpenStreetMap');
  // The site sends Referrer-Policy: no-referrer, and OSM blocks tiles and
  // lookups that carry no referrer, so they send the origin explicitly.
  assert.match(app, /const OSM_REFERRER_POLICY = "strict-origin-when-cross-origin";/);
  assert.equal((app.match(/referrerPolicy: OSM_REFERRER_POLICY,/g) || []).length, layers.length, 'every tile layer sends the site origin');
  const nominatimCalls = app.split('nominatim.openstreetmap.org/').length - 1;
  assert.equal((app.match(/await fetch\(url, OSM_FETCH_OPTIONS\)/g) || []).length, nominatimCalls, 'every Nominatim lookup sends the site origin');
});

test('config.js never sends a Google key and always picks OpenStreetMap (C18)', () => {
  assert.match(server, /const mapProvider = 'osm';/);
  assert.match(server, /googleMapsApiKey: '',/);
  assert.match(server, /window\.MAKAUG_MAP_PROVIDER = \$\{JSON\.stringify\(publicConfig\.mapProvider\)\};/);
});

test('the off-plan brochure skips the paid Google static map unless Google is chosen', () => {
  assert.match(brochure, /if \(String\(process\.env\.GOOGLE_PLACES_ALLOWED \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'true'\) return null;/);
  assert.match(brochure, /if \(String\(process\.env\.MAP_PROVIDER \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'google'\) return null;/);
});
