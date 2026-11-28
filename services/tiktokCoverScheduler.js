'use strict';

/**
 * Saves a cover picture for TikTok listings that have none.
 *
 * One job does both the backfill (every pending or approved TikTok listing that
 * has no real photo yet, newest pending first) and new intakes going forward
 * (a new TikTok listing is picked up within a couple of minutes). A listing
 * that already has a real photo on our media host is never touched, and a
 * listing's status, text, map pin and approval checks are never changed: this
 * only adds one picture row (see services/tiktokCoverService.js) and writes a
 * log row that is the backup (migration 253, rollback in
 * scripts/rollback-253-tiktok-covers.sql).
 *
 * Light on the 0.5-CPU web container, like services/videoStillScheduler.js:
 * no ffmpeg, one listing at a time, a few per tick, skipped when the site is
 * busy, a time budget per tick. A failed listing is retried after 30 min, then
 * 2 h, then 12 h, then left alone. A video that TikTok says is deleted or
 * private is marked unavailable and not retried. Off with TIKTOK_COVER_AUTO=false.
 */

const { monitorEventLoopDelay } = require('perf_hooks');
const logger = require('../config/logger');
const { realHostedPhotoExistsSql } = require('../utils/realListingPhoto');
const { saveTikTokCoverForListing } = require('./tiktokCoverService');

const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.TIKTOK_COVER_MAX_ATTEMPTS || '3', 10) || 3);
const BATCH_PER_TICK = Math.max(1, parseInt(process.env.TIKTOK_COVER_BATCH || '8', 10) || 8);
const TICK_INTERVAL_MS = Math.max(30_000, parseInt(process.env.TIKTOK_COVER_INTERVAL_MS || '90000', 10) || 90_000);
const TICK_BUDGET_MS = Math.max(10_000, parseInt(process.env.TIKTOK_COVER_TICK_BUDGET_MS || '70000', 10) || 70_000);
const DELAY_BETWEEN_MS = 800;
const BOOT_DELAY_MS = 60_000;
const BUSY_EVENT_LOOP_P95_MS = 200;
const BACKOFF_INTERVALS = ['30 minutes', '2 hours', '12 hours'];

let timer = null;
let running = false;
let loopMonitor = null;
let loopWindowP95Ms = 0;
let loopWindowTimer = null;

function startLoopMonitor() {
  if (loopMonitor) return;
  loopMonitor = monitorEventLoopDelay({ resolution: 20 });
  loopMonitor.enable();
  loopWindowTimer = setInterval(() => {
    loopWindowP95Ms = loopMonitor.percentile(95) / 1e6;
    loopMonitor.reset();
  }, 60_000);
  loopWindowTimer.unref?.();
}

function siteBusyReason(db, eventLoopP95Ms = loopWindowP95Ms) {
  const waiting = Number(db?.pool?.waitingCount || 0);
  if (waiting > 0) return { reason: 'db_pool_waiting', waiting };
  if (Number(eventLoopP95Ms) > BUSY_EVENT_LOOP_P95_MS) return { reason: 'event_loop_slow', p95_ms: Math.round(eventLoopP95Ms) };
  return null;
}

function backoffSql(alias = 'p') {
  return `CASE LEAST(GREATEST(COALESCE((${alias}.extra_fields->>'tiktok_cover_attempts')::int, 0), 1), ${BACKOFF_INTERVALS.length})
            ${BACKOFF_INTERVALS.map((interval, i) => `WHEN ${i + 1} THEN INTERVAL '${interval}'`).join(' ')}
          END`;
}

// Pending or approved TikTok listings with no real photo, not yet done, not
// given up on, and not waiting out a back-off. Pending first, newest first.
function selectionQuery() {
  const tiktokField = (key) => `p.extra_fields->>'${key}' ~* 'tiktok\\.com/@[^/]+/video/[0-9]|//(vm|vt)\\.tiktok\\.com/'`;
  return `
    SELECT p.id::text AS id, p.status, p.extra_fields
      FROM properties p
     WHERE p.status IN ('pending', 'approved')
       AND (${['tiktok_url', 'video_url', 'source_post_url', 'canonical_source_url', 'source_url'].map(tiktokField).join(' OR ')})
       AND NOT ${realHostedPhotoExistsSql('p')}
       AND COALESCE(p.extra_fields->>'tiktok_cover_status', '') NOT IN ('saved', 'unavailable', 'rolled_back')
       AND COALESCE((p.extra_fields->>'tiktok_cover_attempts')::int, 0) < ${MAX_ATTEMPTS}
       AND (
         p.extra_fields->>'tiktok_cover_attempted_at' IS NULL
         OR (p.extra_fields->>'tiktok_cover_attempted_at')::timestamptz < NOW() - ${backoffSql('p')}
       )
     ORDER BY (p.status = 'pending') DESC, p.created_at DESC
     LIMIT $1`;
}

