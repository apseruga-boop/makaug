'use strict';

// 27 Oct 2026: MK-20261026-3F73F8 and MK-20261026-B9466B (Kisowera, Mukono)
// could not be saved: "area/neighbourhood must match a canonical Uganda
// location". Kisowera is a village in Nama sub-county, Mukono District.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');

test('Kisowera resolves to Mukono District', () => {
  const hit = canonicalizeUgandaLocation('Kisowera');
  assert.ok(hit, 'Kisowera should be a known place');
  assert.equal(hit.district, 'Mukono');
  assert.equal(hit.town, 'Mukono');
});

test('a staff save with Kisowera under Mukono town has no location errors', () => {
  for (const city of ['Mukono', 'Nama']) {
    const result = normalizeReviewLocationHierarchy({
      area: 'Kisowera', district: 'Mukono', city, neighborhood: 'Kisowera'
    });
    assert.deepEqual(result.errors, [], `town ${city}: ${result.errors.join('; ')}`);
  }
});

test('Kisowera under a different district is still refused', () => {
  const result = normalizeReviewLocationHierarchy({
    area: 'Kisowera', district: 'Wakiso', city: 'Wakiso', neighborhood: 'Kisowera'
  });
  assert.ok(result.errors.length > 0);
});
