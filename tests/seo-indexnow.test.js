'use strict';

/** S4: honest hub lastmod, agent profiles in the sitemap, IndexNow. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { buildPublicSeoSnapshot, sitemapEntries } = require('../services/publicSeoService');
const indexNow = require('../services/indexNowService');

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const rows = [
  { id: 's1', listing_type: 'sale', area: 'Ntinda', district: 'Kampala', canonical_location_id: 'kampala:ntinda', updated_at: '2026-09-01T08:00:00.000Z', agent_id: 'ag1', agent_public: true },
  { id: 's2', listing_type: 'sale', area: 'Ntinda', district: 'Kampala', canonical_location_id: 'kampala:ntinda', updated_at: '2026-10-02T08:00:00.000Z', agent_id: 'ag1', agent_public: true },
  { id: 's3', listing_type: 'sale', area: 'Ntinda', district: 'Kampala', canonical_location_id: 'kampala:ntinda', updated_at: '2026-10-05T08:00:00.000Z', agent_id: 'ag2', agent_public: false },
  { id: 'r1', listing_type: 'rent', area: 'Ntinda', district: 'Kampala', canonical_location_id: 'kampala:ntinda', updated_at: '2026-07-01T08:00:00.000Z' }
];
const snapshot = buildPublicSeoSnapshot(rows, '2026-10-09T00:00:00.000Z');
const entries = sitemapEntries(snapshot, 'https://makaug.com');
const byLoc = (loc) => entries.find((entry) => entry.loc === loc);

test('category hub lastmod is the newest listing date, not generation time', () => {
  assert.strictEqual(byLoc('https://makaug.com/for-sale').lastmod, '2026-10-05T08:00:00.000Z');
  assert.strictEqual(byLoc('https://makaug.com/to-rent').lastmod, '2026-07-01T08:00:00.000Z');
  assert.strictEqual(byLoc('https://makaug.com/').lastmod, '2026-10-05T08:00:00.000Z');
});

test('hub with no listings carries no lastmod', () => {
  assert.strictEqual(byLoc('https://makaug.com/land').lastmod, '');
});

test('location hub lastmod uses only that location and category', () => {
  const sale = entries.find((entry) => /\/for-sale\/ntinda-kampala$/.test(entry.loc));
  assert.ok(sale);
  assert.strictEqual(sale.lastmod, '2026-10-05T08:00:00.000Z');
});

test('public agents with a live listing are in the sitemap with their newest listing date', () => {
  const agent = byLoc('https://makaug.com/agents/ag1');
  assert.ok(agent);
  assert.strictEqual(agent.lastmod, '2026-10-02T08:00:00.000Z');
  assert.ok(!byLoc('https://makaug.com/agents/ag2'), 'non-public agents stay out');
});

test('snapshot SQL selects agent visibility', () => {
  const src = read('services/publicSeoService.js');
  assert.match(src, /agent_id,\s+EXISTS/);
});

test('key route serves the key only at its own path', () => {
  process.env.INDEXNOW_KEY = KEY;
  assert.strictEqual(indexNow.keyFileFor(`/${KEY}.txt`), KEY);
  assert.strictEqual(indexNow.keyFileFor('/ffffffffffffffffffffffffffffffff.txt'), null);
  delete process.env.INDEXNOW_KEY;
  assert.strictEqual(indexNow.keyFileFor(`/${KEY}.txt`), null);
  const server = read('server.js');
  assert.match(server, /keyFileFor\(req\.path\)/);
  assert.ok(server.indexOf('keyFileFor(req.path)') < server.indexOf('function shouldServeIndex'));
});

test('notify posts one batched call with the key, from production only', async () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.INDEXNOW_KEY = KEY;
  indexNow.resetForTests();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  try {
    assert.strictEqual(indexNow.notifyListing({ id: 'abc', listing_type: 'sale' }), true);
    assert.strictEqual(indexNow.notify(['https://evil.example/x']), false, 'foreign hosts are dropped');
    await indexNow.flush();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.indexnow.org/indexnow');
    const body = JSON.parse(calls[0].init.body);
    assert.strictEqual(body.host, 'makaug.com');
    assert.strictEqual(body.key, KEY);
    assert.strictEqual(body.keyLocation, `https://makaug.com/${KEY}.txt`);
    assert.ok(body.urlList.includes('https://makaug.com/property/abc'));
    assert.ok(body.urlList.includes('https://makaug.com/for-sale'));
  } finally {
    globalThis.fetch = realFetch;
    process.env.NODE_ENV = prevEnv;
    delete process.env.INDEXNOW_KEY;
    indexNow.resetForTests();
  }
});

test('no call when the key is unset or outside production', () => {
  indexNow.resetForTests();
  delete process.env.INDEXNOW_KEY;
  process.env.NODE_ENV = 'production';
  assert.strictEqual(indexNow.notify(['/property/1']), false);
  process.env.INDEXNOW_KEY = KEY;
  process.env.NODE_ENV = 'test';
  assert.strictEqual(indexNow.notify(['/property/1']), false);
  delete process.env.INDEXNOW_KEY;
  indexNow.resetForTests();
});

test('a failing fetch is swallowed and the key never reaches the logs', async () => {
  process.env.NODE_ENV = 'production';
  process.env.INDEXNOW_KEY = KEY;
  indexNow.resetForTests();
  const logged = [];
  const origs = ['log', 'warn', 'error', 'info'].map((m) => [m, console[m]]);
  for (const [m] of origs) console[m] = (...a) => logged.push(a.join(' '));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('boom'); };
  try {
    indexNow.notify(['/property/1']);
    await indexNow.flush();
  } finally {
    globalThis.fetch = realFetch;
    for (const [m, fn] of origs) console[m] = fn;
    process.env.NODE_ENV = 'test';
    delete process.env.INDEXNOW_KEY;
    indexNow.resetForTests();
  }
  assert.ok(!logged.join('\n').includes(KEY));
  assert.ok(!/logger\./.test(read('services/indexNowService.js')), 'service logs nothing');
});

test('approve and removal paths call notify after the status change', () => {
  const props = read('routes/properties.js');
  assert.strictEqual((props.match(/notifyIndexNowOnStatusChange\(current, listing, nextStatus\)/g) || []).length, 2);
  assert.match(read('routes/staff.js'), /indexNowService'\)\.notifyListing\(approved\)/);
  assert.match(read('routes/admin.js'), /indexNowService'\)\.notifyListing\(updated\.rows\[0\]\)/);
});
