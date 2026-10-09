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

const logger = require('../config/logger');

let timer = null;
let running = false;

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
       AND (
         candidates.extra_fields->>'video_still_auto_attempted_at' IS NULL
         -- A property with no cover at all is worth retrying sooner than one
         -- that already has pictures; the old twelve hours meant a single
         -- transient failure left a listing bare for half a day.
         OR (candidates.extra_fields->>'video_still_auto_attempted_at')::timestamptz
              < NOW() - (
                CASE WHEN EXISTS (
                       SELECT 1 FROM property_images pi WHERE pi.property_id = candidates.id
                     )
                     THEN INTERVAL '12 hours'
                     ELSE INTERVAL '30 minutes' END
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

async function tickVideoStills(db) {
  if (running) return { skipped: 'busy' };
  running = true;
  let attemptedId = null;
  try {
    const backfill = require('../scripts/backfill-whatsapp-video-stills');
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
    const uploaded = await backfill.makeAndUploadStills(property);
    const attached = await backfill.attachStills(property.id, uploaded);
    // Clear any recorded failure now that it has worked.
    await db.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) - 'video_still_auto_error'
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
    if (attemptedId) {
      await db.query(
        `UPDATE properties
            SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
                  'video_still_auto_error', $2::text,
                  'video_still_auto_error_at', NOW()::text)
          WHERE id = $1`,
        [attemptedId, reason]
      ).catch(() => {});
    }
    logger.warn('Video still tick failed', { propertyId: attemptedId || null, error: reason });
    return { error: reason, propertyId: attemptedId || null };
  } finally {
    running = false;
  }
}

function startVideoStillScheduler(db) {
  if (timer || !process.env.DATABASE_URL || process.env.VIDEO_STILL_AUTO === 'false') return;
  const pollMs = Math.max(60_000, Number(process.env.VIDEO_STILL_POLL_MS || 4 * 60_000));
  timer = setInterval(() => { tickVideoStills(db); }, pollMs);
  timer.unref?.();

  // setInterval does not fire until a whole interval has passed, so every deploy
  // restarted the wait from zero. On 9 Oct three deploys inside half an hour
  // meant this job never once ran, which looked exactly like it being broken.
  // One kick shortly after boot, far enough in not to compete with start-up.
  const kick = setTimeout(() => { tickVideoStills(db); }, 60_000);
  kick.unref?.();

  logger.info('Video still scheduler armed', { pollMs });
}

module.exports = { tickVideoStills, startVideoStillScheduler, selectionQuery };
