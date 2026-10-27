'use strict';

// Staff "Run check now" (POST /api/staff/properties/:id/video-caption-ocr).
// Runs the real service against an in-memory database, a stubbed fetch and a
// stubbed child_process.spawn, so nothing is downloaded and ffmpeg never runs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.join(__dirname, '..');
const SERVICE_REQUIRE = /const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]\.\.\/services\/videoCaptionOcrService['"]\s*\)/g;

const properties = new Map();
const ocrRows = new Map();
const fakeDb = {
  async query(sql, params = []) {
    const text = String(sql);
    if (/INSERT INTO property_video_ocr/.test(text)) {
      ocrRows.set(params[0], {
        property_id: params[0],
        status: params[1],
        ocr_text: params[2],
        parsed_facts: JSON.parse(params[3]),
        conflicts: JSON.parse(params[4]),
        override: params[5] ? JSON.parse(params[5]) : null,
        resolution: params[6] ? JSON.parse(params[6]) : null,
        frame_count: params[7],
        video_count: params[8],
        error: params[9],
        updated_at: new Date().toISOString()
      });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM property_video_ocr/.test(text)) {
      const row = ocrRows.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^\s*UPDATE properties/.test(text)) return { rows: [], rowCount: 1 };
    if (/FROM properties/.test(text)) {
      const row = properties.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }
};
require.cache[require.resolve('../config/database')] = {
  id: 'fake-db', filename: 'fake-db', loaded: true, exports: fakeDb
};

const spawned = [];
childProcess.spawn = (command, args) => {
  spawned.push([command, ...(args || [])].join(' '));
  throw new Error('spawn is not allowed in this test');
};

const fetched = [];
let fetchImpl = async () => ({ ok: false, status: 404, body: null, headers: new Map() });
globalThis.fetch = (url, options) => {
  fetched.push(String(url));
  return fetchImpl(url, options);
};

const service = require('../services/videoCaptionOcrService');

function listing(id, extra) {
  properties.set(id, {
    id,
    title: 'Test listing',
    description: '',
    area: 'Kira',
    district: 'Wakiso',
    price: 1000000,
    extra_fields: extra
  });
  return id;
}

function reset() {
  fetched.length = 0;
  spawned.length = 0;
  fetchImpl = async () => ({ ok: false, status: 404, body: null, headers: new Map() });
}

test('every name the routes and scripts import from videoCaptionOcrService is exported', () => {
  const files = ['routes', 'scripts'].flatMap((dir) => fs.readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name)));
  let staffNames = [];
  let checked = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(SERVICE_REQUIRE)) {
      const names = match[1].split(',').map((part) => part.split(':')[0].trim()).filter(Boolean);
      for (const name of names) {
        checked += 1;
        assert.notStrictEqual(service[name], undefined, `${file} imports ${name}, which the service does not export`);
      }
      if (file === path.join('routes', 'staff.js')) staffNames = staffNames.concat(names);
    }
  }
  assert(checked > 0, 'found the service imports');
  assert(staffNames.includes('runVideoCaptionOcr'), 'routes/staff.js still imports runVideoCaptionOcr');
  for (const name of staffNames) {
    assert.strictEqual(typeof service[name], 'function', `routes/staff.js imports ${name}; it must be a function`);
  }
});

test('a YouTube link is never downloaded and is saved as not checkable', async () => {
  reset();
  const id = listing('2a4353f2-6bd9-4c59-bbd1-ad7ed797488f', {
    video_url: 'https://www.youtube.com/watch?v=NQeagorxOiU'
  });
  const record = await service.runVideoCaptionOcr(id);
  assert.deepStrictEqual(fetched, [], 'no download was attempted');
  assert.deepStrictEqual(spawned, [], 'ffmpeg/tesseract never ran');
  assert.ok(record && typeof record === 'object', 'the run returns a record');
  assert.strictEqual(record.status, service.STATUS_NOT_CHECKABLE);
  assert.strictEqual(record.error, service.EXTERNAL_VIDEO_PAGE);
  assert.strictEqual(ocrRows.get(id).status, 'not_checkable', 'the final status is saved');
  const view = service.publicOcrView(record);
  assert.strictEqual(view.status, 'not_checkable', 'the route sends not_checkable, so the button does not come back');
  assert.match(view.text, /YouTube or TikTok/);
});

