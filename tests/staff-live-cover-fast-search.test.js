'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const scheduler = require('../services/videoStillScheduler');
const { mediaHost } = require('../utils/realListingPhoto');

const staff = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const backfill = fs.readFileSync(path.join(__dirname, '../scripts/backfill-whatsapp-video-stills.js'), 'utf8');

function fakeDb(row) {
  return {
    pool: { waitingCount: 0 },
    async query() { return { rows: row ? [row] : [] }; }
  };
}

test('a live listing gets a video cover without leaving the live set', async () => {
  const mp4 = `https://${mediaHost()}/videos/tour.mp4`;
  const calls = [];
  const backfillStub = {
    FRAME_CANDIDATE_COUNT: 8,
    killLiveChildren() {},
    async makeAndUploadStills() { return [{ url: `https://${mediaHost()}/stills/cover.jpg` }]; },
    async attachStills(_id, _uploaded, options) {
      calls.push(options);
      return { attached: 1 };
    }
  };
  for (const status of ['approved', 'live', 'published']) {
    const made = await scheduler.makeVideoCoverForListing(
      fakeDb({ id: 'p1', status, extra_fields: { video_url: mp4 } }),
      'p1',
      { backfill: backfillStub, actorId: 'moderator' }
    );
    assert.equal(made.ok, true, status);
    assert.equal(made.listingStatus, status);
  }
  assert.deepEqual(calls.map((options) => options.coverLiveListing), [true, true, true]);
  assert.ok(calls.every((options) => options.keepListingText === true && !options.reopenApproved));

  const pending = await scheduler.makeVideoCoverForListing(
    fakeDb({ id: 'p1', status: 'pending', extra_fields: { video_url: mp4 } }),
    'p1',
    { backfill: backfillStub, actorId: 'moderator' }
  );
  assert.equal(pending.ok, true);
  assert.equal(calls.at(-1).coverLiveListing, undefined);

  const removed = await scheduler.makeVideoCoverForListing(
    fakeDb({ id: 'p1', status: 'rejected', extra_fields: { video_url: mp4 } }),
    'p1',
    { backfill: backfillStub }
  );
  assert.equal(removed.ok, false);
  assert.equal(removed.status, 409);
});

test('the live cover keeps status, becomes the primary still, and refreshes public caches', () => {
  const route = staff.slice(staff.indexOf("router.post('/properties/:id/video-cover'"), staff.indexOf("router.post('/properties/:id/videos/remove'"));
  assert.match(route, /clearPublicListingCaches\('staff_live_video_cover'\)/);
  assert.match(route, /invalidatePublicInventoryMetricsCache\('staff_live_video_cover'\)/);
  assert.match(route, /\['approved', 'live', 'published'\]/);
  assert.doesNotMatch(route, /status\s*=\s*'pending'|SET status/);

  const attach = backfill.slice(backfill.indexOf('async function attachStills'), backfill.indexOf('async function quarantineWhatsappVideoScreenshots'));
  assert.match(attach, /coverLiveListing/);
  assert.match(attach, /coverLiveListing \? property\.status : 'pending'/);
  assert.match(attach, /coverLiveListing \? \{\} : \{/);
  assert.match(attach, /review_only: true/);
  assert.match(attach, /SET is_primary = FALSE/);
  assert.match(attach, /CASE WHEN \$4::boolean THEN 'pending' ELSE status END/);
  assert.match(app, /cover\.disabled = !consent/);
  assert.match(app, /Tick the rights box below/);
});
