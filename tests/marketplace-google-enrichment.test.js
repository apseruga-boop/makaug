'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  getGooglePlaceDetails,
  normalizeGooglePlaceDetails,
  resetGoogleDetailsState
} = require('../services/marketplaceGooglePlacesService');

const root = path.join(__dirname, '..');
const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;
const originalCap = process.env.MARKETPLACE_GOOGLE_DETAILS_DAILY_CAP;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  if (originalCap === undefined) delete process.env.MARKETPLACE_GOOGLE_DETAILS_DAILY_CAP;
  else process.env.MARKETPLACE_GOOGLE_DETAILS_DAILY_CAP = originalCap;
  resetGoogleDetailsState();
});

test('normalizes the Google fields used by a found-online profile', () => {
  const result = normalizeGooglePlaceDetails({
    id: 'ChIJ123',
    displayName: { text: 'Acme Surveyors' },
    rating: 4.3,
    userRatingCount: 87,
    formattedAddress: 'Kira Road, Kampala, Uganda',
    plusCode: { globalCode: '8G7H8H2V+6J' },
    internationalPhoneNumber: '+256 700 000000',
    websiteUri: 'https://example.com',
    googleMapsUri: 'https://maps.google.com/?cid=123',
    businessStatus: 'CLOSED_TEMPORARILY',
    currentOpeningHours: { openNow: false, weekdayDescriptions: ['Monday: 8:00 AM – 5:00 PM'] }
  });
  assert.equal(result.place_id, 'ChIJ123');
  assert.equal(result.rating, 4.3);
  assert.equal(result.review_count, 87);
  assert.equal(result.business_status, 'temporarily_closed');
  assert.equal(result.open_now, false);
  assert.deepEqual(result.weekday_descriptions, ['Monday: 8:00 AM – 5:00 PM']);
});

test('fetches Google details once and serves the next profile open from short cache', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    assert.match(url, /places\/ChIJ-cache$/);
    assert.match(options.headers['X-Goog-FieldMask'], /rating/);
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-key');
    return {
      ok: true,
      json: async () => ({ id: 'ChIJ-cache', rating: 4.8, userRatingCount: 21, businessStatus: 'OPERATIONAL' })
    };
  };
  const first = await getGooglePlaceDetails('ChIJ-cache');
  const second = await getGooglePlaceDetails('ChIJ-cache');
  assert.equal(first.cache_status, 'miss');
  assert.equal(second.cache_status, 'hit');
  assert.equal(second.rating, 4.8);
  assert.equal(calls, 1);
});

test('enforces the configured daily request budget across distinct profiles', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  process.env.MARKETPLACE_GOOGLE_DETAILS_DAILY_CAP = '1';
  global.fetch = async () => ({ ok: true, json: async () => ({ businessStatus: 'OPERATIONAL' }) });
  await getGooglePlaceDetails('ChIJ-one');
  await assert.rejects(() => getGooglePlaceDetails('ChIJ-two'), /daily request cap reached/i);
});

test('wires the enrichment marker, stable place id and on-demand profile endpoint', () => {
  const migration = fs.readFileSync(path.join(root, 'db/migrations/083_marketplace_google_enrichment.sql'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'routes/marketplace.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
  const seed = fs.readFileSync(path.join(root, 'scripts/seed-marketplace-google-places.js'), 'utf8');
  assert.match(migration, /source_place_id TEXT/);
  assert.match(route, /businesses\/:id\/details/);
  assert.match(route, /business_hidden_permanently_closed/);
  assert.match(app, /marketplace-enrich-20260719/);
  assert.match(app, /reviewsOnGoogle/);
  assert.match(seed, /source_place_id/);
});
