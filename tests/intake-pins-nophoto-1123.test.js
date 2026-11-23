'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { areaCentreForUnpinnedListing, correctedPinForNewListing, autoPinForApproval } = require('../services/listingCoordinateRepairService');
const { buildAutomatedListingReview } = require('../services/listingModerationService');
const { ownPropertyPhotoCount, isOwnPropertyPhoto, FOUND_ONLINE_REAL_PHOTO_CHECK_KEY } = require('../utils/realListingPhoto');

const migration = (name) => fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', name), 'utf8');

test('WhatsApp intake areas that went live with no pin now have an area centre', () => {
  for (const [area, district] of [['Butalangu', 'Nakaseke'], ['Miseebe', 'Mityana'], ['Kikandwa', 'Mityana'], ['Maganjo', 'Wakiso'], ['Myanzi', 'Kassanda'], ['Kissasi', 'Kampala']]) {
    const found = areaCentreForUnpinnedListing({ area, district });
    assert.ok(found, `${area}, ${district} has a centre`);
    assert.equal(found.entry.district, district);
    const pin = correctedPinForNewListing({ title: `Land for sale in ${area}`, area, district });
    assert.ok(pin && Number.isFinite(pin.latitude), `${area} intake gets a pin`);
    assert.ok(autoPinForApproval({ area, district }), `${area} approval gets a pin`);
  }
});

test('places with a wrong stored district are still not guessed', () => {
  assert.equal(areaCentreForUnpinnedListing({ area: 'Kawoko', district: 'Bukomansimbi' }), null);
  assert.equal(areaCentreForUnpinnedListing({ area: 'Kito', district: 'Lwengo' }), null);
  assert.equal(areaCentreForUnpinnedListing({ area: 'Wakiso', district: 'Wakiso' }), null);
  assert.equal(areaCentreForUnpinnedListing({ area: '', district: '' }), null);
});

test('source-post images are not real photos of the property', () => {
  const media = 'https://media.makaug.com';
  assert.equal(isOwnPropertyPhoto({ url: `${media}/properties/x/staff-images/1.jpg` }), true);
  assert.equal(isOwnPropertyPhoto({ url: `${media}/source-previews/tiktok/1.jpg` }), false);
  assert.equal(isOwnPropertyPhoto({ url: `${media}/staff-video-cover/youtube/a/cover.jpg` }), false);
  assert.equal(isOwnPropertyPhoto({ url: `${media}/properties/x/a.jpg`, slot_key: 'harvest_cover_frame' }), false);
  assert.equal(isOwnPropertyPhoto({ url: `${media}/properties/x/a.jpg`, slot_key: 'video_key_frame_1' }), false);
  assert.equal(isOwnPropertyPhoto({ url: 'https://i.ytimg.com/vi/abc/default.jpg' }), false);
  assert.equal(isOwnPropertyPhoto({ url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg' }), false);
  assert.equal(ownPropertyPhotoCount([]), 0);
});

test('found-online with no real photo: an overrideable approval block, others unaffected', () => {
  const base = { id: 'x', title: 'Rental in Bukoto', description: 'd', district: 'Kampala', area: 'Bukoto', listing_type: 'rent', price: 500000 };
  const video = { ...base, source: 'found_online_property_source_v1', extra_fields: { tiktok_url: 'https://www.tiktok.com/@a/video/1' } };
  const review = buildAutomatedListingReview({ listing: video, images: [{ url: 'https://media.makaug.com/source-previews/tiktok/1.jpg' }] });
  const check = review.checks.find((item) => item.key === FOUND_ONLINE_REAL_PHOTO_CHECK_KEY);
  assert.equal(check.status, 'fail');
  assert.equal(check.overrideable, true);
  assert.ok(review.warnings.some((item) => item.key === FOUND_ONLINE_REAL_PHOTO_CHECK_KEY), 'listed with the approval warnings to override');
  assert.ok(!review.blocking_failures.some((item) => item.key === FOUND_ONLINE_REAL_PHOTO_CHECK_KEY));

  const withPhoto = buildAutomatedListingReview({ listing: video, images: [{ url: 'https://media.makaug.com/properties/x/staff-images/1.jpg' }] });
  assert.equal(withPhoto.checks.find((item) => item.key === FOUND_ONLINE_REAL_PHOTO_CHECK_KEY).status, 'pass');

  const website = buildAutomatedListingReview({ listing: { ...base, source: 'website' }, images: [] });
  assert.equal(website.checks.find((item) => item.key === FOUND_ONLINE_REAL_PHOTO_CHECK_KEY).status, 'pass');
  // previous_lister_checked is unchanged: still a non-blocking warning.
  assert.equal(website.checks.find((item) => item.key === 'previous_lister_checked').blocking, false);
});

test('approve routes enforce the found-online photo block with a named override', () => {
  const props = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  assert.match(props, /isFoundOnlineListing\(current\) && !warningOverrides\[FOUND_ONLINE_REAL_PHOTO_CHECK_KEY\]/);
  const staff = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
  assert.match(staff, /reason: FOUND_ONLINE_REAL_PHOTO_CHECK_KEY/);
  assert.match(staff, /autoPinForApproval\(\{/);
});

test('migrations 253 and 254 back up first, roll back, and delete nothing', () => {
  const pins = migration('253_pin_intake_areas_without_centre.sql');
  assert.match(pins, /CREATE TABLE IF NOT EXISTS auto_pin_253_backup/);
  assert.match(pins, /-- Rollback/);
  for (const id of ['1cb2e4d0', '89ab7b1e', '869be006', '05ee3bed', 'a783de4e', '13a3a362']) assert.ok(pins.includes(`'${id}-`), id);
  assert.ok(!pins.includes("'74fd7985-"), 'Nakasajja has no area and is left for Fisher');
  assert.equal((pins.match(/::uuid, -?\d/g) || []).length, 18);
  const held = migration('254_found_online_no_real_photo_to_pending.sql');
  assert.match(held, /CREATE TABLE IF NOT EXISTS found_online_no_photo_254_backup/);
  assert.match(held, /-- Rollback/);
  assert.match(held, /SET status = 'pending'/);
  for (const sql of [pins, held]) assert.doesNotMatch(sql, /\bDELETE\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
});
