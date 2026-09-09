'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  blockedSocialSourceMatch,
  isPermanentlyBlockedSocialSource,
} = require('../services/socialSourceBlocklistService');
const {
  importExactSocialSourcePosts,
  sourcesForPlatform,
} = require('../services/socialPlatformPostDiscoveryService');
const { queueFoundOnlineSourcePostListings } = require('../services/socialSearchSourcedListingsService');
const { buildCoverageManifestRows } = require('../services/sourceCoverageService');
const {
  processYouTubeWebSubNotification,
  registerDiscoveredYouTubeChannels,
  requestYouTubeWebSubSubscription,
} = require('../services/youtubeWebSubService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('permanent block matches stable account, handle, name and phone identities', () => {
  assert.equal(isPermanentlyBlockedSocialSource({ channel_id: 'UCFvuSMhrD9IiNXI3jgL6QgA' }), true);
  assert.equal(isPermanentlyBlockedSocialSource({ author_url: 'https://www.tiktok.com/@WillioLevis/video/123' }), true);
  assert.equal(isPermanentlyBlockedSocialSource({ source_name: 'DREAM HOME REAL-ESTATE AKA V8' }), true);
  assert.equal(isPermanentlyBlockedSocialSource({ contact_phone: '+256 750 719 382' }), true);
  assert.equal(isPermanentlyBlockedSocialSource({ source_name: 'Different Uganda Homes' }), false);
  assert.equal(blockedSocialSourceMatch({ source_registry_key: 'dream-home-real-estate' }).key, 'dream-home-real-estate');
});

test('registry and restart-safe coverage omit the blocked source before provider work', () => {
  const youtubeSources = sourcesForPlatform('youtube');
  assert.equal(youtubeSources.some((source) => isPermanentlyBlockedSocialSource(source)), false);
  const rows = buildCoverageManifestRows([
    { key: 'dream-home-real-estate', name: 'Dream Home Real Estate', platform: 'youtube', url: 'https://youtube.com/channel/UCFvuSMhrD9IiNXI3jgL6QgA', status: 'active' },
    { key: 'allowed', name: 'Allowed', platform: 'youtube', url: 'https://youtube.com/@allowed', status: 'active' },
  ], { platforms: ['youtube'] });
  assert.deepEqual(rows.map((row) => row.source_key), ['allowed']);
});

test('central listing queue rejects a blocked account even when the post URL is new', async () => {
  const result = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      post_url: 'https://www.youtube.com/watch?v=brandNewVideo',
      source_name: 'DREAM HOME REAL-ESTATE AKA V8',
      source_page_url: 'https://www.youtube.com/channel/UCFvuSMhrD9IiNXI3jgL6QgA',
      title: 'House for sale in Kyanja Kampala',
      area: 'Kyanja',
      district: 'Kampala',
      source_platform: 'YouTube',
      source_registry_key: 'UCFvuSMhrD9IiNXI3jgL6QgA',
    }],
  });
  assert.equal(result.created_properties, 0);
  assert.equal(result.would_create_properties, 0);
  assert.equal(result.blocked_social_source_count, 1);
  assert.equal(result.source_review_records[0].reason, 'permanently_blocked_social_source');
});

test('exact import and YouTube WebSub guards perform no external request for the blocked account', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('blocked source must not reach provider');
  };
  const exact = await importExactSocialSourcePosts({
    posts: [{
      post_url: 'https://www.youtube.com/watch?v=brandNewVideo',
      source_registry_key: 'UCFvuSMhrD9IiNXI3jgL6QgA',
    }],
    fetchImpl,
  });
  assert.equal(exact.reason, 'permanently_blocked_social_source');
  assert.equal(exact.created_properties, 0);

  const subscription = await requestYouTubeWebSubSubscription(null, 'UCFvuSMhrD9IiNXI3jgL6QgA', {
    fetchImpl,
    env: { PUBLIC_BASE_URL: 'https://makaug.com', YOUTUBE_WEBSUB_SECRET: 'test' },
  });
  assert.equal(subscription.reason, 'permanently_blocked_social_source');

  const atom = `<?xml version="1.0"?><feed><entry><yt:videoId>newVideo</yt:videoId><yt:channelId>UCFvuSMhrD9IiNXI3jgL6QgA</yt:channelId><title>New house</title><author><name>DREAM HOME REAL-ESTATE AKA V8</name></author></entry></feed>`;
  const notification = await processYouTubeWebSubNotification(null, atom, { fetchImpl });
  assert.equal(notification.reason, 'permanently_blocked_social_source');

  const registered = await registerDiscoveredYouTubeChannels(null, [{
    channel_id: 'UCFvuSMhrD9IiNXI3jgL6QgA',
    source_name: 'DREAM HOME REAL-ESTATE AKA V8',
  }], { fetchImpl });
  assert.equal(registered.reports[0].subscription.reason, 'permanently_blocked_social_source');
  assert.equal(fetchCalls, 0);
});

test('migration records exact purge evidence and the admin route exposes live verification', () => {
  const migration = read('db/migrations/125_block_and_purge_dream_home_v8.sql');
  const adminRoute = read('routes/admin.js');
  const healthRoute = read('routes/health.js');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS blocked_social_sources/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS social_source_purge_audits/);
  assert.match(migration, /DELETE FROM properties/);
  assert.match(migration, /verified_remaining_property_count/);
  assert.match(migration, /ucfvusmhrd9iinxi3jgl6qga/);
  assert.match(adminRoute, /social-source-blocks\/dream-home-real-estate/);
  assert.match(healthRoute, /125_block_and_purge_dream_home_v8\.sql/);
});
