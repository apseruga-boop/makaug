#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  DEFAULT_HASHTAG,
  runTikTokAutopublishAgent,
} = require('../services/tiktokAutopublishAgentService');
const { harvestAutomationEnabled } = require('../utils/harvestFeatureFlags');

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
    '  node scripts/run-tiktok-autopublish-agent.js --dry-run --hashtag=ugandarealestate',
    '  node scripts/run-tiktok-autopublish-agent.js --confirm-review --hashtag=ugandarealestate --review-limit=100',
    '',
    'Optional exact source input:',
    '  --url=https://www.tiktok.com/@handle/video/1234567890',
    '  --hashtag-sequence=ugandarealestate,housesforsaleuganda,kampalarentals,landforsaleuganda',
    '  --policy-mode=relaxed',
    '',
    'Rules:',
    '  The legacy command name is retained for scheduler compatibility, but live publishing is disabled.',
    '  Exact TikTok /@handle/video/id records are scored and remain pending for human review.',
  ].join('\n'));
}

async function main() {
  const confirmReview = args.includes('--confirm-review') || args.includes('--confirm-live');
  const dryRun = args.includes('--dry-run') || !confirmReview;
  if (confirmReview && !harvestAutomationEnabled()) {
    throw new Error('Harvest automation is disabled. Set HARVEST_AUTOMATION_ENABLED=true only after Dave verification.');
  }
  const urls = args
    .filter((arg) => String(arg || '').startsWith('--url='))
    .map((arg) => arg.slice('--url='.length))
    .filter(Boolean);
  const hashtagSequence = argValue('--hashtag-sequence', '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const result = await runTikTokAutopublishAgent({
    db,
    hashtag: argValue('--hashtag', DEFAULT_HASHTAG),
    hashtagSequence,
    policyMode: argValue('--policy-mode', argValue('--policy', 'strict')),
    liveLimit: argValue('--live-limit', '5'),
    reviewLimit: argValue('--review-limit', '100'),
    scanLimit: argValue('--scan-limit', '250'),
    dryRun,
    confirmReview,
    urls,
    fetchOembed: !args.includes('--no-oembed'),
  });
  console.log(JSON.stringify({
    ok: result.ok !== false,
    action: 'tiktok_review_queue_agent',
    review_only: true,
    ...result,
  }, null, 2));
  if (result.ok === false) process.exit(2);
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
