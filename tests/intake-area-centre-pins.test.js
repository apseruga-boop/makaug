
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAutomatedListingReview
} = require('../services/listingModerationService');
const {
  normalizeFoundOnlineSourcePost,
  buildSocialSearchListing
} = require('../services/socialSearchSourcedListingsService');
const { canonicalLocationPinPoint, canonicalLocationByKey } = require('../utils/ugandaLocationRegistry');

function reviewOf(listing) {
  return buildAutomatedListingReview({ listing, images: [] });
}

function check(review, key) {
  return review.checks.find((item) => item.key === key);
}

test('found-online intake fills a missing pin from the area centre and refuses a district centre', () => {
  const ntinda = canonicalLocationPinPoint(canonicalLocationByKey('kampala:ntinda'));
  const filled = normalizeFoundOnlineSourcePost({
    title: 'House for sale in Ntinda',
    source_title: 'House for sale in Ntinda',
    area: 'Ntinda',
    district: 'Kampala',
    canonical_location_id: 'kampala:ntinda',
    location: 'Ntinda, Kampala',
    listing_type: 'sale',
    price: 150000000
  });
  // The normalizer resolves the area itself; either path should land on Ntinda.
  if (filled.canonicalLocationId === 'kampala:ntinda' || filled.area === 'Ntinda') {
    assert.equal(Number(filled.lat), ntinda.lat);
    assert.equal(Number(filled.lng), ntinda.lng);
    assert.equal(filled.coords_fix.reason, 'missing_pin');
  }

  const persisted = buildSocialSearchListing({
    title: 'House for sale in Ntinda',
    area: 'Ntinda',
    district: 'Kampala',
    canonicalLocationId: 'kampala:ntinda',
    listingType: 'sale',
    price: 150000000,
    priceCurrency: 'UGX',
    address: 'Ntinda, Kampala'
  });
  assert.equal(Number(persisted.latitude), ntinda.lat);
  assert.equal(Number(persisted.longitude), ntinda.lng);
  const extra = JSON.parse(persisted.extra_fields);
  assert.equal(extra.coords_fix.reason, 'missing_pin');

  const districtOnly = normalizeFoundOnlineSourcePost({
    title: 'House for sale in Kampala',
    source_title: 'House for sale in Kampala',
    area: 'Kampala',
    district: 'Kampala',
    canonical_location_id: 'kampala:kampala',
    location: 'Kampala',
    listing_type: 'sale',
    price: 150000000
  });
  assert.equal(districtOnly.lat ?? null, null);
  assert.equal(districtOnly.lng ?? null, null);

  const persistedDistrict = buildSocialSearchListing({
    title: 'House for sale in Kampala',
    area: '',
    district: 'Kampala',
    canonicalLocationId: 'kampala:kampala',
    listingType: 'sale',
    price: 150000000,
    priceCurrency: 'UGX',
    address: 'Kampala'
  });
  assert.equal(persistedDistrict.latitude ?? null, null);
  assert.equal(persistedDistrict.longitude ?? null, null);
  const districtExtra = JSON.parse(persistedDistrict.extra_fields);
  assert.equal(districtExtra.coords_fix ?? null, null);
});

