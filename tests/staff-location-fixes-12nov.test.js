'use strict';

// 12 Nov 2026: Kikwatamigo and Makindye Lusaka were missing from the
// catalogue, a location reject discarded title/description/price, an unknown
// neighbourhood was silently rewritten to the parent area, and the Akright
// City suggestion left Entebbe plus the Kirinnya pin.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  canonicalizeUgandaLocation,
  canonicalLocationByKey,
  canonicalLocationPinPoint
} = require('../utils/ugandaLocationRegistry');
const { isOnUgandaLand } = require('../utils/ugandaLand');
const { getDistrictLocationTree, normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');
const { areaCentreForUnpinnedListing } = require('../services/listingCoordinateRepairService');
const { normalizeStaffListingPatch, updateStaffEditableListing } = require('../routes/staff')._test;

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const staff = fs.readFileSync(path.join(root, 'routes/staff.js'), 'utf8');

function almostEqual(actual, expected, delta = 0.0005) {
  assert.ok(Math.abs(Number(actual) - expected) < delta, `${actual} !~ ${expected}`);
}

test('Kikwatamigo is accepted as a Hoima Town neighbourhood near Kyentale', () => {
  const place = canonicalizeUgandaLocation('Kikwatamigo', 'Hoima');
  assert.ok(place);
  assert.equal(place.name, 'Kikwatamigo');
  assert.equal(place.district, 'Hoima');
  assert.equal(place.town, 'Hoima Town');
  almostEqual(place.lat, 1.439);
  almostEqual(place.lng, 31.352);
  assert.equal(isOnUgandaLand(place.lat, place.lng), true);
  const kyentale = canonicalizeUgandaLocation('Kyentale', 'Hoima');
  assert.ok(kyentale);
  // Stay near Kyentale, not at the Kirinnya or Entebbe pins, and not identical.
  assert.ok(Math.abs(place.lat - kyentale.lat) < 0.02);
  assert.ok(Math.abs(place.lng - kyentale.lng) < 0.03);
  assert.notEqual(place.key, kyentale.key);

  const aliased = canonicalizeUgandaLocation('Kikwatamigo Hoima', 'Hoima');
  assert.equal(aliased.key, place.key);

  const hierarchy = normalizeReviewLocationHierarchy({
    area: 'Kikwatamigo',
    district: 'Hoima'
  });
  assert.deepEqual(hierarchy.errors, []);
  assert.equal(hierarchy.neighborhood, 'Kikwatamigo');
  assert.equal(hierarchy.city, 'Hoima Town');
  assert.equal(hierarchy.district, 'Hoima');

  const patched = normalizeStaffListingPatch(
    { area: '', district: '', extra_fields: {}, listing_type: 'sale' },
    { area: 'Kikwatamigo', district: 'Hoima City' }
  );
  assert.deepEqual(patched.errors, []);
  assert.equal(patched.patch.area, 'Kikwatamigo');
  assert.equal(patched.patch.district, 'Hoima');

  const hoimaTown = getDistrictLocationTree('Hoima').find((node) => node.city === 'Hoima Town');
  assert.ok((hoimaTown?.neighborhoods || []).some((item) => item.name === 'Kikwatamigo'));
});

test('Lusaka is accepted under Makindye and is not rewritten to Makindye', () => {
  const place = canonicalizeUgandaLocation('Lusaka', 'Kampala');
  assert.ok(place);
  assert.equal(place.name, 'Lusaka');
  assert.equal(place.district, 'Kampala');
  assert.equal(place.town, 'Makindye');
  almostEqual(place.lat, 0.2876);
  almostEqual(place.lng, 32.587);
  assert.equal(isOnUgandaLand(place.lat, place.lng), true);
  assert.equal(canonicalizeUgandaLocation('Makindye Lusaka', 'Kampala').key, place.key);

  const asArea = normalizeReviewLocationHierarchy({
    area: 'Makindye Lusaka',
    district: 'Kampala'
  });
  assert.deepEqual(asArea.errors, []);
  assert.equal(asArea.neighborhood, 'Lusaka');
  assert.equal(asArea.city, 'Makindye');
  assert.notEqual(asArea.neighborhood, 'Makindye');

  const asChild = normalizeReviewLocationHierarchy({
    area: 'Makindye',
    district: 'Kampala',
    city: 'Makindye',
    neighborhood: 'Lusaka'
  });
  assert.deepEqual(asChild.errors, []);
  assert.equal(asChild.neighborhood, 'Lusaka');
  assert.equal(asChild.city, 'Makindye');

  const patched = normalizeStaffListingPatch(
    { area: 'Makindye', district: 'Kampala', extra_fields: { city: 'Makindye' }, listing_type: 'sale' },
    { area: 'Makindye Lusaka', district: 'Kampala', neighborhood: 'Lusaka', city: 'Makindye' }
  );
  assert.deepEqual(patched.errors, []);
  assert.equal(patched.patch.area, 'Lusaka');
  assert.equal(patched.hierarchy.neighborhood, 'Lusaka');
  assert.notEqual(patched.hierarchy.neighborhood, 'Makindye');

  const makindye = getDistrictLocationTree('Kampala').find((node) => node.city === 'Makindye');
  assert.ok((makindye?.neighborhoods || []).some((item) => item.name === 'Lusaka'));
});

test('an unknown neighbourhood is kept and rejected, not silently rewritten to the parent area', () => {
  const result = normalizeReviewLocationHierarchy({
    area: 'Makindye',
    district: 'Kampala',
    city: 'Makindye',
    neighborhood: 'An Invented Parish'
  });
  assert.equal(result.neighborhood, 'An Invented Parish');
  assert.notEqual(result.neighborhood, 'Makindye');
  assert.ok(result.errors.includes('neighbourhood must belong to the selected district and town/city'));
});

test('a bad area still saves title, description and price from the same preview request', async () => {
  const row = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: 'Old title',
    description: 'Old description',
    listing_type: 'sale',
    area: 'Ntinda',
    district: 'Kampala',
    price: null,
    price_period: 'once',
    price_on_application: true,
    moderation_notes: '',
    extra_fields: { city: 'Nakawa', neighborhood: 'Ntinda', price_on_application: true }
  };
  const db = require('../config/database');
  const originalQuery = db.query;
  const updates = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('SELECT * FROM properties')) return { rows: [row] };
    if (text.includes('UPDATE properties')) {
      updates.push({ text, params: [...params] });
      const titleMatch = text.match(/\btitle\s*=\s*\$(\d+)/);
      const descMatch = text.match(/\bdescription\s*=\s*\$(\d+)/);
      const priceMatch = text.match(/\bprice\s*=\s*\$(\d+)/);
      const notesMatch = text.match(/\bmoderation_notes\s*=\s*\$(\d+)/);
      if (titleMatch) row.title = params[Number(titleMatch[1]) - 1];
      if (descMatch) row.description = params[Number(descMatch[1]) - 1];
      if (priceMatch) row.price = params[Number(priceMatch[1]) - 1];
      if (notesMatch) row.moderation_notes = params[Number(notesMatch[1]) - 1];
      const extraMatch = text.match(/\|\|\s*\$(\d+)::jsonb/);
      if (extraMatch) {
        row.extra_fields = { ...(row.extra_fields || {}), ...JSON.parse(params[Number(extraMatch[1]) - 1]) };
      }
      return { rows: [row] };
    }
    return { rows: [] };
  };
  let thrown = null;
  try {
    await updateStaffEditableListing(
      { userAuth: { id: '00000000-0000-4000-8000-000000000001', first_name: 'Mod', role: 'moderator' } },
      row.id,
      {
        title: 'House in an unknown parish',
        description: 'Staff-written description of the house.',
        price: 10000000,
        price_on_application: false,
        price_period: 'once',
        area: 'Completely Unknown Parish',
        district: 'Kampala',
        listing_type: 'sale'
      },
      { notes: 'Source says UGX 10m, not POA.' }
    );
  } catch (error) {
    thrown = error;
  } finally {
    db.query = originalQuery;
  }
  assert.ok(thrown);
  assert.equal(thrown.status, 400);
  assert.match(String(thrown.message), /canonical Uganda location/);
  assert.equal(thrown.fields_saved, true);
  assert.equal(thrown.note_saved, true);
  assert.equal(row.title, 'House in an unknown parish');
  assert.equal(row.description, 'Staff-written description of the house.');
  assert.equal(row.price, 10000000);
  assert.match(String(row.moderation_notes), /Source says UGX 10m, not POA/);
  assert.equal(row.area, 'Ntinda');
  assert.ok(updates.some((item) => /\btitle\s*=/.test(item.text) && /\bprice\s*=/.test(item.text)));
  assert.ok(updates.every((item) => !/\barea\s*=/.test(item.text)));
  assert.match(staff, /persistStaffReviewSafeFields/);
  assert.match(staff, /fields_saved: error\.fields_saved === true/);
  assert.match(app, /Title, description, price and the internal note were saved/);
});

