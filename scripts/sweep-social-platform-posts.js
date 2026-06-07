#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  runSocialPlatformPostSweep,
} = require('../services/socialPlatformPostDiscoveryService');

const args = process.argv.slice(2);

function argValue(name, fallback = '') {
  const exactIndex = args.indexOf(name);
  if (exactIndex >= 0) return args[exactIndex + 1] || fallback;
  const prefix = `${name}=`;
  const found = args.find((arg) => String(arg || '').startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function usage() {
  console.error([
    'Usage:',
    '  node scripts/sweep-social-platform-posts.js --platform=tiktok --dry-run',
    '  node scripts/sweep-social-platform-posts.js --platform=youtube --confirm --published-after=2026-01-01T00:00:00.000Z --source-offset=0 --max-sources=50 --max-results=50',
    '  node scripts/sweep-social-platform-posts.js --platform=youtube --dry-run --source-offset=100 --max-sources=50 --max-results=50',
    '  node scripts/sweep-social-platform-posts.js --platform=x --dry-run',
    '  node scripts/sweep-social-platform-posts.js --platform=x --confirm --max-sources=25 --max-results=25 --lookback-days=14',
    '',
    'Platforms:',
    '  tiktok  Builds exact-video capture tasks from tracked TikTok hashtag/profile feeds.',
    '  youtube Uses YOUTUBE_API_KEY/GOOGLE_YOUTUBE_API_KEY to fetch Shorts and long-form videos from 1 January 2026 onward and queue eligible exact video posts.',
    '  x       Uses X_BEARER_TOKEN/TWITTER_BEARER_TOKEN when available to fetch exact X post URLs and queue eligible found-online properties.',
    '  all     Runs TikTok capture tasks plus YouTube and X API discovery.',
    '',
    'Writes:',
    '  --dry-run reports tasks/posts only.',
    '  --confirm queues eligible exact YouTube/X posts into King found-online review. TikTok hashtags still require exact video URLs before import.',
  ].join('\n'));
}

async function main() {
  const platform = argValue('--platform', 'all');
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  const maxSources = argValue('--max-sources', argValue('--limit', '40'));
  const sourceOffset = argValue('--source-offset', '0');
  const maxResultsPerSource = argValue('--max-results', '25');
  const searchMode = argValue('--x-search-mode', 'all');
  const lookbackDays = argValue('--lookback-days', '0');
  const publishedAfter = argValue('--published-after', '2026-01-01T00:00:00.000Z');
  if (!dryRun && !confirm) {
    usage();
    process.exit(2);
  }
  const result = await runSocialPlatformPostSweep({
    db,
    platform,
    dryRun,
    maxSources,
    sourceOffset,
    maxResultsPerSource,
    searchMode,
    lookbackDays,
    publishedAfter,
  });
  console.log(JSON.stringify({
    ok: true,
    action: 'social_platform_post_sweep',
    batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    ...result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch (_) {}
  });
