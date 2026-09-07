'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildInstagramHashtagJobs,
  fetchInstagramHashtagPostsForJobs,
} = require('../services/socialPlatformPostDiscoveryService');
const { loadHarvestSummary } = require('../services/propertyHarvestMonitoringService');
const {
  SOCIAL_COVERAGE_SCHEDULER_MARKER,
  SOCIAL_COVERAGE_TARGET_UNIQUE_POSTS,
  runSocialCoverageOnce,
  schedulerConfig,
  schedulerStatus,
} = require('../services/socialCoverageSchedulerService');

test('Instagram Graph hashtag discovery returns exact review candidates without putting tokens in URLs', async () => {
  const jobs = buildInstagramHashtagJobs({
    sources: [{
      platform: 'instagram',
      key: 'instagram-hashtag-houses-for-rent-kampala',
      name: '#housesforrentkampala',
      sourceType: 'hashtag_search_feed',
      source_record_kind: 'discovery_feed',
      url: 'https://www.instagram.com/explore/tags/housesforrentkampala/',
      hashtags: ['housesforrentkampala'],
    }],
    limit: 10,
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].hashtag, 'housesforrentkampala');

  const calls = [];
  const result = await fetchInstagramHashtagPostsForJobs(jobs, {
    accessToken: 'meta-test-token',
    businessAccountIds: ['17841400000000000'],
    graphVersion: 'v23.0',
    maxResults: 25,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/ig_hashtag_search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: '17843800000000000' }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            id: '18000000000000000',
            caption: 'House for rent in Kira, Wakiso at UGX 1,500,000 per month',
            media_type: 'IMAGE',
            media_url: 'https://cdn.example.test/kira-house.jpg',
            permalink: 'https://www.instagram.com/p/ABC123/',
            timestamp: '2026-08-24T08:00:00+0000',
            username: 'agent_uganda',
          }],
        }),
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => !call.url.includes('meta-test-token')), true);
  assert.equal(calls.every((call) => call.options.headers.Authorization === 'Bearer meta-test-token'), true);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].platform, 'instagram');
  assert.equal(result.posts[0].post_url, 'https://www.instagram.com/p/ABC123/');
  assert.equal(result.posts[0].area, 'Kira');
  assert.equal(result.reports[0].normalized_post_count, 1);
});

test('30,000 coverage is based on distinct exact post identities and exposes duplicates separately', async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes('AS unique_posts_checked') && !sql.includes('GROUP BY platform')) {
        return { rows: [{
          event_count: 42000,
          unique_posts_checked: 12345,
          duplicate_events: 8765,
          unique_posts_checked_in_window: 321,
          coverage_started_at: '2026-08-01T00:00:00.000Z',
          newest_check_at: '2026-08-24T09:00:00.000Z',
        }] };
      }
      if (sql.includes('GROUP BY platform') && sql.includes('AS unique_posts_checked')) {
        return { rows: [
          { platform: 'youtube', event_count: 20000, unique_posts_checked: 10000, duplicate_events: 4000 },
          { platform: 'tiktok', event_count: 22000, unique_posts_checked: 2345, duplicate_events: 4765 },
        ] };
      }
      return { rows: [] };
    },
  };

  const summary = await loadHarvestSummary(db, { days: 14 });
  assert.equal(summary.review_only, true);
  assert.equal(summary.post_check_coverage.target_unique_posts, 30000);
  assert.equal(summary.post_check_coverage.unique_posts_checked, 12345);
  assert.equal(summary.post_check_coverage.unique_posts_remaining, 17655);
  assert.equal(summary.post_check_coverage.percent_complete, 41.15);
  assert.equal(summary.post_check_coverage.duplicate_events, 8765);
  assert.match(summary.post_check_coverage.counting_rule, /Distinct exact platform post IDs/);
});

test('recurring social coverage scheduler is review-only, bounded and targets 30,000 unique posts', () => {
  assert.equal(SOCIAL_COVERAGE_SCHEDULER_MARKER, 'social-coverage-30k-review-only-20260824');
  assert.equal(SOCIAL_COVERAGE_TARGET_UNIQUE_POSTS, 30000);
  assert.deepEqual(schedulerConfig({}), {
    cadence_minutes: 15,
    batch_size: 10,
    max_results_per_source: 25,
  });
  const status = schedulerStatus();
  assert.equal(status.review_only, true);
  assert.equal(status.target_unique_posts, 30000);
});

test('recurring scheduler acquires and releases its advisory lock on the same database session', async () => {
  const lockQueries = [];
  let released = false;
  const client = {
    query: async (sql) => {
      lockQueries.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      return { rows: [] };
    },
    release: () => { released = true; },
  };
  const db = {
    getClient: async () => client,
    query: async (sql) => {
      if (sql.includes('FROM audit_logs')) {
        return { rows: [{ details: { completed_at: new Date().toISOString() }, created_at: new Date() }] };
      }
      return { rows: [] };
    },
  };

  const result = await runSocialCoverageOnce(db);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'social_coverage_scheduler_not_due');
  assert.equal(lockQueries.some((sql) => sql.includes('pg_try_advisory_lock')), true);
  assert.equal(lockQueries.some((sql) => sql.includes('pg_advisory_unlock')), true);
  assert.equal(released, true);
});
