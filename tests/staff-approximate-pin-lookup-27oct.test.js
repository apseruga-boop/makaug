'use strict';

/**
 * 27 Oct 2026 (Arthur): in staff Preview & edit, a Kira or Namugongo listing
 * with no saved lat/lng opened with the pin on the Wakiso district centre
 * (0.404, 32.459), and "Use current pin" saved that centre. When the pin is
 * only a district/town-centre fallback, "Find" and "Use current pin" now look
 * up the listing's neighbourhood/town and move the pin there.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const WAKISO = { lat: 0.4044, lng: 32.4594 };
const KIRA = { lat: 0.3978, lng: 32.6414 };

function slice(startMarker, endMarker) {
  const start = APP.indexOf(startMarker);
  const end = APP.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `${startMarker} .. ${endMarker}`);
  return APP.slice(start, end);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadHelpers({ draft, registry = {}, address = null, nominatim = null }) {
  const calls = { registry: [], address: [], fetch: [], moved: [] };
  const context = {
    MAP_DEFAULT_CENTER: { lat: 1.3733, lng: 32.2903 },
    MAP_CITY_ZOOM: 15,
    ACTIVE_LOCATION_COUNTRY: { countryName: 'Uganda' },
    ACTIVE_LOCATION_COUNTRY_CODE_LOWER: 'ug',
    OSM_FETCH_OPTIONS: {},
    adminReviewLocationDraft: () => draft,
    adminReviewHasUsableCoordinates: (lat, lng) => Boolean(String(lat || '').trim() && String(lng || '').trim()),
    getDistrictCenter: (district) => (district === 'Wakiso' ? WAKISO : district === 'Mukono' ? { lat: 0.3533, lng: 32.7553 } : null),
    fixedPlaceCentroid: (d, a) => (d === 'Wakiso' && a === 'Wakiso' ? WAKISO : null),
    getCityPoint: () => null,
    getHierarchyPointForArea: () => null,
    getRegionCenter: () => ({ lat: 0.5, lng: 32.5 }),
    regionForDistrict: () => 'Central',
    haversineKm,
    isLikelyUgandaCoordinate: (lat, lng) => lat >= -1.5 && lat <= 4.3 && lng >= 29.5 && lng <= 35.1,
    adminReviewPlaceEqualsDistrict: (place, district) => String(place).toLowerCase() === String(district).toLowerCase(),
    uniqueTextParts: (parts) => [...new Set(parts.map((p) => String(p || '').trim()).filter(Boolean))],
    resolveUgandaLocationFromSharedRegistry: async (query) => {
      calls.registry.push(query);
      const hit = registry[query];
      return hit ? { status: 'matched', location: hit } : { status: 'unmatched', location: null };
    },
    resolveUgandaLocationFromAddressParts: async (point) => { calls.address.push(point.addressParts); return address; },
    fetch: async (url) => { calls.fetch.push(url); return { ok: true, json: async () => (nominatim ? [nominatim] : []) }; },
    adminReviewMoveLocationPin: (lat, lng, options) => calls.moved.push({ lat, lng, zoom: options?.zoom })
  };
  vm.createContext(context);
  vm.runInContext(`${slice('const ADMIN_REVIEW_APPROXIMATE_PIN_KM', "// The map marker's position")}
    this.isApproximate = adminReviewPinIsApproximate;
    this.lookup = adminReviewLookupListingPlacePoint;
    this.movePin = adminReviewMovePinToListingPlace;`, context);
  return { context, calls };
}

const kiraDraft = { district: 'Wakiso', city: 'Kira', neighborhood: 'Kira', area: 'Kira', latitude: '', longitude: '' };

test('a pin on the Wakiso centre with empty lat/lng is approximate; a real place pin is not', () => {
  const { context } = loadHelpers({ draft: kiraDraft });
  assert.equal(context.isApproximate(WAKISO), true);
  assert.equal(context.isApproximate({ lat: 0.4050, lng: 32.4600 }), true, 'within 1.5 km of the centre');
  assert.equal(context.isApproximate(null), true, 'no marker yet');
  assert.equal(context.isApproximate(KIRA), false);
  const saved = loadHelpers({ draft: { ...kiraDraft, latitude: '0.404400', longitude: '32.459400' } });
  assert.equal(saved.context.isApproximate(WAKISO), false, 'a saved pin is never replaced');
});

test('Kira resolves through the makaug catalogue and the pin moves there', async () => {
  const { context, calls } = loadHelpers({
    draft: kiraDraft,
    registry: { 'Kira, Wakiso': { name: 'Kira', level: 'city', latitude: KIRA.lat, longitude: KIRA.lng } }
  });
  const point = await context.movePin();
  assert.deepEqual({ lat: point.lat, lng: point.lng, label: point.label }, { ...KIRA, label: 'Kira' });
  assert.deepEqual(calls.registry, ['Kira, Wakiso']);
  assert.deepEqual(calls.moved, [{ ...KIRA, zoom: 15 }]);
  assert.deepEqual(calls.fetch, [], 'no external geocoder when the catalogue has the place');
});

test('a district-level match is not used; resolve-address and then a district-checked OSM search are', async () => {
  const draft = { district: 'Wakiso', city: 'Kira', neighborhood: 'Namugongo', area: 'Namugongo', latitude: '', longitude: '' };
  const viaAddress = loadHelpers({
    draft,
    registry: { 'Namugongo, Wakiso': { name: 'Wakiso', level: 'district', latitude: WAKISO.lat, longitude: WAKISO.lng } },
    address: { name: 'Namugongo', level: 'area', latitude: 0.363, longitude: 32.636 }
  });
  const fromAddress = await viaAddress.context.lookup();
  assert.deepEqual([fromAddress.lat, fromAddress.lng], [0.363, 32.636]);
  assert.equal(JSON.stringify(viaAddress.calls.address[0]), JSON.stringify({ specific: ['Namugongo'], broad: ['Wakiso'] }));

  const viaOsm = loadHelpers({ draft, nominatim: { lat: '0.3631', lon: '32.6362' } });
  const fromOsm = await viaOsm.context.lookup();
  assert.deepEqual([fromOsm.lat, fromOsm.lng, fromOsm.provider], [0.3631, 32.6362, 'nominatim']);
  assert.match(viaOsm.calls.fetch[0], /q=Namugongo%2C%20Wakiso%2C%20Uganda/);

  const farAway = loadHelpers({ draft, nominatim: { lat: '2.77', lon: '32.30' } });
  assert.equal(await farAway.context.lookup(), null, 'a result 60+ km from the district is ignored');
  assert.deepEqual(farAway.calls.moved, []);
});

test('a neighbourhood found on OSM beats the town registry point (Kitukutwe, Kira)', async () => {
  const draft = { district: 'Wakiso', city: 'Kira', neighborhood: 'Kitukutwe', area: 'Kitukutwe', latitude: '', longitude: '' };
  const { context, calls } = loadHelpers({
    draft,
    registry: {
      'Kitukutwe, Wakiso': { name: 'Kitukutwe', level: 'area', latitude: null, longitude: null },
      'Kira, Wakiso': { name: 'Kira', level: 'city', latitude: KIRA.lat, longitude: KIRA.lng }
    },
    nominatim: { lat: '0.4427481', lon: '32.6574187' }
  });
  const point = await context.lookup();
  assert.deepEqual([point.lat, point.lng, point.label], [0.4427481, 32.6574187, 'Kitukutwe']);
  assert.match(calls.fetch[0], /q=Kitukutwe%2C%20Wakiso%2C%20Uganda/);
});

test('a lookup that finishes after staff typed a pin does not move it', async () => {
  const draft = { ...kiraDraft };
  const { context, calls } = loadHelpers({
    draft,
    registry: { 'Kira, Wakiso': { name: 'Kira', level: 'city', latitude: KIRA.lat, longitude: KIRA.lng } }
  });
  const pending = context.movePin();
  draft.latitude = '0.401000';
  draft.longitude = '32.600000';
  assert.equal(await pending, null);
  assert.deepEqual(calls.moved, []);
});

function loadUsePin({ approximate, lookup, marker }) {
  const calls = { set: [], status: [], toast: [] };
  const context = {
    adminReviewLocationMarker: marker,
    adminActiveReview: { id: 'kira' },
    adminReviewLocationPoint: () => ({ ...WAKISO, exact: false }),
    adminReviewPinIsApproximate: () => approximate,
    adminReviewMovePinToListingPlace: async () => lookup,
    isLikelyUgandaCoordinate: (lat, lng) => lat >= -1.5 && lat <= 4.3 && lng >= 29.5 && lng <= 35.1,
    adminReviewSetLocationInputs: (lat, lng, message) => calls.set.push({ lat, lng, message }),
    adminReviewLocationStatus: (message) => calls.status.push(message),
    toast: (message) => calls.toast.push(message)
  };
  vm.createContext(context);
  vm.runInContext(`${slice('function reviewMarkerPoint', 'async function initAdminReviewLocationMap')}; this.run = adminReviewUseMapPin;`, context);
  return { run: context.run, calls };
}

test('Use current pin on the Wakiso centre saves the looked-up Kira point', async () => {
  const { run, calls } = loadUsePin({
    approximate: true,
    lookup: { ...KIRA, label: 'Kira' },
    marker: { getLatLng: () => WAKISO }
  });
  await run();
  assert.deepEqual(calls.set.map(({ lat, lng }) => [lat, lng]), [[KIRA.lat, KIRA.lng]]);
  assert.match(calls.set[0].message, /Pin moved to Kira and saved to fields/);
});

test('Use current pin keeps the old behaviour when the lookup finds nothing or the pin is real', async () => {
  const none = loadUsePin({ approximate: true, lookup: null, marker: { getLatLng: () => WAKISO } });
  await none.run();
  assert.deepEqual(none.calls.set.map(({ lat, lng }) => [lat, lng]), [[WAKISO.lat, WAKISO.lng]]);
  const real = loadUsePin({ approximate: false, lookup: { ...KIRA, label: 'Kira' }, marker: { getLatLng: () => ({ lat: 0.3005, lng: 32.6463 }) } });
  real.run();
  assert.deepEqual(real.calls.set.map(({ lat, lng }) => [lat, lng]), [[0.3005, 32.6463]]);
  assert.match(real.calls.set[0].message, /Exact pin saved/);
});

test('Find moves an approximate pin (typed place first, else the listing area) without saving it', () => {
  const find = slice('async function adminReviewFindAddressOrPlace(', 'let adminReviewLastFindPoint');
  assert.match(find, /adminReviewPinIsApproximate\(reviewMarkerPoint\(adminReviewLocationMarker\)\)/);
  assert.match(find, /typed \? adminReviewMovePinToPoint\(typed\) : await adminReviewMovePinToListingPlace\(\)/);
  assert.doesNotMatch(find, /adminReviewSetLocationInputs/, 'Find never writes lat/lng');
  assert.match(APP, /adminReviewLastFindPoint = \{ lat: Number\(findChoice\.point\.lat\)/);
});
