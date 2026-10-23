'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { tiktokSourceSweepEnabled } = require('../utils/harvestFeatureFlags');
const { dailySourceMonitorPlan } = require('../utils/dailySourceMonitorPlan');
const {
  classifyTikTokPublicPage,
  fetchTikTokPublicSourcePosts,
  videoUrlsFromPublicHtml,
} = require('../services/tiktokPublicSweepService');
const { runSocialPlatformPostSweep } = require('../services/socialPlatformPostDiscoveryService');

function snowflake(iso) {
  const seconds = BigInt(Math.floor(Date.parse(iso) / 1000));
  return (seconds << 32n).toString();
}

function response({ status = 200, body = '', jsonBody = null, location = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'location' ? location : '') },
    text: async () => body,
    json: async () => jsonBody || {},
  };
}

test('TikTok public sweep stays off unless TIKTOK_SOURCE_SWEEP_ENABLED is on', () => {
  assert.equal(tiktokSourceSweepEnabled({}), false);
  assert.equal(tiktokSourceSweepEnabled({ TIKTOK_SOURCE_SWEEP_ENABLED: 'false' }), false);
  assert.equal(tiktokSourceSweepEnabled({ TIKTOK_SOURCE_SWEEP_ENABLED: 'true' }), true);
  const off = dailySourceMonitorPlan({ env: {}, platforms: ['youtube', 'x'] });
  assert.deepEqual(off.sweep_platforms, []);
  assert.equal(off.skipped.some((item) => item.platform === 'tiktok'), false);
  const on = dailySourceMonitorPlan({
    env: { TIKTOK_SOURCE_SWEEP_ENABLED: 'true', HARVEST_AUTOMATION_ENABLED: 'true' },
    platforms: ['youtube', 'x'],
  });
  assert.deepEqual(on.sweep_platforms, ['youtube', 'x', 'tiktok']);
});

test('public HTML video links are read and login pages are not treated as posts', () => {
  const recent = snowflake('2026-10-20T12:00:00.000Z');
  const urls = videoUrlsFromPublicHtml(`<a href="/@kampalahomes/video/${recent}">clip</a>`);
  assert.equal(urls[0], `https://www.tiktok.com/@kampalahomes/video/${recent}`);
  assert.equal(classifyTikTokPublicPage({ status: 404, videoCount: 0 }), 'broken');
  assert.equal(classifyTikTokPublicPage({ status: 200, html: 'Log in to TikTok', videoCount: 0 }), 'auth_wall');
  assert.equal(classifyTikTokPublicPage({ status: 302, location: 'https://www.tiktok.com/login', videoCount: 0 }), 'auth_wall');
});

test('flagged sweep dedupes, rate-limits, skips old videos, and uses oEmbed without auth', async () => {
  const recent = snowflake('2026-10-20T12:00:00.000Z');
  const old = snowflake('2024-01-01T00:00:00.000Z');
  const recentUrl = `https://www.tiktok.com/@kampalahomes/video/${recent}`;
  const oldUrl = `https://www.tiktok.com/@kampalahomes/video/${old}`;
  const sleeps = [];
  const calls = [];
  const fetchImpl = async (url, options) => {
    const href = String(url?.href || url);
    calls.push({ href, options });
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.redirect, 'manual');
    assert.equal(/login|signup/i.test(new URL(href).pathname), false);
    if (href.includes('/oembed')) {
      return response({
        jsonBody: {
          title: '3 bedroom house for sale in Kira',
          author_name: 'Kampala Homes',
          author_url: 'https://www.tiktok.com/@kampalahomes',
          thumbnail_url: 'https://p16-sign.tiktokcdn.com/cover.jpg',
        },
      });
    }
    if (href.includes('/@oldsource')) {
      return response({ body: `<a href="${oldUrl}">old</a>` });
    }
    return response({ body: `<a href="${recentUrl}">new</a><a href="${recentUrl}">dup</a>` });
  };
  const result = await fetchTikTokPublicSourcePosts({
    enabled: true,
    env: {
      TIKTOK_SOURCE_SWEEP_PACING_MS: '25',
      TIKTOK_SOURCE_SWEEP_MAX_VIDEOS_PER_SOURCE: '4',
      TIKTOK_SOURCE_SWEEP_MAX_OEMBED: '5',
    },
    publishedAfter: '2026-09-01T00:00:00.000Z',
    sleep: async (ms) => { sleeps.push(ms); },
    sources: [
      { source_key: 'new-a', source_name: 'New A', source_url: 'https://www.tiktok.com/@newa' },
      { source_key: 'new-b', source_name: 'New B', source_url: 'https://www.tiktok.com/@newb' },
      { source_key: 'old', source_name: 'Old', source_url: 'https://www.tiktok.com/@oldsource' },
    ],
    fetchImpl,
  });
  assert.equal(result.enabled, true);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].post_url, recentUrl);
  assert.equal(result.posts[0].source_registry_key, 'new-a');
  assert.equal(result.duplicates_skipped >= 1, true);
  assert.equal(result.outside_lookback_count, 1);
  assert.equal(result.oembed_fetch_count, 1);
  assert.equal(calls.filter((call) => call.href.includes('/oembed')).length, 1);
  assert.equal(sleeps.every((ms) => ms === 25), true);
  assert.equal(sleeps.length >= 2, true);
});

