'use strict';

/**
 * C1 (10 Oct 2026, Arthur): a still from the listing's own source video counts
 * as its photo, and a listing with only its own playable video can be approved.
 * 152 of 160 pending listings had no media.makaug.com photo; every one had a
 * source video. TikTok CDN covers, stock photos, data: images and "image
 * pending" cards still never count. Staff get "Make a cover from the video".
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) process.env.DATABASE_URL = DB_URL;
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';

const {
  mediaHost,
  summariseListingMedia,
  listingSourceVideoUrls,
  NO_PHOTO_OR_VIDEO_MESSAGE
} = require('../utils/realListingPhoto');
const { foundOnlinePublicImages, consentedStaffPrimaryImageLateralSql } = require('../utils/foundOnlinePublicImages');
const scheduler = require('../services/videoStillScheduler');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const hosted = (name) => `https://${mediaHost()}/listing/${name}.jpg`;
const TIKTOK_PAGE = 'https://www.tiktok.com/@agent/video/7691604548967763208';

test('a listing with only its own video can be approved, on the basis source_video', () => {
  const media = summariseListingMedia([], { video_url: TIKTOK_PAGE, source_url: TIKTOK_PAGE });
  assert.equal(media.ok, true);
  assert.equal(media.basis, 'source_video');
  // A source marked unavailable is not a video we can show.
  assert.equal(summariseListingMedia([], { video_url: TIKTOK_PAGE, source_unavailable: true }).ok, false);
  assert.deepEqual(listingSourceVideoUrls({ video_urls: ['https://v16.tiktokcdn.com/cover.jpeg', 'https://media.makaug.com/v/1.mp4'] }), ['https://media.makaug.com/v/1.mp4']);
});

test('one hosted still (video_key_frame_1) is enough, on the basis video_still', () => {
  const media = summariseListingMedia([{ url: hosted('frame-1'), slot_key: 'video_key_frame_1' }], {});
  assert.equal(media.ok, true);
  assert.equal(media.basis, 'video_still');
  assert.equal(media.video_stills, 1);
  const photo = summariseListingMedia([{ url: hosted('front'), slot_key: 'staff_upload' }, { url: hosted('frame-1'), slot_key: 'video_key_frame_1' }], {});
  assert.equal(photo.basis, 'photo', 'a real photo wins');
});

test('TikTok CDN covers alone, or stock and data: images alone, are still refused', () => {
  const tiktokOnly = summariseListingMedia([
    { url: 'https://p16-sign.tiktokcdn.com/obj/cover.jpeg', slot_key: 'source_primary_image' },
    { url: 'https://p16-sign.byteimg.com/x.jpeg', slot_key: 'video_key_frame_1' }
  ], {});
  assert.equal(tiktokOnly.ok, false);
  assert.equal(tiktokOnly.basis, null);
  const stockAndData = summariseListingMedia([
    { url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900' },
    { url: 'data:image/svg+xml;base64,AAAA' }
  ], {});
  assert.equal(stockAndData.ok, false);
  assert.equal(NO_PHOTO_OR_VIDEO_MESSAGE, 'This listing needs a photo or its own property video before it can be approved.');
});

test('a found-online public row shows 2 staff photos + 1 still, never the TikTok cover', () => {
  const images = [
    { url: 'https://p16-sign.tiktokcdn.com/obj/cover.jpeg', slot_key: 'source_primary_image', is_primary: true },
    { url: hosted('staff-1'), slot_key: 'staff_upload' },
    { url: hosted('staff-2'), slot_key: 'staff_upload', is_primary: true },
    { url: hosted('k1'), slot_key: 'video_key_frame_1' },
    { url: 'https://p16-sign.tiktokcdn.com/obj/frame.jpeg', slot_key: 'video_key_frame_2' }
  ];
  const out = foundOnlinePublicImages(images, { staff_image_upload: { by: 'staff' } });
  assert.deepEqual(out.map((image) => [image.url, image.is_primary]), [
    [hosted('staff-2'), true], [hosted('staff-1'), false], [hosted('k1'), false]
  ]);
  assert.deepEqual(foundOnlinePublicImages([images[0]], {}), [], 'source-only stays hidden');
  // Without staff consent the still is still ours to show.
  assert.deepEqual(foundOnlinePublicImages(images, {}).map((image) => image.url), [hosted('k1')]);
  const sql = consentedStaffPrimaryImageLateralSql('p');
  assert.match(sql, /video_key_frame_/);
  assert.match(sql, /ORDER BY \(COALESCE\(si\.slot_key, ''\) = 'staff_upload'\) DESC/);
});

function fakeDb(row) {
  return {
    pool: { waitingCount: 0 },
    async query() { return { rows: row ? [row] : [] }; }
  };
}

test('"Make a cover from the video": a TikTok page gives a plain error; a video file is turned into uncropped stills', async () => {
  const property = { id: 'p1', status: 'pending', video_still_count: 0, extra_fields: { video_url: TIKTOK_PAGE } };
  const refused = await scheduler.makeVideoCoverForListing(fakeDb(property), 'p1', { backfill: {} });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /TikTok, YouTube or Facebook page, not a video file we can open/);
  const calls = [];
  const backfill = {
    FRAME_CANDIDATE_COUNT: 8,
    killLiveChildren() {},
    async makeAndUploadStills(p, options) { calls.push(['make', p.extra_fields.video_urls, options.maxVideos]); return [{ url: hosted('k1') }]; },
    async attachStills(id, uploaded, options) { calls.push(['attach', id, options]); return { attached: uploaded.length }; }
  };
  const mp4 = `https://${mediaHost()}/videos/tour.mp4`;
  const made = await scheduler.makeVideoCoverForListing(fakeDb({ ...property, extra_fields: { video_url: mp4 } }), 'p1', { backfill, actorId: 'staff-9' });
  assert.deepEqual(made, { ok: true, attached: 1 });
  assert.deepEqual(calls[0], ['make', [mp4], 2], 'the scheduler\'s two-video limit');
  assert.deepEqual(calls[1], ['attach', 'p1', { keepListingText: true, actorId: 'staff-9' }], 'description left alone');
  const failing = { ...backfill, async makeAndUploadStills() { throw new Error('no clear, visually distinct frame could be extracted'); } };
  const failed = await scheduler.makeVideoCoverForListing(fakeDb({ ...property, extra_fields: { video_url: mp4 } }), 'p1', { backfill: failing });
  assert.equal(failed.error, 'We couldn\'t get a clear picture from this video, so no cover was made. Upload a photo instead.');
  const approved = await scheduler.makeVideoCoverForListing(fakeDb({ ...property, status: 'approved' }), 'p1', { backfill });
  assert.equal(approved.status, 409);
  const busy = await scheduler.makeVideoCoverForListing({ pool: { waitingCount: 3 }, query: async () => ({ rows: [] }) }, 'p1', { backfill });
  assert.equal(busy.status, 503);
});

test('every approval path uses the photo-or-video gate; staff see the basis, the button and the new consent wording', () => {
  const staff = read('routes/staff.js');
  assert.match(staff, /loadListingMediaSummaries\(queryable, approveIds\)/);
  assert.match(staff, /router\.post\('\/properties\/:id\/video-cover', async/);
  assert.match(staff, /preview\.media_check = await listingPhotoOrVideoCheck\(db, preview\.id\)/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /These are photos of this property, or frames captured from this listing's own source video, and we are allowed to use them\./);
  assert.match(app, /video_still: "Approves on: a still from the listing's own video\."/);
  assert.match(app, /onclick="staffMakeVideoCover\(/);
  assert.match(read('services/staffPropertyMediaService.js'), /frames captured from this listing\\'s own source video/);
  // Stills are resized to fit, never cropped or blurred: the agent's branding stays.
  const backfill = read('scripts/backfill-whatsapp-video-stills.js');
  assert.match(backfill, /resize\(\{ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true \}\)/);
  assert.doesNotMatch(backfill, /\.blur\(|\.extract\(/);
});

let db;
const ids = [];
const TAG = `VIDPHOTO${crypto.randomBytes(3).toString('hex')}`;

test.after(async () => {
  if (!db) return;
  if (ids.length) {
    await db.query('DELETE FROM property_images WHERE property_id = ANY($1::uuid[])', [ids]).catch(() => {});
    await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
  }
  await db.pool.end().catch(() => {});
});

test('against a database: video-only and still-only rows pass the gate; TikTok-CDN-only does not', { skip }, async () => {
  db = require('../config/database');
  const { listingPhotoOrVideoCheck } = require('../utils/realListingPhoto');
  const insert = async (title, extra, images = []) => {
    const id = (await db.query(
      `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage, source, listed_via, extra_fields)
       VALUES ('rent', $1, 'Video gate fixture flat with parking.', 'Wakiso', 'Kira', 900000, 'month', 'pending', 'pending', 'found_online_property_source_v1', 'found_online', $2::jsonb) RETURNING id`,
      [`${TAG} ${title}`, JSON.stringify(extra)]
    )).rows[0].id;
    ids.push(id);
    for (const [index, image] of images.entries()) {
      await db.query('INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key) VALUES ($1, $2, $3, $4, $5)', [id, image.url, index === 0, index, image.slot_key]);
    }
    return id;
  };
  const videoOnly = await insert('video only', { found_online: true, video_url: TIKTOK_PAGE });
  const stillOnly = await insert('still only', { found_online: true }, [{ url: hosted('frame-1'), slot_key: 'video_key_frame_1' }]);
  const cdnOnly = await insert('cdn only', { found_online: true }, [{ url: 'https://p16-sign.tiktokcdn.com/obj/cover.jpeg', slot_key: 'source_primary_image' }]);
  assert.equal((await listingPhotoOrVideoCheck(db, videoOnly)).basis, 'source_video');
  assert.equal((await listingPhotoOrVideoCheck(db, stillOnly)).basis, 'video_still');
  assert.equal((await listingPhotoOrVideoCheck(db, cdnOnly)).ok, false);
});
