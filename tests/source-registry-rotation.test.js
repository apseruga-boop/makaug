'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  runSocialPlatformPostSweep,
} = require('../services/socialPlatformPostDiscoveryService');

test('social source sweeps rotate non-YouTube registry windows instead of repeating the first slice', async () => {
  const first = await runSocialPlatformPostSweep({
    platform: 'x',
    dryRun: true,
    maxSources: 3,
    sourceOffset: 0,
    fetchX: false,
    fetchYouTube: false,
    env: {},
  });
  const second = await runSocialPlatformPostSweep({
    platform: 'x',
    dryRun: true,
    maxSources: 3,
    sourceOffset: 3,
    fetchX: false,
    fetchYouTube: false,
    env: {},
  });

  assert.equal(first.x.selected_source_count, 3);
  assert.equal(second.x.selected_source_count, 3);
  assert.equal(first.x.source_offset, 0);
  assert.equal(second.x.source_offset, 3);
  assert.equal(first.x.next_source_offset, 3);
  assert.equal(second.x.next_source_offset, 6);
  assert.notEqual(
    first.x.search_jobs.map((job) => job.source_key).join(','),
    second.x.search_jobs.map((job) => job.source_key).join(','),
    'offset 3 must inspect a different X registry window than offset 0'
  );
  assert.equal(first.registry_rotation.x.next_source_offset, 3);
});

test('channel-upload source sweeps top up from rotated registry search feeds when known channels are exhausted', async () => {
  const result = await runSocialPlatformPostSweep({
    platform: 'youtube',
    dryRun: true,
    maxSources: 50,
    sourceOffset: 0,
    fetchYouTube: false,
    fetchX: false,
    youtubeJobMode: 'channel_uploads',
    env: {},
  });

  assert.equal(result.youtube.job_mode, 'channel_uploads');
  assert.equal(result.youtube.selected_source_count, 50);
  assert.equal(result.youtube.next_source_offset, 50);
  assert.ok(result.youtube.primary_search_job_count > 0, 'known channel uploads should still be attempted first');
  assert.ok(result.youtube.registry_fill_search_job_count > 0, 'registry search feeds should fill the batch when channel uploads are too small');
  assert.ok(result.youtube.search_job_count >= 50, 'deep sweep should no longer be limited to the small known-channel pool');
  assert.equal(result.performance.caps.source_limit, 50);
  assert.equal(result.performance.caps.max_results_per_source, 25);
  assert.equal(result.performance.caps.max_pages_per_source, 1);
  assert.equal(result.performance.caps.import_post_limit, 50);
});

test('source sweeps enforce fast caps and return partial telemetry when the time budget is exhausted', async () => {
  const capped = await runSocialPlatformPostSweep({
    platform: 'youtube',
    dryRun: true,
    maxSources: 500,
    maxResultsPerSource: 99,
    maxPagesPerSource: 6,
    fetchYouTube: false,
    fetchX: false,
    env: {},
  });

  assert.equal(capped.registry_rotation.requested_source_limit, 60);
  assert.equal(capped.performance.caps.source_limit, 60);
  assert.equal(capped.performance.caps.max_results_per_source, 25);
  assert.equal(capped.performance.caps.max_pages_per_source, 1);
  assert.equal(capped.performance.caps.import_post_limit, 60);
  assert.equal(capped.performance.time_budget_ms, 45000);

  const timed = await runSocialPlatformPostSweep({
    platform: 'youtube',
    dryRun: true,
    maxSources: 3,
    maxResultsPerSource: 25,
    maxPagesPerSource: 1,
    youtubeJobMode: 'search',
    fetchYouTube: true,
    fetchX: false,
    env: { YOUTUBE_API_KEY: 'test-key' },
    timeBudgetMs: 1,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    }),
  });

  assert.equal(timed.partial_results, true);
  assert.equal(timed.performance.partial_results, true);
  assert.ok(timed.youtube.fetch_reports.some((report) => report.reason === 'source_sweep_time_budget_exhausted'));
});
