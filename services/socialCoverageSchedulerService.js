'use strict';

const logger = require('../config/logger');
const { runSocialPlatformPostSweep } = require('./socialPlatformPostDiscoveryService');

const SOCIAL_COVERAGE_SCHEDULER_MARKER = 'social-coverage-30k-review-only-20260824';
const SOCIAL_COVERAGE_AUDIT_ACTION = 'social_coverage_scheduler_run';
const SOCIAL_COVERAGE_LOCK_KEY = 'makaug_social_coverage_scheduler';
const SOCIAL_COVERAGE_TARGET_UNIQUE_POSTS = 30000;
const DEFAULT_CADENCE_MINUTES = 15;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_RESULTS = 25;
const SCHEDULER_POLL_MS = 60 * 1000;

let schedulerTimer = null;
let schedulerRunning = false;
let schedulerArmedAt = null;
let schedulerLastTickAt = null;
let schedulerLastResult = null;

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
}

function schedulerDisabledByEnv(env = process.env) {
  return String(env.SOCIAL_COVERAGE_SCHEDULER_ENABLED || 'true').trim().toLowerCase() === 'false';
}

function schedulerConfig(env = process.env) {
  return {
    cadence_minutes: numberInRange(env.SOCIAL_COVERAGE_CADENCE_MINUTES, DEFAULT_CADENCE_MINUTES, 5, 1440),
    batch_size: numberInRange(env.SOCIAL_COVERAGE_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 60),
    max_results_per_source: numberInRange(env.SOCIAL_COVERAGE_MAX_RESULTS, DEFAULT_MAX_RESULTS, 1, 25),
  };
}

function schedulerStatus() {
  return {
    marker: SOCIAL_COVERAGE_SCHEDULER_MARKER,
    review_only: true,
    target_unique_posts: SOCIAL_COVERAGE_TARGET_UNIQUE_POSTS,
    armed: Boolean(schedulerTimer),
    disabled_by_env: schedulerDisabledByEnv(),
    running: schedulerRunning,
    poll_ms: SCHEDULER_POLL_MS,
    config: schedulerConfig(),
    armed_at: schedulerArmedAt,
    last_tick_at: schedulerLastTickAt,
    last_result: schedulerLastResult,
  };
}

async function readLastRun(db) {
  try {
    const result = await db.query(
      `SELECT details, created_at
       FROM audit_logs
       WHERE action = $1
       ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST
       LIMIT 1`,
      [SOCIAL_COVERAGE_AUDIT_ACTION]
    );
    return result.rows[0] || null;
  } catch (_) {
    return null;
  }
}

