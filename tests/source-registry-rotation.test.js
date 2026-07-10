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
    maxSources: 80,
    sourceOffset: 0,
    fetchYouTube: false,
    fetchX: false,
    youtubeJobMode: 'channel_uploads',
    env: {},
  });

  assert.equal(result.youtube.job_mode, 'channel_uploads');
  assert.equal(result.youtube.selected_source_count, 80);
  assert.equal(result.youtube.next_source_offset, 80);
  assert.ok(result.youtube.primary_search_job_count > 0, 'known channel uploads should still be attempted first');
  assert.ok(result.youtube.registry_fill_search_job_count > 0, 'registry search feeds should fill the batch when channel uploads are too small');
  assert.ok(result.youtube.search_job_count >= 80, 'deep sweep should no longer be limited to the small known-channel pool');
});
