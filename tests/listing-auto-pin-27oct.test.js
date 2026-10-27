// 27 Oct 2026: live listings with no map pin get the centre of their own area
// (on approval, and once for the ~760 already live). Never from a
// district-only or blank area.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  areaCentreForUnpinnedListing,
  autoPinForApproval,
  correctedPinForNewListing,
  pinUnpinnedListings,
  rollbackAutoPinnedListings
} = require('../services/listingCoordinateRepairService');

test('a canonical area id gives that area centre', () => {
  const found = areaCentreForUnpinnedListing({ area: 'Kyanja', district: 'Kampala', extra_fields: { canonical_location_id: 'kampala:kyanja' } });
  assert.equal(found.entry.key, 'kampala:kyanja');
  assert.deepEqual(found.point, { lat: 0.384, lng: 32.596 });
});

test('with no canonical id, the area name is looked up inside its district', () => {
  const found = areaCentreForUnpinnedListing({ area: 'Matugga', district: 'Wakiso', extra_fields: {} });
  assert.equal(found.entry.key, 'wakiso:matugga');
  assert.ok(Math.abs(found.point.lat - 0.463) < 0.01);
});

test('areas whose only point is the OpenStreetMap centre from PR #593 are pinned there', () => {
  const found = areaCentreForUnpinnedListing({ area: 'Kulambiro', district: 'Kampala', extra_fields: {} });
  assert.equal(found.entry.key, 'kampala:kulambiro');
  assert.deepEqual(found.point, { lat: 0.3744, lng: 32.6089 });
});

test('district-only, blank or other-district areas are never pinned', () => {
  assert.equal(areaCentreForUnpinnedListing({ area: 'Wakiso', district: 'Wakiso', extra_fields: {} }), null);
  assert.equal(areaCentreForUnpinnedListing({ area: '', district: 'Kampala', extra_fields: {} }), null);
  assert.equal(areaCentreForUnpinnedListing({ area: '', district: '', extra_fields: {} }), null);
  assert.equal(areaCentreForUnpinnedListing({ area: '', district: 'Wakiso', extra_fields: { canonical_location_id: 'wakiso:wakiso' } }), null);
  // Mutungo exists in Kampala and Wakiso: a Kampala listing gets the Kampala one.
  assert.equal(areaCentreForUnpinnedListing({ area: 'Mutungo', district: 'Kampala', extra_fields: {} }).entry.district, 'Kampala');
  // A canonical id in another district than the one stored is not trusted.
  assert.equal(areaCentreForUnpinnedListing({ area: 'Kyanja', district: 'Wakiso', extra_fields: { canonical_location_id: 'kampala:kyanja' } }), null);
});

test('a website listing saved with no pin also uses the area name and PR #593 centres', () => {
  const fix = correctedPinForNewListing({ title: 'House', area: 'Kulambiro', district: 'Kampala', extra_fields: {} });
  assert.equal(fix.latitude, 0.3744);
  assert.equal(fix.coords_fix.reason, 'missing_pin');
  assert.equal(correctedPinForNewListing({ title: 'House', area: '', district: 'Kampala', extra_fields: {} }), null);
});

test('approval pins an unpinned listing as approximate, area level, and keeps the previous state', () => {
  const pin = autoPinForApproval({ area: 'Kireka', district: 'Wakiso', extra_fields: { location_precision: 'district' }, by: 'staff-1' });
  assert.ok(pin);
  assert.equal(pin.extra_fields_patch.location_precision, 'area');
  assert.equal(pin.extra_fields_patch.auto_pinned, true);
  assert.match(pin.extra_fields_patch.auto_pin_note, /Approximate, not the exact address/);
  assert.equal(pin.extra_fields_patch.coords_fix.action, 'auto_pin');
  assert.equal(pin.extra_fields_patch.coords_fix.previous.latitude, null);
  assert.equal(pin.extra_fields_patch.coords_fix.previous.location_precision, 'district');
  assert.deepEqual(pin.extra_fields_patch.coords_fix.to_point, { lat: pin.latitude, lng: pin.longitude });
});

