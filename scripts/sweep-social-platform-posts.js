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
    '  node scripts/sweep-social-platform-posts.js --platform=x --dry-run',
    '  node scripts/sweep-social-platform-posts.js --platform=x --confirm --max-sources=25 --max-results=25',
    '',
    'Platforms:',
    '  tiktok  Builds exact-video capture tasks from tracked TikTok hashtag/profile feeds.',
    '  x       Uses X_BEARER_TOKEN/TWITTER_BEARER_TOKEN when available to fetch exact X post URLs and queue eligible found-online properties.',
    '  all     Runs TikTok capture tasks plus X API discovery.',
    '',
    'Writes:',
    '  --dry-run reports tasks/posts only.',
    '  --confirm queues eligible exact X posts into King found-online review. TikTok hashtags still require exact video URLs before import.',
  ].join('\n'));
}

async function main() {
  const platform = argValue('--platform', 'all');
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  const maxSources = argValue('--max-sources', argValue('--limit', '40'));
  const maxResultsPerSource = argValue('--max-results', '25');
  const searchMode = argValue('--x-search-mode', 'all');
  if (!dryRun && !confirm) {
    usage();
    process.exit(2);
  }
  const result = await runSocialPlatformPostSweep({
    db,
    platform,
    dryRun,
    maxSources,
    maxResultsPerSource,
    searchMode,
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