test('Akright City maps to Bwebajja and does not keep the Kirinnya or Entebbe pin', () => {
  const place = canonicalizeUgandaLocation('Akright City', 'Wakiso');
  assert.equal(place.name, 'Akright City');
  assert.equal(place.district, 'Wakiso');
  assert.equal(place.town, 'Bwebajja');
  const pin = canonicalLocationPinPoint(place);
  almostEqual(pin.lat, 0.179);
  almostEqual(pin.lng, 32.541);
  assert.ok(Math.abs(pin.lat - 0.3303) > 0.05);
  assert.ok(Math.abs(pin.lng - 32.677) > 0.05);
  assert.equal(isOnUgandaLand(pin.lat, pin.lng), true);
  assert.equal(canonicalizeUgandaLocation('Akright-Bwebajja', 'Wakiso').key, place.key);
  assert.equal(canonicalizeUgandaLocation('Entebbe Road Akright City', 'Wakiso').key, place.key);
  assert.equal(canonicalizeUgandaLocation('Akright', 'Wakiso').key, place.key);

  const centre = areaCentreForUnpinnedListing({ area: 'Akright City', district: 'Wakiso' });
  almostEqual(centre.point.lat, 0.179);
  almostEqual(centre.point.lng, 32.541);

  const kirinnya = canonicalizeUgandaLocation('Kirinnya Akright Estate', 'Wakiso');
  assert.ok(kirinnya);
  assert.notEqual(kirinnya.key, place.key);
  const kirinnyaPin = canonicalLocationPinPoint(kirinnya);
  almostEqual(kirinnyaPin.lat, 0.3303);
  almostEqual(kirinnyaPin.lng, 32.677);
  assert.equal(canonicalizeUgandaLocation('Bujuuko Akright', 'Wakiso').name, 'Bujuuko');

  const patched = normalizeStaffListingPatch(
    { area: 'Entebbe', district: 'Wakiso', extra_fields: { city: 'Entebbe' }, listing_type: 'sale' },
    { area: 'Akright City', district: 'Wakiso' }
  );
  assert.deepEqual(patched.errors, []);
  assert.equal(patched.patch.area, 'Akright City');
  assert.equal(patched.hierarchy.city, 'Bwebajja');
});