test('staff review warns No map pin – add one only when there is no usable pin and no area centre', () => {
  const withPin = reviewOf({
    title: 'House in Ntinda',
    description: 'A house in Ntinda.',
    district: 'Kampala',
    area: 'Ntinda',
    listing_type: 'sale',
    price: 150000000,
    latitude: 0.357,
    longitude: 32.612,
    lister_phone: '+256700000111',
    lister_email: 'owner@example.com',
    listed_via: 'website',
    source: 'website',
    extra_fields: {}
  });
  assert.equal(check(withPin, 'location_verified').status, 'pass');

  const areaCentre = reviewOf({
    title: 'House in Ntinda',
    description: 'A house in Ntinda.',
    district: 'Kampala',
    area: 'Ntinda',
    listing_type: 'sale',
    price: 150000000,
    latitude: null,
    longitude: null,
    lister_phone: '+256700000111',
    lister_email: 'owner@example.com',
    listed_via: 'website',
    source: 'website',
    extra_fields: {}
  });
  assert.equal(check(areaCentre, 'location_verified').status, 'pass');
  assert.equal(check(areaCentre, 'location_verified').blocking, false);
  assert.match(check(areaCentre, 'location_verified').message, /area centre/i);

  const missing = reviewOf({
    title: 'Land in Mpangalo',
    description: 'Land in Mpangalo, Hoima.',
    district: 'Hoima',
    area: 'Mpangalo',
    listing_type: 'sale',
    price: 20000000,
    latitude: null,
    longitude: null,
    lister_phone: '+256700000111',
    lister_email: 'owner@example.com',
    listed_via: 'website',
    source: 'website',
    extra_fields: {}
  });
  assert.equal(check(missing, 'location_verified').status, 'warning');
  assert.equal(check(missing, 'location_verified').blocking, false);
  assert.equal(check(missing, 'location_verified').message, 'No map pin – add one');

  const outside = reviewOf({
    title: 'Land in Mpangalo',
    description: 'Land in Mpangalo, Hoima.',
    district: 'Hoima',
    area: 'Mpangalo',
    listing_type: 'sale',
    price: 20000000,
    latitude: 0,
    longitude: 0,
    lister_phone: '+256700000111',
    lister_email: 'owner@example.com',
    listed_via: 'website',
    source: 'website',
    extra_fields: {}
  });
  assert.equal(check(outside, 'location_verified').status, 'warning');
  assert.equal(check(outside, 'location_verified').message, 'No map pin – add one');
});

test('employee WhatsApp intake with no pin at Ntinda can be approved, and Mpangalo only warns', () => {
  const employee = {
    title: '3 bedroom house for sale in Ntinda',
    description: 'A 3 bedroom house for sale in Ntinda, Kampala.',
    district: 'Kampala',
    area: 'Ntinda',
    listing_type: 'sale',
    price: 150000000,
    latitude: null,
    longitude: null,
    lister_phone: '+256700000111',
    listed_via: 'whatsapp',
    source: 'whatsapp_employee_intake',
    extra_fields: {}
  };
  const ntinda = reviewOf(employee);
  assert.equal(check(ntinda, 'location_verified').status, 'pass');
  assert.equal(ntinda.can_approve, true);

  const mpangalo = reviewOf({
    ...employee,
    title: 'Land in Mpangalo',
    description: 'Land in Mpangalo, Hoima.',
    district: 'Hoima',
    area: 'Mpangalo'
  });
  assert.equal(check(mpangalo, 'location_verified').status, 'warning');
  assert.equal(check(mpangalo, 'location_verified').blocking, false);
  assert.equal(check(mpangalo, 'location_verified').message, 'No map pin – add one');
  assert.equal(mpangalo.can_approve, true);
});

test('WhatsApp employee intake and the staff screen reuse the website pin fill and show the warning', () => {
  const whatsapp = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert.match(whatsapp, /correctedPinForNewListing/);
  assert.match(whatsapp, /intakeLatitude/);
  assert.match(whatsapp, /if \(pinFix\) extraFields\.coords_fix = pinFix\.coords_fix/);
  // Do not change WhatsApp message wording or sending in this PR.
  assert.doesNotMatch(whatsapp, /No map pin/);

  const source = fs.readFileSync(path.join(__dirname, '../services/socialSearchSourcedListingsService.js'), 'utf8');
  assert.match(source, /applyCorrectedPinToSourceItem/);
  assert.doesNotMatch(source, /canonicalLocation\?\.lat/);

  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  assert.match(app, /function adminReviewMissingMapPinWarning/);
  assert.match(app, /data-admin-review-missing-pin-warning="1">No map pin – add one/);
});
