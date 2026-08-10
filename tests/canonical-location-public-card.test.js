#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { _test } = require('../routes/properties');

const kira = _test.compactPublicCardRow({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Raw location must not win',
  description: 'Canonical display contract',
  status: 'approved',
  area: 'Kampala',
  district: 'Wakiso',
  extra_fields: {
    canonical_location_id: 'wakiso:kira',
    canonical_location_level: 'city'
  }
});

assert.equal(kira.area, 'Kira');
assert.equal(kira.district, 'Wakiso');
assert.equal(kira.canonical_location_id, 'wakiso:kira');
assert.equal(kira.canonical_location_level, 'city');

const districtOnly = _test.compactPublicCardRow({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'District-only listing',
  description: 'No district chip may leak into area display',
  status: 'approved',
  area: 'Kampala',
  district: 'Kampala',
  extra_fields: {
    canonical_location_id: 'kampala:kampala',
    canonical_location_level: 'district'
  }
});

assert.equal(districtOnly.area, null);
assert.equal(districtOnly.district, 'Kampala');
assert.equal(districtOnly.canonical_location_level, 'district');

const detail = _test.publicPropertyRow({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Raw location must not win on detail',
  description: 'Canonical detail contract',
  area: 'Kampala',
  district: 'Wakiso',
  extra_fields: {
    canonical_location_id: 'wakiso:kira',
    canonical_location_level: 'city'
  }
});

assert.equal(detail.area, 'Kira');
assert.equal(detail.district, 'Wakiso');
assert.equal(detail.canonical_location_id, 'wakiso:kira');
assert.equal(detail.canonical_location_level, 'city');

console.log('canonical location public card tests passed');
