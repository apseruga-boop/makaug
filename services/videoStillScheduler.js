'use strict';

/**
 * Cover photos for properties that arrived as a video only.
 *
 * Agents mostly send a walk-through video. Those properties reached review with
 * no photo at all ("blocked_no_usable_property_image"), and the ones approved
 * anyway went live with no cover picture. scripts/backfill-whatsapp-video-stills.js
 * already picks clear, distinct frames from the video and attaches them as
 * review images; it just had to be run by hand. This runs it for one pending
 * WhatsApp property at a time, every few minutes. Approved listings are never
 * touched here — only properties still waiting for a moderator.
 */

const { monitorEventLoopDelay } = require('perf_hooks');
const logger = require('../config/logger');

let timer = null;
let running = false;

/*
 * 9 Oct 2026: this job pinned the 0.5-CPU web container from 16:10 BST. Every
 * tick downloaded up to ten videos and ran 30 ffmpeg decodes plus a sharp pass
 * for each, and coverless listings were retried every 30 minutes forever. Staff
 * queries then timed out waiting for a database connection and moderators got
 * 503s. So, now:
 *   - it is OFF unless VIDEO_STILL_AUTO=true;
 *   - a listing that fails is retried after 30 min, then 2 h, then given up on
 *     after VIDEO_STILL_MAX_ATTEMPTS (3) failures, until staff re-pull it;
 *   - a tick looks at no more than VIDEO_STILL_MAX_VIDEOS (2) videos, decodes no
 *     more than VIDEO_STILL_FRAME_CANDIDATES (8) frames per video, and stops at
 *     VIDEO_STILL_TICK_BUDGET_MS (90 s), killing its ffmpeg;
 *   - ffmpeg runs under `nice -n 19` on one thread;
 *   - a tick is skipped when the site is busy (event-loop p95 over the last
 *     minute above 200 ms, or anyone waiting for a database connection);
 *   - the first tick after a boot waits ten minutes.
 */
const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.VIDEO_STILL_MAX_ATTEMPTS || '3', 10) || 3);
const MAX_VIDEOS_PER_TICK = Math.max(1, parseInt(process.env.VIDEO_STILL_MAX_VIDEOS || '2', 10) || 2);
const TICK_BUDGET_MS = Math.max(10_000, parseInt(process.env.VIDEO_STILL_TICK_BUDGET_MS || '90000', 10) || 90_000);
const BUSY_EVENT_LOOP_P95_MS = Math.max(1, parseInt(process.env.VIDEO_STILL_BUSY_P95_MS || '200', 10) || 200);
const BOOT_DELAY_MS = 10 * 60_000;
// Wait after the n-th failure before trying again (n = 1, 2, 3…).
const BACKOFF_INTERVALS = ['30 minutes', '2 hours', '12 hours'];

function backoffIntervalSql() {
  // attempts is the number of failures so far (at least 1 here).
  return `CASE LEAST(GREATEST(COALESCE((candidates.extra_fields->>'video_still_auto_attempts')::int, 0), 1), ${BACKOFF_INTERVALS.length})
            ${BACKOFF_INTERVALS.map((interval, i) => `WHEN ${i + 1} THEN INTERVAL '${interval}'`).join('\n            ')}
          END`;
}

// Event-loop delay over roughly the last minute, sampled continuously.
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

function siteBusyReason(db, { eventLoopP95Ms = loopWindowP95Ms } = {}) {
  const waiting = Number(db?.pool?.waitingCount || 0);
  if (waiting > 0) return { reason: 'db_pool_waiting', waiting };
  if (Number(eventLoopP95Ms) > BUSY_EVENT_LOOP_P95_MS) return { reason: 'event_loop_slow', p95_ms: Math.round(eventLoopP95Ms) };
  return null;
}

function ffmpegReady() {
  if (process.env.FFMPEG_PATH) return true;
  try {
    const bin = require('ffmpeg-static');
    if (bin) {
      process.env.FFMPEG_PATH = bin;
      return true;
    }
  } catch (_ignored) { /* fall back to PATH */ }
  return true;
}

/**
 * The one property to repair next, or none.
 *
 * Kept as a named query, and exported, for a reason learned the hard way: when
 * this SELECT fails there is no property to record the failure against, so the
 * catch below has nothing to write to and the job goes quiet in exactly the way
 * it is supposed to stop doing. /api/admin/properties/video-still-candidates
 * runs this same query so the error, or the empty result, can be read instead
 * of guessed at.
 *
 * A correlated EXISTS rather than a join: it keeps the surrounding query simple
 * enough to reason about, and the subquery that feeds it already groups rows.
 */
