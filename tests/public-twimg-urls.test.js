'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../routes/properties');

const TWIMG = 'https://pbs.twimg.com/media/abc.jpg';
const VIDEO_TWIMG = 'https://video.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg';
const OURS = 'https://media.makaug.com/listings/a.jpg';

function listing(extra) {
  return {
    id: '496006a9-d203-437c-a722-d99fe7d8df03',
    title: 'House in Kira',
    listing_type: 'sale',
    property_type: 'House',
    status: 'approved',
    area: 'Kira',
    district: 'Wakiso',
    price: 150000000,
    extra_fields: extra
  };
}

test('twimg hosts are recognised and other image hosts are not', () => {
  assert.equal(_test.isTwimgHostedUrl(TWIMG), true);
  assert.equal(_test.isTwimgHostedUrl(VIDEO_TWIMG), true);
  assert.equal(_test.isTwimgHostedUrl('https://twimg.com/a.jpg'), true);
  assert.equal(_test.isTwimgHostedUrl('https://pbs.twimg.com.evil.example/a.jpg'), false);
  assert.equal(_test.isTwimgHostedUrl(OURS), false);
  assert.equal(_test.isTwimgHostedUrl('https://twitter.com/makaug/status/1'), false);
});

test('public listing JSON omits twimg thumbnails and keeps a later hosted image', () => {
  const onlyTwimg = _test.publicPropertyRow(listing({
    thumbnail_url: TWIMG,
    source_thumbnail_url: TWIMG,
    video_thumbnail_url: VIDEO_TWIMG,
    cover_image_url: TWIMG,
    tiktok_thumbnail_url: TWIMG,
    oembed_thumbnail_url: VIDEO_TWIMG
  }), [], { privileged: false });
  for (const key of ['thumbnail_url', 'source_thumbnail_url', 'video_thumbnail_url', 'cover_image_url', 'tiktok_thumbnail_url', 'oembed_thumbnail_url']) {
    assert.equal(onlyTwimg.extra_fields[key], null, key);
  }
  assert.equal(JSON.stringify(onlyTwimg).includes('twimg.com'), false);

  const withFallback = _test.publicPropertyRow(listing({
    thumbnail_url: TWIMG,
    source_thumbnail_url: VIDEO_TWIMG,
    video_thumbnail_url: TWIMG,
    cover_image_url: OURS
  }), [], { privileged: false });
  assert.equal(withFallback.extra_fields.thumbnail_url, OURS);
  assert.equal(withFallback.extra_fields.source_thumbnail_url, OURS);
  assert.equal(withFallback.extra_fields.video_thumbnail_url, OURS);
  assert.equal(withFallback.extra_fields.cover_image_url, OURS);
  assert.equal(JSON.stringify(withFallback.extra_fields).includes('twimg.com'), false);
});

test('staff preview keeps twimg thumbnails', () => {
  const staff = _test.publicPropertyRow(listing({
    thumbnail_url: TWIMG,
    source_thumbnail_url: TWIMG,
    video_thumbnail_url: VIDEO_TWIMG,
    cover_image_url: TWIMG
  }), [], { privileged: true });
  assert.equal(staff.extra_fields.thumbnail_url, TWIMG);
  assert.equal(staff.extra_fields.source_thumbnail_url, TWIMG);
  assert.equal(staff.extra_fields.cover_image_url, TWIMG);
  assert.equal(staff.extra_fields.video_thumbnail_url, TWIMG);
});

test('public cards omit twimg thumbnails', () => {
  const card = _test.compactPublicCardRow({
    id: '496006a9-d203-437c-a722-d99fe7d8df03',
    title: 'House in Kira',
    listing_type: 'sale',
    property_type: 'House',
    status: 'approved',
    area: 'Kira',
    district: 'Wakiso',
    extra_fields: {
      thumbnail_url: TWIMG,
      source_thumbnail_url: VIDEO_TWIMG,
      cover_image_url: TWIMG
    }
  });
  assert.equal(card.extra_fields.thumbnail_url, null);
  assert.equal(card.extra_fields.source_thumbnail_url, null);
  assert.equal(JSON.stringify(card.extra_fields).includes('twimg.com'), false);

  const kept = _test.compactPublicCardRow({
    id: '496006a9-d203-437c-a722-d99fe7d8df03',
    title: 'House in Kira',
    listing_type: 'sale',
    property_type: 'House',
    status: 'approved',
    area: 'Kira',
    district: 'Wakiso',
    extra_fields: {
      thumbnail_url: TWIMG,
      cover_image_url: OURS
    }
  });
  assert.equal(kept.extra_fields.thumbnail_url, OURS);
});
