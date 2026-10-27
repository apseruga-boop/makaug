'use strict';

// 27 Oct 2026 moderator reports:
// - MK-20261026-A64E8E: "Make a cover from the video" attached two stills
//   (05:15 UTC) but the listing summary still said no photo, and the queue
//   card said "no approved property photo" while the review page approved
//   the listing on its own video.
// - A saved internal note never showed "Note saved".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const STAFF = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
const { syncListingImageSummaryAfterVideoCover } = require('../services/staffPropertyMediaService');

function grab(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = APP.indexOf(') {', start) + 2; i < APP.length; i += 1) {
    if (APP[i] === '{') depth += 1;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(name);
}

// Run one app function with every helper it calls stubbed to return "".
function isolated(name, keep = []) {
  const real = new Set(['String', 'Number', 'Array', 'Boolean', 'Object', 'JSON', 'Math', 'Date', 'RegExp',
    'encodeURIComponent', 'undefined', ...keep]);
  const stubs = new Proxy({}, {
    has: (target, key) => typeof key === 'string' && !real.has(key),
    get: (target, key) => (key === Symbol.unscopables ? undefined : () => '')
  });
  // eslint-disable-next-line no-new-func
  return new Function('stubs', `with (stubs) { ${grab(name)}; return ${name}; }`)(stubs);
}

const card = isolated('staffReviewQueueCardHtml', ['item', 'options']);
const A64 = {
  id: 'a90d30c5-78eb-4896-ab34-b84b7e2d0da1',
  area: 'Mutundwe',
  district: 'Kampala',
  price: 1400000000,
  extra_fields: { media_validation_status: 'blocked_no_usable_property_image', public_image_count: 0 }
};
const withExtra = (extra) => ({ ...A64, extra_fields: { ...A64.extra_fields, ...extra } });

test('queue card: a listing with its own video is not "Media blocked"', () => {
  const html = card(withExtra({ video_url: 'https://media.makaug.com/videos/a64e8e.mp4' }));
  assert.doesNotMatch(html, /Media blocked/);
  assert.match(html, /No photo yet/);
});

test('queue card: stills or photos on the listing clear the stale intake flag', () => {
  const html = card(withExtra({ public_image_count: 2, primary_image_url: 'https://media.makaug.com/stills/a.jpg' }));
  assert.doesNotMatch(html, /Media blocked/);
  assert.doesNotMatch(html, /No photo yet/);
});

test('queue card: no photo and no video is still blocked, and video recovery always is', () => {
  assert.match(card(A64), /Media blocked/);
  assert.match(card(withExtra({ video_url: 'https://media.makaug.com/v.mp4', video_recovery_required: true })), /Media blocked/);
});

test('a staff video cover rewrites the image summary and clears the no-photo flag', async () => {
  const writes = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (/^\s*SELECT id, url, slot_key, is_primary FROM property_images/.test(text)) {
        return { rows: [
          { id: 1, url: 'https://media.makaug.com/stills/1.jpg', slot_key: 'video_key_frame_1', is_primary: true },
          { id: 2, url: 'https://media.makaug.com/stills/2.jpg', slot_key: 'video_key_frame_2', is_primary: false }
        ] };
      }
      writes.push({ text, params });
      return { rows: [] };
    }
  };
  const summary = await syncListingImageSummaryAfterVideoCover(client, A64.id);
  assert.equal(summary.public_image_count, 2);
  assert.equal(summary.primary_image_url, 'https://media.makaug.com/stills/1.jpg');
  assert.ok(writes.some((w) => /public_image_count|\$2::jsonb/.test(w.text) && JSON.parse(w.params[1]).public_image_count === 2));
  const flag = writes.find((w) => /passed_repair_image_gate/.test(w.text));
  assert.ok(flag, 'the stale flag is cleared');
  assert.match(flag.text, /media_validation_status' = 'blocked_no_usable_property_image'/, 'only that flag is changed');
});

test('the video-cover route syncs the summary for every non-preview success', () => {
  const start = STAFF.indexOf("router.post('/properties/:id/video-cover'");
  const body = STAFF.slice(start, STAFF.indexOf('router.post(', start + 10));
  assert.match(body, /result\.preview !== true\)[\s\S]*syncListingImageSummaryAfterVideoCover\(db, req\.params\.id\)/);
});

test('saving with a note says "Note saved" and moves the note into the history', () => {
  const save = grab('saveStaffListingPreview');
  assert.match(save, /noteSent \? "Saved\. Note saved\."/);
  assert.match(save, /staffShowSavedReviewNote\(saved\)/);
  const show = grab('staffShowSavedReviewNote');
  assert.match(show, /data-staff-note-history/);
  assert.match(show, /textarea\.value = ""/);
  assert.match(show, /"Note saved\."/);
});
