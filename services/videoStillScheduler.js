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

async function tickVideoStills(db) {
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const backfill = require('../scripts/backfill-whatsapp-video-stills');
    const result = await db.query(
      `SELECT * FROM (${backfill.SELECTION_SQL}) candidates
        WHERE candidates.created_at >= NOW() - INTERVAL '21 days'
          AND (
            candidates.extra_fields->>'video_still_auto_attempted_at' IS NULL
            OR (candidates.extra_fields->>'video_still_auto_attempted_at')::timestamptz < NOW() - INTERVAL '12 hours'
          )
        LIMIT 1`
    );
    const property = result.rows[0];
    if (!property) return { skipped: 'nothing_to_do' };
    await db.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('video_still_auto_attempted_at', NOW()::text)
        WHERE id = $1`,
      [property.id]
    );
    ffmpegReady();
    const uploaded = await backfill.makeAndUploadStills(property);
    const attached = await backfill.attachStills(property.id, uploaded);
    logger.info('Video stills attached', { propertyId: property.id, attached: attached.attached || 0 });
    return { propertyId: property.id, ...attached };
  } catch (error) {
    logger.warn('Video still tick failed', { error: error.message || String(error) });
    return { error: error.message || String(error) };
  } finally {
    running = false;
  }
}

function startVideoStillScheduler(db) {
  if (timer || !process.env.DATABASE_URL || process.env.VIDEO_STILL_AUTO === 'false') return;
  const pollMs = Math.max(60_000, Number(process.env.VIDEO_STILL_POLL_MS || 4 * 60_000));
  timer = setInterval(() => { tickVideoStills(db); }, pollMs);
  timer.unref?.();
  logger.info('Video still scheduler armed', { pollMs });
}

module.exports = { tickVideoStills, startVideoStillScheduler };
