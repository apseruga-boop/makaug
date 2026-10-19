'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return app.slice(start, end);
}

function loadFns(markers) {
  const context = { DISTRICTS: ['Wakiso', 'Kampala', 'Mukono'] };
  vm.createContext(context);
  vm.runInContext(markers.map(([start, end]) => slice(start, end)).join('\n'), context);
  return context;
}

const editor = loadFns([
  ['function adminReviewExtraFields', 'function adminReviewRegionOptionsHtml'],
  ['function adminReviewPlaceEqualsDistrict', 'function adminReviewCityBelongsToDistrict'],
  ['function extraFieldsForListing', 'function firstValidListingDate'],
  ['function isFoundOnlineListing', 'function shouldUseSourceOnlyContact'],
  ['function adminReviewTownOnlyLocationNote', 'function adminReviewClearCanonicalSuggestions'],
  ['function staffBrokerQueueResolution', 'function staffPanelRetryEndpoint']
]);

test('a saved found-online town with a valid district and no canonical id is a soft note', () => {
  const note = editor.adminReviewTownOnlyLocationNote({
    source: 'found_online_property_source_v1',
    district: 'Wakiso',
    canonical_location_id: '',
    extra_fields: { city: 'Kira', found_online: true, location_resolution_status: 'unresolved' }
  });
  assert.match(note, /Town saved as Kira, Wakiso/);
  assert.match(note, /does not block the save/);
  assert.doesNotMatch(note, /Location not recognised/);
  assert.doesNotMatch(note, /Choose an exact Uganda area/);
});

test('a canonical area, a district-named town, and a non-found-online row do not get the soft note', () => {
  assert.equal(editor.adminReviewTownOnlyLocationNote({
    source: 'found_online_property_source_v1',
    district: 'Wakiso',
    canonical_location_id: 'ug-kira-najjera',
    extra_fields: { city: 'Kira', found_online: true }
  }), '');
  assert.equal(editor.adminReviewTownOnlyLocationNote({
    source: 'found_online_property_source_v1',
    district: 'Wakiso',
    extra_fields: { city: 'Wakiso', found_online: true }
  }), '');
  assert.equal(editor.adminReviewTownOnlyLocationNote({
    source: 'website',
    district: 'Wakiso',
    extra_fields: { city: 'Kira' }
  }), '');
});

test('the staff editor shows the soft note before the hard unrecognised warning', () => {
  const auto = slice('async function adminReviewAutoPopulateLocationFromSource', 'function adminLocationReclassificationReviewHtml');
  const noteAt = auto.indexOf('adminReviewTownOnlyLocationNote');
  const hardAt = auto.indexOf('Location not recognised — pin set but region/district/area could NOT be auto-filled.');
  assert.ok(noteAt >= 0 && hardAt > noteAt);
  assert.match(auto, /if \(townNote\) \{\s*adminReviewSetAddressSearchStatus\(townNote, "slate"\);\s*return;/);
  assert.match(app, /data-staff-town-note=/);
  assert.match(app, /Town saved as \$\{city\}, \$\{district\}/);
});

test('the hierarchy pin is labelled as not saved and the save still reads the Lat/Lng fields', () => {
  const sync = slice('function adminReviewSyncLocationMapFromInputs', 'function reviewMarkerPoint');
  assert.match(sync, /Closest hierarchy pin — not saved\. Lat\/Lng stay empty until you press Use current pin\./);
  assert.doesNotMatch(sync, /adminReviewSetLocationInputs/);
  const collect = slice('function collectAdminReviewListingPatch', 'function adminReviewHumanLocationConfirmation');
  assert.match(collect, /latitude: coordinates\.latitude/);
  assert.match(collect, /longitude: coordinates\.longitude/);
  assert.doesNotMatch(collect, /reviewMarkerPoint|resolveHierarchyMapAnchor/);
  assert.match(app, /The pin follows the town as a guide and is not saved/);
});

test('an empty successful broker scan with a positive count loads the broker segment instead of retrying forever', () => {
  assert.equal(editor.staffBrokerQueueResolution([], {
    query_ok: true,
    expected_count: 9
  }, 0, 4), 'load_broker_segment');
  assert.equal(editor.staffBrokerQueueResolution([{ id: 'broker-1' }], {
    query_ok: true,
    expected_count: 9
  }, 0, 4), 'rows');
  assert.equal(editor.staffBrokerQueueResolution([], {
    query_ok: true,
    expected_count: 0,
    broker_segment_loaded: true
  }, 0, 4), 'empty');
});

test('a broker queue that keeps failing stops on an error instead of the catching-up sentence', () => {
  assert.equal(editor.staffBrokerQueueResolution([], {
    query_ok: false,
    timed_out: true,
    query_error: '57014',
    expected_count: 4
  }, 1, 4), 'retry');
  assert.equal(editor.staffBrokerQueueResolution([], {
    query_ok: false,
    timed_out: true,
    query_error: '57014',
    expected_count: 4
  }, 4, 4), 'error');
  const render = slice('function renderStaffBrokerReviewQueue', 'let staffBrokerSegmentLoad');
  assert.match(render, /resolution === "error"/);
  assert.match(render, /staffReviewQueueErrorHtml/);
  assert.match(render, /staffLoadBrokerReviewSegment\(\)/);
  assert.doesNotMatch(render, /scheduleStaffDashboardPanelRetry\("broker queue"\)[\s\S]*resolution === "load_broker_segment"/);
  assert.match(app, /data-staff-queue-error="1"/);
  assert.match(app, /Broker review queue/);
});