async function writeRunAudit(db, details = {}) {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, details)
     VALUES ($1, $2, $3::jsonb)`,
    ['social_coverage_scheduler', SOCIAL_COVERAGE_AUDIT_ACTION, JSON.stringify(details)]
  );
}

function summarizePlatformSweep(platform, result = {}) {
  const importResult = result.import_result || {};
  const platformResult = result[platform] || {};
  return {
    platform,
    source_count: Number(platformResult.source_count || 0),
    selected_source_count: Number(platformResult.selected_source_count || 0),
    source_offset: Number(platformResult.source_offset || 0),
    next_source_offset: Number(platformResult.next_source_offset || 0),
    capture_task_count: Number(platformResult.capture_task_count || 0),
    api_configured: platformResult.api_configured === true,
    skipped_reason: platformResult.skipped_reason || '',
    fetched_posts_count: Number(platformResult.fetched_posts_count || platformResult.data_source_fetch?.fetched_posts_count || 0),
    discovered_posts_count: Number(result.discovered_posts_count || 0),
    created_properties: Number(importResult.created_properties || 0),
    existing_properties: Number(importResult.existing_properties || 0),
    review_queue_properties: Number(importResult.review_queue_properties || 0),
    auto_live_properties: Number(importResult.auto_live_properties || 0),
    partial_results: result.partial_results === true,
    elapsed_ms: Number(result.performance?.elapsed_ms || 0),
  };
}

async function runSocialCoverageOnce(db, { force = false, actorId = 'social_coverage_scheduler' } = {}) {
  const config = schedulerConfig();
  const lockClient = typeof db?.getClient === 'function'
    ? await db.getClient()
    : (db?.pool?.connect ? await db.pool.connect() : null);
  const lockExecutor = lockClient || db;
  const lock = await lockExecutor.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [SOCIAL_COVERAGE_LOCK_KEY]);
  if (!lock.rows[0]?.locked) {
    if (lockClient?.release) lockClient.release();
    return { ok: true, skipped: true, reason: 'social_coverage_scheduler_already_running' };
  }
  const startedAt = new Date();
  try {
    const lastRun = await readLastRun(db);
    const lastDetails = lastRun?.details || {};
    const lastCompletedAt = new Date(lastDetails.completed_at || lastRun?.created_at || 0);
    const dueAt = new Date(lastCompletedAt.getTime() + config.cadence_minutes * 60 * 1000);
    if (!force && Number.isFinite(lastCompletedAt.getTime()) && dueAt > startedAt) {
      return {
        ok: true,
        skipped: true,
        reason: 'social_coverage_scheduler_not_due',
        next_run_at: dueAt.toISOString(),
      };
    }

    const previousOffsets = lastDetails.next_offsets || {};
    const summaries = [];
    for (const platform of ['instagram', 'tiktok']) {
      const result = await runSocialPlatformPostSweep({
        db,
        platform,
        dryRun: false,
        maxSources: config.batch_size,
        sourceOffset: Number(previousOffsets[platform] || 0),
        maxResultsPerSource: config.max_results_per_source,
        maxPagesPerSource: 1,
        fetchX: false,
        fetchYouTube: false,
        fetchInstagram: platform === 'instagram',
        lookbackDays: 7,
        publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        timeBudgetMs: 45000,
      });
      summaries.push(summarizePlatformSweep(platform, result));
    }

    const completedAt = new Date();
    const report = {
      ok: true,
      marker: SOCIAL_COVERAGE_SCHEDULER_MARKER,
      actor_id: actorId,
      review_only: true,
      target_unique_posts: SOCIAL_COVERAGE_TARGET_UNIQUE_POSTS,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      next_run_at: new Date(completedAt.getTime() + config.cadence_minutes * 60 * 1000).toISOString(),
      config,
      next_offsets: Object.fromEntries(summaries.map((summary) => [summary.platform, summary.next_source_offset])),
      platforms: summaries,
      auto_live_properties: summaries.reduce((sum, summary) => sum + summary.auto_live_properties, 0),
    };
    if (report.auto_live_properties > 0) {
      throw new Error('social_coverage_review_only_guard_failed');
    }
    await writeRunAudit(db, report);
    return report;
  } catch (error) {
    const failure = {
      ok: false,
      marker: SOCIAL_COVERAGE_SCHEDULER_MARKER,
      actor_id: actorId,
      review_only: true,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      error: error.message || 'social_coverage_scheduler_failed',
    };
    await writeRunAudit(db, failure).catch(() => {});
    return failure;
  } finally {
    await lockExecutor.query('SELECT pg_advisory_unlock(hashtext($1))', [SOCIAL_COVERAGE_LOCK_KEY]).catch(() => {});
    if (lockClient?.release) lockClient.release();
  }
}

async function tickSocialCoverageScheduler(db, actorId = 'social_coverage_scheduler') {
  if (schedulerRunning) {
    schedulerLastResult = {
      ok: true,
      skipped: true,
      reason: 'social_coverage_scheduler_tick_already_running',
      at: new Date().toISOString(),
    };
    return schedulerLastResult;
  }
  schedulerRunning = true;
  schedulerLastTickAt = new Date().toISOString();
  try {
    schedulerLastResult = await runSocialCoverageOnce(db, { force: false, actorId });
    return schedulerLastResult;
  } catch (error) {
    schedulerLastResult = {
      ok: false,
      error: error.message || 'social_coverage_scheduler_tick_failed',
      at: new Date().toISOString(),
    };
    logger.warn('Social coverage scheduler tick failed', error.message);
    return schedulerLastResult;
  } finally {
    schedulerRunning = false;
  }
}

function startSocialCoverageScheduler(db) {
  if (schedulerTimer || schedulerDisabledByEnv()) return;
  schedulerArmedAt = new Date().toISOString();
  schedulerTimer = setInterval(() => {
    tickSocialCoverageScheduler(db).catch((error) => {
      logger.warn('Social coverage scheduler interval failed', error.message);
    });
  }, SCHEDULER_POLL_MS);
  setTimeout(() => {
    tickSocialCoverageScheduler(db, 'social_coverage_scheduler_boot').catch((error) => {
      logger.warn('Social coverage scheduler boot tick failed', error.message);
    });
  }, 15000);
  logger.info('Social coverage scheduler armed', {
    marker: SOCIAL_COVERAGE_SCHEDULER_MARKER,
    config: schedulerConfig(),
  });
}

module.exports = {
  SOCIAL_COVERAGE_SCHEDULER_MARKER,
  SOCIAL_COVERAGE_AUDIT_ACTION,
  SOCIAL_COVERAGE_TARGET_UNIQUE_POSTS,
  schedulerConfig,
  schedulerStatus,
  runSocialCoverageOnce,
  tickSocialCoverageScheduler,
  startSocialCoverageScheduler,
};
