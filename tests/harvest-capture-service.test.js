'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  captureHarvestDetails,
  captureHarvestDetailsForItems,
  parseTikTokVideoPage,
  platformFor
} = require('../services/harvestCaptureService');

function res(status, body, type = 'text/html') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => type },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body)
  };
}

const TT_URL = 'https://www.tiktok.com/@kampalahomes/video/7400000000000000001';
const TT_PAGE = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"desc":"3 bed house in Kira, 450M UGX. Full caption \\u0026 more","author":{"uniqueId":"kampalahomes","signature":"Real estate Kampala\\nCall/WhatsApp 0772 123 456"},"cover":"https:\\u002F\\u002Fp16-sign.tiktokcdn-eu.com\\u002Fobj\\u002Fcover.jpeg"}</script>';

test('platformFor recognises TikTok and YouTube posts only', () => {
  assert.equal(platformFor({ sourceUrl: TT_URL }), 'tiktok');
  assert.equal(platformFor({ youtubeId: 'abcDEF12345' }), 'youtube');
  assert.equal(platformFor({ sourceUrl: 'https://www.youtube.com/shorts/abcDEF12345' }), 'youtube');
  assert.equal(platformFor({ sourceUrl: 'https://facebook.com/x' }), '');
});

test('parseTikTokVideoPage reads caption, bio, cover and handle', () => {
  const parsed = parseTikTokVideoPage(TT_PAGE);
  assert.match(parsed.caption, /3 bed house in Kira.*& more/);
  assert.match(parsed.bio, /0772 123 456/);
  assert.equal(parsed.cover, 'https://p16-sign.tiktokcdn-eu.com/obj/cover.jpeg');
  assert.equal(parsed.handle, 'kampalahomes');
});

test('TikTok capture stores full caption, +256 bio phone and a stored cover frame', async () => {
  const stored = [];
  const out = await captureHarvestDetails({ sourceUrl: TT_URL, caption: 'short' }, {
    fetchImpl: async (url) => (url === TT_URL ? res(200, TT_PAGE) : res(404, '')),
    storeRemoteImage: async (url, opts) => { stored.push({ url, opts }); return 'https://media.makaug.com/staff-video-cover/harvest/x.jpg'; }
  });
  assert.equal(out.harvest_capture_platform, 'tiktok');
  assert.match(out.harvest_caption_full, /Full caption & more/);
  assert.equal(out.poster_bio_phone, '+256772123456');
  assert.equal(out.harvest_cover_frame_url, 'https://media.makaug.com/staff-video-cover/harvest/x.jpg');
  assert.equal(stored[0].url, 'https://p16-sign.tiktokcdn-eu.com/obj/cover.jpeg');
  assert.equal(stored[0].opts.keyPrefix, 'staff-video-cover/harvest');
});

test('TikTok page blocked: falls back to oEmbed, phone stays empty, never throws', async () => {
  const out = await captureHarvestDetails({ sourceUrl: TT_URL, caption: '' }, {
    fetchImpl: async (url) => {
      if (url.startsWith('https://www.tiktok.com/oembed')) return res(200, { title: 'Plot in Wakiso', thumbnail_url: 'https://p16.tiktokcdn.com/t.jpg', author_url: 'https://www.tiktok.com/@kampalahomes' }, 'application/json');
      return res(403, 'blocked');
    },
    storeRemoteImage: async () => { throw Object.assign(new Error('storage off'), { status: 503 }); }
  });
  assert.equal(out.harvest_caption_full, 'Plot in Wakiso');
  assert.equal(out.poster_bio_phone, '');
  assert.equal(out.harvest_cover_frame_url, '');
  assert.equal(out.harvest_cover_source_url, 'https://p16.tiktokcdn.com/t.jpg');
  assert.ok(out.harvest_capture_errors.includes('video_page_403'));
  assert.ok(out.harvest_capture_errors.includes('cover_store_503'));
});

test('network errors everywhere still return an empty capture', async () => {
  const out = await captureHarvestDetails({ sourceUrl: TT_URL }, {
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
    storeRemoteImage: async () => null
  });
  assert.equal(out.poster_bio_phone, '');
  assert.equal(out.harvest_cover_frame_url, '');
});

