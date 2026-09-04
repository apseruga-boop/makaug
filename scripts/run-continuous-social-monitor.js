#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
} = require('../services/propertySourceRegistryService');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  runSocialPlatformPostSweep,
} = require('../services/socialPlatformPostDiscoveryService');
const { harvestAutomationEnabled } = require('../utils/harvestFeatureFlags');

const args = process.argv.slice(2);
const MONITOR_AUDIT_ACTION = 'continuous_social_monitor_run';
const DEFAULT_CADENCE_MINUTES = 10;

function argValue(name, fallback = '') {
  const exactIndex = args.indexOf(name);
  if (exactIndex >= 0) return args[exactIndex + 1] || fallback;
  const prefix = `${name}=`;
  const found = args.find((arg) => String(arg || '').startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function numberValue(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = argValue(name, fallback == null ? '' : String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function listValue(name, fallback = '') {
  return String(argValue(name, fallback) || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function usage() {
  console.error([
    'Usage:',
    '  node scripts/run-continuous-social-monitor.js --dry-run',
    '  node scripts/run-continuous-social-monitor.js --confirm',
    '  node scripts/run-continuous-social-monitor.js --confirm --platforms=youtube,x,instagram,tiktok --youtube-job-mode=channel_uploads --max-sources=15',
    '',
    'Defaults:',
    '  High-frequency YouTube runs use --youtube-job-mode=channel_uploads to avoid broad Search quota burn.',
    '  The next source offset is read from audit_logs when available; otherwise it is time-slot based.',
    '  Use --youtube-job-mode=all on a slower cron for broader hashtag/search coverage.',
  ].join('\n'));
}

function timeSlotOffset({ maxSources, targetCount, cadenceMinutes, now = new Date() }) {
  const cadenceMs = Math.max(1, cadenceMinutes) * 60 * 1000;
  const slot = Math.floor(now.getTime() / cadenceMs);
  return (slot * Math.max(1, maxSources)) % Math.max(1, targetCount);
}

async function readLastMonitorCursor() {
  try {
    const result = await db.query(
      `SELECT details
       FROM audit_logs
       WHERE action = $1
       ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST
       LIMIT 1`,
      [MONITOR_AUDIT_ACTION]
    );
    const details = result.rows[0]?.details || {};
    const offset = Number(details.next_source_offset ?? details.source_offset);
    return Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : null;
  } catch (_error) {
    return null;
  }
}

async function writeMonitorAudit(details = {}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      ['continuous_social_monitor', MONITOR_AUDIT_ACTION, JSON.stringify(details || {})]
    );
  } catch (_error) {
    // The monitor must still run if audit_logs is temporarily unavailable.
  }
}

function summarizeSweepResult(result = {}) {
  const importResult = result.import_result || {};
  return {
    platforms: result.platforms || [],
    dry_run: result.dry_run === true,
    discovered_posts_count: result.discovered_posts_count || 0,
    created_properties: importResult.created_properties || 0,
    existing_properties: importResult.existing_properties || 0,
    review_queue_properties: importResult.review_queue_properties || 0,
    created_auto_live_properties: importResult.created_auto_live_properties || 0,
    existing_auto_live_properties: importResult.existing_auto_live_properties || 0,
    auto_live_properties: importResult.auto_live_properties || 0,
    youtube: result.youtube ? {
      job_mode: result.youtube.job_mode || '',
      source_offset: result.youtube.source_offset || 0,
      source_count: result.youtube.source_count || 0,
      unfiltered_search_job_count: result.youtube.unfiltered_search_job_count || 0,
      search_job_count: result.youtube.search_job_count || 0,
      fetched_posts_count: result.youtube.fetched_posts_count || 0,
      live_ready_count: result.youtube.confidence_summary?.live_ready_count || 0,
      known_channel_fallback_attempted: result.youtube.known_channel_fallback?.attempted === true,
      known_channel_fallback_posts: result.youtube.known_channel_fallback?.fetched_posts_count || 0,
      api_configured: result.youtube.api_configured === true,
      skipped_reason: result.youtube.skipped_reason || '',
    } : null,
    x: result.x ? {
      search_job_count: result.x.search_job_count || 0,
      fetched_posts_count: result.x.fetched_posts_count || 0,
      api_configured: result.x.api_configured === true,
      skipped_reason: result.x.skipped_reason || '',
    } : null,
    instagram: result.instagram ? {
      hashtag_search_job_count: result.instagram.hashtag_search_job_count || 0,
      fetched_posts_count: result.instagram.fetched_posts_count || 0,
      api_configured: result.instagram.api_configured === true,
      skipped_reason: result.instagram.skipped_reason || '',
    } : null,
    tiktok: result.tiktok ? {
      capture_task_count: result.tiktok.capture_task_count || 0,
      fetched_posts_count: result.tiktok.data_source_fetch?.fetched_posts_count || 0,
      api_configured: result.tiktok.api_configured === true,
      skipped_reason: result.tiktok.data_source_fetch?.skipped_reason || '',
    } : null,
  };
}

async function main() {
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  if (!dryRun && !confirm) {
    usage();
    process.exit(2);
  }
  if (confirm && !harvestAutomationEnabled()) {
    throw new Error('Harvest automation is disabled. Set HARVEST_AUTOMATION_ENABLED=true only after Dave verification.');
  }

  const targetCount = numberValue('--source-target', PROPERTY_SOURCE_REGISTRY_TARGET_COUNT, { min: 1 });
  const cadenceMinutes = numberValue('--cadence-minutes', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_CADENCE_MINUTES || DEFAULT_CADENCE_MINUTES), { min: 1, max: 1440 });
  const maxSources = numberValue('--max-sources', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_MAX_SOURCES || 15), { min: 1, max: 60 });
  const maxResultsPerSource = numberValue('--max-results', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_MAX_RESULTS || 25), { min: 1, max: 25 });
  const maxPagesPerSource = numberValue('--max-pages', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_MAX_PAGES || 1), { min: 1, max: 1 });
  const publishedAfter = argValue('--published-after', process.env.CONTINUOUS_SOCIAL_MONITOR_PUBLISHED_AFTER || '2026-01-01T00:00:00.000Z');
  const lookbackDays = numberValue('--lookback-days', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_LOOKBACK_DAYS || 7), { min: 0, max: 30 });
  const searchMode = argValue('--x-search-mode', process.env.CONTINUOUS_SOCIAL_MONITOR_X_SEARCH_MODE || 'recent');
  const youtubeJobMode = argValue('--youtube-job-mode', process.env.CONTINUOUS_SOCIAL_MONITOR_YOUTUBE_JOB_MODE || 'channel_uploads');
  const platforms = listValue('--platforms', process.env.CONTINUOUS_SOCIAL_MONITOR_PLATFORMS || 'youtube,x,instagram,tiktok');
  const explicitOffset = argValue('--source-offset', '');
  const auditCursor = explicitOffset === '' ? await readLastMonitorCursor() : null;
  const sourceOffset = explicitOffset !== ''
    ? numberValue('--source-offset', 0, { min: 0, max: targetCount - 1 })
    : (auditCursor ?? timeSlotOffset({ maxSources, targetCount, cadenceMinutes }));
  const nextSourceOffset = (sourceOffset + maxSources) % targetCount;

  const sweepResults = [];
  for (const platform of platforms) {
    const result = await runSocialPlatformPostSweep({
      db,
      platform,
      dryRun,
      maxSources,
      sourceOffset,
      maxResultsPerSource,
      maxPagesPerSource,
      searchMode,
      lookbackDays,
      publishedAfter,
      youtubeJobMode: platform === 'youtube' ? youtubeJobMode : 'all',
    });
    sweepResults.push({
      platform,
      result,
      summary: summarizeSweepResult(result),
    });
  }

  const report = {
    ok: true,
    action: 'continuous_social_monitor',
    dry_run: dryRun,
    confirmed: confirm,
    source_registry_batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
    social_platform_batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    source_offset: sourceOffset,
    next_source_offset: nextSourceOffset,
    target_source_count: targetCount,
    cadence_minutes: cadenceMinutes,
    max_sources: maxSources,
    max_results_per_source: maxResultsPerSource,
    max_pages_per_source: maxPagesPerSource,
    published_after: publishedAfter,
    youtube_job_mode: youtubeJobMode,
    platforms,
    summaries: sweepResults.map((item) => item.summary),
  };

  if (confirm) await writeMonitorAudit(report);
  console.log(JSON.stringify(report, null, 2));
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
