'use strict';

/**
 * 9 Oct 2026, MK-20261009-1B005F: a moderator uploaded 4 photos with the #377
 * box (consent ticked) and approved the listing, but the public API returned
 * images: [], image: null, primary_image_url: null, because publicPropertyRow()
 * blanked every image on found-online rows. Found-online rows now publish only
 * the consented staff uploads; source media stays hidden.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  foundOnlinePublicImages,
  foundOnlinePrimaryImageUrl,
  consentedStaffPrimaryImageLateralSql
} = require('../utils/foundOnlinePublicImages');
const { publicPropertyRow, compactPublicCardRow } = require('../routes/properties')._test;

const ID = '56ec3ed3-3962-4aa1-aea1-4bf333279083';
const STAFF_1 = `https://media.makaug.com/properties/${ID}/staff-images/staff-photo-1.jpg`;
const STAFF_2 = `https://media.makaug.com/properties/${ID}/staff-images/staff-photo-2.jpg`;
const TIKTOK = 'https://p16-sign-va.tiktokcdn.com/obj/cover.jpeg';
const SOURCE_COPY = `https://media.makaug.com/properties/${ID}/source-cover.jpg`;

const foundOnlineProperty = (extra = {}) => ({
  id: ID,
  title: 'House for rent in Kira',
  description: 'Three bedroom house.',
  listing_type: 'rent',
  property_type: 'house',
  area: 'Kira',
  district: 'Wakiso',
  status: 'approved',
  source: 'social_search',
  listed_via: 'found_online',
  extra_fields: {
    found_online: true,
    source_platform: 'TikTok',
    source_url: 'https://www.tiktok.com/@agent/video/1',
    ...extra
  }
});
const consent = { image_rights_confirmed: true, staff_image_upload: { at: '2026-10-09T17:20:00Z', image_count: 2 } };

const sourceImage = { id: 's1', url: TIKTOK, is_primary: true, sort_order: 0, slot_key: 'source_tiktok_cover', room_label: 'TikTok cover' };
const sourceCopy = { id: 's2', url: SOURCE_COPY, is_primary: false, sort_order: 1, slot_key: 'source_cover', room_label: 'Source cover' };
const staff1 = { id: 'a1', url: STAFF_1, is_primary: false, sort_order: 2, slot_key: 'staff_upload', room_label: 'Property photo' };
const staff2 = { id: 'a2', url: STAFF_2, is_primary: false, sort_order: 3, slot_key: 'staff_upload', room_label: 'Property photo 2' };

test('found online with 2 staff uploads and 1 source image publishes exactly the 2 staff images', () => {
  const row = publicPropertyRow(foundOnlineProperty(consent), [sourceImage, staff1, staff2]);
  assert.deepEqual(row.images.map((image) => image.url), [STAFF_1, STAFF_2]);
  assert.equal(row.images[0].is_primary, true, 'first staff photo is the cover');
  assert.equal(row.images[1].is_primary, false);
  assert.equal(row.primary_image_url, STAFF_1);
  assert.equal(row.image, STAFF_1);
  assert.ok(!JSON.stringify(row.images).includes('tiktokcdn'));
});

test('a source image copied to our media host (source_* slot) still stays hidden', () => {
  const row = publicPropertyRow(foundOnlineProperty(consent), [sourceCopy, staff2]);
  assert.deepEqual(row.images.map((image) => image.url), [STAFF_2]);
});

test('found online with only source images still returns []', () => {
  const row = publicPropertyRow(foundOnlineProperty(consent), [sourceImage, sourceCopy]);
  assert.deepEqual(row.images, []);
  assert.equal(row.primary_image_url, null);
  assert.equal(row.image, null);
});

test('staff_upload rows without the consent record are not published', () => {
  const row = publicPropertyRow(foundOnlineProperty({}), [staff1, staff2]);
  assert.deepEqual(row.images, []);
  assert.equal(row.primary_image_url, null);
});

test('a staff-marked primary keeps first place', () => {
  const images = foundOnlinePublicImages([sourceImage, staff1, { ...staff2, is_primary: true }], consent);
  assert.deepEqual(images.map((image) => image.url), [STAFF_2, STAFF_1]);
  assert.deepEqual(images.map((image) => image.is_primary), [true, false]);
});

test('a private listing is unchanged', () => {
  const property = {
    id: 'aaaaaaaa-0000-4000-8000-0000000000aa',
    title: 'Two bedroom apartment in Ntinda',
    description: 'Owner listing.',
    listing_type: 'rent',
    area: 'Ntinda',
    district: 'Kampala',
    status: 'approved',
    source: 'website',
    listed_via: 'website',
    primary_image_url: 'https://media.makaug.com/properties/x/owner-1.jpg',
    image: 'https://media.makaug.com/properties/x/owner-1.jpg',
    extra_fields: {}
  };
  const images = [
    { id: 'o1', url: 'https://media.makaug.com/properties/x/owner-1.jpg', is_primary: true, sort_order: 0, slot_key: 'living_room' },
    { id: 'o2', url: 'https://media.makaug.com/properties/x/owner-2.jpg', is_primary: false, sort_order: 1, slot_key: 'bedroom' }
  ];
  const row = publicPropertyRow(property, images);
  assert.deepEqual(row.images, images);
  assert.equal(row.primary_image_url, property.primary_image_url);
  assert.equal(row.image, property.image);
});

test('list/card rows use the consented staff primary for found online, never the source cover', () => {
  const base = { ...foundOnlineProperty(consent), admin_extra_fields: foundOnlineProperty(consent).extra_fields };
  const withStaff = compactPublicCardRow({ ...base, primary_image_url: TIKTOK, staff_primary_image_url: STAFF_1 });
  assert.equal(withStaff.primary_image_url, STAFF_1);
  const sourceOnly = compactPublicCardRow({ ...base, primary_image_url: TIKTOK, staff_primary_image_url: null });
  assert.equal(sourceOnly.primary_image_url, null);
  assert.equal(foundOnlinePrimaryImageUrl({ staff_primary_image_url: TIKTOK }), null);
});

test('the list, card and SSR queries all select the consented staff primary', () => {
  const sql = consentedStaffPrimaryImageLateralSql('p');
  assert.match(sql, /si\.slot_key = 'staff_upload'/);
  assert.match(sql, /staff_image_upload/);
  assert.match(sql, /image_rights_confirmed/);
  assert.match(sql, /tiktokcdn\|byteimg/);
  const routes = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
  assert.equal((routes.match(/staff_img\.url AS staff_primary_image_url/g) || []).length, 2, 'both list queries');
  const ssr = fs.readFileSync(path.join(__dirname, '../services/publicSeoRenderService.js'), 'utf8');
  assert.equal((ssr.match(/staff_img\.url AS staff_primary_image_url/g) || []).length, 2, 'listing pages and /property/:id');
  assert.match(ssr, /primary_image_url: foundOnline \? String\(foundOnlinePrimaryImageUrl\(row\)/);
});

test('the SPA shows consented staff photos for found online and keeps source media out', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = app.indexOf('const FOUND_ONLINE_SOURCE_MEDIA_RE');
  const end = app.indexOf('function getPropertyGalleryPhotos');
  assert.ok(start > 0 && end > start);
  // eslint-disable-next-line no-new-func
  const helpers = new Function(`${app.slice(start, end)}; return { foundOnlineConsentedPhotos, foundOnlineConsentedPhotoUrl };`)();
  assert.deepEqual(helpers.foundOnlineConsentedPhotos([sourceImage, sourceCopy, staff1, staff2]).map((image) => image.url), [STAFF_1, STAFF_2]);
  assert.equal(helpers.foundOnlineConsentedPhotoUrl({ images: [], primary_image_url: STAFF_1 }), STAFF_1);
  assert.equal(helpers.foundOnlineConsentedPhotoUrl({ images: [], primary_image_url: TIKTOK }), '');
  assert.equal(helpers.foundOnlineConsentedPhotoUrl({ images: [sourceImage] }), '');
  assert.match(app, /const publicImageItems = thirdPartyDiscovery \? foundOnlineConsentedPhotos\(imageItems\) : imageItems;/);
  assert.match(app, /const thirdPartySourceVisual = thirdPartyDetail && !foundOnlineConsentedPhotoUrl\(p\);/);
  assert.match(app, /const coverUrl = foundOnlineConsentedPhotoUrl\(p\) \|\| foundOnlineSourceThumbnailUrl\(p, sourceUrl\);/);
});
