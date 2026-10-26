'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const discovery = require('../services/socialPlatformPostDiscoveryService');
const drip = require('../services/youtubeSourceDripService');
const { getPropertySourceRegistry } = require('../services/propertySourceRegistryService');

// The YouTube drip froze the web server for 4-7 s at the start of each run: it
// walked ~11,000 registry sources twice in one synchronous pass to keep 5 jobs.

test('the async job builder returns exactly what the sync builder returns', async () => {
  const sources = discovery.sourcesForPlatform('youtube');
  for (const [jobMode, offset] of [['all', 0], ['all', 4321], ['search', 17], ['channel_uploads', 3]]) {
    const args = { sources, limit: 5, offset, publishedAfter: '2026-06-01T00:00:00.000Z', maxPagesPerSource: 1, jobMode };
    assert.deepEqual(await discovery.buildYouTubeSearchJobsAsync(args), discovery.buildYouTubeSearchJobs(args), `${jobMode}@${offset}`);
  }
});

test('the async source list matches the sync one', async () => {
  const sync = discovery.sourcesForPlatform('youtube');
  const asyncList = await discovery.sourcesForPlatformAsync('youtube');
  assert.equal(asyncList.length, sync.length);
  assert.deepEqual(asyncList.slice(0, 20), sync.slice(0, 20));
  assert.deepEqual(asyncList.slice(-20), sync.slice(-20));
});

test('building the drip window never blocks the event loop for long', async () => {
  const sources = discovery.sourcesForPlatform('youtube');
  let last = Date.now();
  let worst = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 5);
  try {
    await discovery.buildYouTubeSearchJobsAsync({ sources, limit: 5, offset: 100, jobMode: 'all' });
  } finally {
    clearInterval(timer);
  }
  // The sync walk took ~3 s here; chunked, each slice is a small fraction.
  assert.ok(worst < 1000, `worst event-loop gap ${worst} ms`);
});

test('the sweep uses the yielding builders and walks the sources once in all mode', () => {
  const source = read('services/socialPlatformPostDiscoveryService.js');
  const sweep = source.slice(source.indexOf('async function runSocialPlatformPostSweep'));
  assert.ok(sweep.includes("await sourcesForPlatformAsync('youtube')"));
  assert.ok(sweep.includes("normalizedYoutubeJobMode === 'all'\n      ? unfilteredYoutubeSearchJobs"));
  assert.ok(!/[^.]buildYouTubeSearchJobs\(\{ sources: youtubeSources/.test(sweep), 'no sync walk of the registry sources in the sweep');
});

test('the drip runs a few times a day, not every 10 minutes', () => {
  assert.ok(drip.MIN_INTERVAL_MINUTES >= 240, `floor ${drip.MIN_INTERVAL_MINUTES}`);
  const source = read('services/youtubeSourceDripService.js');
  assert.ok(source.includes('base_interval_minutes = GREATEST(source_drip_state.base_interval_minutes, EXCLUDED.base_interval_minutes)'),
    'a saved 10-minute interval is raised to the floor');
  assert.ok(source.includes("observeJob('youtube_source_drip', () => runSocialPlatformPostSweep("), 'every run is a named job in the stall log');
});

test('a quota-exhausted run waits for the Pacific-midnight quota reset', () => {
  // 26 Oct 2026 08:00 UTC = 01:00 PDT; the next reset is 27 Oct 07:05 UTC.
  assert.equal(drip.nextYouTubeQuotaResetAt(new Date('2026-10-26T08:00:00Z')).toISOString(), '2026-10-27T07:05:00.000Z');
  // 10 Dec 2026 20:00 UTC = 12:00 PST; the next reset is 11 Dec 08:05 UTC.
  assert.equal(drip.nextYouTubeQuotaResetAt(new Date('2026-12-10T20:00:00Z')).toISOString(), '2026-12-11T08:05:00.000Z');
  // 10 Dec 2026 07:30 UTC = 23:30 PST on the 9th; the reset is 35 minutes away.
  assert.equal(drip.nextYouTubeQuotaResetAt(new Date('2026-12-10T07:30:00Z')).toISOString(), '2026-12-10T08:05:00.000Z');
  const minutes = drip.quotaExhaustedBackoffMinutes(new Date('2026-10-26T08:00:00Z'));
  assert.equal(minutes, 23 * 60 + 5);
  assert.ok(drip.quotaExhaustedBackoffMinutes(new Date('2026-12-10T07:30:00Z')) >= drip.MIN_INTERVAL_MINUTES, 'never sooner than the floor');
});

test('a failing run backs off instead of retrying on the normal interval', () => {
  const floor = drip.MIN_INTERVAL_MINUTES;
  assert.equal(drip.errorBackoffMinutes({ current_interval_minutes: 10 }), floor * 2);
  assert.equal(drip.errorBackoffMinutes({ current_interval_minutes: floor * 2 }), Math.min(1440, floor * 4));
  assert.equal(drip.errorBackoffMinutes({ current_interval_minutes: 1440 }), 1440);
  const source = read('services/youtubeSourceDripService.js');
  assert.ok(source.includes("next_run_at = NOW() + ($4 * INTERVAL '1 minute')"));
});

test('scheduler ticks do not rebuild the 60,000-row registry', () => {
  const source = read('services/youtubeSourceDripService.js');
  assert.ok(source.includes('if (cachedYouTubeSourceCount === null)'));
  assert.ok(getPropertySourceRegistry().length > 10000);
});