test('approval never moves an existing pin', () => {
  assert.equal(autoPinForApproval({ area: 'Kireka', district: 'Wakiso', latitude: 0.35, longitude: 32.65 }), null);
  assert.equal(autoPinForApproval({ area: 'Kireka', district: 'Wakiso', latitude: 0, longitude: 0 }), null);
});

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT id, source/.test(sql)) return { rows: params[1] ? [] : rows };
      if (/^\s*UPDATE properties/.test(sql)) return { rowCount: 1, rows: [] };
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 3 }] };
      return { rows: [] };
    }
  };
}

const ROWS = [
  { id: '00000000-0000-0000-0000-000000000001', source: 'whatsapp_employee_intake', area: 'Kyanja', district: 'Kampala', extra_fields: { canonical_location_id: 'kampala:kyanja' } },
  { id: '00000000-0000-0000-0000-000000000002', source: 'whatsapp_employee_intake', area: 'Wakiso', district: 'Wakiso', extra_fields: {} },
  { id: '00000000-0000-0000-0000-000000000003', source: 'found_online_property_source_v1', area: 'Kulambiro', district: 'Kampala', extra_fields: {} },
  { id: '00000000-0000-0000-0000-000000000004', source: 'found_online_property_source_v1', area: '', district: '', extra_fields: {} }
];

test('the one-off run is a dry run unless apply is set', async () => {
  const db = fakeDb(ROWS);
  const summary = await pinUnpinnedListings(db, { batch: 'b1', logger: null });
  assert.equal(summary.checked, 4);
  assert.equal(summary.pinnable, 2);
  assert.equal(summary.skipped.district_only_or_blank, 2);
  assert.equal(summary.applied, 0);
  assert.deepEqual(summary.by_source.whatsapp_employee_intake, { unpinned: 2, pinnable: 1 });
  assert.equal(db.calls.filter((c) => /UPDATE/.test(c.sql)).length, 0);
});

test('applying writes only still-unpinned rows and stamps the batch for undo', async () => {
  const db = fakeDb(ROWS);
  const summary = await pinUnpinnedListings(db, { apply: true, batch: 'b1', actor: 'staff-1', logger: null });
  assert.equal(summary.applied, 2);
  const updates = db.calls.filter((c) => /UPDATE/.test(c.sql));
  assert.equal(updates.length, 2);
  assert.match(updates[0].sql, /latitude IS NULL AND longitude IS NULL/);
  const patch = JSON.parse(updates[0].params[3]);
  assert.equal(patch.coords_fix.batch, 'b1');
  assert.equal(patch.location_precision, 'area');
});

test('rollback needs a batch, counts on a dry run, and only undoes pins still where the batch put them', async () => {
  await assert.rejects(() => rollbackAutoPinnedListings(fakeDb([]), {}), /batch is required/);
  const dry = await rollbackAutoPinnedListings(fakeDb([]), { batch: 'b1' });
  assert.equal(dry.matching, 3);
  const db = fakeDb([]);
  const done = await rollbackAutoPinnedListings(db, { batch: 'b1', apply: true });
  assert.equal(done.reverted, 1);
  const sql = db.calls[0].sql;
  assert.match(sql, /SET latitude = NULL, longitude = NULL/);
  assert.match(sql, /to_point'->>'lat'/);
  assert.match(sql, /'auto_pin'/);
});

test('the approval route and the admin maintenance endpoint are wired to the auto-pin', () => {
  const properties = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  const status = properties.slice(properties.indexOf("router.patch('/:id/status'"));
  assert.match(status.slice(0, status.indexOf('\nrouter.')), /autoPinForApproval\(/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.match(admin, /mode === 'pin_unpinned'/);
  assert.match(admin, /rollbackAutoPinnedListings/);
});
