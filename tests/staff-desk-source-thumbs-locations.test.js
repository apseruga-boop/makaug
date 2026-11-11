'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isSignedTikTokCdnUrl,
  youtubeHqDefaultUrl,
  staffPreviewImage,
  sanitizeStaffPhotos,
  publicSafeStayImages,
  youtubePreviewFields,
} = require('../utils/staffSourceMedia');
const {
  resolveCanonicalUgandaLocation,
  canonicalLocationByKey,
  canonicalLocationSuggestions,
  crossDistrictStaffLocationHints,
  canonicalizeUgandaLocation,
} = require('../utils/ugandaLocationRegistry');
const { kampalaTownFor } = require('../utils/kampalaDivisions');
const { buildFoundOnlineShortStayRecord } = require('../services/foundOnlineShortStayIntake');

const SIGNED_TIKTOK = 'https://p16-sign-va.tiktokcdn-us.com/tos-useast2a-p-0068-euttp/abc~tplv.jpeg?x-expires=1762848000&x-signature=abcd';

test('signed TikTok CDN thumbs are rejected; YouTube hqdefault and media.makaug.com covers are kept', () => {
  assert.equal(isSignedTikTokCdnUrl(SIGNED_TIKTOK), true);
  assert.equal(isSignedTikTokCdnUrl('https://media.makaug.com/st/covers/abc.jpg'), false);
  assert.equal(
    youtubeHqDefaultUrl('https://www.youtube.com/watch?v=sYZoct4o-Qo'),
    'https://i.ytimg.com/vi/sYZoct4o-Qo/hqdefault.jpg'
  );

  const hosted = staffPreviewImage(
    { extra_fields: { source_url: 'https://www.tiktok.com/@host/video/1' } },
    [{ url: 'https://media.makaug.com/st/covers/tiktok-rehost.jpg' }, { url: SIGNED_TIKTOK }]
  );
  assert.equal(hosted.cover_url, 'https://media.makaug.com/st/covers/tiktok-rehost.jpg');
  assert.equal(hosted.cover_kind, 'rehosted');

  const youtube = staffPreviewImage({
    extra_fields: { source_url: 'https://www.youtube.com/watch?v=sYZoct4o-Qo', source_platform: 'youtube' },
  }, [{ url: 'https://i.ytimg.com/vi/sYZoct4o-Qo/maxresdefault.jpg' }]);
  assert.equal(youtube.cover_url, 'https://i.ytimg.com/vi/sYZoct4o-Qo/hqdefault.jpg');
  assert.equal(youtube.cover_kind, 'youtube_hqdefault');

  const placeholder = staffPreviewImage({
    extra_fields: { source_url: 'https://www.tiktok.com/@host/video/1', source_platform: 'tiktok' },
  }, [{ url: SIGNED_TIKTOK }]);
  assert.equal(placeholder.cover_url, null);
  assert.equal(placeholder.preview_placeholder, true);

  const photos = sanitizeStaffPhotos([{ url: SIGNED_TIKTOK, caption: 'cover' }], {
    extra_fields: { source_url: 'https://www.tiktok.com/@host/video/1' },
  });
  assert.equal(photos.some((item) => isSignedTikTokCdnUrl(item.url)), false);
  assert.deepEqual(publicSafeStayImages([{ url: SIGNED_TIKTOK }, { url: 'https://media.makaug.com/st/ok.jpg' }]).map((item) => item.url), [
    'https://media.makaug.com/st/ok.jpg',
  ]);
});

test('found-online short-stay intake attaches a YouTube hqdefault preview without a TikTok CDN thumb', () => {
  const youtube = buildFoundOnlineShortStayRecord({
    title: 'Apartment in Kololo',
    source_url: 'https://www.youtube.com/watch?v=sYZoct4o-Qo',
    sourcePlatform: 'youtube',
    youtubeId: 'sYZoct4o-Qo',
    district: 'Kampala',
    area: 'Kololo',
  });
  assert.equal(youtube.extra_fields.youtube_hqdefault_url, 'https://i.ytimg.com/vi/sYZoct4o-Qo/hqdefault.jpg');
  assert.equal(youtube.extra_fields.staff_preview_image_kind, 'youtube_hqdefault');
  assert.equal(youtubePreviewFields({ youtubeId: 'sYZoct4o-Qo' }).youtube_video_id, 'sYZoct4o-Qo');

  const tiktok = buildFoundOnlineShortStayRecord({
    title: 'Apartment in Kololo',
    source_url: 'https://www.tiktok.com/@host/video/1',
    sourcePlatform: 'tiktok',
    thumbnailUrl: SIGNED_TIKTOK,
    district: 'Kampala',
    area: 'Kololo',
  });
  assert.equal(tiktok.extra_fields.youtube_hqdefault_url, undefined);
  assert.ok(!String(JSON.stringify(tiktok)).includes('tiktokcdn'));
});

test('Makindye Kizungu is a Kampala / Makindye neighbourhood near Kizungu Secondary School', () => {
  const match = resolveCanonicalUgandaLocation('Makindye Kizungu', 'Kampala');
  assert.equal(match.status, 'matched');
  assert.equal(match.match.name, 'Kizungu');
  assert.equal(match.match.district, 'Kampala');
  assert.equal(kampalaTownFor('Kizungu'), 'Makindye');
  const entry = canonicalLocationByKey('kampala:kizungu');
  assert.ok(entry);
  assert.equal(entry.lat, 0.276);
  assert.equal(entry.lng, 32.590);
  assert.equal(canonicalizeUgandaLocation('Kizungu', 'Kampala').name, 'Kizungu');
});

test('typing Bugema while the district is Wakiso suggests Bugema (Luwero) and does not auto-resolve', () => {
  const resolution = resolveCanonicalUgandaLocation('Bugema', 'Wakiso');
  assert.notEqual(resolution.status, 'matched');
  const hints = crossDistrictStaffLocationHints('Bugema', 'Wakiso');
  assert.equal(hints.length, 1);
  assert.equal(hints[0].display_label, 'Bugema (Luwero)');
  assert.equal(hints[0].district, 'Luwero');
  assert.equal(hints[0].auto_resolvable, false);
  assert.match(hints[0].hint, /Luwero/);
  const suggestions = canonicalLocationSuggestions('Bugema', new Map(), 8, { district: 'Wakiso' });
  const bugema = suggestions.find((item) => item.canonical_key === 'luwero:bugema');
  assert.ok(bugema);
  assert.equal(bugema.auto_resolvable, false);
  assert.equal(bugema.display_label, 'Bugema (Luwero)');
});
