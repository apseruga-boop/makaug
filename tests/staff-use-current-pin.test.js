'use strict';

/**
 * P5 (10 Oct 2026): in staff Preview & edit, "Use current pin" left latitude
 * and longitude at 0 and the moderator had to type the pin by hand. The handler
 * read the marker only when the provider flag matched, and the Leaflet map
 * never set the flag. Now it reads the marker directly (falling back to the
 * geocoded/area pin) and never writes 0,0; the staff save route treats 0,0 as
 * missing, so it is never saved.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-use-current-pin-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { normalizeStaffListingPatch, isMissingPin } = require('../routes/staff')._test;

const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const existing = { area: 'Luzira', district: 'Kampala', extra_fields: {} };

test('server: a 0,0 pin from staff is not saved', () => {
  for (const pin of [{ latitude: 0, longitude: 0 }, { latitude: '0', longitude: '0' }, { latitude: '0.000000', longitude: '0.000000' }, { lat: 0, lng: 0 }, { latitude: 0.3, longitude: 0 }]) {
    const { patch } = normalizeStaffListingPatch(existing, { title: 'House in Luzira', ...pin });
    assert.equal(Object.prototype.hasOwnProperty.call(patch, 'latitude'), false, JSON.stringify(pin));
    assert.equal(Object.prototype.hasOwnProperty.call(patch, 'longitude'), false, JSON.stringify(pin));
    assert.equal(patch.lat, undefined);
    assert.equal(patch.lng, undefined);
  }
});

test('server: real pins are kept, including ones near the equator', () => {
  const { patch } = normalizeStaffListingPatch(existing, { latitude: '0.300512', longitude: '32.646310' });
  assert.equal(patch.latitude, '0.300512');
  assert.equal(patch.longitude, '32.646310');
  const equator = normalizeStaffListingPatch(existing, { latitude: 0, longitude: 32.45 }).patch;
  assert.equal(equator.latitude, 0, 'latitude 0 is real in Uganda when the longitude is real');
  assert.equal(equator.longitude, 32.45);
  assert.equal(isMissingPin(undefined, undefined), false, 'no pin sent: nothing to drop');
  assert.equal(isMissingPin('', ''), false);
});

test('server: the save route uses the normalised patch', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
  assert.match(source, /const \{ patch, hierarchy, errors \} = normalizeStaffListingPatch\(existing, listingPatch\);/);
});

function loadHandler({ marker = null, fallback = null } = {}) {
  const start = APP.indexOf('function reviewMarkerPoint');
  const end = APP.indexOf('async function initAdminReviewLocationMap', start);
  assert.ok(start > 0 && end > start);
  const calls = { set: [], status: [], toast: [] };
  const context = {
    adminReviewLocationMarker: marker,
    adminActiveReview: { id: 'aa89974b-1a27-4a9a-9739-c87e8d8e4ba7' },
    adminReviewLocationPoint: () => fallback,
    isLikelyUgandaCoordinate: (lat, lng) => lat >= -1.5 && lat <= 4.3 && lng >= 29.5 && lng <= 35.1,
    adminReviewSetLocationInputs: (lat, lng, message) => calls.set.push({ lat, lng, message }),
    adminReviewLocationStatus: (message) => calls.status.push(message),
    toast: (message) => calls.toast.push(message)
  };
  vm.createContext(context);
  vm.runInContext(`${APP.slice(start, end)}; this.run = adminReviewUseMapPin;`, context);
  return { run: context.run, calls };
}

test('handler: copies a Leaflet marker even with no provider flag', () => {
  const { run, calls } = loadHandler({ marker: { getLatLng: () => ({ lat: 0.3005, lng: 32.6463 }) } });
  run();
  assert.deepEqual(calls.set.map(({ lat, lng }) => [lat, lng]), [[0.3005, 32.6463]]);
});

test('handler: copies a Google marker', () => {
  const { run, calls } = loadHandler({ marker: { getPosition: () => ({ lat: () => 0.3005, lng: () => 32.6463 }) } });
  run();
  assert.deepEqual(calls.set.map(({ lat, lng }) => [lat, lng]), [[0.3005, 32.6463]]);
});

test('handler: a marker at 0,0 falls back to the geocoded pin', () => {
  const { run, calls } = loadHandler({ marker: { getLatLng: () => ({ lat: 0, lng: 0 }) }, fallback: { lat: 0.3006, lng: 32.6460, exact: false } });
  run();
  assert.deepEqual(calls.set.map(({ lat, lng }) => [lat, lng]), [[0.3006, 32.646]]);
  assert.match(calls.set[0].message, /Area pin/);
});

test('handler: never writes 0,0', () => {
  const { run, calls } = loadHandler({ marker: { getLatLng: () => ({ lat: 0, lng: 0 }) }, fallback: { lat: 0, lng: 0 } });
  run();
  assert.deepEqual(calls.set, []);
  assert.match(calls.status[0], /Map pin not ready/);
  const none = loadHandler({});
  none.run();
  assert.deepEqual(none.calls.set, []);
});

test('the Leaflet review map sets its provider flag', () => {
  const init = APP.slice(APP.indexOf('async function initAdminReviewLocationMap'), APP.indexOf('function adminReviewTimestampField'));
  assert.match(init, /adminReviewLocationMarker = marker;\s*adminReviewLocationProvider = "leaflet";/);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
