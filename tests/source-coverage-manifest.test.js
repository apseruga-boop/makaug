'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  SOURCE_COVERAGE_MARKER,
  normalizeCoveragePlatforms,
  canonicalSourceKey,
  buildCoverageManifestRows,
  createSourceCoverageRun,
  youtubeProviderFailureDisposition,
} = require('../services/sourceCoverageService');
const staffRouter = require('../routes/staff');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('coverage manifests preserve every registry row while avoiding duplicate network work', () => {
  const sources = [
    {
      key: 'tiktok-a',
      name: 'TikTok A',
      platform: 'tiktok',
      sourceType: 'hashtag_feed',
      url: 'https://www.tiktok.com/tag/UgandaRealEstate?utm_source=test',
      hashtags: ['UgandaRealEstate'],
      status: 'active',
    },
    {
      key: 'tiktok-a-copy',
      name: 'TikTok A copy',
      platform: 'tiktok',
      sourceType: 'hashtag_feed',
      url: 'https://WWW.TIKTOK.COM/tag/UgandaRealEstate/',
      hashtags: ['UgandaRealEstate'],
      status: 'candidate',
    },
    {
      key: 'youtube-a',
      name: 'YouTube A',
      platform: 'youtube',
      sourceType: 'creator_channel',
      url: 'https://www.youtube.com/@UgandaHomes',
      status: 'active',
    },
    {
      key: 'x-a',
      name: 'X A',
      platform: 'x',
      sourceType: 'search_feed',
      url: 'https://x.com/search?q=UgandaProperty',
      status: 'active',
    },
  ];

  const rows = buildCoverageManifestRows(sources, { platforms: ['tiktok', 'youtube'], sectionSize: 500 });
  assert.equal(rows.length, 3, 'every in-scope TikTok and YouTube registry row must remain represented');
  assert.equal(rows.filter((row) => row.status === 'pending').length, 2, 'only canonical sources should require network work');
  assert.equal(rows.filter((row) => row.status === 'duplicate_source').length, 1, 'canonical duplicates should be completed without refetching');
  assert.equal(rows[1].metadata.duplicate_of_sequence, 1);
  assert.equal(rows[0].source_offset, 0);
  assert.equal(rows[1].source_offset, 1);
  assert.equal(rows[2].source_offset, 0, 'platform offsets must be independent');
  assert.equal(rows[2].section_number, 1, 'sections must restart independently for each platform');
  assert.equal(rows.every((row) => row.metadata.marker === SOURCE_COVERAGE_MARKER), true);
});

test('coverage platform and URL normalization are deterministic', () => {
  assert.deepEqual(normalizeCoveragePlatforms('youtube,tiktok,tiktok'), ['tiktok', 'youtube']);
  assert.deepEqual(normalizeCoveragePlatforms('all'), ['tiktok', 'x', 'youtube']);
  assert.equal(
    canonicalSourceKey({ platform: 'TikTok', url: 'https://WWW.TIKTOK.COM/tag/KampalaRentals/?utm_campaign=x#top' }),
    'tiktok:https://www.tiktok.com/tag/kampalarentals'
  );
});

test('YouTube provider failures never masquerade as checked-empty sources', () => {
  assert.deepEqual(
    youtubeProviderFailureDisposition([{ ok: false, status: 403, error_reason: 'forbidden' }]),
    {
      outcome: 'blocked',
      reason: 'forbidden',
      retryAfterMinutes: 60,
      report: { ok: false, status: 403, error_reason: 'forbidden' },
    }
  );
  assert.equal(youtubeProviderFailureDisposition([{ ok: true, status: 200 }]), null);
});

test('active manifest reuse releases its transaction connection before loading status', async () => {
  let released = false;
  const runId = '00000000-0000-4000-8000-000000000001';
  const client = {
    async query(sql) {
      if (/FROM source_coverage_runs/.test(sql)) return { rows: [{ id: runId }] };
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const db = {
    pool: { async connect() { return client; } },
    async query(sql) {
      assert.equal(released, true, 'status reads must not wait for a second pool connection while the transaction client is held');
      if (/SELECT \*, id::text AS id FROM source_coverage_runs/.test(sql)) {
        return { rows: [{ id: runId, platform_scope: ['tiktok', 'youtube'], status: 'queued', source_record_count: 2, canonical_source_count: 2, section_count: 1, counters: {} }] };
      }
      return { rows: [] };
    },
  };
  const run = await createSourceCoverageRun({
    db,
    registrySources: [
      { key: 'tiktok-one', name: 'TikTok one', platform: 'tiktok', sourceType: 'hashtag_feed', url: 'https://www.tiktok.com/tag/one', status: 'active' },
      { key: 'youtube-one', name: 'YouTube one', platform: 'youtube', sourceType: 'creator_channel', url: 'https://www.youtube.com/@one', status: 'active' },
    ],
  });
  assert.equal(run.id, runId);
  assert.equal(run.reused_existing_run, true);
});

test('migration, staff APIs, dashboard and CLI expose restart-safe review-only coverage', () => {
  const migration = read('db/migrations/124_source_coverage_manifest.sql');
  const staffRoute = read('routes/staff.js');
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  const script = read('scripts/run-source-coverage.js');
  const packageJson = read('package.json');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS source_coverage_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS source_coverage_items/);
  assert.match(migration, /UNIQUE \(run_id, sequence_number\)/, 'duplicate registry keys must not silently drop manifest rows');
  assert.match(migration, /FOR UPDATE SKIP LOCKED|idx_source_coverage_items_claim/);
  assert.match(staffRoute, /source-intake\/coverage\/runs/);
  assert.match(staffRoute, /source-intake\/coverage\/items\/:itemId\/complete/);
  assert.match(staffRoute, /auto_live_properties \|\| 0\) !== 0/);
  assert.match(staffRoute, /\.slice\(0, 10\)/, 'manual TikTok commits must remain in small batches');
  assert.match(html, /Exhaustive 30-day source coverage/);
  assert.match(html, /Load next 10 TikTok sources/);
  assert.match(app, /Review-only confirmed/);
  assert.match(script, /processYouTubeCoverageBatch/);
  assert.match(script, /hasFlag\('--latest'\)/, 'scheduled workers must resolve the active durable run without a hard-coded UUID');
  assert.match(packageJson, /inventory:source-coverage/);
  assert.equal(staffRouter.stack[0]?.name, 'requireStaffAccess', 'coverage endpoints must inherit the staff access gate');
});