test('TikTok and youtu.be links are page links too; direct files are not', () => {
  for (const url of [
    'https://youtu.be/NQeagorxOiU',
    'https://m.youtube.com/shorts/abc',
    'https://www.tiktok.com/@agent/video/123',
    'https://vt.tiktok.com/ZSabc/'
  ]) assert.strictEqual(service.isExternalVideoPage(url), true, url);
  for (const url of [
    'https://media.makaug.com/videos/a.mp4',
    'https://notyoutube.com/watch',
    'not a url'
  ]) assert.strictEqual(service.isExternalVideoPage(url), false, url);
});

test('a listing with a YouTube link and a direct MP4 downloads only the MP4 and returns the saved result', async () => {
  reset();
  const id = listing('11111111-1111-4111-8111-111111111111', {
    video_urls: ['https://youtu.be/NQeagorxOiU', 'https://media.makaug.com/videos/plot.mp4']
  });
  const record = await service.runVideoCaptionOcr(id);
  assert.deepStrictEqual(fetched, ['https://media.makaug.com/videos/plot.mp4']);
  assert.ok(record && typeof record === 'object', 'the run returns a record, not undefined');
  assert.strictEqual(record.status, service.OCR_PENDING);
  assert.match(String(record.error), /download failed \(404\)/);
  assert.strictEqual(ocrRows.get(id).status, service.OCR_PENDING);
});

test('a listing with no video returns null', async () => {
  reset();
  const id = listing('22222222-2222-4222-8222-222222222222', {});
  assert.strictEqual(await service.runVideoCaptionOcr(id), null);
  assert.deepStrictEqual(fetched, []);
});

test('an on-demand run waits for the queued job instead of running beside it', async () => {
  reset();
  const queuedId = listing('33333333-3333-4333-8333-333333333333', { video_url: 'https://media.makaug.com/q.mp4' });
  const staffId = listing('44444444-4444-4444-8444-444444444444', { video_url: 'https://media.makaug.com/s.mp4' });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  fetchImpl = async (url) => {
    events.push(`start ${url}`);
    if (String(url).endsWith('/q.mp4')) await gate;
    events.push(`end ${url}`);
    return { ok: false, status: 404, body: null, headers: new Map() };
  };
  assert.strictEqual(service.scheduleVideoCaptionOcr(queuedId), true);
  for (let i = 0; i < 50 && !events.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepStrictEqual(events, ['start https://media.makaug.com/q.mp4'], 'the queue job is running');
  const staffRun = service.runVideoCaptionOcr(staffId);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepStrictEqual(events, ['start https://media.makaug.com/q.mp4'], 'the staff run has not started yet');
  release();
  const record = await staffRun;
  assert.deepStrictEqual(events, [
    'start https://media.makaug.com/q.mp4',
    'end https://media.makaug.com/q.mp4',
    'start https://media.makaug.com/s.mp4',
    'end https://media.makaug.com/s.mp4'
  ]);
  assert.strictEqual(record.status, service.OCR_PENDING);
  assert.ok(ocrRows.get(queuedId), 'the queued job finished and saved');
});

function observe(promise) {
  return promise.then((value) => ({ value }), (error) => ({ error }));
}

function holdPropertyReader(url) {
  let started;
  let release;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fetchImpl = async (requested) => {
    if (String(requested) === url) {
      started();
      await gate;
    }
    return { ok: false, status: 404, body: null, headers: new Map() };
  };
  const run = service.ocrPropertyVideos({ extra_fields: { video_url: url } });
  return {
    started: startedPromise,
    release,
    run,
    outcome: observe(run)
  };
}

test('the exported property reader holds the same lock as a staff run', async () => {
  reset();
  const direct = holdPropertyReader('https://media.makaug.com/direct-lock.mp4');
  await direct.started;
  const staffId = listing('55555555-5555-4555-8555-555555555555', {
    video_url: 'https://www.youtube.com/watch?v=staff-lock'
  });
  const query = fakeDb.query;
  const staffQueries = [];
  const events = [];
  const settled = () => events.push('direct settled');
  direct.run.then(settled, settled);
  fakeDb.query = async (sql, params) => {
    if (params?.[0] === staffId) {
      staffQueries.push(String(sql));
      events.push('staff query');
    }
    return query(sql, params);
  };
  const staffRun = observe(service.runVideoCaptionOcr(staffId));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(staffQueries, [], 'staff has not read or saved anything while the direct reader owns the lock');
    assert.strictEqual(ocrRows.has(staffId), false);
    direct.release();
    assert.match(String((await direct.outcome).error), /download failed \(404\)/);
    const staff = await staffRun;
    assert.ifError(staff.error);
    assert.strictEqual(staff.value.status, service.STATUS_NOT_CHECKABLE);
    assert.strictEqual(events[0], 'direct settled', 'the direct read settles before staff touches the database');
    assert.ok(staffQueries.some((sql) => /FROM properties/.test(sql)), 'staff started after the direct reader finished');
    assert.strictEqual(ocrRows.get(staffId).status, service.STATUS_NOT_CHECKABLE);
  } finally {
    direct.release();
    await Promise.all([direct.outcome, staffRun]);
    fakeDb.query = query;
  }
});

