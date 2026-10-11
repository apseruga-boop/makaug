'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  X_BROWSER_USER_AGENT,
  X_REFERER,
  cacheXPostPhoto,
  isXPlatform,
  normalizeTwimgPhotoUrl,
  replaceTwimgRowsWithHostedCopies,
  twimgUrlsFromListing,
  twimgUrlsStillToCopy,
} = require('../utils/xPostPhoto');
const { storeRemoteImageUrl } = require('../services/cloudMediaStorageService');
const { realPhotoRejection } = require('../utils/realListingPhoto');
const { foundOnlinePublicImages } = require('../utils/foundOnlinePublicImages');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('twimg media URLs are requested as a large jpeg', () => {
  assert.equal(
    normalizeTwimgPhotoUrl('https://pbs.twimg.com/media/AbC123.jpg'),
    'https://pbs.twimg.com/media/AbC123?format=jpg&name=large'
  );
  assert.equal(
    normalizeTwimgPhotoUrl('https://pbs.twimg.com/media/AbC123.png'),
    'https://pbs.twimg.com/media/AbC123?format=jpg&name=large'
  );
  assert.equal(
    normalizeTwimgPhotoUrl('https://pbs.twimg.com/media/AbC123?format=jpg&name=small'),
    'https://pbs.twimg.com/media/AbC123?format=jpg&name=large'
  );
  assert.equal(
    normalizeTwimgPhotoUrl('http://PBS.twimg.com/media/AbC123.JPG:large'),
    'https://pbs.twimg.com/media/AbC123?format=jpg&name=large'
  );
  const thumb = 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/abc.jpg';
  assert.equal(normalizeTwimgPhotoUrl(thumb), thumb);
  assert.equal(normalizeTwimgPhotoUrl('https://media.makaug.com/x-post-photos/a.jpg'), 'https://media.makaug.com/x-post-photos/a.jpg');
  assert.equal(normalizeTwimgPhotoUrl(''), '');
});

test('caching an X photo uses a browser user agent and an x.com referer', async () => {
  const calls = [];
  const hosted = 'https://media.makaug.com/x-post-photos/AbC123.jpg';
  const stored = await cacheXPostPhoto('https://pbs.twimg.com/media/AbC123.jpg', {
    store: async (url, options) => {
      calls.push({ url, options });
      return hosted;
    },
  });
  assert.equal(stored, hosted);
  assert.equal(calls[0].url, 'https://pbs.twimg.com/media/AbC123?format=jpg&name=large');
  assert.equal(calls[0].options.userAgent, X_BROWSER_USER_AGENT);
  assert.equal(calls[0].options.referer, X_REFERER);
  assert.equal(calls[0].options.keyPrefix, 'x-post-photos');
  assert.deepEqual(calls[0].options.allowedHosts, ['pbs.twimg.com', 'video.twimg.com', 'twimg.com']);
  assert.equal(await cacheXPostPhoto('https://p16-sign.tiktokcdn.com/obj/cover.jpeg', {
    store: async () => {
      throw new Error('tiktok must not be cached as an X photo');
    },
  }), null);
  const errors = [];
  assert.equal(await cacheXPostPhoto('https://pbs.twimg.com/media/AbC123.jpg', {
    store: async () => { throw new Error('twimg blocked the fetch'); },
    onError(error) { errors.push(error.message); },
  }), null);
  assert.deepEqual(errors, ['twimg blocked the fetch']);
});

