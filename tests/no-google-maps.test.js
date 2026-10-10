'use strict';

/**
 * C18 (10 Oct 2026, Arthur: "we won't be using Google again"). The Google Cloud
 * billing account is closing and the paid keys were blanked on Render. Nothing
 * may call a paid Google Maps/Places API, and nothing may break without a key:
 * maps are Leaflet + OpenStreetMap everywhere. Google Analytics stays.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('no Google Places call runs unless GOOGLE_PLACES_ALLOWED=true, even with a key set', async () => {
  const saved = { allowed: process.env.GOOGLE_PLACES_ALLOWED, key: process.env.GOOGLE_MAPS_API_KEY, fetch: global.fetch };
  delete process.env.GOOGLE_PLACES_ALLOWED;
  process.env.GOOGLE_MAPS_API_KEY = 'still-set-somewhere';
  let googleCalls = 0;
  global.fetch = async (url) => { if (/googleapis\.com/.test(String(url))) googleCalls += 1; throw new Error('no network in tests'); };
  try {
    const { googlePlacesAllowed, googlePlacesApiKey } = require('../utils/googlePlacesAllowed');
    assert.equal(googlePlacesAllowed(), false);
    assert.equal(googlePlacesApiKey(), '');
    const places = require('../services/marketplaceGooglePlacesService');
    await assert.rejects(() => places.getGooglePlaceDetails('ChIJ-test-place'), /not configured/);
    const drip = require('../services/marketplaceNationalDripService');
    const google = (drip.SOURCE_DEFINITIONS || []).find((source) => source.key === 'google_maps');
    if (google && typeof drip.getMarketplaceDripStatus === 'function') {
      // The provider status reads the gated key: Google shows as not configured.
      const source = read('services/marketplaceNationalDripService.js');
      assert.match(source, /function googleApiKey\(\) \{\n  return clean\(googlePlacesApiKey\(\)\);\n\}/);
    }
    const brochure = require('../services/offPlanBrochureService');
    if (typeof brochure.googleStaticMapBuffer === 'function') {
      assert.equal(await brochure.googleStaticMapBuffer({ latitude: 0.3, longitude: 32.6 }), null);
    }
    assert.equal(googleCalls, 0);
  } finally {
    if (saved.allowed === undefined) delete process.env.GOOGLE_PLACES_ALLOWED; else process.env.GOOGLE_PLACES_ALLOWED = saved.allowed;
    if (saved.key === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = saved.key;
    global.fetch = saved.fetch;
  }
});

test('the seed script refuses to run without the flag', () => {
  assert.match(read('scripts/seed-marketplace-google-places.js'), /Google Places is switched off \(set GOOGLE_PLACES_ALLOWED=true to run this deliberately\)\./);
});

test('no page, bundle or browser script loads Google Maps; maps are Leaflet + OSM', () => {
  for (const file of ['index.html', 'assets/makaug-app.js', 'assets/off-plan.js', 'assets/short-term.js', 'assets/build/makaug-app.min.js', 'assets/build/makaug-admin.min.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /maps\.googleapis\.com|places\.googleapis\.com|maps\/api\/js/, file);
  }
  const offPlan = read('assets/off-plan.js');
  assert.doesNotMatch(offPlan, /google\.maps/);
  assert.match(offPlan, /window\.L\.tileLayer\(OFF_PLAN_TILE_URL, \{ attribution: OFF_PLAN_TILE_ATTRIBUTION, referrerPolicy: 'strict-origin-when-cross-origin'/);
  const shortTerm = read('assets/short-term.js');
  assert.doesNotMatch(shortTerm, /google\.maps/);
  assert.match(shortTerm, /L\.divIcon\(/, 'the price is still the pin');
  const server = read('server.js');
  assert.match(server, /const mapProvider = 'osm';/);
  assert.doesNotMatch(server, /googleMapsApiKey: mapProvider === 'google'/);
});

test('Google Analytics is kept', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /googletagmanager\.com\/gtag\/js|gtag\(/);
});