async function writeOutcome(db, id, result) {
  if (result.status === 'saved' || result.status === 'skipped') return;
  const unavailable = result.status === 'unavailable';
  await db.query(
    `UPDATE properties
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
              'tiktok_cover_status', $2::text,
              'tiktok_cover_error', $3::text,
              'tiktok_cover_attempted_at', NOW()::text,
              'tiktok_cover_attempts', COALESCE((extra_fields->>'tiktok_cover_attempts')::int, 0) + 1)
      WHERE id = $1::uuid`,
    [id, unavailable ? 'unavailable' : 'failed', String(result.error || 'unknown').slice(0, 200)]
  );
}

async function tickTikTokCovers(db, { eventLoopP95Ms, budgetMs = TICK_BUDGET_MS, batch = BATCH_PER_TICK, deps = {}, clearCaches } = {}) {
  if (running) return { skipped: 'busy' };
  const busy = siteBusyReason(db, eventLoopP95Ms === undefined ? undefined : eventLoopP95Ms);
  if (busy) return { skipped: 'busy_traffic', ...busy };
  running = true;
  const summary = { picked: 0, saved: 0, failed: 0, unavailable: 0, skipped: 0 };
  const deadline = Date.now() + budgetMs;
  try {
    const found = await db.query(selectionQuery(), [batch]);
    const rows = found.rows || [];
    if (!rows.length) return { skipped: 'nothing_to_do' };
    let approvedSaved = 0;
    for (const row of rows) {
      if (Date.now() > deadline) break;
      summary.picked += 1;
      let result;
      try {
        result = await saveTikTokCoverForListing(db, row, deps);
      } catch (error) {
        result = { status: 'failed', error: String(error?.message || error).slice(0, 160) };
      }
      try {
        await writeOutcome(db, row.id, result);
      } catch (error) {
        logger.warn('TikTok cover outcome not recorded', { propertyId: row.id, message: error.message });
      }
      if (result.status === 'saved') {
        summary.saved += 1;
        if (row.status === 'approved') approvedSaved += 1;
      } else if (result.status === 'unavailable') summary.unavailable += 1;
      else if (result.status === 'skipped') summary.skipped += 1;
      else summary.failed += 1;
      if (result.status !== 'saved') {
        logger.info('TikTok cover not saved', { propertyId: row.id, status: result.status, error: result.error, detail: result.detail });
      }
      await new Promise((resolve) => setTimeout(resolve, deps.delayMs ?? DELAY_BETWEEN_MS));
    }
    if (approvedSaved > 0) {
      try {
        (clearCaches || (() => {
          require('../routes/properties').clearPublicPropertiesCache('tiktok_cover_saved');
          require('./publicInventoryMetricsService').invalidatePublicInventoryMetricsCache('tiktok_cover_saved');
        }))();
      } catch (error) {
        logger.warn('Public caches could not be cleared after TikTok covers', { message: error.message });
      }
    }
    logger.info('TikTok covers tick', summary);
    return summary;
  } catch (error) {
    logger.warn('TikTok cover tick failed', { message: String(error?.message || error).slice(0, 300) });
    return { error: String(error?.message || error).slice(0, 300), ...summary };
  } finally {
    running = false;
  }
}

function startTikTokCoverScheduler(db) {
  if (timer) return timer;
  if (String(process.env.TIKTOK_COVER_AUTO || '').trim().toLowerCase() === 'false') {
    logger.info('TikTok cover scheduler is off (TIKTOK_COVER_AUTO=false)');
    return null;
  }
  startLoopMonitor();
  const run = () => tickTikTokCovers(db).catch((error) => logger.warn('TikTok cover tick threw', { message: error.message }));
  const first = setTimeout(() => {
    run();
    timer = setInterval(run, TICK_INTERVAL_MS);
    timer.unref?.();
  }, BOOT_DELAY_MS);
  first.unref?.();
  timer = first;
  logger.info('TikTok cover scheduler armed', { first_tick_ms: BOOT_DELAY_MS, interval_ms: TICK_INTERVAL_MS, batch: BATCH_PER_TICK });
  return timer;
}

module.exports = { startTikTokCoverScheduler, tickTikTokCovers, selectionQuery, MAX_ATTEMPTS };