test('YouTube capture uses API v3 channel description for the phone and the ytimg thumbnail', async () => {
  const calls = [];
  const out = await captureHarvestDetails({ youtubeId: 'abcDEF12345', caption: 'title' }, {
    apiKey: 'k',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/youtube/v3/videos')) return res(200, { items: [{ snippet: { description: 'Long description of the house', channelId: 'UC1' } }] });
      if (url.includes('/youtube/v3/channels')) return res(200, { items: [{ snippet: { description: 'Brokers. Tel +256 701 234567' } }] });
      return res(404, '');
    },
    storeRemoteImage: async (url) => `https://media.makaug.com/${url.split('/').pop()}`
  });
  assert.equal(out.harvest_caption_full, 'Long description of the house');
  assert.equal(out.poster_bio_phone, '+256701234567');
  assert.equal(out.harvest_cover_source_url, 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg');
  assert.equal(out.harvest_cover_frame_url, 'https://media.makaug.com/hqdefault.jpg');
  assert.ok(calls.some((u) => u.includes('channels?part=snippet&id=UC1')));
});

test('YouTube without an API key leaves the phone empty', async () => {
  const out = await captureHarvestDetails({ youtubeId: 'abcDEF12345', caption: 'x' }, {
    apiKey: '',
    fetchImpl: async () => res(404, ''),
    storeRemoteImage: async () => null
  });
  assert.equal(out.poster_bio_phone, '');
  assert.ok(out.harvest_capture_errors.includes('yt_api_key_missing'));
});

test('batch capture skips non-video items, caps the count and attaches results', async () => {
  const items = [{ sourceUrl: TT_URL }, { sourceUrl: 'https://facebook.com/p' }, { youtubeId: 'abcDEF12345' }, { youtubeId: 'zzzDEF12345' }];
  const n = await captureHarvestDetailsForItems(items, {
    delayMs: 0, maxItems: 2, apiKey: '',
    fetchImpl: async () => res(500, ''),
    storeRemoteImage: async () => null
  });
  assert.equal(n, 2);
  assert.ok(items[0].harvestCapture);
  assert.equal(items[1].harvestCapture, undefined);
  assert.ok(items[2].harvestCapture);
  assert.equal(items[3].harvestCapture, undefined);
});

test('importer merges capture onto the listing and adds the frame as an image', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../services/socialSearchSourcedListingsService.js'), 'utf8');
  assert.match(src, /captureHarvestDetailsForItems\(/);
  assert.match(src, /\.\.\.harvestCapture,/);
  assert.match(src, /slot_key: 'harvest_cover_frame'/);
  // capture runs before the transaction opens
  assert.ok(src.indexOf('captureHarvestDetailsForItems(\n') < src.indexOf("await lockFoundOnlineCanonicalKeys(client, items);"));
});

test('video cover uses the stored harvest frame for a TikTok page video', async () => {
  const { makeVideoCoverForListing, harvestCoverFrameFor } = require('../services/videoStillScheduler');
  assert.equal(harvestCoverFrameFor({}), null);
  const frame = 'https://media.makaug.com/staff-video-cover/harvest/a.jpg';
  const db = {
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    query: async () => ({ rows: [{ id: 'p1', status: 'pending', video_still_count: 0, extra_fields: { tiktok_url: TT_URL, harvest_cover_frame_url: frame } }] })
  };
  let attachedArgs;
  const backfill = { attachStills: async (id, stills, opts) => { attachedArgs = { id, stills, opts }; return { attached: 1 }; } };
  const result = await makeVideoCoverForListing(db, 'p1', { backfill });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.attached, 1);
  assert.equal(attachedArgs.stills[0].url, frame);
  assert.equal(attachedArgs.opts.setAsCover, true);
});

test('TikTok page video with no stored frame still gets the clear refusal', async () => {
  const { makeVideoCoverForListing } = require('../services/videoStillScheduler');
  const db = {
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    query: async () => ({ rows: [{ id: 'p2', status: 'pending', video_still_count: 0, extra_fields: { tiktok_url: TT_URL } }] })
  };
  const result = await makeVideoCoverForListing(db, 'p2', { backfill: { attachStills: async () => ({ attached: 1 }) } });
  assert.equal(result.ok, false);
  assert.match(result.error, /TikTok or Facebook page/);
});
