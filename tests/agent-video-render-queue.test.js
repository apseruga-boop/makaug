// Welcome / report films render one at a time, never during start-up, and
// are not rendered twice. (5 Oct: parallel renders ran the 512 MB server out
// of memory.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const videos = require('../services/agentReportVideoService');
const { runWelcomeCatchUp } = require('../services/agentWelcomeCatchUpService');

function payloadFor(id) {
  return {
    agent: { id, full_name: `Agent ${id}`, makaug_agent_number: 'MKA-AG-1' },
    stats: { listings: 1000, agents: 40, searchers: 10000 },
    listings: { live: 1, pending: 0 }
  };
}

function cleanup(id, version) {
  try { fs.unlinkSync(videos._test.cachePath(id, version, 'welcome-')); } catch (_) {}
}

test('five welcome films queued together render one at a time', async () => {
  const version = `9${Date.now()}`;
  const ids = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005'];
  let inFlight = 0;
  let maxInFlight = 0;
  videos._test.resetStats();
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(async (_spec, file) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 25));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'mp4');
    inFlight -= 1;
    return file;
  });
  try {
    const results = await Promise.all(ids.map((id) => videos.ensureWelcomeVideo(payloadFor(id), version)));
    assert.equal(results.length, 5);
    assert.equal(maxInFlight, 1, 'never more than one render at once');
    assert.equal(videos._test.renderStats.maxConcurrent, 1);
    assert.equal(videos._test.renderStats.started, 5);
  } finally {
    ids.forEach((id) => cleanup(id, version));
    videos._test.setEncoder(null);
  }
});

test('a film that already exists is not rendered again', async () => {
  const version = `8${Date.now()}`;
  const id = 'bbbbbbbb-0000-4000-8000-000000000001';
  let renders = 0;
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(async (_spec, file) => {
    renders += 1;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'mp4');
    return file;
  });
  try {
    await videos.ensureWelcomeVideo(payloadFor(id), version);
    await videos.ensureWelcomeVideo(payloadFor(id), version);
    assert.equal(renders, 1);
  } finally {
    cleanup(id, version);
    videos._test.setEncoder(null);
  }
});

test('a film kept in storage is served from there, without rendering', async () => {
  const version = `7${Date.now()}`;
  const id = 'cccccccc-0000-4000-8000-000000000001';
  const env = { ...process.env };
  Object.assign(process.env, {
    MEDIA_STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://storage.test', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's', S3_REGION: 'auto', S3_PUBLIC_BASE_URL: 'https://media.example.test'
  });
  let renders = 0;
  videos._test.setEncoder(async () => { renders += 1; return ''; });
  videos._test.setRemoteLookup(async (url) => url.startsWith('https://media.example.test/agent-videos/'));
  try {
    const result = await videos.ensureWelcomeVideo(payloadFor(id), version);
    assert.match(String(result), /^https:\/\/media\.example\.test\/agent-videos\/welcome-/);
    assert.equal(renders, 0);
  } finally {
    process.env = env;
    videos._test.setEncoder(null);
    videos._test.setRemoteLookup(async () => false);
  }
});

test('allowRender: false never renders', async () => {
  let renders = 0;
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(async () => { renders += 1; return ''; });
  try {
    const result = await videos.ensureWelcomeVideo(payloadFor('dddddddd-0000-4000-8000-000000000001'), `6${Date.now()}`, { allowRender: false });
    assert.equal(result, '');
    assert.equal(renders, 0);
  } finally {
    videos._test.setEncoder(null);
  }
});

test('a render that would start with memory already high is refused (text fallback)', () => {
  const limit = Number(process.env.MEMORY_LIMIT_MB || 512);
  assert.equal(videos._test.memoryTooHighForRender(limit * 1048576 * 0.8), true);
  assert.equal(videos._test.memoryTooHighForRender(limit * 1048576 * 0.3), false);
});

test('start-up catch-up: one agent at a time and never with video rendering', async () => {
  const agents = Array.from({ length: 5 }, (_, i) => ({ id: `eeeeeeee-0000-4000-8000-00000000000${i}`, full_name: `A${i}` }));
  const db = { query: async () => ({ rows: agents }) };
  let inFlight = 0;
  let maxInFlight = 0;
  const calls = [];
  const summary = await runWelcomeCatchUp({
    db,
    logger: { info() {}, warn() {} },
    runFollowUps: async (args) => {
      calls.push(args);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return { welcome: { format: 'text' } };
    }
  });
  assert.equal(summary.processed, 5);
  assert.equal(maxInFlight, 1);
  assert.ok(calls.every((c) => c.allowVideoRender === false), 'catch-up must not render videos');
});

test('sharp is limited to one thread with no cache while rendering', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'agentReportVideoService.js'), 'utf8');
  assert.match(source, /sharp\.cache\(false\)/);
  assert.match(source, /sharp\.concurrency\(1\)/);
});

test('only photo/document routes accept large JSON bodies', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /LARGE_JSON_BODY_PREFIXES/);
  assert.doesNotMatch(source, /app\.use\(express\.json\(\{\s*limit: '40mb'/);
});

// keep the temp dir tidy when run repeatedly
test.after(() => { try { fs.rmSync(path.join(os.tmpdir(), 'makaug-report-videos-test'), { recursive: true, force: true }); } catch (_) {} });
