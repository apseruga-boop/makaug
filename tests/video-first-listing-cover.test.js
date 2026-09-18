'use strict';

// Guards the rule that listings arriving with a video walkthrough and no photo of their own
// lead with the video, instead of the generic stock house-and-keys placeholder.
//
// This broke once: 43 live agent listings from the WhatsApp intake had videos and no photos,
// and every card and property page showed the same Unsplash stock photo, dressed up as a real
// gallery shot labelled "Front / exterior". More listings arrive this way every week, so the
// behaviour is pinned here rather than left to be rediscovered.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');

const STOCK_PHOTO_ID = 'photo-1560518883-ce09059eeffa';
const BLOCK_START = '// Stock house-and-keys photo makaug drops in when a listing has no photo of its own.';
const BLOCK_END = 'function renderLpVideoPreview()';

function loadVideoFirstHelpers() {
  const start = frontend.indexOf(BLOCK_START);
  assert.notStrictEqual(start, -1, 'video-first helper block is missing from assets/makaug-app.js');
  const end = frontend.indexOf(BLOCK_END, start);
  assert.notStrictEqual(end, -1, 'could not find the end of the video-first helper block');
  const source = frontend.slice(start, end);

  const sandbox = {
    // Minimal stand-ins for the globals the block leans on.
    adminAttr: (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    translateListingLabel: (value) => value,
    isFoundOnlineListing: (property) => property && property.listing_origin === 'found_online',
    getYouTubeEmbedUrl: (url) => {
      const match = String(url || '').match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{6,})/);
      return match ? `https://www.youtube-nocookie.com/embed/${match[1]}?rel=0` : '';
    },
    propertyVideoUrls: (property = {}) => {
      const extra = property.extra_fields || {};
      const raw = [
        ...(Array.isArray(extra.video_urls) ? extra.video_urls : []),
        ...(Array.isArray(extra.video_tours) ? extra.video_tours.map((item) => (item && item.url) || item) : []),
        property.video_url,
        property.youtube_url,
        extra.video_url
      ];
      return [...new Set(raw.map((value) => String(value || '').trim()).filter((value) => /^https?:\/\//i.test(value)))];
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

const MP4 = 'https://media.makaug.com/whatsapp-employee-intake/video/sample-1.mp4';
const PHOTO = 'https://media.makaug.com/properties/abc/real-photo.jpg';
const STOCK = `https://images.unsplash.com/${STOCK_PHOTO_ID}?w=900&q=80`;

test('a listing with a video and no photo leads with the video', () => {
  const { propertyVideoFirstMedia } = loadVideoFirstHelpers();
  const media = propertyVideoFirstMedia({ images: [], extra_fields: { video_urls: [MP4] } });
  assert.ok(media, 'expected video-first media for a listing with a video and no photo');
  assert.strictEqual(media.kind, 'mp4');
  assert.strictEqual(media.url, MP4);
});

test('a listing whose only photo is the stock placeholder still leads with the video', () => {
  const { propertyVideoFirstMedia } = loadVideoFirstHelpers();
  const media = propertyVideoFirstMedia({ images: [], primary_image_url: STOCK, extra_fields: { video_urls: [MP4] } });
  assert.ok(media, 'the stock placeholder must never count as a real photo');
});

test('a listing with a real photo is left alone', () => {
  const { propertyVideoFirstMedia } = loadVideoFirstHelpers();
  const media = propertyVideoFirstMedia({ images: [{ url: PHOTO }], extra_fields: { video_urls: [MP4] } });
  assert.strictEqual(media, null, 'a listing with its own photo must keep the photo as its cover');
});

test('a listing with neither photo nor video keeps the existing placeholder behaviour', () => {
  const { propertyVideoFirstMedia } = loadVideoFirstHelpers();
  assert.strictEqual(propertyVideoFirstMedia({ images: [], extra_fields: {} }), null);
});

test('found-online listings keep their own source treatment', () => {
  const { propertyVideoFirstMedia } = loadVideoFirstHelpers();
  const media = propertyVideoFirstMedia({ images: [], listing_origin: 'found_online', extra_fields: { video_urls: [MP4] } });
  assert.strictEqual(media, null, 'found-online listings are rendered by the source-preview path');
});

test('a YouTube walkthrough uses its own thumbnail, not the stock photo', () => {
  const { propertyVideoFirstMedia } = loadVideoFirstHelpers();
  const media = propertyVideoFirstMedia({ images: [], youtube_url: 'https://youtu.be/abc123xyz', extra_fields: {} });
  assert.ok(media, 'expected video-first media for a YouTube-only listing');
  assert.strictEqual(media.kind, 'youtube');
  assert.match(media.poster, /ytimg\.com/);
});

test('the card cover renders the video frame and never the stock photo', () => {
  const { propertyVideoFirstMedia, videoFirstTileHtml } = loadVideoFirstHelpers();
  const media = propertyVideoFirstMedia({ images: [], extra_fields: { video_urls: [MP4] } });
  const html = videoFirstTileHtml(media, { alt: 'Land for sale in Kira' });
  assert.match(html, /<video/, 'the cover must be a video element');
  assert.match(html, /data-video-first-frame=/, 'the frame must load lazily, not eagerly');
  assert.match(html, /preload="none"/, 'off-screen cards must not download video data');
  assert.ok(!html.includes(STOCK_PHOTO_ID), 'the stock photo must not appear on a video-first cover');
});

test('the card cover only fetches its frame once scrolled into view', () => {
  const source = frontend.slice(frontend.indexOf(BLOCK_START));
  assert.match(source, /IntersectionObserver/, 'card frames must be hydrated by an IntersectionObserver');
  assert.match(source, /hydrateVideoFirstFrame/, 'the lazy hydration helper must exist');
});

test('the listing normaliser does not hand the stock photo to a video-first listing', () => {
  const line = frontend.split('\n').find((text) => text.includes('img: thirdPartyDiscovery ?'));
  assert.ok(line, 'could not find the listing image normaliser');
  assert.match(line, /videoFirstMedia/, 'the normaliser must skip the stock fallback when a video cover is available');
});

test('the property page hero plays the video instead of showing a fabricated gallery', () => {
  assert.match(frontend, /detailVideoFirstMedia/, 'the property page must compute video-first media');
  assert.match(frontend, /hidePhotoGallery/, 'the fake one-photo gallery must be suppressed for video-first listings');
  assert.match(frontend, /detail-gallery-hero-video/, 'the hero must render a video player for video-first listings');
});