function selectionQuery(backfill) {
  // Approved listings used to be excluded on the reasoning that a moderator had
  // already passed them. In practice that meant a listing approved without a
  // cover photo could never get one: three of Segawa's went live in October
  // with a video and no picture, were never even attempted, and nothing would
  // ever have attempted them. A listing with NO image at all is the one case
  // worth revisiting, because adding its first cover photo cannot overwrite a
  // moderator's choice — there was nothing there to overwrite.
  const withApproved = backfill.SELECTION_SQL
    .replace("AND p.status = 'pending'", "AND p.status IN ('pending', 'approved')");
  return `
    SELECT * FROM (${withApproved}) candidates
     WHERE candidates.created_at >= NOW() - INTERVAL '21 days'
       AND (
         candidates.status = 'pending'
         OR NOT EXISTS (
           SELECT 1 FROM property_images pi WHERE pi.property_id = candidates.id
         )
       )
       -- Given up after repeated failures; staff re-pulling the listing clears it.
       AND candidates.extra_fields->>'video_still_auto_gave_up_at' IS NULL
       AND COALESCE((candidates.extra_fields->>'video_still_auto_attempts')::int, 0) < ${MAX_ATTEMPTS}
       AND (
         candidates.extra_fields->>'video_still_auto_attempted_at' IS NULL
         -- Never failed yet: a listing that already has pictures waits twelve
         -- hours between looks, one with no cover thirty minutes.
         OR (
           COALESCE((candidates.extra_fields->>'video_still_auto_attempts')::int, 0) = 0
           AND (candidates.extra_fields->>'video_still_auto_attempted_at')::timestamptz
              < NOW() - (
                CASE WHEN EXISTS (
                       SELECT 1 FROM property_images pi WHERE pi.property_id = candidates.id
                     )
                     THEN INTERVAL '12 hours'
                     ELSE INTERVAL '30 minutes' END
              )
         )
         -- Failed before: back off 30 min, then 2 h, then 12 h.
         OR (
           COALESCE((candidates.extra_fields->>'video_still_auto_attempts')::int, 0) > 0
           AND (candidates.extra_fields->>'video_still_auto_attempted_at')::timestamptz
              < NOW() - ${backoffIntervalSql()}
         )
       )
     -- Newest first. Opening this up to approved listings uncovered a backlog of
     -- twenty-odd old ones with no cover at all; oldest-first put the properties
     -- that broke this morning behind all of them, which is the opposite of what
     -- anyone watching a fresh batch needs. The backlog still drains, because a
     -- property leaves this list as soon as it has a picture.
     ORDER BY candidates.created_at DESC
     LIMIT 1`;
}