for (const cancellation of ['deadline', 'signal']) {
  test(`an exported property reader checks its ${cancellation} after waiting for the lock`, async (t) => {
    reset();
    const heldUrl = `https://media.makaug.com/held-${cancellation}.mp4`;
    const direct = holdPropertyReader(heldUrl);
    await direct.started;
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const controller = new AbortController();
    const options = cancellation === 'deadline' ? { deadline: now + 1000 } : { signal: controller.signal };
    const waiting = observe(service.ocrPropertyVideos({
      extra_fields: { video_url: `https://media.makaug.com/expired-${cancellation}.mp4` }
    }, options));
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepStrictEqual(fetched, [heldUrl], 'the second reader is waiting before cancellation');
      if (cancellation === 'deadline') now += 1001;
      else controller.abort();
      direct.release();
      assert.match(String((await direct.outcome).error), /download failed \(404\)/);
      const result = await waiting;
      assert.strictEqual(result.error?.code, 'OCR_TIMEOUT');
      assert.deepStrictEqual(fetched, [heldUrl], 'an expired or aborted waiting reader never downloads');
      assert.deepStrictEqual(spawned, []);
    } finally {
      direct.release();
      await Promise.all([direct.outcome, waiting]);
    }
  });
}

test('the exported file reader waits for the property reader and checks its expired deadline before spawning', async (t) => {
  reset();
  const heldUrl = 'https://media.makaug.com/held-file-reader.mp4';
  const direct = holdPropertyReader(heldUrl);
  await direct.started;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const fileRead = observe(service.ocrVideoFile('/missing-file', { deadline: now + 1000 }));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(spawned, [], 'the file reader does not start a process while it waits');
    now += 1001;
    direct.release();
    assert.match(String((await direct.outcome).error), /download failed \(404\)/);
    const result = await fileRead;
    assert.strictEqual(result.error?.code, 'OCR_TIMEOUT');
    assert.deepStrictEqual(fetched, [heldUrl]);
    assert.deepStrictEqual(spawned, [], 'the expired file reader never probes or decodes the file');
  } finally {
    direct.release();
    await Promise.all([direct.outcome, fileRead]);
  }
});
