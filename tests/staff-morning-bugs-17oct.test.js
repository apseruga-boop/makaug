'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getDistrictLocationTree } = require('../utils/ugandaLocationHierarchy');
const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { normalizeSeoListingRow, seoCoverImageUrl, renderPropertySeoHtml } = require('../services/publicSeoRenderService');
const {
  normalizeStaffListingPatch,
  staffLocationWarnings,
  staffLocationSoftWarnings,
  stripRoadNamePhrases
} = require('../routes/staff')._test;

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Kajjansi stays the town and Kitende stays under it after a staff save', () => {
  const kajjansi = canonicalizeUgandaLocation('Kajjansi', 'Wakiso');
  const kitende = canonicalizeUgandaLocation('Kitende', 'Wakiso');
  assert.equal(kajjansi.level, 'town');
  assert.equal(kajjansi.town, 'Kajjansi');
  assert.equal(kitende.town, 'Kajjansi');
  const town = getDistrictLocationTree('Wakiso').find((item) => item.city === 'Kajjansi');
  assert.ok(town, 'Kajjansi is a town in the Wakiso tree');
  assert.ok(town.neighborhoods.some((item) => item.name === 'Kitende'), 'Kitende sits under Kajjansi');

  const saved = normalizeStaffListingPatch({
    area: 'Kitende',
    district: 'Wakiso',
    listing_type: 'land',
    extra_fields: { city: 'Wakiso', neighborhood: 'Kitende', region: 'Central' }
  }, {
    city: 'Kajjansi',
    area: 'Kitende',
    neighborhood: 'Kitende',
    district: 'Wakiso'
  });
  assert.deepEqual(saved.errors, [], saved.errors.join('; '));
  assert.equal(saved.hierarchy.city, 'Kajjansi');
  assert.equal(saved.hierarchy.neighborhood, 'Kitende');
  assert.equal(saved.patch.area, 'Kitende');
});

test('a road name is not location evidence, and a title town is only a soft warning', () => {
  assert.equal(stripRoadNamePhrases('Gulu - Kampala Road, Matugga'), 'Matugga');
  assert.equal(stripRoadNamePhrases('Plot on Kampala Road'), 'Plot');
  assert.doesNotMatch(stripRoadNamePhrases('House on Entebbe Road in Kitende'), /\bEntebbe\b/);
  const gulu = staffLocationWarnings({
    title: 'Land for sale at Matugga',
    address: 'Gulu - Kampala Road, Matugga',
    district: 'Wakiso',
    area: 'Matugga',
    extra_fields: { city: 'Gombe' }
  });
  assert.equal(gulu.some((warning) => /Gulu/.test(warning)), false, gulu.join(' | '));

  const soft = staffLocationSoftWarnings({
    title: 'Land for sale in Nansana Municipality',
    address: 'Gulu - Kampala Road, Matugga',
    district: 'Wakiso',
    area: 'Matugga',
    extra_fields: { city: 'Gombe' }
  });
  assert.equal(soft.some((warning) => /Nansana/.test(warning) && /Gombe/.test(warning)), true, soft.join(' | '));
  assert.match(soft.join(' '), /does not block/);
  const blocking = staffLocationWarnings({
    title: 'Land for sale in Nansana Municipality',
    district: 'Wakiso',
    area: 'Matugga',
    extra_fields: { city: 'Gombe' }
  });
  assert.equal(blocking.some((warning) => /Nansana/.test(warning)), false, blocking.join(' | '));
});

test('photo consent enables the video cover without a chosen file', () => {
  assert.match(app, /function staffSyncPreviewPhotoActions/);
  assert.match(app, /id="staff-preview-video-cover-button"/);
  assert.match(app, /id="staff-preview-photo-upload-button"/);
  const syncStart = app.indexOf('function staffSyncPreviewPhotoActions');
  const sync = app.slice(syncStart, app.indexOf('function staffPreviewPhotoUploadHtml', syncStart));
  assert.match(sync, /cover\.disabled = !consent/);
  assert.match(sync, /upload\.disabled = !\(consent && fileCount > 0\)/);
});

test('preview save patches the open modal id and ignores a different listing', () => {
  assert.match(app, /function staffOpenPreviewPropertyId/);
  assert.match(app, /modal\?\.dataset\?\.propertyId/);
  const saveStart = app.indexOf('async function saveStaffListingPreview');
  const save = app.slice(saveStart, app.indexOf('function openStaffOwnerStatusWhatsApp', saveStart));
  assert.match(save, /staffPreviewOpenSeq \+= 1/);
  assert.match(save, /const targetId = openId \|\| requested/);
  assert.match(save, /encodeURIComponent\(targetId\)/);
  assert.match(save, /staffPreviewResponseMatches\(targetId, saved\)/);
  assert.match(save, /different listing, so this editor was left unchanged/);
  const renderStart = app.indexOf('function renderStaffListingPreviewModal');
  const render = app.slice(renderStart, app.indexOf('function closeStaffListingPreview', renderStart));
  assert.match(render, /allowSwitch !== true/);
  assert.match(render, /modal\.dataset\.propertyId/);
});

test('the approval WhatsApp notice does not open a trapping dialog', () => {
  assert.match(page, /id="admin-whatsapp-modal" class="admin-whatsapp-panel"/);
  assert.doesNotMatch(page, /id="admin-whatsapp-modal" class="modal-overlay"/);
  const openStart = app.indexOf('function openAdminWhatsAppMessageModal');
  const open = app.slice(openStart, app.indexOf('function closeAdminOwnerWhatsApp', openStart));
  assert.doesNotMatch(open, /openModal\("admin-whatsapp-modal"\)/);
  assert.match(open, /admin-whatsapp-panel/);
});

test('the source monitor date is the 30-day lookback, not the last sweep', () => {
  assert.match(app, /30-day lookback, not the last sweep/);
  const drip = fs.readFileSync(path.join(root, 'services/xSourceDripService.js'), 'utf8');
  assert.match(drip, /missing_bearer_token: missingBearer/);
  assert.match(drip, /api_read_count: missingBearer \? 0 : searchJobCount/);
  assert.match(drip, /Set X_BEARER_TOKEN, TWITTER_BEARER_TOKEN, or X_API_BEARER_TOKEN/);
});

test('a public property page uses the listing cover as an absolute og:image', () => {
  const cover = 'https://media.makaug.com/listings/kitende-cover.jpg';
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    listing_type: 'land',
    title: 'Land in Kitende',
    description: 'A plot.',
    area: 'Kitende',
    district: 'Wakiso',
    price: 120000000,
    primary_image_url: cover,
    found_online_candidate: 'true',
    copy_extra: {}
  };
  const listing = normalizeSeoListingRow(row);
  assert.equal(listing.primary_image_url, cover);
  assert.equal(seoCoverImageUrl({ primary_image_url: cover, staff_primary_image_url: '' }, true), cover);
  assert.equal(seoCoverImageUrl({
    primary_image_url: 'https://p16-sign.tiktokcdn.com/cover.jpg',
    staff_primary_image_url: cover
  }, true), cover);
  const html = '<html><head></head><body><div id="detail-content"></div><footer></footer></body></html>';
  const rendered = renderPropertySeoHtml(html, listing, { baseUrl: 'https://makaug.com' });
  assert.equal(rendered.meta.image, cover);
  assert.doesNotMatch(rendered.meta.image, /house-ads-v3\/land\.webp/);
  assert.match(rendered.meta.image, /^https:\/\//);
});