async function tickVideoStills(db, { eventLoopP95Ms, budgetMs = TICK_BUDGET_MS } = {}) {
  if (running) return { skipped: 'busy' };
  const busy = siteBusyReason(db, eventLoopP95Ms === undefined ? {} : { eventLoopP95Ms });
  if (busy) {
    logger.info('Video still tick skipped', { skipped: 'busy_traffic', ...busy });
    return { skipped: 'busy_traffic', ...busy };
  }
  running = true;
  let attemptedId = null;
  const controller = new AbortController();
  const deadline = Date.now() + budgetMs;
  // Not unref'd: it must fire even if a hung ffmpeg is the only thing left.
  // Cleared in finally, so it never outlives the tick.
  const budgetTimer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const backfill = require('../scripts/backfill-whatsapp-video-stills');
    // At the time budget: stop the downloads and kill any ffmpeg still running,
    // so a stuck decode cannot hold the CPU past the budget.
    controller.signal.addEventListener('abort', () => { try { backfill.killLiveChildren?.(); } catch (_) {} }, { once: true });
    // Approved listings used to be excluded on the reasoning that a moderator had
    // already passed them. In practice that meant a listing approved without a
    // cover photo could never get one: three of Segawa's went live in October
    // with a video and no picture, were never even attempted, and nothing would
    // ever have attempted them. A listing with NO image at all is the one case
    // worth revisiting, because adding its first cover photo cannot overwrite a
    // moderator's choice — there was nothing there to overwrite.
    const result = await db.query(selectionQuery(backfill));
    const property = result.rows[0];
    if (!property) return { skipped: 'nothing_to_do' };
    attemptedId = property.id;
    await db.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('video_still_auto_attempted_at', NOW()::text)
        WHERE id = $1`,
      [property.id]
    );
    ffmpegReady();
    const uploaded = await backfill.makeAndUploadStills(property, {
      frameCandidates: backfill.FRAME_CANDIDATE_COUNT,
      maxVideos: MAX_VIDEOS_PER_TICK,
      deadline,
      signal: controller.signal
    });
    const attached = await backfill.attachStills(property.id, uploaded);
    // Clear any recorded failure, and the failure count, now that it has worked.
    await db.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) - 'video_still_auto_error' - 'video_still_auto_attempts' - 'video_still_auto_gave_up_at'
        WHERE id = $1`,
      [property.id]
    ).catch(() => {});
    logger.info('Video stills attached', { propertyId: property.id, attached: attached.attached || 0 });
    return { propertyId: property.id, ...attached };
  } catch (error) {
    const reason = String(error?.message || error).slice(0, 300);
    // Why this is written to the property and not only to the log: this job has
    // been failing silently for days. The only visible trace was a key-frame
    // count that stayed at zero, which says a repair was tried and not why it
    // did not work. Recording the reason beside the property makes the next
    // one of these diagnosable from the admin API instead of from guesswork.
    const timedOut = error?.code === 'VIDEO_STILL_TIME_BUDGET' || controller.signal.aborted;
    if (timedOut) {
      try { require('../scripts/backfill-whatsapp-video-stills').killLiveChildren?.(); } catch (_) {}
    }
    if (attemptedId) {
      // Count the failure; after MAX_ATTEMPTS it is given up on.
      await db.query(
        `UPDATE properties
            SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
                  'video_still_auto_error', $2::text,
                  'video_still_auto_error_at', NOW()::text,
                  'video_still_auto_attempts', COALESCE((extra_fields->>'video_still_auto_attempts')::int, 0) + 1
                ) || CASE
                       WHEN COALESCE((extra_fields->>'video_still_auto_attempts')::int, 0) + 1 >= $3::int
                       THEN jsonb_build_object('video_still_auto_gave_up_at', NOW()::text)
                       ELSE '{}'::jsonb
                     END
          WHERE id = $1`,
        [attemptedId, timedOut ? `time budget of ${Math.round(budgetMs / 1000)}s used up` : reason, MAX_ATTEMPTS]
      ).catch(() => {});
    }
    logger.warn('Video still tick failed', { propertyId: attemptedId || null, error: timedOut ? 'time_budget' : reason });
    return { error: timedOut ? 'time_budget' : reason, propertyId: attemptedId || null, ...(timedOut ? { timed_out: true } : {}) };
  } finally {
    clearTimeout(budgetTimer);
    running = false;
  }
}

/** For staff actions that re-pull a listing's media: start the count afresh. */
async function clearVideoStillAttempts(db, propertyId) {
  if (!propertyId) return;
  await db.query(
    `UPDATE properties
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
              - 'video_still_auto_attempts' - 'video_still_auto_gave_up_at' - 'video_still_auto_attempted_at'
      WHERE id = $1`,
    [propertyId]
  ).catch(() => {});
}

function startVideoStillScheduler(db) {
  if (timer) return;
  // Opt-in: off unless VIDEO_STILL_AUTO=true. Said once at boot either way, so
  // the logs show whether it is running.
  if (process.env.VIDEO_STILL_AUTO !== 'true' || !process.env.DATABASE_URL) {
    logger.info('Video still scheduler not armed', {
      reason: process.env.VIDEO_STILL_AUTO !== 'true' ? 'VIDEO_STILL_AUTO is not "true"' : 'no DATABASE_URL'
    });
    return;
  }
  const pollMs = Math.max(60_000, Number(process.env.VIDEO_STILL_POLL_MS || 4 * 60_000));
  startLoopMonitor();
  timer = setInterval(() => { tickVideoStills(db); }, pollMs);
  timer.unref?.();

  // One kick after boot so a deploy does not always mean another idle interval,
  // but ten minutes in, so a run of deploys never stacks ticks on start-up.
  const kick = setTimeout(() => { tickVideoStills(db); }, BOOT_DELAY_MS);
  kick.unref?.();

  logger.info('Video still scheduler armed', {
    pollMs,
    first_tick_in_ms: BOOT_DELAY_MS,
    max_attempts: MAX_ATTEMPTS,
    max_videos_per_tick: MAX_VIDEOS_PER_TICK,
    tick_budget_ms: TICK_BUDGET_MS
  });
}

module.exports = {
  BACKOFF_INTERVALS,
  BOOT_DELAY_MS,
  MAX_ATTEMPTS,
  clearVideoStillAttempts,
  selectionQuery,
  siteBusyReason,
  startVideoStillScheduler,
  tickVideoStills
};
