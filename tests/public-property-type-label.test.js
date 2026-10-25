'use strict';

// PR #549 follow-up: migration 179 stores the code 'land' for ee920882, and
// the shared label helper returns single-word codes unchanged, so the public
// API showed "land". The public rows now start with a capital letter.

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../routes/properties');
const { humanPropertyTypeLabel } = require('../utils/commercialClassification');

test('public property type label capitalises stored single-word codes', () => {
  const label = _test.publicPropertyTypeLabel;
  assert.equal(label('land'), 'Land');
  assert.equal(label('house'), 'House');
  assert.equal(label('Land'), 'Land');
  assert.equal(label('commercial_land'), 'Commercial land');
  assert.equal(label('shop_retail'), 'Shop / retail space');
  assert.equal(label('boys_quarters'), 'Boys quarters');
  assert.equal(label(''), '');
  assert.equal(label(null), null);
  // The shared helper is unchanged; only the public rows capitalise.
  assert.equal(humanPropertyTypeLabel('land'), 'land');
});

const namuseera = {
  id: 'ee920882-bd61-4f1d-9156-75f45851edf9',
  title: 'Land for sale in Namuseera, Wakiso',
  description: 'Plot in Namuseera Estate.',
  property_type: 'land',
  listing_type: 'land',
  transaction_type: 'sale',
  status: 'approved',
  area: 'Namuseera',
  district: 'Wakiso',
  extra_fields: {
    canonical_location_id: 'wakiso:wakiso',
    canonical_location_level: 'district',
    neighborhood: 'Namuseera',
    resolved_location_label: 'Namuseera, Wakiso'
  }
};

test('detail and card rows show Land for the Namuseera listing after 179', () => {
  assert.equal(_test.publicPropertyRow(namuseera, []).property_type, 'Land');
  assert.equal(_test.compactPublicCardRow(namuseera).property_type, 'Land');
});

test('server-rendered property page title reads "Land for Sale" for the Namuseera listing after 179', () => {
  const { normalizeSeoListingRow, propertySeoTitle } = require('../services/publicSeoRenderService');
  const seoRow = normalizeSeoListingRow({ ...namuseera, price: 30000000, price_currency: 'UGX', price_period: 'once' });
  assert.equal(seoRow.property_type, 'Land');
  assert.match(propertySeoTitle(seoRow), /^Land for Sale in Namuseera, Wakiso/);
});
