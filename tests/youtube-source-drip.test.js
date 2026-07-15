'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const {
  buildYouTubeSearchJobs,
} = require('../services/socialPlatformPostDiscoveryService');
const {
  getPropertySourceRegistry,
} = require('../services/propertySourceRegistryService');
const {
  YOUTUBE_DRIP_MARKER,
  YOUTUBE_SOURCE_DRIP_KEY,
  firstQuotaLimitedSourceOffset,
  summarizeYouTubeDripSweepResult,
} = require('../services/youtubeSourceDripService');

async function main() {
  const migration = read('db/migrations/075_youtube_source_drip.sql');
  const dripService = read('services/youtubeSourceDripService.js');
  const adminRoute = read('routes/admin.js');
  const server = read('server.js');
  const socialDiscoveryService = read('services/socialPlatformPostDiscoveryService.js');
  const html = read('index.html');

  assert.strictEqual(YOUTUBE_DRIP_MARKER, 'youtube-drip-20260715', 'YouTube drip marker should be stable for production verification');
  assert.strictEqual(YOUTUBE_SOURCE_DRIP_KEY, 'youtube_source_drip', 'YouTube drip should use its own persistent state key');
  assert(migration.includes("platform IN ('x','youtube')"), 'migration should allow both X and YouTube drip state');
  assert(migration.includes('batch_size BETWEEN 1 AND 25'), 'migration should keep shared drip batch-size constraints compatible with X blitz mode');
  assert(dripService.includes("platform: 'youtube'"), 'YouTube drip should call the sweep in YouTube-only mode');
  assert(dripService.includes('youtubePublishedAfter'), 'YouTube drip should pass the crawl date floor through to the sweep');
  assert(dripService.includes('YOUTUBE_DRIP_MONTHLY_READ_CAP'), 'YouTube drip should expose a monthly read cap');
  assert(dripService.includes('pg_try_advisory_lock'), 'YouTube drip should be concurrency guarded');
  assert(dripService.includes('firstQuotaLimitedSourceOffset(summary, offset)'), 'YouTube drip should retry quota-limited sources instead of skipping them');
  assert(adminRoute.includes("router.get('/youtube-source-drip'"), 'admin route should expose YouTube drip status');
  assert(adminRoute.includes("router.patch('/youtube-source-drip'"), 'admin route should expose YouTube drip config');
  assert(adminRoute.includes("router.post('/youtube-source-drip/start'"), 'admin route should expose YouTube drip start control');
  assert(adminRoute.includes("router.post('/youtube-source-drip/pause'"), 'admin route should expose YouTube drip pause control');
  assert(adminRoute.includes("router.post('/youtube-source-drip/run-once'"), 'admin route should expose YouTube drip run-once control');
  assert(server.includes('startYouTubeSourceDripScheduler(db)'), 'server should arm the YouTube drip scheduler');
  assert(socialDiscoveryService.includes('source_registry_offset'), 'YouTube jobs should carry registry offsets for quota-limit retry');
  assert(socialDiscoveryService.includes('source_window_index'), 'YouTube jobs should carry a per-window index for run diagnostics');
  assert(html.includes('youtube-drip-20260715'), 'production HTML marker should include the YouTube drip marker');

  const youtubeSources = getPropertySourceRegistry().filter((source) => String(source.platform || '').toLowerCase() === 'youtube');
  assert(youtubeSources.length > 100, 'registry should have enough localized YouTube sources for cursor walking');
  const jobs = buildYouTubeSearchJobs({
    sources: youtubeSources,
    limit: 5,
    offset: 0,
    publishedAfter: '2026-06-01T00:00:00.000Z',
    jobMode: 'all',
  });
  assert(jobs.length > 0, 'YouTube registry should build crawl jobs');
  assert.strictEqual(jobs[0].platform, 'youtube', 'YouTube drip jobs should be platform-tagged');
  assert.strictEqual(jobs[0].published_after, '2026-06-01T00:00:00.000Z', 'YouTube jobs should preserve the June launch date floor');
  assert(Number.isInteger(jobs[0].source_registry_offset), 'YouTube jobs should expose a numeric source registry offset');
  assert(Number.isInteger(jobs[0].source_window_index), 'YouTube jobs should expose a numeric source window index');

  const summary = summarizeYouTubeDripSweepResult({
    youtube: {
      source_count: youtubeSources.length,
      source_offset: 25,
      next_source_offset: 30,
      published_after: '2026-06-01T00:00:00.000Z',
      search_job_count: 5,
      fetched_posts_count: 2,
      fetch_reports: [
        { status: 403, reason: 'quotaExceeded', source_registry_offset: 26 },
        { status: 429, reason: 'rateLimitExceeded', source_registry_offset: 27 },
        { status: 401, reason: 'Unauthorized', source_registry_offset: 28 },
      ],
    },
    discovered_posts_count: 2,
    import_result: {
      created_properties: 1,
      review_queue_properties: 1,
      existing_properties: 0,
      duplicate_warnings: [],
      source_review_records: [{ reason: 'low_signal_source_location' }],
    },
  });
  assert.strictEqual(summary.quota_limited_count, 2, 'summary should count YouTube quota/rate-limit reports');
  assert.strictEqual(summary.auth_error_count, 1, 'summary should count YouTube auth failures');
  assert.strictEqual(summary.created_properties, 1, 'summary should preserve created count');
  assert.strictEqual(summary.review_queue_properties, 1, 'summary should preserve review queue count');
  assert.strictEqual(firstQuotaLimitedSourceOffset(summary, 25), 26, 'cursor should requeue the first quota-limited YouTube source');

  console.log('ok - YouTube source drip scheduler, cursor, controls, and quota guards are wired');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
