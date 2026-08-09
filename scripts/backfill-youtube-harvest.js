#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const { runSocialPlatformPostSweep } = require('../services/socialPlatformPostDiscoveryService');

const args = process.argv.slice(2);

function argValue(name, fallback = '') {
  const exactIndex = args.indexOf(name);
  if (exactIndex >= 0) return args[exactIndex + 1] || fallback;
  const prefix = `${name}=`;
  const found = args.find((arg) => String(arg || '').startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function twoMonthStart(now = new Date()) {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 2);
  return start.toISOString();
}

function buildDateWindows(startValue, endValue = new Date().toISOString(), windowDays = 7) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return [];
  const days = Math.max(1, Math.min(31, Number(windowDays) || 7));
  const windows = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Math.min(end.getTime(), cursor.getTime() + days * 24 * 60 * 60 * 1000));
    windows.push({ published_after: cursor.toISOString(), published_before: next.toISOString() });
    cursor = next;
  }
  return windows;
}

function usage() {
  console.error([
    'Usage:',
    '  npm run inventory:youtube-backfill -- --dry-run',
    '  npm run inventory:youtube-backfill -- --confirm --source-offset=0 --max-sources=5 --max-pages=2 --window-days=7',
    '',
    'The default start is two months before the run time. The script walks bounded publishedAfter/publishedBefore windows.',
    'Saved forward cursors are deliberately ignored. --confirm only queues candidates into King review; it never publishes them.',
  ].join('\n'));
}

async function main() {
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  if (!dryRun && !confirm) {
    usage();
    process.exitCode = 2;
    return;
  }
  const publishedAfter = argValue('--published-after', twoMonthStart());
  const publishedBefore = argValue('--published-before', new Date().toISOString());
  const windows = buildDateWindows(publishedAfter, publishedBefore, Number(argValue('--window-days', '7')) || 7);
  if (!windows.length) throw new Error('The YouTube backfill date range is invalid or empty.');
  const reports = [];
  for (const window of windows) {
    const result = await runSocialPlatformPostSweep({
      db,
      platform: 'youtube',
      dryRun,
      useSavedCursors: false,
      backfillMode: true,
      youtubePublishedAfter: window.published_after,
      youtubePublishedBefore: window.published_before,
      youtubeJobMode: argValue('--youtube-job-mode', 'all'),
      sourceOffset: Number(argValue('--source-offset', '0')) || 0,
      maxSources: Number(argValue('--max-sources', '5')) || 5,
      maxResultsPerSource: Number(argValue('--max-results', '50')) || 50,
      maxPagesPerSource: Number(argValue('--max-pages', '2')) || 2,
    });
    reports.push({ window, result });
  }
  console.log(JSON.stringify({
    ok: true,
    action: 'youtube_two_month_review_only_backfill',
    review_only: true,
    published_after: publishedAfter,
    published_before: publishedBefore,
    window_count: reports.length,
    totals: reports.reduce((totals, report) => {
      const imported = report.result?.import_result || {};
      totals.discovered += Number(report.result?.discovered_posts_count || 0);
      totals.created_in_review += Number(imported.created_properties || 0);
      totals.duplicates += Number(imported.existing_properties || 0);
      totals.skipped += Number(imported.source_review_count || 0);
      return totals;
    }, { discovered: 0, created_in_review: 0, duplicates: 0, skipped: 0 }),
    reports,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await db.pool.end();
      } catch (_) {}
    });
}

module.exports = { buildDateWindows, twoMonthStart };
