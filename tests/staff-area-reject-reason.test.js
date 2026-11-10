'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { getDistrictLocationTree, normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function saved(area, district) {
  const canonical = canonicalizeUgandaLocation(area, district);
  const hierarchy = normalizeReviewLocationHierarchy({ area, district });
  return { canonical, hierarchy };
}

test('Wakiso Town, Mukono Town, Entebbe and Jinja City save as areas inside their district', () => {
  const wakisoTown = saved('Wakiso Town', 'Wakiso');
  assert.equal(wakisoTown.canonical.level, 'town');
  assert.equal(wakisoTown.canonical.name, 'Wakiso Town');
  assert.equal(wakisoTown.canonical.district, 'Wakiso');
  assert.equal(wakisoTown.canonical.town, 'Wakiso');
  assert.deepEqual(wakisoTown.hierarchy.errors, []);
  assert.equal(wakisoTown.hierarchy.neighborhood, 'Wakiso Town');

  const bareDistrict = saved('Wakiso', 'Wakiso');
  assert.equal(bareDistrict.canonical.level, 'district');
  assert.ok(bareDistrict.hierarchy.errors.includes('area/neighbourhood must be more specific than a district'));

  const mukonoTown = saved('Mukono Town', 'Mukono');
  assert.equal(mukonoTown.canonical.level, 'town');
  assert.equal(mukonoTown.canonical.district, 'Mukono');
  assert.deepEqual(mukonoTown.hierarchy.errors, []);

  const entebbe = saved('Entebbe', 'Wakiso');
  assert.equal(entebbe.canonical.level, 'city');
  assert.equal(entebbe.canonical.name, 'Entebbe');
  assert.deepEqual(entebbe.hierarchy.errors, []);

  const jinjaCity = saved('Jinja City', 'Jinja');
  assert.equal(jinjaCity.canonical.level, 'city');
  assert.equal(jinjaCity.canonical.district, 'Jinja');
  assert.deepEqual(jinjaCity.hierarchy.errors, []);
  assert.deepEqual(saved('Jinja City', 'Jinja City').hierarchy.errors, []);

  const towns = new Set(getDistrictLocationTree('Wakiso').map((node) => node.city));
  assert.equal(towns.has('Wakiso Town'), false);
  assert.equal(towns.has('Wakiso'), true);
  assert.equal(towns.has('Entebbe'), true);
});

test('Bugema is a Luweero town with a pin beside Bugema University', () => {
  const bugema = canonicalizeUgandaLocation('Bugema', 'Luweero');
  assert.ok(bugema);
  assert.equal(bugema.name, 'Bugema');
  assert.equal(bugema.district, 'Luwero');
  assert.equal(bugema.level, 'town');
  assert.ok(Math.abs(bugema.lat - 0.569722) < 0.0001);
  assert.ok(Math.abs(bugema.lng - 32.641944) < 0.0001);
  const hierarchy = normalizeReviewLocationHierarchy({ area: 'Bugema', district: 'Luwero' });
  assert.deepEqual(hierarchy.errors, []);
  assert.equal(hierarchy.canonical.key, 'luwero:bugema');
  assert.equal(
    normalizeReviewLocationHierarchy({ area: 'Bugema', district: 'Kampala' }).errors
      .includes('area/neighbourhood must match the selected district'),
    true
  );
});

test('the staff listing save accepts Wakiso Town and Bugema', () => {
  const { normalizeStaffListingPatch } = require('../routes/staff')._test;
  const existing = { area: '', district: '', extra_fields: {}, listing_type: 'rent' };
  const wakiso = normalizeStaffListingPatch(existing, { area: 'Wakiso Town', district: 'Wakiso' });
  assert.deepEqual(wakiso.errors, []);
  assert.equal(wakiso.patch.area, 'Wakiso Town');
  assert.equal(wakiso.hierarchy.district, 'Wakiso');

  const bugema = normalizeStaffListingPatch(existing, { area: 'Bugema', district: 'Luwero' });
  assert.deepEqual(bugema.errors, []);
  assert.equal(bugema.patch.area, 'Bugema');
  assert.equal(bugema.patch.district, 'Luwero');

  const bugemaSpelling = normalizeStaffListingPatch(existing, { area: 'Bugema', district: 'Luweero' });
  assert.deepEqual(bugemaSpelling.errors, []);
  assert.equal(bugemaSpelling.patch.district, 'Luwero');

  const jinjaCity = normalizeStaffListingPatch(
    { area: '', district: '', extra_fields: {}, listing_type: 'sale' },
    { area: 'Jinja City', district: 'Jinja City' }
  );
  assert.deepEqual(jinjaCity.errors, []);
  assert.equal(jinjaCity.patch.area, 'Jinja City');
  assert.equal(jinjaCity.patch.district, 'Jinja');

  const districtOnly = normalizeStaffListingPatch(existing, { area: 'Wakiso', district: 'Wakiso' });
  assert.notEqual(districtOnly.patch.area, 'Wakiso');
  assert.ok(
    districtOnly.errors.includes('area/neighbourhood must be more specific than a district')
      || districtOnly.patch.area === ''
  );
});

test('staff reject reasons include no specific area, and the vague-location wording is not Not a property listing', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('const MODERATION_REJECTION_REASON_OPTIONS = [');
  const end = app.indexOf('];', start);
  const block = app.slice(start, end);
  assert.match(block, /no_specific_area/);
  assert.match(block, /No specific area \/ location too vague/);
  assert.doesNotMatch(block, /Not a property listing/);
  assert.match(app, /moderationStructuredReasonControlsHtml\("staff-preview"\)/);
});

test('reject-reason migration backs up the two listings and has a rollback', () => {
  const sql = read('db/migrations/209_reject_reason_no_specific_area.sql');
  const rollback = read('scripts/rollback-209-reject-reason-no-specific-area.sql');
  assert.match(sql, /reject_reason_209_backup/);
  assert.match(sql, /MK-20261109-A9F886/);
  assert.match(sql, /MK-20261110-D126C0/);
  assert.match(sql, /Not a property listing/);
  assert.match(sql, /No specific area \/ location too vague/);
  assert.match(sql, /no_specific_area/);
  assert.match(sql, /property_moderation_events/);
  assert.doesNotMatch(sql, /DELETE FROM properties/i);
  assert.match(rollback, /reject_reason_209_backup/);
  assert.match(rollback, /rolled_back_at/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/i);
});

test('stale found-online migration hides, does not delete, and skips paying agents', () => {
  const sql = read('db/migrations/210_hide_stale_found_online_listings.sql');
  const rollback = read('scripts/rollback-210-hide-stale-found-online-listings.sql');
  assert.match(sql, /stale_source_unpublish_210_backup/);
  assert.match(sql, /status = 'hidden'/);
  assert.match(sql, /INTERVAL '180 days'/);
  assert.match(sql, /found_online_property_source_v1/);
  assert.match(sql, /fee_exempt/);
  assert.match(sql, /paid_until/);
  assert.match(sql, /agent_subscription/);
  assert.match(sql, /source_published_at/);
  assert.doesNotMatch(sql, /DELETE FROM properties/i);
  assert.doesNotMatch(sql, /\b(?:FROM|UPDATE|INSERT INTO) st_listing\b/i);
  assert.match(rollback, /stale_source_unpublish_210_backup/);
  assert.match(rollback, /before_status/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/i);
});
