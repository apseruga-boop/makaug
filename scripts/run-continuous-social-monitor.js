#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
  releasePropertySourceRegistryCache,
} = require('../services/propertySourceRegistryService');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  runSocialPlatformPostSweep,
} = require('../services/socialPlatformPostDiscoveryService');
const { socialSweepPublishedAfter } = require('../utils/socialSweepWindow');
const { dailySourceMonitorPlan } = require('../utils/dailySourceMonitorPlan');
const logger = require('../config/logger');
const {
  DEFAULT_STALE_AFTER_DAYS,
  LISTING_SOURCE_HEALTH_AUDIT_ACTION,
  buildListingSourceHealthReport,
  probeListingSources,
  storeListingSourceHealthReport,
} = require('../services/listingSourceHealthService');

let args = process.argv.slice(2);
let activeRun = {};
const MONITOR_AUDIT_ACTION = 'continuous_social_monitor_run';
const DEFAULT_CADENCE_MINUTES = 10;

function argvFromRunOptions(options = {}) {
  const argv = [];
  if (options.dryRun) argv.push('--dry-run');
  if (options.confirm) argv.push('--confirm');
  if (options.platforms) {
    const list = Array.isArray(options.platforms) ? options.platforms.join(',') : String(options.platforms);
    argv.push(`--platforms=${list}`);
  }
  if (options.youtubeJobMode) argv.push(`--youtube-job-mode=${options.youtubeJobMode}`);
  if (options.maxSources != null) argv.push(`--max-sources=${options.maxSources}`);
  if (options.maxResults != null) argv.push(`--max-results=${options.maxResults}`);
  if (options.maxPages != null) argv.push(`--max-pages=${options.maxPages}`);
  if (options.publishedAfter) argv.push(`--published-after=${options.publishedAfter}`);
  if (options.lookbackDays != null) argv.push(`--lookback-days=${options.lookbackDays}`);
  if (options.searchMode) argv.push(`--x-search-mode=${options.searchMode}`);
  return argv;
}

function runWasStopped() {
  return typeof activeRun.shouldStop === 'function' && activeRun.shouldStop() === true;
}

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
    '  node scripts/run-continuous-social-monitor.js --confirm --platforms=youtube,x --youtube-job-mode=channel_uploads --max-sources=8',
    '  The makaug web service runs this once a day at 05:30 Europe/London.',
    '  YouTube/X run only when HARVEST_AUTOMATION_ENABLED=true.',
    '  The scheduled run includes TikTok unless TIKTOK_SOURCE_SWEEP_ENABLED=false. The health report always runs.',
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
  };
}

