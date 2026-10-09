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
  assert.deepStrictEqual(write.values, ['prop-1', 'ffmpeg exited with code 127', 3],
    'the reason, plus the attempt limit the failure count is checked against');
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

function armWithFakeTimers(scheduler, env = {}) {
  const timers = [];
  const realInterval = global.setInterval;
  const realTimeout = global.setTimeout;
  global.setInterval = (fn, ms) => { timers.push(['interval', ms]); return { unref() {} }; };
  global.setTimeout = (fn, ms) => { timers.push(['timeout', ms]); return { unref() {} }; };
  const saved = { DATABASE_URL: process.env.DATABASE_URL, VIDEO_STILL_AUTO: process.env.VIDEO_STILL_AUTO };
  process.env.DATABASE_URL = saved.DATABASE_URL || 'postgres://test';
  if ('VIDEO_STILL_AUTO' in env) {
    if (env.VIDEO_STILL_AUTO === undefined) delete process.env.VIDEO_STILL_AUTO;
    else process.env.VIDEO_STILL_AUTO = env.VIDEO_STILL_AUTO;
  }
  try {
    scheduler.startVideoStillScheduler(fakeDb(null));
  } finally {
    global.setInterval = realInterval;
    global.setTimeout = realTimeout;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return timers;
}

test('the scheduler does not arm unless VIDEO_STILL_AUTO=true', () => {
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  for (const value of [undefined, '', 'false', '1', 'yes']) {
    const timers = armWithFakeTimers(freshScheduler(), { VIDEO_STILL_AUTO: value });
    assert.deepStrictEqual(timers, [], `VIDEO_STILL_AUTO=${JSON.stringify(value)} must not arm it`);
  }
});

test('armed, the first tick waits ten minutes after boot', async () => {
  // 9 Oct: a 60 s kick after every boot meant a run of deploys stacked ticks
  // on start-up. A kick still comes, so a deploy is not always an idle
  // interval, but not before ten minutes.
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  const timers = armWithFakeTimers(freshScheduler(), { VIDEO_STILL_AUTO: 'true' });
  assert.ok(timers.some(([kind]) => kind === 'interval'), 'the repeating poll should be armed');
  const kick = timers.find(([kind]) => kind === 'timeout');
  assert.ok(kick, 'one kick after boot');
  assert.ok(kick[1] >= 10 * 60_000, `the boot kick must wait at least 10 minutes, got ${kick[1]} ms`);
});

test('the newest coverless property is repaired first', () => {
  const { selectionQuery } = freshScheduler();
  const sql = selectionQuery({
    SELECTION_SQL: "SELECT p.id FROM properties p WHERE p.source = 'x' AND p.status = 'pending'"
  });
  assert.match(sql, /ORDER BY candidates\.created_at DESC/,
    'a backlog of old listings must not bury the batch that broke this morning');
});

// ---------------------------------------------------------------------------
// 9 Oct 2026: the job that pinned the CPU
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const os = require('node:os');
const childProcess = require('node:child_process');

const REAL_SQL = { SELECTION_SQL: "SELECT p.id, p.status, p.created_at, p.extra_fields FROM properties p WHERE p.source = 'x' AND p.status = 'pending'" };

test('a listing with 3 failures is never selected again', () => {
  const sql = freshScheduler().selectionQuery(REAL_SQL);
  assert.match(sql, /video_still_auto_gave_up_at' IS NULL/);
  assert.match(sql, /COALESCE\(\(candidates\.extra_fields->>'video_still_auto_attempts'\)::int, 0\) < 3/);
});

test('the third failure records that it gave up', async () => {
  installBackfillStub({
    makeAndUploadStills: async () => { throw new Error('ffmpeg exited 1'); },
    attachStills: async () => ({ attached: 0 })
  });
  const db = fakeDb({ ...PROPERTY, extra_fields: { video_still_auto_attempts: 2 } });
  await freshScheduler().tickVideoStills(db);
  const write = db.calls.find((c) => /video_still_auto_attempts', COALESCE/.test(c.text));
  assert.ok(write, 'the failure count is incremented');
  assert.match(write.text, /video_still_auto_gave_up_at/);
  assert.strictEqual(write.values[2], 3, 'it gives up when the count reaches 3');
});

test('backoff: 30 minutes, then 2 hours, then 12 hours', () => {
  const scheduler = freshScheduler();
  assert.deepStrictEqual(scheduler.BACKOFF_INTERVALS, ['30 minutes', '2 hours', '12 hours']);
  const sql = scheduler.selectionQuery(REAL_SQL);
  assert.match(sql, /WHEN 1 THEN INTERVAL '30 minutes'/);
  assert.match(sql, /WHEN 2 THEN INTERVAL '2 hours'/);
  assert.match(sql, /WHEN 3 THEN INTERVAL '12 hours'/);
  assert.match(sql, /video_still_auto_attempts'\)::int, 0\) > 0\s*AND \(candidates\.extra_fields->>'video_still_auto_attempted_at'\)::timestamptz\s*< NOW\(\) - CASE/,
    'the backoff applies only to listings that have failed before');
});

test('a success clears the failure count', async () => {
  installBackfillStub({ makeAndUploadStills: async () => [{ url: 'x' }], attachStills: async () => ({ attached: 1 }) });
  const db = fakeDb({ ...PROPERTY, extra_fields: { video_still_auto_attempts: 2 } });
  await freshScheduler().tickVideoStills(db);
  const cleared = db.calls.find((c) => /- 'video_still_auto_attempts'/.test(c.text));
  assert.ok(cleared);
});

test('the tick is skipped when the database pool has waiters', async () => {
  let selected = false;
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  const db = fakeDb(PROPERTY);
  db.pool = { waitingCount: 2 };
  const original = db.query;
  db.query = async (...args) => { selected = true; return original.apply(db, args); };
  const result = await freshScheduler().tickVideoStills(db);
  assert.strictEqual(result.skipped, 'busy_traffic');
  assert.strictEqual(result.reason, 'db_pool_waiting');
  assert.strictEqual(selected, false, 'no query at all while the pool is contended');
});

test('the tick is skipped when the event loop is slow', async () => {
  installBackfillStub({ makeAndUploadStills: async () => [], attachStills: async () => ({ attached: 0 }) });
  const db = fakeDb(PROPERTY);
  const result = await freshScheduler().tickVideoStills(db, { eventLoopP95Ms: 250 });
  assert.strictEqual(result.skipped, 'busy_traffic');
  assert.strictEqual(result.reason, 'event_loop_slow');
  assert.ok(!db.calls.length);
  const ok = await freshScheduler().tickVideoStills(fakeDb(null), { eventLoopP95Ms: 150 });
  assert.deepStrictEqual(ok, { skipped: 'nothing_to_do' }, '150 ms is under the 200 ms threshold');
});

// The real backfill module, with ffmpeg and the network faked.

let realJpeg = null;
async function noiseJpeg(seed) {
  const sharp = require('sharp');
  const size = 64;
  const data = Buffer.alloc(size * size * 3);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < data.length; i += 1) { x = (x * 1103515245 + 12345) >>> 0; data[i] = x >>> 24; }
  return sharp(data, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}

function realBackfill() {
  delete require.cache[BACKFILL_PATH];
  return require('../scripts/backfill-whatsapp-video-stills');
}

function fakeVideoFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(url);
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return new Response(new Uint8Array(1024), { status: 200, headers: { 'content-length': '1024' } });
  };
  return { calls, fetchImpl };
}

// Mocks child_process.execFile. Frame decodes (-frames:v) write a JPEG to the
// output path; probing returns a 20 s duration.
function mockExecFile({ decodeDelayMs = 0, hang = false } = {}) {
  const state = { decodes: [], all: [], killed: 0 };
  const real = childProcess.execFile;
  childProcess.execFile = (file, args, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    state.all.push([file, ...args]);
    const child = { kill() { state.killed += 1; if (this.pending) { const p = this.pending; this.pending = null; p(Object.assign(new Error('killed'), { killed: true }), '', ''); } } };
    if (args.includes('-frames:v')) {
      state.decodes.push(args);
      const out = args[args.length - 1];
      const finish = async () => {
        fs.writeFileSync(out, await noiseJpeg(state.decodes.length));
        cb(null, '', '');
      };
      if (hang) child.pending = cb;
      else setTimeout(finish, decodeDelayMs);
    } else {
      setImmediate(() => cb(null, '20.0\n', ''));
    }
    return child;
  };
  return { state, restore() { childProcess.execFile = real; } };
}

function videoProperty(id, videos = 4) {
  return {
    id,
    status: 'pending',
    video_still_count: 0,
    extra_fields: { video_urls: Array.from({ length: videos }, (_, i) => `https://media.makaug.com/v/${id}-${i}.mp4`) }
  };
}

test('at most VIDEO_STILL_FRAME_CANDIDATES frame decodes per video, and at most 2 videos', async () => {
  const backfill = realBackfill();
  assert.strictEqual(backfill.FRAME_CANDIDATE_COUNT, 8, 'the default is 8, not 30');
  const exec = mockExecFile();
  const net = fakeVideoFetch();
  const realFetch = global.fetch;
  global.fetch = net.fetchImpl;
  try {
    await backfill.makeAndUploadStills(videoProperty('spawn-cap'), { frameCandidates: 8, maxVideos: 2 }).catch(() => {});
  } finally {
    global.fetch = realFetch;
    exec.restore();
  }
  assert.strictEqual(net.calls.length, 2, 'only two of the four videos are downloaded');
  const perVideo = {};
  for (const args of exec.state.decodes) {
    const input = args[args.indexOf('-i') + 1];
    perVideo[input] = (perVideo[input] || 0) + 1;
  }
  assert.strictEqual(Object.keys(perVideo).length, 2);
  for (const [video, count] of Object.entries(perVideo)) assert.ok(count <= 8, `${video}: ${count} decodes`);
});

test('ffmpeg runs at nice 19 on one thread', () => {
  const backfill = realBackfill();
  const command = backfill.lowPriorityCommand('/opt/ffmpeg-static/ffmpeg', ['-i', 'in.mp4', 'out.jpg']);
  const flat = [command.file, ...command.args];
  assert.ok(flat.includes('-threads') && flat[flat.indexOf('-threads') + 1] === '1', flat.join(' '));
  if (fs.existsSync('/usr/bin/nice') || fs.existsSync('/bin/nice')) {
    assert.match(command.file, /nice$/);
    assert.deepStrictEqual(command.args.slice(0, 3), ['-n', '19', '/opt/ffmpeg-static/ffmpeg']);
  }
  const probe = backfill.lowPriorityCommand('ffprobe', ['-v', 'error']);
  assert.ok(!probe.args.includes('-threads'), 'only ffmpeg gets -threads');
});

test('the tick stops at its time budget, kills ffmpeg and cleans up', async () => {
  delete require.cache[SCHEDULER_PATH];
  realBackfill();
  const scheduler = freshScheduler();
  const exec = mockExecFile({ hang: true });
  const net = fakeVideoFetch();
  const realFetch = global.fetch;
  global.fetch = net.fetchImpl;
  const id = `budget-${Date.now()}`;
  const db = fakeDb(videoProperty(id, 2));
  const started = Date.now();
  let result;
  try {
    result = await scheduler.tickVideoStills(db, { budgetMs: 300, eventLoopP95Ms: 0 });
  } finally {
    global.fetch = realFetch;
    exec.restore();
  }
  assert.ok(Date.now() - started < 5000, 'it returns promptly once the budget is used');
  assert.strictEqual(result.timed_out, true, JSON.stringify(result));
  assert.ok(exec.state.killed >= 1, 'the hung ffmpeg is killed');
  const leftovers = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`makaug-video-still-${id}-`));
  assert.deepStrictEqual(leftovers, [], 'the temp dir is removed');
  const write = db.calls.find((c) => /video_still_auto_attempts', COALESCE/.test(c.text));
  assert.ok(write, 'running out of time counts as a failure');
  assert.match(write.values[1], /time budget/);
});

test('sharp is limited in the backfill module', () => {
  const source = fs.readFileSync(BACKFILL_PATH, 'utf8');
  assert.match(source, /sharp\.cache\(false\);\s*\nsharp\.concurrency\(1\);/);
});

test.after(() => {
  delete require.cache[BACKFILL_PATH];
  delete require.cache[SCHEDULER_PATH];
});