test('storeRemoteImageUrl sends Referer only when asked, and keeps the cache user agent by default', async () => {
  const keys = ['MEDIA_STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.MEDIA_STORAGE_PROVIDER = 's3';
  process.env.S3_ENDPOINT = 'https://s3.example.test';
  process.env.S3_BUCKET = 'bucket';
  process.env.S3_ACCESS_KEY_ID = 'key';
  process.env.S3_SECRET_ACCESS_KEY = 'secret';
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url: String(url), headers: options.headers });
    return { ok: false, status: 404, headers: { get: () => 'image/jpeg' } };
  };
  try {
    await assert.rejects(() => storeRemoteImageUrl('https://pbs.twimg.com/media/AbC123?format=jpg&name=large', {
      allowedHosts: ['pbs.twimg.com'],
      referer: 'https://x.com/',
      userAgent: 'BrowserUA',
      fetchImpl,
    }));
    assert.equal(seen[0].headers.Referer, 'https://x.com/');
    assert.equal(seen[0].headers['User-Agent'], 'BrowserUA');
    await assert.rejects(() => storeRemoteImageUrl('https://p16-sign.tiktokcdn.com/obj/cover.jpeg', {
      allowedHosts: ['tiktokcdn.com'],
      fetchImpl,
    }));
    assert.equal(seen[1].headers['User-Agent'], 'makaug-source-preview-cache/1.0');
    assert.equal(seen[1].headers.Referer, undefined);
  } finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('a copied X photo replaces the twimg row, and a failed copy keeps the source row', async () => {
  const source = { url: 'https://pbs.twimg.com/media/AbC123.jpg', slot_key: 'source_primary_image', room_label: 'Source listing image', is_primary: true, sort_order: 0 };
  const other = { url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg', slot_key: 'source_image_2', is_primary: false, sort_order: 1 };
  const hosted = 'https://media.makaug.com/x-post-photos/AbC123.jpg';
  const copied = await replaceTwimgRowsWithHostedCopies([source, other], {
    cache: async () => hosted,
  });
  assert.equal(copied.images[0].url, hosted);
  assert.equal(copied.images[0].slot_key, 'x_post_photo');
  assert.equal(copied.images[0].room_label, 'Photo from the X post');
  assert.equal(copied.images[0].is_primary, true);
  assert.equal(copied.images[1], other);
  assert.ok(copied.copiedSources.includes(source.url));
  assert.equal(realPhotoRejection(copied.images[0]), null);
  assert.equal(realPhotoRejection({ url: source.url, slot_key: 'x_post_photo' }), 'not_hosted_on_media');

  const kept = await replaceTwimgRowsWithHostedCopies([source], {
    cache: async (url, options) => {
      options.onError(new Error('timeout'));
      return null;
    },
  });
  assert.equal(kept.images[0].slot_key, 'source_primary_image');
  assert.equal(kept.images[0].url, source.url);
  assert.equal(kept.failures[0].error, 'timeout');
});

test('staff photos stay ahead of a hosted X photo, which stays ahead of a video still', () => {
  const staff = { url: 'https://media.makaug.com/properties/p/staff-images/1.jpg', slot_key: 'staff_upload', is_primary: false };
  const xPhoto = { url: 'https://media.makaug.com/x-post-photos/1.jpg', slot_key: 'x_post_photo', is_primary: true };
  const still = { url: 'https://media.makaug.com/listing/frame.jpg', slot_key: 'video_key_frame_1' };
  const raw = { url: 'https://pbs.twimg.com/media/AbC123.jpg', slot_key: 'x_post_photo', is_primary: true };
  const out = foundOnlinePublicImages([raw, xPhoto, still, staff], { image_rights_confirmed: true });
  assert.deepEqual(out.map((image) => image.url), [staff.url, xPhoto.url, still.url]);
  assert.deepEqual(out.map((image) => image.is_primary), [true, false, false]);
});

test('the backfill only retries twimg URLs that are not already recorded', () => {
  const original = 'https://pbs.twimg.com/media/AbC123.jpg';
  const normalized = normalizeTwimgPhotoUrl(original);
  const urls = twimgUrlsFromListing({
    images: [
      { url: original, slot_key: 'source_primary_image' },
      { url: 'https://media.makaug.com/x-post-photos/old.jpg', slot_key: 'x_post_photo' },
    ],
    extra: {
      photo_source_urls: [original, 'https://video.twimg.com/ext/thumb.jpg'],
      source_platform: 'X',
    },
  });
  assert.deepEqual(urls, [original, 'https://video.twimg.com/ext/thumb.jpg']);
  assert.deepEqual(twimgUrlsStillToCopy(urls, [normalized]), ['https://video.twimg.com/ext/thumb.jpg']);
  assert.equal(isXPlatform('X'), true);
  assert.equal(isXPlatform('Twitter'), true);
  assert.equal(isXPlatform('TikTok'), false);
});

test('harvest copies X photos at insert, and the backfill script stays dry-run until --confirm', () => {
  const service = read('services/socialSearchSourcedListingsService.js');
  assert.match(service, /if \(isXPlatform\(platform\)\) \{\s*const hosted = await replaceTwimgRowsWithHostedCopies\(imagesToStore\)/);
  assert.match(service, /x_post_photo_source_urls: xPostPhotoSourceUrls/);
  assert.match(service, /X post photo cache failed/);
  const script = read('scripts/backfill-x-post-photos.js');
  const pkg = read('package.json');
  assert.match(pkg, /"inventory:backfill-x-post-photos": "node scripts\/backfill-x-post-photos\.js"/);
  assert.match(script, /const CONFIRM = args\.includes\('--confirm'\)/);
  assert.match(script, /dry_run: true/);
  assert.match(script, /Pass --confirm to copy photos and write x_post_photo rows/);
  assert.match(script, /if \(require\.main === module\)/);
  assert.match(script, /slot_key, room_label/);
  assert.doesNotMatch(script, /process\.argv\.includes\('--confirm'\)[\s\S]{0,80}cacheXPostPhoto/);
});