async function runContinuousSocialMonitor(options = {}) {
  activeRun = options || {};
  args = options.argv || (
    options.confirm || options.dryRun || options.platforms || options.youtubeJobMode
      ? argvFromRunOptions(options)
      : process.argv.slice(2)
  );
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  if (!dryRun && !confirm) {
    usage();
    if (require.main === module) process.exit(2);
    throw new Error('source monitor requires --confirm or --dry-run');
  }
  const targetCount = numberValue('--source-target', PROPERTY_SOURCE_REGISTRY_TARGET_COUNT, { min: 1 });
  const cadenceMinutes = numberValue('--cadence-minutes', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_CADENCE_MINUTES || DEFAULT_CADENCE_MINUTES), { min: 1, max: 1440 });
  const maxSources = numberValue('--max-sources', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_MAX_SOURCES || 15), { min: 1, max: 60 });
  const maxResultsPerSource = numberValue('--max-results', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_MAX_RESULTS || 25), { min: 1, max: 25 });
  const maxPagesPerSource = numberValue('--max-pages', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_MAX_PAGES || 1), { min: 1, max: 1 });
  const publishedAfter = argValue('--published-after', process.env.CONTINUOUS_SOCIAL_MONITOR_PUBLISHED_AFTER || socialSweepPublishedAfter());
  const lookbackDays = numberValue('--lookback-days', Number(process.env.CONTINUOUS_SOCIAL_MONITOR_LOOKBACK_DAYS || 30), { min: 0, max: 30 });
  const searchMode = argValue('--x-search-mode', process.env.CONTINUOUS_SOCIAL_MONITOR_X_SEARCH_MODE || 'recent');
  const youtubeJobMode = argValue('--youtube-job-mode', process.env.CONTINUOUS_SOCIAL_MONITOR_YOUTUBE_JOB_MODE || 'channel_uploads');
  const requestedPlatforms = listValue('--platforms', process.env.CONTINUOUS_SOCIAL_MONITOR_PLATFORMS || 'youtube,x');
  const plan = dailySourceMonitorPlan({
    env: activeRun.env || process.env,
    platforms: requestedPlatforms,
    tiktokWhenUnset: activeRun.tiktokWhenUnset === true,
  });
  const platforms = plan.sweep_platforms;
  const explicitOffset = argValue('--source-offset', '');
  const auditCursor = explicitOffset === '' ? await readLastMonitorCursor() : null;
  const sourceOffset = explicitOffset !== ''
    ? numberValue('--source-offset', 0, { min: 0, max: targetCount - 1 })
    : (auditCursor ?? timeSlotOffset({ maxSources, targetCount, cadenceMinutes }));
  const nextSourceOffset = (sourceOffset + maxSources) % targetCount;

  const sweepResults = [];
  for (const skipped of plan.skipped) {
    sweepResults.push({
      platform: skipped.platform,
      result: { skipped_reason: skipped.reason, posts: [] },
      summary: {
        platforms: [skipped.platform],
        skipped_reason: skipped.reason,
        discovered_posts_count: 0,
        created_properties: 0,
        existing_properties: 0,
        review_queue_properties: 0,
      },
    });
    logger.warn(`source monitor skipped ${skipped.platform}: ${skipped.reason}`);
  }
  for (const platform of platforms) {
    if (runWasStopped()) {
      logger.warn('source monitor stopped before the next platform', { platform });
      break;
    }
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
    const brokenSources = result?.tiktok?.public_sweep?.broken_sources || result?.public_sweep?.broken_sources || [];
    sweepResults.push({
      platform,
      broken_sources: brokenSources,
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
    sweep_plan: plan,
    summaries: sweepResults.map((item) => item.summary),
  };

  const staleAfterDays = numberValue('--stale-after-days', Number(process.env.LISTING_SOURCE_STALE_AFTER_DAYS || DEFAULT_STALE_AFTER_DAYS), { min: 1, max: 90 });
  const probeLimit = numberValue('--probe-limit', Number(process.env.LISTING_SOURCE_HEALTH_PROBE_LIMIT || 8), { min: 1, max: 20 });
  const probes = dryRun
    ? { skipped: true, reason: 'dry_run', checked: 0, results: [] }
    : runWasStopped()
      ? { skipped: true, reason: 'timeout', checked: 0, results: [] }
      : await probeListingSources({ limit: probeLimit, pacingMs: Number(process.env.LISTING_SOURCE_HEALTH_PROBE_PACING_MS || 1100) });
  const health = await buildListingSourceHealthReport({
    db,
    staleAfterDays,
    probes: probes.results || [],
    tiktokSweepEnabled: plan.tiktok_sweep_enabled,
    sweepSkipped: plan.skipped,
  });
  health.probes = {
    skipped: probes.skipped === true,
    reason: probes.reason || '',
    checked: probes.checked || 0,
    note: probes.note || '',
  };
  const publicSweepBroken = sweepResults.flatMap((item) => item.broken_sources || []);
  if (publicSweepBroken.length) {
    const extraBroken = publicSweepBroken.map((row) => ({
      kind: 'tiktok_public_sweep',
      platform: 'tiktok',
      source_key: row.source_key || '',
      source_name: row.source_name || '',
      source_url: row.source_url || '',
      http_status: row.http_status || null,
      status: 'broken',
      reason: row.reason || 'broken',
    }));
    health.broken = [...health.broken, ...extraBroken].slice(0, 40);
    health.broken_count = health.broken.length;
    health.summary = `${health.broken_count} broken, ${health.stale_count} stale, ${health.auth_wall_count} auth-walled, TikTok public sweep ${plan.tiktok_sweep_enabled ? 'on' : 'off'}`;
  }
  report.listing_source_health = health;

  if (confirm && platforms.length) await writeMonitorAudit(report);
  let healthStored = { ok: true, skipped: !confirm };
  if (confirm) healthStored = await storeListingSourceHealthReport(db, health);
  report.listing_source_health_stored = healthStored;
  logger.info(`listing_source_health_report ${health.summary} audit=${LISTING_SOURCE_HEALTH_AUDIT_ACTION}`);
  releasePropertySourceRegistryCache();
  if (require.main === module) console.log(JSON.stringify(report, null, 2));
  if (require.main === module && confirm && healthStored.ok !== true) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  runContinuousSocialMonitor()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      try {
        await db.pool.end();
      } catch (_) {}
    });
}

module.exports = {
  MONITOR_AUDIT_ACTION,
  runContinuousSocialMonitor,
};