test('choosing Akright City in the staff editor sets town Bwebajja and drops a stale Entebbe pin', () => {
  const chooseStart = app.indexOf('function adminReviewChooseCanonicalSuggestion');
  const choose = app.slice(chooseStart, app.indexOf('function adminReviewRenderCanonicalSuggestions', chooseStart));
  assert.match(choose, /preferCanonicalTown:\s*true/);
  const areaStart = app.indexOf('async function adminReviewOnAreaInput');
  const area = app.slice(areaStart, app.indexOf('async function resolveUgandaLocationFromSharedRegistry', areaStart));
  assert.match(area, /preferCanonicalTown:\s*true/);
  const applyStart = app.indexOf('function applyAdminReviewCanonicalLocation');
  const apply = app.slice(applyStart, app.indexOf('function clearLpCanonicalLocationCascade', applyStart));
  assert.match(apply, /preferCanonicalTown/);
  assert.match(apply, /adminReviewDiscardStalePinForCanonicalLocation/);

  const helpersStart = app.indexOf('function adminReviewShouldReplaceStalePin');
  const helpersEnd = app.indexOf('function applyAdminReviewCanonicalLocation', helpersStart);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`
    function adminReviewHasUsableCoordinates(lat, lng) {
      return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && String(lat).trim() !== "" && String(lng).trim() !== "";
    }
    function adminReviewNormalizeCoordinateInputs(latitude, longitude) {
      return { latitude: Number(latitude).toFixed(6), longitude: Number(longitude).toFixed(6), exact: true };
    }
    function haversineKm(lat1, lng1, lat2, lng2) {
      const toRad = (deg) => deg * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(a));
    }
    ${app.slice(helpersStart, helpersEnd)}
    this.replace = adminReviewShouldReplaceStalePin;
  `, context);
  // Entebbe-ish pin versus Bwebajja must be treated as stale.
  assert.equal(context.replace(0.051, 32.463, 0.179, 32.541, 2), true);
  // A pin already at Bwebajja is kept.
  assert.equal(context.replace(0.179, 32.541, 0.179, 32.541, 2), false);
  assert.equal(context.replace(0.180, 32.542, 0.179, 32.541, 2), false);
});