test('a TikTok 429 stops further requests and a 404 is reported broken', async () => {
  const recent = snowflake('2026-10-20T12:00:00.000Z');
  const recentUrl = `https://www.tiktok.com/@kampalahomes/video/${recent}`;
  let calls = 0;
  const result = await fetchTikTokPublicSourcePosts({
    enabled: true,
    env: { TIKTOK_SOURCE_SWEEP_PACING_MS: '0' },
    publishedAfter: '2026-09-01T00:00:00.000Z',
    sources: [
      { source_key: 'gone', source_name: 'Gone', source_url: 'https://www.tiktok.com/@gone' },
      { source_key: 'live', source_name: 'Live', source_url: 'https://www.tiktok.com/@live' },
      { source_key: 'later', source_name: 'Later', source_url: 'https://www.tiktok.com/@later' },
    ],
    fetchImpl: async (url) => {
      calls += 1;
      const href = String(url?.href || url);
      if (href.includes('/@gone')) return response({ status: 404, body: 'not found' });
      if (href.includes('/@live')) return response({ body: `<a href="${recentUrl}">v</a>` });
      return response({ status: 429, body: 'slow down' });
    },
  });
  assert.equal(result.broken_sources.some((row) => row.source_key === 'gone'), true);
  assert.equal(result.rate_limited, true);
  assert.equal(result.posts.length, 1);
  assert.equal(result.oembed_fetch_count, 0);
  assert.equal(calls, 3);
});

test('the shared sweep does not call TikTok when the flag is off and queues when it is on', async () => {
  const recent = snowflake('2026-10-20T12:00:00.000Z');
  const recentUrl = `https://www.tiktok.com/@kampalahomes/video/${recent}`;
  const db = { query: async () => ({ rows: [] }) };
  let calls = 0;
  const off = await runSocialPlatformPostSweep({
    db,
    platform: 'tiktok',
    dryRun: true,
    maxSources: 1,
    sourceOffset: 0,
    env: {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network should stay unused');
    },
  });
  assert.equal(calls, 0);
  assert.equal(off.tiktok.public_sweep.enabled, false);
  assert.equal(off.discovered_posts_count, 0);

  const on = await runSocialPlatformPostSweep({
    db,
    platform: 'tiktok',
    dryRun: true,
    maxSources: 1,
    sourceOffset: 0,
    publishedAfter: '2026-09-01T00:00:00.000Z',
    env: {
      TIKTOK_SOURCE_SWEEP_ENABLED: 'true',
      TIKTOK_SOURCE_SWEEP_PACING_MS: '0',
      TIKTOK_SOURCE_SWEEP_MAX_VIDEOS_PER_SOURCE: '2',
      TIKTOK_SOURCE_SWEEP_MAX_OEMBED: '2',
    },
    fetchImpl: async (url) => {
      const href = String(url?.href || url);
      if (href.includes('/oembed')) {
        return response({
          jsonBody: {
            title: 'House for sale in Kira Kampala',
            author_name: 'Kampala Homes',
            author_url: 'https://www.tiktok.com/@kampalahomes',
            thumbnail_url: 'https://p16-sign.tiktokcdn.com/cover.jpg',
          },
        });
      }
      return response({ body: `<a href="${recentUrl}">listing</a>` });
    },
  });
  assert.equal(on.tiktok.public_sweep.enabled, true);
  assert.equal(on.discovered_posts.some((post) => post.post_url === recentUrl), true);
  assert.equal(on.import_result.dry_run, true);
  assert.equal(on.import_result.received_posts >= 1, true);
});
