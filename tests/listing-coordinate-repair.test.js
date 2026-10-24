// Listing pins that are nowhere near the listing's own area get fixed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyListingLocation, correctedPinForNewListing } = require('../services/listingCoordinateRepairService');
const identity = require('../services/agentIdentityStorageService');

test('a Matugga listing pinned at Mulago is moved to Matugga', () => {
  const d = classifyListingLocation({ title: 'Property for sale in Matugga, Wakiso', area: 'Matugga', district: 'Wakiso', latitude: 0.343072, longitude: 32.575536, extra_fields: { canonical_location_id: 'wakiso:matugga' } });
  assert.equal(d.action, 'repin');
  assert.ok(Math.abs(d.to_point.lat - 0.463) < 0.01);
});

test('a pin inside its area is left alone', () => {
  const d = classifyListingLocation({ title: 'House in Ntinda', area: 'Ntinda', district: 'Kampala', latitude: 0.3575, longitude: 32.613, extra_fields: { canonical_location_id: 'kampala:ntinda' } });
  assert.equal(d.action, 'ok');
});

test('the middle-of-Uganda default pin is replaced by the area centre', () => {
  const d = classifyListingLocation({ title: 'Land in Gayaza', area: 'Gayaza', district: 'Wakiso', latitude: 1.3733, longitude: 32.2903, extra_fields: { canonical_location_id: 'wakiso:gayaza' } });
  assert.equal(d.action, 'repin');
});

test('staff-confirmed locations are never changed', () => {
  const d = classifyListingLocation({ title: 'x', area: 'Matugga', district: 'Wakiso', latitude: 0.343, longitude: 32.575, extra_fields: { canonical_location_id: 'wakiso:matugga', coords_fix: { reviewed_ok: true } } });
  assert.equal(d.action, 'ok');
});

test('a new website listing with a far-off pin is corrected before saving', () => {
  const fix = correctedPinForNewListing({ title: 'Plot in Matugga', area: 'Matugga', district: 'Wakiso', latitude: 1.3733, longitude: 32.2903, extra_fields: { canonical_location_id: 'wakiso:matugga' } });
  assert.ok(fix && fix.coords_fix.action === 'repin');
  assert.equal(correctedPinForNewListing({ title: 'Plot in Matugga', area: 'Matugga', district: 'Wakiso', latitude: 0.462, longitude: 32.526, extra_fields: { canonical_location_id: 'wakiso:matugga' } }), null);
});

test('agent ID photos: lists show a marker, never the image itself', () => {
  assert.equal(identity.identityListMarker('data:image/jpeg;base64,AAAA'), 'inline');
  assert.equal(identity.identityListMarker('s3://bucket/key.jpg'), 'private');
  assert.equal(identity.identityListMarker(''), '');
  assert.equal(identity.isInlineImage('data:application/pdf;base64,AAAA'), true);
});

test('a listing pinned only at its district centre is marked as district-level', () => {
  const d = classifyListingLocation({ title: 'House for rent', area: '', district: 'Kampala', latitude: 0.3476, longitude: 32.5825, extra_fields: {} });
  assert.equal(d.action, 'ok');
  assert.equal(d.precision, 'district');
});

test('a lake pin with a flipped latitude that lands on shore is corrected by the sign flip', () => {
  const d = classifyListingLocation({ title: 'Land in Buvuma', area: '', district: '', latitude: -0.376491, longitude: 33.258793, extra_fields: {} });
  assert.equal(d.action, 'repin');
  assert.equal(d.reason, 'flipped_latitude');
  assert.ok(Math.abs(d.to_point.lat - 0.376491) < 1e-6);
});

test('a Kigo pin saved in the lake moves to the Kigo village centre', () => {
  const d = classifyListingLocation({ title: 'Land in Kigo', area: 'Kigo', district: 'Wakiso', latitude: 0.196, longitude: 32.615, extra_fields: { canonical_location_id: 'wakiso:kigo' } });
  assert.equal(d.action, 'repin');
  assert.equal(d.reason, 'off_uganda_land');
  assert.equal(d.to_point.lat, 0.2052);
  assert.equal(d.to_point.lng, 32.5967);
});

test('a new listing with no coordinates gets the area centre when the registry has one', () => {
  const fix = correctedPinForNewListing({ title: 'Plot in Kigo', area: 'Kigo', district: 'Wakiso', latitude: null, longitude: null, extra_fields: { canonical_location_id: 'wakiso:kigo' } });
  assert.equal(fix.latitude, 0.2052);
  assert.equal(fix.longitude, 32.5967);
  assert.equal(fix.coords_fix.reason, 'missing_pin');
  assert.equal(correctedPinForNewListing({ title: 'Plot', area: '', district: 'Wakiso', latitude: null, longitude: null, extra_fields: {} }), null);
});

test('greater Kampala rejects an area pin more than 5 km from its centre', () => {
  const near = classifyListingLocation({ title: 'House in Ntinda', area: 'Ntinda', district: 'Kampala', latitude: 0.357, longitude: 32.648, extra_fields: { canonical_location_id: 'kampala:ntinda' } });
  const far = classifyListingLocation({ title: 'House in Ntinda', area: 'Ntinda', district: 'Kampala', latitude: 0.357, longitude: 32.67, extra_fields: { canonical_location_id: 'kampala:ntinda' } });
  assert.equal(near.action, 'ok');
  assert.equal(far.action, 'repin');
});
