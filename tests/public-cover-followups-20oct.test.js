'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { foundOnlinePublicImages } = require('../utils/foundOnlinePublicImages');
const { mediaHost } = require('../utils/realListingPhoto');
const { planVideoStillCleanup } = require('../services/videoStillDuplicateService');
const scheduler = require('../services/videoStillScheduler');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const backfill = fs.readFileSync(path.join(__dirname, '../scripts/backfill-whatsapp-video-stills.js'), 'utf8');
const staff = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
const hosted = (name) => `https://${mediaHost()}/${name}.jpg`;

test('a primary video still leads the public gallery and a YouTube thumbnail stays out', () => {
  const images = foundOnlinePublicImages([
    { url: 'https://i.ytimg.com/vi/old/hqdefault.jpg', slot_key: 'source_youtube_thumbnail', is_primary: false, sort_order: 0 },
    { url: hosted('staff-photo'), slot_key: 'staff_upload', is_primary: false, sort_order: 2 },
    { url: hosted('cover-still'), slot_key: 'video_key_frame_2', is_primary: true, sort_order: 1 },
    { url: 'https://p16-sign.tiktokcdn.com/obj/cover.jpeg', slot_key: 'source_primary_image', is_primary: true, sort_order: 0 }
  ], { image_rights_confirmed: true, staff_image_upload: { by: 'moderator' } });
  assert.deepEqual(images.map((image) => image.url), [hosted('cover-still'), hosted('staff-photo')]);
  assert.equal(images[0].is_primary, true);
  assert.equal(images[1].is_primary, false);
});

test('the public page keeps a hosted video still and still plays the approved video', () => {
  const start = app.indexOf('const FOUND_ONLINE_SOURCE_MEDIA_RE');
  const end = app.indexOf('function getPropertyGalleryPhotos');
  const helpers = new Function(`${app.slice(start, end)}; return { foundOnlineConsentedPhotos, foundOnlineConsentedPhotoUrl };`)();
  const still = { url: hosted('properties/a81b9856/staff-video-cover/youtube/cover.jpg'), slot_key: 'video_key_frame_1', is_primary: true };
  const youtube = { url: 'https://i.ytimg.com/vi/old/hqdefault.jpg', slot_key: 'source_youtube_thumbnail', is_primary: false };
  const staffPhoto = { url: `https://${mediaHost()}/properties/x/staff-images/photo.jpg`, slot_key: 'staff_upload' };
  assert.deepEqual(helpers.foundOnlineConsentedPhotos([youtube, staffPhoto, still]).map((image) => image.url), [still.url, staffPhoto.url]);
  assert.equal(helpers.foundOnlineConsentedPhotoUrl({ images: [still] }), still.url);
  assert.equal(helpers.foundOnlineConsentedPhotoUrl({ images: [], primary_image_url: still.url }), still.url);
  assert.equal(helpers.foundOnlineConsentedPhotoUrl({ images: [youtube], primary_image_url: youtube.url }), '');
  assert.match(app, /const detailVideoUrls = propertyVideoUrls\(p\)/);
  assert.match(app, /<video controls preload="metadata" playsinline/);
  assert.doesNotMatch(app.slice(app.indexOf('const detailVideoUrls = propertyVideoUrls(p)'), app.indexOf('const directionsUrl = propertyDirectionsUrl(p)')), /!thirdPartyDetail/);
});

