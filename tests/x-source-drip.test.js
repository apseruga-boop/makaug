'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const {
  buildXSearchJobs,
  runSocialPlatformPostSweep,
} = require('../services/socialPlatformPostDiscoveryService');
const {
  getPropertySourceRegistry,
} = require('../services/propertySourceRegistryService');
const {
  X_SOURCE_DRIP_MARKER,
  X_SOURCE_DRIP_FAST_MODE_MARKER,
  maxBatchSizeForMode,
  summarizeSweepResult,
} = require('../services/xSourceDripService');

async function main() {
  const migration = read('db/migrations/067_x_source_drip.sql');
  const fastModeMigration = read('db/migrations/073_x_source_drip_fast_mode.sql');
  const dripService = read('services/xSourceDripService.js');
  const adminRoute = read('routes/admin.js');
  const server = read('server.js');
  const frontend = read('assets/makaug-app.js');
  const html = read('index.html');
  const socialDiscoveryService = read('services/socialPlatformPostDiscoveryService.js');

  assert.strictEqual(X_SOURCE_DRIP_MARKER, 'x-source-drip-20260714', 'drip marker should be stable for production verification');
  assert.strictEqual(X_SOURCE_DRIP_FAST_MODE_MARKER, 'x-source-drip-fast-mode-20260714', 'fast-mode marker should be stable for production verification');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS source_drip_state'), 'migration should create persistent drip state');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS source_drip_run_logs'), 'migration should create per-run logs');
  assert(migration.includes('batch_size BETWEEN 1 AND 5'), 'initial migration should keep full-archive batches small');
  assert(fastModeMigration.includes('batch_size BETWEEN 1 AND 25'), 'fast-mode migration should allow larger recent-search batches');
  assert(fastModeMigration.includes('monthly_read_cap'), 'fast-mode migration should persist the monthly X read cap');
  assert(fastModeMigration.includes('api_read_count'), 'fast-mode migration should log per-run X API reads');
  assert(fastModeMigration.includes("search_mode = CASE WHEN search_mode = 'all' THEN 'recent'"), 'fast-mode migration should move old default state to recent search');
  assert(fastModeMigration.includes('WHEN batch_size <= 5 THEN 20'), 'fast-mode migration should lift old 5-sized recent batches to 20');
  assert(migration.includes('published_after TIMESTAMPTZ'), 'migration should persist the X crawl date floor');
  assert.strictEqual(maxBatchSizeForMode('all'), 5, 'full-archive mode should stay capped to 5');
  assert.strictEqual(maxBatchSizeForMode('recent'), 25, 'recent mode should allow fast batches up to 25');
  assert(dripService.includes('pg_try_advisory_lock'), 'drip runs should be concurrency guarded');
  assert(dripService.includes("platform: 'x'"), 'drip service should be X-only');
  assert(dripService.includes('X_SOURCE_DRIP_PUBLISHED_AFTER'), 'drip should allow Render/env date-floor configuration');
  assert(dripService.includes('X_SOURCE_DRIP_SEARCH_MODE'), 'drip should allow Render/env search-mode configuration');
  assert(dripService.includes('X_SOURCE_DRIP_MONTHLY_READ_CAP'), 'drip should allow Render/env monthly-read cap configuration');
  assert(dripService.includes('x_payment_required_or_credits_exhausted'), 'drip should hard-stop on X payment/credits failure');
  assert(dripService.includes('x_auth_or_permission_error'), 'drip should hard-stop on auth/permission failure');
  assert(dripService.includes('x_monthly_read_cap_reached'), 'drip should auto-pause when monthly X read cap is hit');
  assert(dripService.includes('rate_limited'), 'drip should record rate-limited runs for adaptive backoff');
  assert(adminRoute.includes("router.get('/x-source-drip'"), 'admin route should expose drip status');
  assert(adminRoute.includes("router.post('/x-source-drip/start'"), 'admin route should expose start control');
  assert(adminRoute.includes("router.post('/x-source-drip/pause'"), 'admin route should expose pause control');
  assert(adminRoute.includes("router.post('/x-source-drip/run-once'"), 'admin route should expose manual one-batch control');
  assert(server.includes('startXSourceDripScheduler(db)'), 'server should arm the drip scheduler');
  assert(html.includes('admin-x-drip-btn'), 'dashboard HTML should expose X drip button');
  assert(frontend.includes('adminLoadXSourceDrip'), 'frontend should load the X drip panel');
  assert(frontend.includes('/api/admin/x-source-drip/run-once'), 'frontend should call the protected run-once endpoint');
  assert(frontend.includes('admin-x-drip-published-after'), 'frontend should expose the X drip since-date field');
  assert(frontend.includes('admin-x-drip-monthly-cap'), 'frontend should expose the monthly X read cap');
  assert(frontend.includes('x-source-drip-fast-mode-20260714'), 'frontend should render the fast-mode marker');
  assert(socialDiscoveryService.includes('next_source_offset'), 'sweep response should expose next source offset');
  assert(socialDiscoveryService.includes('xPublishedAfter'), 'X sweep should accept an explicit X published-after date');
  assert(socialDiscoveryService.includes('const xSourceWindow = rotatingSourceWindow(xSources'), 'X sweep should walk source offsets through the rotating source window');
  assert(socialDiscoveryService.includes('buildXSearchJobs({ sources: xSourceWindow.sources'), 'X sweep should build X jobs from the offset-selected source window');

  const xSources = getPropertySourceRegistry().filter((source) => String(source.platform || '').toLowerCase() === 'x');
  assert(xSources.length > 100, 'registry should have enough X sources for offset walking');
  const firstBatch = buildXSearchJobs({ sources: xSources.slice(0, 5), limit: 5 });
  const offsetBatch = buildXSearchJobs({ sources: xSources.slice(50, 55), limit: 5 });
  assert.strictEqual(firstBatch.length, 5, 'first X batch should cap to 5');
  assert.strictEqual(offsetBatch.length, 5, 'offset X batch should cap to 5');
  assert.notStrictEqual(firstBatch[0].source_key, offsetBatch[0].source_key, 'X offset should walk to different sources');

  const dryRun = await runSocialPlatformPostSweep({
    db: null,
    platform: 'x',
    dryRun: true,
    maxSources: 5,
    sourceOffset: 50,
    maxResultsPerSource: 10,
    searchMode: 'all',
    xPublishedAfter: '2026-03-01T00:00:00.000Z',
    fetchX: false,
    env: {},
  });
  assert.strictEqual(dryRun.x.source_offset, 50, 'X dry-run should echo source offset');
  assert.strictEqual(dryRun.x.next_source_offset, 55, 'X dry-run should expose next source offset');
  assert.strictEqual(dryRun.x.search_job_count, 5, 'X dry-run should prepare 5 jobs');
  assert.strictEqual(dryRun.x.published_after, '2026-03-01T00:00:00.000Z', 'X dry-run should echo the X published-after date floor');
  assert.strictEqual(dryRun.x.search_jobs[0].start_time, '2026-03-01T00:00:00.000Z', 'X jobs should carry the configured date floor into start_time');

  const summary = summarizeSweepResult({
    x: {
      source_count: 16001,
      source_offset: 50,
      next_source_offset: 55,
      published_after: '2026-01-01T00:00:00.000Z',
      search_job_count: 5,
      fetched_posts_count: 1,
      fetch_reports: [
        { status: 429, reason: 'Too Many Requests' },
        { status: 429, reason: 'Too Many Requests' },
        { status: 402, reason: 'Payment Required' },
        { status: 401, reason: 'Unauthorized' },
      ],
    },
    discovered_posts_count: 1,
    import_result: {
      created_properties: 1,
      review_queue_properties: 1,
      existing_properties: 0,
      duplicate_warnings: [{ source_url: 'https://x.com/example/status/1' }],
      source_review_records: [],
    },
  });
  assert.strictEqual(summary.rate_limited_count, 2, 'summary should count 429s');
  assert.strictEqual(summary.billing_error_count, 1, 'summary should count 402 payment failures');
  assert.strictEqual(summary.auth_error_count, 1, 'summary should count auth failures');
  assert.strictEqual(summary.created_properties, 1, 'summary should preserve created count');
  assert.strictEqual(summary.api_read_count, 5, 'summary should count X API reads from search jobs');
  assert.strictEqual(summary.published_after, '2026-01-01T00:00:00.000Z', 'summary should preserve the crawl date floor');

  console.log('ok - X source drip scheduler, cursor, controls, and backoff guards are wired');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
