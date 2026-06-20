#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  DEFAULT_HASHTAG,
  runTikTokAutopublishAgent,
} = require('../services/tiktokAutopublishAgentService');

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
    '  node scripts/run-tiktok-autopublish-agent.js --confirm-live --hashtag=ugandarealestate --live-limit=5 --review-limit=100',
    '',
    'Optional exact source input:',
    '  --url=https://www.tiktok.com/@handle/video/1234567890',
    '',
    'Rules:',
    '  The agent only publishes exact TikTok /@handle/video/id records that pass all hard gates.',
    '  Hashtag pages are capture tasks only; they are not enough evidence to publish a listing.',
  ].join('\n'));
}

async function main() {
  const dryRun = args.includes('--dry-run') || !args.includes('--confirm-live');
  const confirmLive = args.includes('--confirm-live');
  const urls = args
    .filter((arg) => String(arg || '').startsWith('--url='))
    .map((arg) => arg.slice('--url='.length))
    .filter(Boolean);
  const result = await runTikTokAutopublishAgent({
    db,
    hashtag: argValue('--hashtag', DEFAULT_HASHTAG),
    liveLimit: argValue('--live-limit', '5'),
    reviewLimit: argValue('--review-limit', '100'),
    scanLimit: argValue('--scan-limit', '250'),
    dryRun,
    confirmLive,
    urls,
    fetchOembed: !args.includes('--no-oembed'),
  });
  console.log(JSON.stringify({
    ok: result.ok !== false,
    action: 'tiktok_autopublish_agent',
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