test('the editor clears a stale unrecognised location once the place resolves', () => {
  const start = app.indexOf('function adminReviewStatusIsUnrecognised');
  const end = app.indexOf('function adminReviewTownOnlyLocationNote');
  const status = { text: 'Location not recognised — the address note was not changed.', className: '' };
  const toast = { text: 'Location not recognised — pin set but region/district/area could NOT be auto-filled.', show: true, timer: 7 };
  const context = {
    adminReviewCanonicalLocationResolution: null,
    adminActiveReview: { source: 'found_online', extra_fields: { found_online: true } },
    adminReviewCurrentLocationFields: () => ({ district: 'Wakiso', city: 'Nkoowe', neighborhood: '', area: 'Nkoowe' }),
    adminReviewRecognisedLocationSelected: () => false,
    adminReviewPlaceEqualsDistrict: (place, district) => String(place || '').trim().toLowerCase() === String(district || '').trim().toLowerCase(),
    adminReviewExtraFields: (review) => review?.extra_fields || {},
    adminReviewTownOnlyLocationNote: () => 'Town saved as Nkoowe, Wakiso. An exact neighbourhood is optional. This does not block the save.',
    adminReviewSetAddressSearchStatus(message, tone) {
      status.text = message;
      status.tone = tone;
    },
    document: {
      getElementById(id) {
        if (id === 'admin-review-address-search-status') return { textContent: status.text, className: status.className };
        if (id === 'toast-el') {
          return {
            get textContent() { return toast.text; },
            set textContent(value) { toast.text = value; },
            classList: {
              contains: () => toast.show,
              remove: () => { toast.show = false; }
            },
            _timer: toast.timer
          };
        }
        return null;
      }
    },
    clearTimeout() { toast.timer = null; }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  assert.equal(context.adminReviewClearStaleUnrecognisedLocation(), true);
  assert.match(status.text, /Town saved as Nkoowe, Wakiso/);
  assert.equal(status.tone, 'slate');
  assert.equal(toast.show, false);
  assert.equal(toast.text, '');
  assert.match(app.slice(app.indexOf('function applyAdminReviewCanonicalLocation'), app.indexOf('function clearLpCanonicalLocationCascade')), /adminReviewClearStaleUnrecognisedLocation\(\)/);
});

test('staff can preview frames, pick one, or set a time, and a repeat still is not inserted twice', async () => {
  assert.match(app, /data-staff-cover-frame-picker="true"/);
  assert.match(app, /Show frame choices/);
  assert.match(app, /Use this time as the cover/);
  assert.match(app, /data-staff-still-dedupe="true"/);
  assert.match(staff, /router\.post\('\/properties\/:id\/video-stills\/dedupe'/);
  assert.match(backfill, /duplicate_stills/);
  assert.match(backfill, /sha256: item\.sha256 \|\| null/);
  const attach = backfill.slice(backfill.indexOf('async function attachStills'), backfill.indexOf('async function quarantineWhatsappVideoScreenshots'));
  assert.match(attach, /coverLiveListing \? property\.status : 'pending'/);
  assert.match(attach, /SET is_primary = FALSE/);

  const seen = [];
  const db = {
    pool: { waitingCount: 0 },
    async query(sql) {
      seen.push(sql);
      if (/FROM properties/i.test(sql)) {
        return { rows: [{ id: 'p-yt', status: 'approved', extra_fields: { youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk' }, video_still_count: 1 }] };
      }
      return { rows: [] };
    }
  };
  let n = 0;
  const preview = await scheduler.makeVideoCoverForListing(db, 'p-yt', {
    preview: true,
    fetchImpl: async (url) => ({
      ok: true,
      async arrayBuffer() {
        const bytes = Buffer.alloc(1200, n + 1);
        Buffer.from(String(url)).copy(bytes);
        n += 1;
        return bytes;
      }
    }),
    uploadBuffer: async ({ bytes }) => ({ publicUrl: `https://${mediaHost()}/candidate-${bytes[0]}.jpg`, sha256: `hash-${bytes[0]}`, bytes: bytes.length })
  });
  assert.equal(preview.ok, true, preview.error || '');
  assert.equal(preview.preview, true);
  assert.equal(preview.attached, 0);
  assert.ok(preview.candidates.length >= 2);
  assert.ok(seen.some((sql) => /video_cover_candidates/.test(sql)));

  const calls = [];
  const picked = await scheduler.makeVideoCoverForListing({
    pool: { waitingCount: 0 },
    async query() {
      return { rows: [{ id: 'p-yt', status: 'approved', extra_fields: { youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk', video_cover_candidates: preview.candidates } }] };
    }
  }, 'p-yt', {
    stillUrl: preview.candidates[0].url,
    backfill: {
      async attachStills(_id, uploaded, options) {
        calls.push([uploaded[0].url, options.setAsCover, options.coverLiveListing]);
        return { attached: 0, reused: 1 };
      }
    }
  });
  assert.equal(picked.ok, true, picked.error || '');
  assert.deepEqual(calls[0], [preview.candidates[0].url, true, true]);

  const timed = [];
  const atTime = await scheduler.makeVideoCoverForListing({
    pool: { waitingCount: 0 },
    async query() {
      return { rows: [{ id: 'p-file', status: 'pending', extra_fields: { video_url: `https://${mediaHost()}/tour.mp4` } }] };
    }
  }, 'p-file', {
    timestampSeconds: 12.5,
    backfill: {
      async uploadStillAtTimestamp(_property, url, seconds) {
        timed.push([url, seconds]);
        return [{ url: hosted('at-12'), sha256: 'abc', sourceVideoUrl: url, timestampSeconds: seconds }];
      },
      async attachStills() { return { attached: 1, reused: 0 }; }
    }
  });
  assert.equal(atTime.ok, true, atTime.error || '');
  assert.equal(atTime.attached, 1);
  assert.equal(timed[0][1], 12.5);
  assert.equal(atTime.listingStatus, 'pending');

  const youtubeTime = await scheduler.makeVideoCoverForListing(db, 'p-yt', { timestampSeconds: 8 });
  assert.equal(youtubeTime.ok, false);
  assert.match(youtubeTime.error, /automatic frames/);
});

test('duplicate video stills keep the cover and drop the copy', () => {
  const plan = planVideoStillCleanup([
    { id: 'old', url: 'https://media.example/a.jpg', slot_key: 'video_key_frame_1', is_primary: false, sort_order: 1, created_at: '2026-10-20T00:00:00Z' },
    { id: 'cover', url: 'https://media.example/b.jpg', slot_key: 'video_key_frame_2', is_primary: true, sort_order: 2, created_at: '2026-10-20T01:00:00Z' },
    { id: 'photo', url: 'https://media.example/photo.jpg', slot_key: 'staff_upload', is_primary: false, sort_order: 0 }
  ], {
    'https://media.example/a.jpg': 'same-hash',
    'https://media.example/b.jpg': 'same-hash'
  });
  assert.deepEqual(plan.keep.map((image) => image.id), ['cover']);
  assert.deepEqual(plan.remove.map((image) => image.id), ['old']);
  const unique = planVideoStillCleanup([
    { id: 'one', url: 'https://media.example/a.jpg', slot_key: 'video_key_frame_1', is_primary: true },
    { id: 'two', url: 'https://media.example/b.jpg', slot_key: 'video_key_frame_2', is_primary: false }
  ], { 'https://media.example/a.jpg': 'hash-a', 'https://media.example/b.jpg': 'hash-b' });
  assert.equal(unique.remove.length, 0);
});
