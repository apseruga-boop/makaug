'use strict';

/**
 * Staff Preview & edit: detach one video from a listing, and pick which video
 * a cover is made from when the listing has more than one.
 *
 * The live case is pending MK-20261017-DE116F: video 1 is a 36s land clip and
 * video 2 is a 2:40 house interior. These tests use that shape. They do not
 * read or write the production row.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  attributedStillUrls,
  collectListingVideoUrls,
  detachVideoFromExtra,
  removeStaffPropertyVideo,
  untaggedStillsBelongToVideo
} = require('../services/staffPropertyMediaService');
const { mediaHost } = require('../utils/realListingPhoto');
const scheduler = require('../services/videoStillScheduler');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('assets/makaug-app.js');
const LAND = 'https://media.makaug.com/videos/land-36s.mp4';
const INTERIOR = 'https://media.makaug.com/videos/house-2m40.mp4';
const LAND_STILL = 'https://media.makaug.com/stills/land.jpg';
const INTERIOR_STILL = 'https://media.makaug.com/stills/interior.jpg';
const PHOTO = 'https://media.makaug.com/photos/plot.jpg';

function listingExtra() {
  return {
    video_url: LAND,
    video_urls: [LAND, INTERIOR],
    video_tours: [
      { url: LAND, label: 'WhatsApp property video 1', sort_order: 0 },
      { url: INTERIOR, label: 'WhatsApp property video 2', sort_order: 1 }
    ],
    video_count: 2,
    video_still_urls: [LAND_STILL, INTERIOR_STILL],
    video_frame_quality: [
      { frame: 1, source_video_url: LAND, still_url: LAND_STILL },
      { frame: 2, source_video_url: INTERIOR, still_url: INTERIOR_STILL }
    ],
    video_still_sources: [
      { still_url: LAND_STILL, source_video_url: LAND },
      { still_url: INTERIOR_STILL, source_video_url: INTERIOR }
    ],
    video_key_frame_count: 2,
    title_note: 'land at Najjera'
  };
}

test('detaching video 2 leaves video 1 and only the stills made from video 2', () => {
  const extra = listingExtra();
  assert.deepEqual(collectListingVideoUrls(extra), [LAND, INTERIOR]);
  assert.deepEqual([...attributedStillUrls(extra, INTERIOR)], [INTERIOR_STILL]);
  assert.deepEqual([...attributedStillUrls(extra, LAND)], [LAND_STILL]);
  const detached = detachVideoFromExtra(extra, `${INTERIOR}#t=0.1`);
  assert.deepEqual(detached.remaining, [LAND]);
  assert.deepEqual(detached.extra.video_urls, [LAND]);
  assert.deepEqual(detached.extra.video_tours.map((tour) => tour.url), [LAND]);
  assert.equal(detached.extra.video_url, LAND);
  assert.equal(detached.extra.video_count, 1);
  assert.equal(detached.extra.title_note, 'land at Najjera');
});

test('untagged stills are cleared only when they belong to the removed video', () => {
  const bare = { video_still_urls: [LAND_STILL, INTERIOR_STILL] };
  assert.equal(untaggedStillsBelongToVideo(bare, [], INTERIOR, 1), false);
  assert.equal(untaggedStillsBelongToVideo(bare, [], INTERIOR, 0), true);
  assert.equal(untaggedStillsBelongToVideo(bare, [
    { delivery: { source_videos: [INTERIOR, INTERIOR] } }
  ], INTERIOR, 1), true);
  assert.equal(untaggedStillsBelongToVideo(bare, [
    { delivery: { source_videos: [LAND, INTERIOR] } }
  ], INTERIOR, 1), false);
  assert.equal(untaggedStillsBelongToVideo(listingExtra(), [], INTERIOR, 1), false);
});

function memoryMediaDb(seed) {
  const state = {
    property: { id: seed.propertyId, extra_fields: structuredClone(seed.extra) },
    images: seed.images.map((image) => ({ ...image })),
    events: seed.events || [],
    log: []
  };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('SELECT id, extra_fields FROM properties')) {
        return { rows: state.property ? [state.property] : [] };
      }
      if (text.includes('SELECT delivery FROM property_moderation_events')) {
        return { rows: state.events };
      }
      if (text.includes('FROM property_images') && text.includes('SELECT *')) {
        return { rows: state.images.map((image) => ({ ...image })) };
      }
      if (text.includes('DELETE FROM property_images')) {
        const ids = new Set(params[1]);
        state.images = state.images.filter((image) => !ids.has(image.id));
        return { rows: [] };
      }
      if (text.includes('UPDATE property_images SET is_primary')) {
        const primaryId = params[1];
        state.images.forEach((image) => { image.is_primary = image.id === primaryId; });
        return { rows: [] };
      }
      if (text.includes('UPDATE properties SET extra_fields')) {
        state.property.extra_fields = JSON.parse(params[1]);
        return { rows: [] };
      }
      if (text.includes('INSERT INTO property_moderation_events')) {
        state.log.push({ action: params[2], reason: params[3], delivery: JSON.parse(params[4]) });
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${text}`);
    },
    release() { state.released = true; }
  };
  return { state, async getClient() { return client; } };
}

const PROPERTY_ID = '00000000-0000-4000-8000-0000000000de';

test('remove video detaches it, clears its stills, logs the edit, and leaves the file in storage', async () => {
  const database = memoryMediaDb({
    propertyId: PROPERTY_ID,
    extra: listingExtra(),
    images: [
      { id: '10000000-0000-4000-8000-000000000001', url: PHOTO, slot_key: 'staff_upload', is_primary: true, sort_order: 0 },
      { id: '10000000-0000-4000-8000-000000000002', url: LAND_STILL, slot_key: 'video_key_frame_1', is_primary: false, sort_order: 1 },
      { id: '10000000-0000-4000-8000-000000000003', url: INTERIOR_STILL, slot_key: 'video_key_frame_2', is_primary: false, sort_order: 2 }
    ]
  });
  await assert.rejects(
    () => removeStaffPropertyVideo({ propertyId: PROPERTY_ID, videoUrl: INTERIOR, actorId: 'staff-1', confirm: false }, database),
    (error) => error.status === 400 && /Confirm/.test(error.message)
  );
  assert.equal(database.state.images.length, 3);
  await assert.rejects(
    () => removeStaffPropertyVideo({ propertyId: PROPERTY_ID, videoUrl: 'https://media.makaug.com/videos/missing.mp4', actorId: 'staff-1', confirm: true }, database),
    (error) => error.status === 404
  );
  const removed = await removeStaffPropertyVideo({
    propertyId: PROPERTY_ID,
    videoUrl: INTERIOR,
    actorId: 'staff-1',
    confirm: true
  }, database);
  assert.equal(removed.action, 'staff_listing_video_removed');
  assert.equal(removed.storage_deleted, false);
  assert.equal(removed.stills_cleared, 1);
  assert.equal(removed.removed_url, INTERIOR);
  assert.deepEqual(removed.images.map((image) => image.url), [PHOTO, LAND_STILL]);
  assert.equal(removed.extra_fields.video_url, LAND);
  assert.deepEqual(removed.extra_fields.video_urls, [LAND]);
  assert.deepEqual(removed.extra_fields.video_tours.map((tour) => tour.url), [LAND]);
  assert.equal(removed.extra_fields.video_count, 1);
  assert.deepEqual(removed.extra_fields.video_still_urls, [LAND_STILL]);
  assert.deepEqual(removed.extra_fields.video_still_sources, [{ still_url: LAND_STILL, source_video_url: LAND }]);
  assert.equal(removed.extra_fields.video_key_frame_count, 1);
  assert.equal(removed.extra_fields.staff_removed_videos[0].url, INTERIOR);
  assert.equal(removed.extra_fields.staff_removed_videos[0].storage_deleted, false);
  assert.equal(database.state.log.length, 1);
  assert.equal(database.state.log[0].action, 'staff_listing_video_removed');
  assert.equal(database.state.log[0].delivery.storage_deleted, false);
  assert.deepEqual(database.state.log[0].delivery.still_urls, [INTERIOR_STILL]);
  assert.match(database.state.log[0].reason, /left in storage/);
  assert.equal(database.state.released, true);
  const source = read('services/staffPropertyMediaService.js');
  const body = source.slice(source.indexOf('async function removeStaffPropertyVideo'), source.indexOf('module.exports'));
  assert.doesNotMatch(body, /deleteObject|DeleteObject|uploadBufferToS3|unlink\(/);
});

test('a cover with two videos uses only the video staff picked', async () => {
  const land = `https://${mediaHost()}/videos/land-36s.mp4`;
  const interior = `https://${mediaHost()}/videos/house-2m40.mp4`;
  const property = {
    id: 'p1',
    status: 'pending',
    video_still_count: 0,
    extra_fields: { video_url: land, video_urls: [land, interior] }
  };
  const calls = [];
  const backfill = {
    FRAME_CANDIDATE_COUNT: 8,
    killLiveChildren() {},
    async makeAndUploadStills(row, options) {
      calls.push(['make', row.extra_fields.video_urls, options.maxVideos]);
      return [{ url: `https://${mediaHost()}/stills/land.jpg`, sourceVideoUrl: land }];
    },
    async attachStills(id, uploaded, options) {
      calls.push(['attach', id, options]);
      return { attached: uploaded.length };
    }
  };
  const db = { pool: { waitingCount: 0 }, async query() { return { rows: [property] }; } };
  const needsChoice = await scheduler.makeVideoCoverForListing(db, 'p1', { backfill });
  assert.equal(needsChoice.status, 400);
  assert.match(needsChoice.error, /Choose which video/);
  assert.equal(calls.length, 0);
  const made = await scheduler.makeVideoCoverForListing(db, 'p1', { backfill, actorId: 'staff-9', videoUrl: land });
  assert.deepEqual(made, { ok: true, attached: 1, reused: 0, listingStatus: 'pending' });
  assert.deepEqual(calls[0], ['make', [land], 1]);
  assert.deepEqual(calls[1][2], { keepListingText: true, actorId: 'staff-9', setAsCover: true });
  const page = await scheduler.makeVideoCoverForListing(db, 'p1', { backfill, videoUrl: 'https://www.tiktok.com/@agent/video/1' });
  assert.equal(page.status, 422);
});

function previewContext(review) {
  const start = app.indexOf('function staffFormatVideoClock(');
  const end = app.indexOf('async function staffMakeVideoCover(');
  const context = {
    adminAttr: (value) => String(value ?? ''),
    adminEscape: (value) => String(value ?? ''),
    propertyIdArg: JSON.stringify,
    adminActiveReview: review,
    propertyVideoUrls: (preview) => preview?.videos || [],
    getYouTubeThumbnailUrl: () => '',
    videoFirstFrameSrc: (url) => `${url}#t=0.1`
  };
  vm.runInNewContext(app.slice(start, end), context);
  return context;
}

test('two videos show a cover picker with a frame and a duration, and one video keeps the single button', () => {
  assert.equal(previewContext(null).staffFormatVideoClock(36), '0:36');
  assert.equal(previewContext(null).staffFormatVideoClock(160), '2:40');
  const many = previewContext({ id: 'listing-1', videos: [LAND, INTERIOR] });
  const picker = many.staffPreviewVideoCoverHtml('listing-1');
  assert.match(picker, /data-staff-video-cover-picker="true"/);
  assert.equal((picker.match(/Use this video/g) || []).length, 2);
  assert.equal((picker.match(/data-staff-cover-thumb/g) || []).length, 2);
  assert.equal((picker.match(/data-staff-cover-duration/g) || []).length, 2);
  assert.match(picker, new RegExp(`data-video-src="${LAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(picker, new RegExp(`data-video-src="${INTERIOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(picker, /Video 1/);
  assert.match(picker, /Video 2/);
  assert.doesNotMatch(picker, /id="staff-preview-video-cover-button"/);
  assert.match(picker, /staffMakeVideoCover\("listing-1", "https:\/\/media\.makaug\.com\/videos\/land-36s\.mp4"\)/);
  const one = previewContext({ id: 'listing-1', videos: [LAND] });
  const single = one.staffPreviewVideoCoverHtml('listing-1');
  assert.match(single, /id="staff-preview-video-cover-button"/);
  assert.doesNotMatch(single, /data-staff-video-cover-picker/);
  const videoStart = app.indexOf('function staffPreviewVideosHtml(');
  const videoEnd = app.indexOf('function staffPreviewImagesHtml(');
  const videoContext = {
    adminAttr: (value) => String(value ?? ''),
    propertyIdArg: JSON.stringify,
    staffEmpty: (label) => String(label),
    propertyVideoUrls: (preview) => preview.videos || [],
    renderVideoEmbedCard: (url, options) => `<div data-embed="${url}">${options.title}</div>`
  };
  vm.runInNewContext(app.slice(videoStart, videoEnd), videoContext);
  const gallery = videoContext.staffPreviewVideosHtml({ id: 'listing-1', videos: [LAND, INTERIOR] });
  assert.equal((gallery.match(/>Remove video</g) || []).length, 2);
  assert.match(gallery, /data-staff-remove-video=/);
  assert.match(gallery, /Property video 1/);
  assert.match(gallery, /Property video 2/);
});

test('remove video asks for confirmation before the request, and the cover route takes the chosen file', () => {
  const removeStart = app.indexOf('async function staffRemovePreviewVideo');
  const removeBody = app.slice(removeStart, app.indexOf('async function staffChangePreviewPhoto', removeStart));
  const confirmAt = removeBody.indexOf('window.confirm(');
  const requestAt = removeBody.indexOf('/videos/remove');
  assert.ok(confirmAt >= 0 && confirmAt < requestAt);
  assert.match(removeBody, /stays in storage/);
  assert.match(removeBody, /confirm: true/);
  const staff = read('routes/staff.js');
  assert.match(staff, /router\.post\('\/properties\/:id\/videos\/remove'/);
  assert.match(staff, /confirm: req\.body\?\.confirm === true/);
  assert.match(staff, /videoUrl: String\(req\.body\?\.video_url \|\| req\.body\?\.url \|\| ''\)/);
  assert.match(staff, /storage_deleted: false/);
  const backfill = read('scripts/backfill-whatsapp-video-stills.js');
  assert.match(backfill, /source_video_url: item\.sourceVideoUrl \|\| null/);
  assert.match(backfill, /video_still_sources:/);
  assert.doesNotMatch(read('index.html'), /Remove video/);
});

test('unsigned video remove and video cover stay closed', async () => {
  const express = require('express');
  const request = require('supertest');
  const server = express();
  server.use(express.json());
  server.use('/api/staff', require('../routes/staff'));
  const id = '00000000-0000-4000-8000-000000000001';
  for (const response of [
    await request(server).post(`/api/staff/properties/${id}/videos/remove`).send({ url: LAND, confirm: true }),
    await request(server).post(`/api/staff/properties/${id}/video-cover`).send({ video_url: LAND }),
    await request(server).post(`/api/staff/properties/${id}/video-stills/dedupe`).send({})
  ]) {
    assert.equal(response.status, 403);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error, 'Staff access required');
  }
});

test.after(async () => {
  const database = require('../config/database');
  await database.pool?.end?.();
});
