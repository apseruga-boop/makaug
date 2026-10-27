'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { isOnUgandaLand } = require('../utils/ugandaLand');
const { _test: publicProperties } = require('../routes/properties');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const functions = new Map(acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'script' }).body
  .filter((node) => node.type === 'FunctionDeclaration')
  .map((node) => [node.id.name, app.slice(node.start, node.end)]));
const AREA = { latitude: 0.3744, longitude: 32.6089 };

function listing(extra = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'approved', title: 'Home in Kulambiro', listing_type: 'sale',
    area: 'Kulambiro', district: 'Kampala', ...AREA,
    extra_fields: {
      canonical_location_id: 'kampala:kulambiro', location_precision: 'area',
      auto_pinned: true,
      coords_fix: { by: 'private-staff-id', previous: { latitude: null, longitude: null } },
      ...extra
    }
  };
}

function loadClient(names = [], overrides = {}) {
  const context = vm.createContext({
    ACTIVE_LOCATION_COUNTRY: { countryCode: 'UG' },
    MAP_DEFAULT_CENTER: { lat: 1.3733, lng: 32.2903 },
    MAP_APPROXIMATE_ZOOM: 13, MAP_PROPERTY_ZOOM: 17,
    approximatePlacePoint: () => ({ lat: 0.35, lng: 32.58, exact: false, precision: 'area' }),
    isOnUgandaLand, isLikelyUgandaCoordinate: isOnUgandaLand,
    haversineKm: () => 0,
    adminAttr: (text) => String(text).replace(/"/g, '&quot;'),
    adminEscape: (text) => String(text).replace(/</g, '&lt;'),
    translatePropertyUi: (text) => text,
    getLocalizedPropertyTitle: (p) => p.title,
    getPropertyLocationDisplay: (p) => [p.area, p.district].filter(Boolean).join(', '),
    ...overrides
  });
  for (const name of ['getListingMapPoint', ...names]) {
    assert.ok(functions.has(name), `${name} must be a real frontend function`);
    vm.runInContext(functions.get(name), context);
  }
  return context;
}

test('public detail and compact search cards retain area precision without exposing pin audit records', () => {
  const row = listing();
  for (const data of [publicProperties.publicPropertyRow(row), publicProperties.compactPublicCardRow(row)]) {
    assert.equal(data.extra_fields.location_precision, 'area');
    assert.equal(data.latitude, AREA.latitude);
    assert.equal(data.longitude, AREA.longitude);
    assert.equal(data.extra_fields.coords_fix, undefined);
    assert.equal(data.extra_fields.auto_pin_note, undefined);
    assert.equal(data.extra_fields.auto_pinned, undefined);
    assert.equal(row.extra_fields.coords_fix.by, 'private-staff-id');
    const client = loadClient();
    const point = client.getListingMapPoint(JSON.parse(JSON.stringify(data)));
    assert.equal(point.exact, false);
    assert.equal(point.precision, 'area');
    assert.equal(point.lat, AREA.latitude);
    assert.equal(point.lng, AREA.longitude);
  }
});

test('precision is a normalized public enum; GPS and existing unmarked coordinates remain exact', () => {
  const client = loadClient();
  for (const precision of ['gps', undefined, 'untrusted-private-note']) {
    const data = publicProperties.publicPropertyRow(listing({ location_precision: precision, auto_pinned: false }));
    assert.equal(data.extra_fields.location_precision, precision === 'gps' ? 'gps' : null);
    const point = client.getListingMapPoint(data);
    assert.equal(point.exact, true);
    assert.equal(point.precision, 'gps');
    assert.equal(point.lat, AREA.latitude);
    assert.equal(point.lng, AREA.longitude);
  }
  for (const precision of [' Area ', 'district', 'region', 'country']) {
    const data = publicProperties.publicPropertyRow(listing({ location_precision: precision }));
    const point = client.getListingMapPoint(data);
    assert.equal(point.exact, false);
    assert.equal(point.precision, precision.trim().toLowerCase());
  }
});

test('an invalid stored point still uses the existing area fallback', () => {
  const point = loadClient().getListingMapPoint({ latitude: 50, longitude: 0, extra_fields: { location_precision: 'area' } });
  assert.equal(point.lat, 0.35);
  assert.equal(point.lng, 32.58);
  assert.equal(point.exact, false);
});

test('Leaflet overview draws the existing area circle at saved coordinates and keeps GPS markers', () => {
  const drawn = [];
  const layer = (kind, at, options) => {
    const item = { kind, at, options, addTo() { drawn.push(this); return this; }, bindPopup(html) { this.popup = html; return this; } };
    return item;
  };
  const L = { circle: (at, opts) => layer('circle', at, opts), marker: (at, opts) => layer('marker', at, opts) };
  const context = loadClient(['addMarkers'], {
    L, window: { L }, maps: { test: {} }, mapProviders: { test: 'leaflet' }, markers: { test: [] },
    buildMapListingPopupHtml: (p) => `<strong>${p.title}</strong>`, wireLeafletMarkerClick() {}
  });
  context.addMarkers('test', [
    publicProperties.compactPublicCardRow(listing()),
    publicProperties.publicPropertyRow(listing({ location_precision: 'gps', auto_pinned: false }))
  ]);
  assert.equal(drawn.length, 2);
  assert.equal(drawn[0].kind, 'circle');
  assert.deepEqual(Array.from(drawn[0].at), [AREA.latitude, AREA.longitude]);
  assert.equal(drawn[0].options.radius, 700);
  assert.match(drawn[0].popup, /Approximate area/);
  assert.equal(drawn[1].kind, 'marker');
  assert.doesNotMatch(drawn[1].popup, /Approximate area/);
});

test('the static detail map labels a saved area pin before the interactive map loads', () => {
  const context = loadClient(['renderStaticDetailMapFallback']);
  const row = publicProperties.publicPropertyRow(listing());
  const el = {};
  context.renderStaticDetailMapFallback(el, row, context.getListingMapPoint(row));
  assert.match(el.innerHTML, /data-map-precision="approximate"/);
  assert.match(el.innerHTML, /Approximate area/);
  assert.match(el.innerHTML, /mlat=0\.3744&amp;mlon=32\.6089|mlat=0\.3744&mlon=32\.6089/);
  const gps = publicProperties.publicPropertyRow(listing({ location_precision: 'gps' }));
  context.renderStaticDetailMapFallback(el, gps, context.getListingMapPoint(gps));
  assert.doesNotMatch(el.innerHTML, /Approximate area|data-map-precision/);
});

test('the interactive detail map uses the existing 700m circle and approximate zoom for an area pin', async () => {
  const drawn = [];
  const el = { isConnected: true, innerHTML: '' };
  const map = { setView(at, zoom) { this.at = at; this.zoom = zoom; return this; }, invalidateSize() {} };
  const L = {
    map: () => map,
    tileLayer: () => ({ addTo() {} }),
    circle(at, options) {
      const item = { at, options, addTo() { drawn.push(this); return this; }, bindPopup(html) { this.popup = html; return this; }, openPopup() { return this; } };
      return item;
    },
    marker() { throw new Error('Area detail must not draw an exact marker'); }
  };
  const context = loadClient(['renderStaticDetailMapFallback', 'initDetailMap'], {
    L, window: { L }, document: { getElementById: () => el }, lastDetailMapProperty: null,
    waitForDetailMapVisible: async () => true, ensureGoogleMapsApi: async () => false, ensureLeafletApi: async () => true,
    OSM_TILE_URL: '/tiles/{z}/{x}/{y}.png', OSM_TILE_ATTRIBUTION: 'OpenStreetMap', OSM_REFERRER_POLICY: 'no-referrer', setTimeout() {}
  });
  await context.initDetailMap(publicProperties.publicPropertyRow(listing()));
  assert.equal(drawn.length, 1);
  assert.equal(map.zoom, 13);
  assert.deepEqual(Array.from(map.at), [AREA.latitude, AREA.longitude]);
  assert.equal(drawn[0].options.radius, 700);
  assert.match(drawn[0].popup, /Approximate area/);
});
