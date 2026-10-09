'use strict';

/**
 * Cover photos for listings that have none.
 *
 * 9 Oct 2026. An audit of the WhatsApp intake found eight properties with no
 * usable property image. Six of them had a walk-through video and nothing else,
 * and the job that turns a video into a cover photo had either never tried or
 * tried and left no trace: three pending properties carried
 * video_still_auto_attempted_at stamps from that morning with a key-frame count
 * still at zero, and three approved ones had never been attempted at all.
 *
 * Two things were wrong, and neither was the videos. (The videos are fine —
 * 16MB, valid MP4, served at 200. They just carry their metadata at the end of
 * the file, so a browser looks like it is hanging on them.)
 *
 *  1. The scheduler only ever looked at pending properties. A listing approved
 *     without a cover could therefore never get one, for as long as it existed.
 *  2. A failure was written to the log and nowhere else. From the data the only
 *     symptom was a key-frame count that stayed at zero, which records that a
 *     repair was tried but not why it did not work — so it had been failing
 *     invisibly for days.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const BACKFILL_PATH = require.resolve('../scripts/backfill-whatsapp-video-stills');
const SCHEDULER_PATH = require.resolve('../services/videoStillScheduler');

// A stand-in for the backfill script, so no video is downloaded and no ffmpeg
// is needed. SELECTION_SQL keeps the real clause the scheduler rewrites.
function installBackfillStub({ makeAndUploadStills, attachStills }) {
  require.cache[BACKFILL_PATH] = {
    id: BACKFILL_PATH,
    filename: BACKFILL_PATH,
    loaded: true,
    exports: {
      SELECTION_SQL: "SELECT p.id, p.status, p.created_at, p.extra_fields FROM properties p "
        + "WHERE p.source = 'whatsapp_employee_intake' AND p.status = 'pending' ORDER BY p.created_at ASC",
      makeAndUploadStills,
      attachStills
    }
  };
}

function freshScheduler() {
  delete require.cache[SCHEDULER_PATH];
  return require('../services/videoStillScheduler');
}

function fakeDb(row) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      if (/^\s*SELECT/i.test(text)) return { rows: row ? [row] : [] };
      return { rows: [] };
    }
  };
}

const PROPERTY = { id: 'prop-1', status: 'approved', created_at: new Date().toISOString(), extra_fields: {} };

test('an approved listing is no longer skipped', async () => {
  installBackfillStub({
    makeAndUploadStills: async () => [{ url: 'x' }],
    attachStills: async () => ({ attached: 1 })
  });
  const db = fakeDb(PROPERTY);
  await freshScheduler().tickVideoStills(db);
  const select = db.calls.find((c) => /^\s*SELECT/i.test(c.text));
  assert.ok(select, 'it should look for work');
  assert.match(select.text, /IN \('pending', 'approved'\)/,
    'a listing approved without a cover must still be reachable');
  assert.doesNotMatch(select.text, /p\.status = 'pending'/,
    'the pending-only clause should have been rewritten, not left beside the new one');
});

test('an approved listing is only revisited when it has no image at all', async () => {
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  const db = fakeDb(PROPERTY);
  await freshScheduler().tickVideoStills(db);
  const select = db.calls.find((c) => /^\s*SELECT/i.test(c.text));
  assert.match(select.text, /candidates\.status = 'pending'\s*\n?\s*OR NOT EXISTS/,
    'adding a first cover cannot overwrite a moderator choice; replacing existing images could');
  assert.match(select.text, /INTERVAL '30 minutes'/,
    'a coverless listing should be retried sooner than the old twelve hours');
});

test('a failure is recorded on the property, not just the log', async () => {
  installBackfillStub({
    makeAndUploadStills: async () => { throw new Error('ffmpeg exited with code 127'); },
    attachStills: async () => ({ attached: 0 })
  });
  const db = fakeDb(PROPERTY);
  const result = await freshScheduler().tickVideoStills(db);

  assert.match(result.error, /ffmpeg exited with code 127/);
  assert.strictEqual(result.propertyId, 'prop-1', 'the caller should learn which property failed');

  const write = db.calls.find((c) => /video_still_auto_error/.test(c.text) && /UPDATE/i.test(c.text));
  assert.ok(write, 'the reason must land on the property so it can be read back');
  assert.deepStrictEqual(write.values, ['prop-1', 'ffmpeg exited with code 127']);
});

test('a success clears a reason left by an earlier failure', async () => {
  installBackfillStub({
    makeAndUploadStills: async () => [{ url: 'x' }],
    attachStills: async () => ({ attached: 2 })
  });
  const db = fakeDb(PROPERTY);
  const result = await freshScheduler().tickVideoStills(db);
  assert.strictEqual(result.attached, 2);
  const cleared = db.calls.find((c) => /- 'video_still_auto_error'/.test(c.text));
  assert.ok(cleared, 'a stale reason would otherwise outlive the problem it described');
});

test('nothing to do is not an error', async () => {
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  const db = fakeDb(null);
  const result = await freshScheduler().tickVideoStills(db);
  assert.deepStrictEqual(result, { skipped: 'nothing_to_do' });
  assert.ok(!db.calls.some((c) => /UPDATE/i.test(c.text)), 'and must not write to anything');
});

test.after(() => {
  delete require.cache[BACKFILL_PATH];
  delete require.cache[SCHEDULER_PATH];
});

// ---------------------------------------------------------------------------
// The failure with no property to blame
// ---------------------------------------------------------------------------

test('a selection that throws is still reported to the caller', async () => {
  // The blind spot behind the blind spot. When the SELECT itself fails there is
  // no property to write the reason onto, so the job went quiet in exactly the
  // way the error-recording above was meant to stop. It must at least say so.
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  const db = {
    calls: [],
    async query(text) {
      this.calls.push({ text });
      if (/^\s*\n?\s*SELECT/i.test(text)) throw new Error('column "image_count" does not exist');
      return { rows: [] };
    }
  };
  const result = await freshScheduler().tickVideoStills(db);
  assert.match(result.error, /image_count/, 'the caller must learn why nothing was picked up');
  assert.strictEqual(result.propertyId, null, 'and that no property was involved');
});

test('the query is exported so it can be run from the admin API', () => {
  const { selectionQuery } = freshScheduler();
  const sql = selectionQuery({
    SELECTION_SQL: "SELECT p.id FROM properties p WHERE p.source = 'x' AND p.status = 'pending'"
  });
  assert.match(sql, /IN \('pending', 'approved'\)/);
  assert.match(sql, /LIMIT 1\s*$/, 'the admin endpoint widens this limit by replacing it');
});
