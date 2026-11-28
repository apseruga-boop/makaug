'use strict';

/**
 * TikTok listings get a saved cover picture (Arthur, 28 Nov 2026).
 * TikTok's own cover links expire, so listings that came from a TikTok video
 * had no photo and could not be approved. These tests pin the behaviour with
 * no network and no database: fetch, storage and the DB client are stand-ins.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  COVER_SLOT,
  isTikTokVideoUrl,
  tiktokVideoUrlFromExtra,
  parseTikTokPage,
  findTikTokCoverSource,
  saveTikTokCoverForListing,
} = require('../services/tiktokCoverService');
const { tickTikTokCovers, selectionQuery } = require('../services/tiktokCoverScheduler');

const VIDEO = 'https://www.tiktok.com/@someagent/video/7689133677304925447';
const COVER = 'https://p16-common-sign.tiktokcdn-eu.com/tos-alisg-p-0037/abc~tplv-tiktokx-origin.image?x-expires=1796029200&x-signature=zzz';
const OTHER_COVER = 'https://p16-common-sign.tiktokcdn-eu.com/tos-alisg-p-0037/other~tplv.image?x-expires=1&x-signature=y';
const HOSTED = 'https://media.makaug.com/tiktok-covers/7689133677304925447.jpg';

function pageHtml(detail) {
  const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': detail } };
  return `<html><head><meta property="og:image" content="${COVER}&amp;og=1"/></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

function okResponse(body, json) {
  return { ok: true, status: 200, text: async () => body, json: async () => json };
}

test('only a real TikTok video link counts, never a profile', () => {
  assert.ok(isTikTokVideoUrl(VIDEO));
  assert.ok(isTikTokVideoUrl('https://vm.tiktok.com/ZMabc123/'));
  assert.equal(isTikTokVideoUrl('https://www.tiktok.com/@homztel'), false);
  assert.equal(isTikTokVideoUrl('https://www.youtube.com/watch?v=yr9sTv5CLZM'), false);
  assert.equal(tiktokVideoUrlFromExtra({ source_url: 'https://www.tiktok.com/@homztel', video_url: VIDEO }), VIDEO);
  assert.equal(tiktokVideoUrlFromExtra({ source_url: 'https://www.tiktok.com/@homztel' }), '');
});

test('the page parser reads this video\'s own cover and ignores another video\'s', () => {
  const good = parseTikTokPage(pageHtml({ statusCode: 0, itemInfo: { itemStruct: { id: '7689133677304925447', video: { cover: COVER } } } }), '7689133677304925447');
  assert.equal(good.cover, COVER);
  const wrong = parseTikTokPage(pageHtml({ statusCode: 0, itemInfo: { itemStruct: { id: '999', video: { cover: OTHER_COVER } } } }), '7689133677304925447');
  assert.equal(wrong.cover, '');
  const gone = parseTikTokPage(pageHtml({ statusCode: 10204, statusMsg: "item doesn't exist" }), '7689133677304925447');
  assert.equal(gone.statusCode, 10204);
});

test('source order: page cover, then og:image, then oEmbed; a deleted video stops the search', async () => {
  const detail = { statusCode: 0, itemInfo: { itemStruct: { id: '7689133677304925447', video: { cover: COVER } } } };
  const viaPage = await findTikTokCoverSource(VIDEO, { fetchImpl: async () => okResponse(pageHtml(detail)) });
  assert.deepEqual([viaPage.kind, viaPage.coverUrl], ['page', COVER]);

  const noCover = { statusCode: 0, itemInfo: { itemStruct: { id: '7689133677304925447', video: {} } } };
  const viaOg = await findTikTokCoverSource(VIDEO, { fetchImpl: async () => okResponse(pageHtml(noCover)) });
  assert.equal(viaOg.kind, 'og_image');

  const calls = [];
  const viaOembed = await findTikTokCoverSource(VIDEO, {
    fetchImpl: async (url) => {
      calls.push(url);
      if (/oembed/.test(url)) return okResponse('', { thumbnail_url: COVER });
      return { ok: false, status: 403, text: async () => '' };
    },
  });
  assert.equal(viaOembed.kind, 'oembed');
  assert.equal(calls.length, 2);

  const oembedCalls = [];
  const deleted = await findTikTokCoverSource(VIDEO, {
    fetchImpl: async (url) => {
      if (/oembed/.test(url)) oembedCalls.push(url);
      return okResponse(pageHtml({ statusCode: 10204 }));
    },
  });
  assert.equal(deleted.coverUrl, '');
  assert.equal(deleted.unavailable, 'video_deleted');
  assert.equal(oembedCalls.length, 0);
});

test('a cover link on a host that is not TikTok\'s image CDN is refused', async () => {
  const evil = { statusCode: 0, itemInfo: { itemStruct: { id: '7689133677304925447', video: { cover: 'https://evil.example.com/x.jpg' } } } };
  const found = await findTikTokCoverSource(VIDEO, {
    fetchImpl: async (url) => (/oembed/.test(url) ? { ok: false, status: 400 } : okResponse(pageHtml(evil).replace(/<meta[^>]+>/, ''))),
  });
  assert.equal(found.coverUrl, '');
});

// A DB client stand-in that records what was written.
function fakeDb({ images }) {
  const log = [];
  const client = {
    async query(sql, params) {
      log.push({ sql: String(sql), params });
      if (/FROM property_images WHERE property_id/.test(sql)) return { rows: images };
      if (/INSERT INTO property_images/.test(sql)) return { rows: [{ id: 'new-image-id' }] };
      return { rows: [] };
    },
    release() { log.push({ sql: 'RELEASE' }); },
  };
  return { log, db: { pool: { async connect() { return client; } } } };
}

test('saving a cover adds one row, makes it primary over an evidence card, and logs the backup', async () => {
  const { log, db } = fakeDb({ images: [{ id: 'card-1', url: 'data:image/svg+xml;base64,AAAA', slot_key: 'source_evidence_card', room_label: 'Source evidence card - image pending', is_primary: true, sort_order: 0 }] });
  const stored = [];
  const result = await saveTikTokCoverForListing(db, { id: 'p-1', extra_fields: { video_url: VIDEO } }, {
    findSource: async () => ({ coverUrl: COVER, kind: 'page', errors: [] }),
    storeRemoteImage: async (url, options) => { stored.push({ url, options }); return HOSTED; },
  });
  assert.equal(result.status, 'saved');
  assert.equal(stored[0].url, COVER);
  assert.equal(stored[0].options.keyPrefix, 'tiktok-covers');
  assert.ok(stored[0].options.allowedHosts.includes('tiktokcdn-eu.com'));
  const sqls = log.map((entry) => entry.sql);
  assert.ok(sqls.includes('BEGIN') && sqls.includes('COMMIT'));
  const demote = log.find((entry) => /SET is_primary = false/.test(entry.sql));
  assert.deepEqual(demote.params[0], ['card-1']);
  const insert = log.find((entry) => /INSERT INTO property_images/.test(entry.sql));
  assert.deepEqual(insert.params, ['p-1', HOSTED, true, 1, COVER_SLOT, 'TikTok video cover']);
  const backup = log.find((entry) => /INSERT INTO tiktok_cover_log/.test(entry.sql));
  assert.deepEqual(backup.params[5], ['card-1']);
  const update = log.find((entry) => /UPDATE properties/.test(entry.sql));
  assert.ok(!/status\s*=/.test(update.sql.replace(/tiktok_cover_status/g, '')), 'listing status is never written');
  assert.ok(!/previous_lister_checked|latitude|longitude|moderation/i.test(update.sql));
});

test('a listing that already has our cover is left alone', async () => {
  const { log, db } = fakeDb({ images: [{ id: 'c', url: HOSTED, slot_key: COVER_SLOT, room_label: 'TikTok video cover', is_primary: true, sort_order: 0 }] });
  const result = await saveTikTokCoverForListing(db, { id: 'p-1', extra_fields: { video_url: VIDEO } }, {
    findSource: async () => ({ coverUrl: COVER, kind: 'page', errors: [] }),
    storeRemoteImage: async () => HOSTED,
  });
  assert.equal(result.status, 'skipped');
  assert.ok(!log.some((entry) => /INSERT INTO/.test(entry.sql)));
});

test('failures are reported, not thrown: no cover found, storage off, deleted video', async () => {
  const { db } = fakeDb({ images: [] });
  const listing = { id: 'p-1', extra_fields: { video_url: VIDEO } };
  const none = await saveTikTokCoverForListing(db, listing, { findSource: async () => ({ coverUrl: '', unavailable: '', errors: ['video_page_403'] }) });
  assert.deepEqual([none.status, none.error], ['failed', 'video_page_403']);
  const off = await saveTikTokCoverForListing(db, listing, { findSource: async () => ({ coverUrl: COVER, kind: 'page', errors: [] }), storeRemoteImage: async () => null });
  assert.equal(off.status, 'failed');
  assert.match(off.error, /storage_not_configured/i);
  const gone = await saveTikTokCoverForListing(db, listing, { findSource: async () => ({ coverUrl: '', unavailable: 'video_deleted', errors: [] }) });
  assert.deepEqual([gone.status, gone.error], ['unavailable', 'video_deleted']);
  const noUrl = await saveTikTokCoverForListing(db, { id: 'p-2', extra_fields: {} }, {});
  assert.equal(noUrl.error, 'no_tiktok_video_url');
});

test('selection: pending and approved TikTok video listings with no real photo, never rejected ones', () => {
  const sql = selectionQuery();
  assert.match(sql, /p\.status IN \('pending', 'approved'\)/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /tiktok_cover_status/);
  assert.match(sql, /ORDER BY \(p\.status = 'pending'\) DESC/);
  assert.ok(!/UPDATE|INSERT|DELETE/i.test(sql), 'selection only reads');
});

test('a tick records a failure note with a retry count and does not change status', async () => {
  const writes = [];
  const db = {
    pool: { waitingCount: 0 },
    async query(sql, params) {
      if (/SELECT p\.id::text/.test(sql)) return { rows: [{ id: 'p-1', status: 'pending', extra_fields: { video_url: VIDEO } }, { id: 'p-2', status: 'approved', extra_fields: { video_url: VIDEO } }] };
      writes.push({ sql, params });
      return { rows: [] };
    },
  };
  let cleared = 0;
  const summary = await tickTikTokCovers(db, {
    eventLoopP95Ms: 1,
    clearCaches: () => { cleared += 1; },
    deps: {
      delayMs: 0,
      findSource: async (url) => ({ coverUrl: '', unavailable: '', errors: ['video_page_403'] }),
    },
  });
  assert.deepEqual([summary.picked, summary.failed, summary.saved], [2, 2, 0]);
  assert.equal(writes.length, 2);
  assert.match(writes[0].sql, /tiktok_cover_attempts/);
  assert.deepEqual(writes[0].params, ['p-1', 'failed', 'video_page_403']);
  assert.equal(cleared, 0);
});

test('a busy site skips the tick', async () => {
  const r = await tickTikTokCovers({ pool: { waitingCount: 3 }, query: async () => { throw new Error('should not query'); } });
  assert.equal(r.skipped, 'busy_traffic');
});

test('migration 253 only adds a log table; the rollback undoes it without touching status', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'db/migrations/253_tiktok_cover_log.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tiktok_cover_log/);
  assert.ok(!/\bUPDATE\s+\w|DELETE\s+FROM|INSERT\s+INTO|ALTER\s+TABLE\s+properties/i.test(migration.replace(/^--.*$/gm, '')), 'migration writes no listing data');
  const rollback = fs.readFileSync(path.join(root, 'scripts/rollback-253-tiktok-covers.sql'), 'utf8');
  assert.match(rollback, /DELETE FROM property_images/);
  assert.match(rollback, /demoted_image_ids/);
  assert.ok(!/status\s*=\s*'(?:approved|pending|rejected)/i.test(rollback));
});

test('the job is wired into server startup and can be turned off', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /startTikTokCoverScheduler\(db\)/);
  const scheduler = fs.readFileSync(path.join(root, 'services/tiktokCoverScheduler.js'), 'utf8');
  assert.match(scheduler, /TIKTOK_COVER_AUTO/);
});

// AC6732: the same YouTube thumbnail five times, then our copy last.
function previewContext() {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = source.indexOf('function staffPreviewImageOrder(');
  const end = source.indexOf('let staffPhotoChangePending', start);
  const context = { adminAttr: String, adminEscape: String, propertyIdArg: JSON.stringify, staffEmpty: String, adminActiveReview: null, staffPreviewMediaBasisHtml: () => '', staffPreviewVideoCoverHtml: () => '', staffPreviewPhotoUploadHtml: () => '' };
  vm.runInNewContext(source.slice(start, end), context);
  return context;
}

test('staff preview: our saved copy leads and the same YouTube picture shows once (AC6732)', () => {
  const yt = (file, slot, primary) => ({ id: slot, url: `https://i.ytimg.com/vi/yr9sTv5CLZM/${file}`, slot_key: slot, is_primary: primary });
  const images = [
    yt('maxresdefault.jpg', 'source_primary_image', true),
    yt('sddefault.jpg', 'source_image_2', false),
    yt('hqdefault.jpg', 'source_image_3', false),
    yt('mqdefault.jpg', 'source_image_4', false),
    yt('default.jpg', 'source_image_5', false),
    { id: 'own', url: 'https://media.makaug.com/staff-video-cover/harvest/x.jpg', slot_key: 'harvest_cover_frame', room_label: 'Video cover frame', is_primary: false },
  ];
  const ordered = previewContext().staffPreviewImageOrder(images);
  assert.deepEqual(ordered.map((image) => image.id), ['own', 'source_primary_image']);
  assert.equal(ordered[1].staff_other_sizes, 4);
  const html = previewContext().staffPreviewImagesHtml(images, 'prop-1', []);
  assert.equal((html.match(/>Remove photo</g) || []).length, 2);
  assert.match(html, /YouTube thumbnail \(external link, not our copy\), 4 more sizes hidden/);
});

test('staff preview: a saved TikTok cover shows first and says it is our copy', () => {
  const images = [
    { id: 'card', url: 'data:image/svg+xml;base64,AAA', slot_key: 'source_evidence_card', is_primary: false },
    { id: 'cover', url: 'https://media.makaug.com/tiktok-covers/1.jpg', slot_key: 'video_still_tiktok_cover', is_primary: true },
  ];
  const html = previewContext().staffPreviewImagesHtml(images, 'prop-1', []);
  assert.match(html, /TikTok cover \(our saved copy\)/);
  assert.ok(html.indexOf('tiktok-covers/1.jpg') < html.indexOf('data:image/svg+xml'));
});
