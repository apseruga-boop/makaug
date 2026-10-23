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
    const liveCover = property.status === 'approved';
    const attached = await backfill.attachStills(property.id, uploaded, liveCover ? {
      keepListingText: true,
      coverLiveListing: true,
      setAsCover: true,
      onlyIfNoImages: true
    } : undefined);
    if (liveCover && Number(attached.attached) > 0) {
      try {
        require('../routes/properties').clearPublicPropertiesCache('automatic_live_video_cover');
        require('./publicInventoryMetricsService').invalidatePublicInventoryMetricsCache('automatic_live_video_cover');
      } catch (error) {
        logger.warn('Public caches could not be cleared after an automatic video cover', { propertyId: property.id, message: error.message });
      }
    }
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

// C1 (10 Oct 2026): staff "Make a cover from the video" for one listing.
// The same limits as the scheduler (#378): one at a time, skipped when the
// site is busy, at most MAX_VIDEOS_PER_TICK videos and TICK_BUDGET_MS, ffmpeg
// niced on one thread. Frames are resized to fit, never cropped or blurred, so
// the agent's branding stays. The description and video fields are untouched.
const DIRECT_VIDEO_FILE_RE = /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i;

function youtubeVideoId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const nested = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
      if (nested) return nested[1] || '';
    }
  } catch (_) { /* not a URL */ }
  return '';
}

function isDirectCoverVideo(url, mediaHost = '') {
  return DIRECT_VIDEO_FILE_RE.test(url) || (mediaHost && url.toLowerCase().startsWith(`https://${String(mediaHost).toLowerCase()}/`));
}

function coverSourceUrls(extra = {}, { mediaHost = '' } = {}) {
  const { listingSourceVideoUrls } = require('../utils/realListingPhoto');
  return listingSourceVideoUrls(extra)
    .filter((url) => /^https:\/\//i.test(url))
    .map((url) => ({
      url,
      kind: isDirectCoverVideo(url, mediaHost) ? 'file' : (youtubeVideoId(url) ? 'youtube' : '')
    }))
    .filter((item) => item.kind);
}

function coverVideoUrls(extra = {}, { mediaHost = '' } = {}) {
  return coverSourceUrls(extra, { mediaHost }).filter((item) => item.kind === 'file').map((item) => item.url);
}

async function fetchYouTubeThumbnail(videoUrl, fetchImpl = fetch) {
  const id = youtubeVideoId(videoUrl);
  if (!id) throw new Error('not a youtube video');
  const thumbs = [
    `https://i.ytimg.com/vi/${encodeURIComponent(id)}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
  ];
  for (const thumb of thumbs) {
    const response = await fetchImpl(thumb);
    if (!response?.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (thumb.includes('maxresdefault') && bytes.length < 3000) continue;
    if (bytes.length < 500) continue;
    return { bytes, source: thumb };
  }
  throw new Error('YouTube thumbnail could not be fetched');
}

function coverErrorMessage(error) {
  const raw = String(error?.message || error || '');
  if (error?.code === 'YOUTUBE_TIME_UNAVAILABLE' || /youtube_time_unavailable/i.test(raw)) return 'This YouTube video can\'t be opened at a chosen time on this server. Pick one of the automatic frames, or upload a photo.';
  if (error?.code === 'VIDEO_STILL_TIME_BUDGET' || /time budget|aborted/i.test(raw)) return 'The video took too long to read, so no cover was made. Try again later or upload a photo.';
  if (/exceeds .* byte/i.test(raw)) return 'The video is too large to read here (over 100 MB). Upload a photo instead.';
  if (/HTTP \d{3}|fetch failed|ENOTFOUND|ECONNRE|status/i.test(raw)) return 'We couldn\'t fetch the video file, so no cover was made. Upload a photo instead.';
  return 'We couldn\'t get a clear picture from this video, so no cover was made. Upload a photo instead.';
}

function youtubeCandidateThumbnailUrls(videoUrl) {
  const id = youtubeVideoId(videoUrl);
  if (!id) return [];
  const encoded = encodeURIComponent(id);
  return [
    [`Automatic frame 1`, `https://i.ytimg.com/vi/${encoded}/maxresdefault.jpg`],
    [`Automatic frame 2`, `https://i.ytimg.com/vi/${encoded}/sddefault.jpg`],
    [`Automatic frame 3`, `https://i.ytimg.com/vi/${encoded}/hqdefault.jpg`],
    [`Automatic frame 4`, `https://i.ytimg.com/vi/${encoded}/1.jpg`],
    [`Automatic frame 5`, `https://i.ytimg.com/vi/${encoded}/2.jpg`],
    [`Automatic frame 6`, `https://i.ytimg.com/vi/${encoded}/3.jpg`]
  ];
}

function coverCandidateRecord(item, label) {
  return {
    url: item.url,
    sha256: item.sha256 || null,
    timestamp_seconds: Number(item.timestampSeconds || 0),
    source_video_url: item.sourceVideoUrl || null,
    label: label || item.label || 'Frame'
  };
}

async function rememberCoverCandidates(db, propertyId, candidates) {
  await db.query(
    `UPDATE properties
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('video_cover_candidates', $2::jsonb),
            updated_at = NOW()
      WHERE id = $1`,
    [propertyId, JSON.stringify(candidates.slice(0, 8))]
  );
}

async function youtubeCoverCandidates(property, videoUrl, { fetchImpl, uploadBuffer }) {
  const crypto = require('crypto');
  const store = uploadBuffer || ((args) => require('./cloudMediaStorageService').uploadBufferToS3(args));
  const seen = new Set();
  const uploaded = [];
  for (const [label, thumb] of youtubeCandidateThumbnailUrls(videoUrl)) {
    const response = await fetchImpl(thumb);
    if (!response?.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (thumb.includes('maxresdefault') && bytes.length < 3000) continue;
    if (bytes.length < 800) continue;
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    const stored = await store({
      bytes,
      mimeType: 'image/jpeg',
      key: `staff-video-cover/youtube/${property.id}/candidate-${sha256}.jpg`
    });
    if (!stored?.publicUrl) continue;
    uploaded.push({
      url: stored.publicUrl,
      sha256: stored.sha256 || sha256,
      sourceVideoUrl: videoUrl,
      sourceVideoIndex: 0,
      timestampSeconds: 0,
      label,
      sharpness: 0,
      entropy: 0,
      bytes: stored.bytes || bytes.length
    });
  }
  if (!uploaded.length) throw new Error('YouTube thumbnail could not be fetched');
  return uploaded;
}

function youtubeTimeTool() {
  const fs = require('fs');
  return ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'].find((candidate) => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch (_) { return false; }
  }) || '';
}

// A chosen time on a YouTube video needs yt-dlp. Without it, staff pick one of
// the automatic frames instead of us guessing the default thumbnail.
async function youtubeFrameAtTime(property, videoUrl, timestampSeconds, { uploadBuffer, deadline = 0 } = {}) {
  const tool = youtubeTimeTool();
  if (!tool) {
    const unavailable = new Error('youtube_time_unavailable');
    unavailable.code = 'YOUTUBE_TIME_UNAVAILABLE';
    throw unavailable;
  }
  const { execFile } = require('child_process');
  const fsp = require('fs/promises');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `makaug-yt-${property.id}-`));
  const run = (file, args, timeout) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error) => (error ? reject(error) : resolve()));
  });
  try {
    const videoPath = path.join(dir, 'video.mp4');
    const stillPath = path.join(dir, 'frame.jpg');
    const at = Math.max(0, Number(timestampSeconds) || 0);
    const timeout = Math.max(15000, (deadline || Date.now() + 60000) - Date.now());
    await run(tool, [
      '--no-playlist',
      '-f', 'best[height<=480]/best',
      '--download-sections', `*${Math.max(0, at - 1).toFixed(3)}-${(at + 2).toFixed(3)}`,
      '-o', videoPath,
      videoUrl
    ], timeout);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', at.toFixed(3),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '3',
      stillPath
    ], 20000);
    const bytes = await fsp.readFile(stillPath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const store = uploadBuffer || ((args) => require('./cloudMediaStorageService').uploadBufferToS3(args));
    const stored = await store({
      bytes,
      mimeType: 'image/jpeg',
      key: `staff-video-cover/youtube/${property.id}/frame-${sha256}.jpg`
    });
    if (!stored?.publicUrl) throw new Error('The frame could not be saved.');
    return [{
      url: stored.publicUrl,
      sha256: stored.sha256 || sha256,
      sourceVideoUrl: videoUrl,
      sourceVideoIndex: 0,
      timestampSeconds: at,
      sharpness: 0,
      entropy: 0,
      bytes: bytes.length
    }];
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function makeVideoCoverForListing(db, propertyId, { actorId = 'staff', budgetMs = TICK_BUDGET_MS, backfill: injected = null, videoUrl = '', fetchImpl = fetch, uploadBuffer = null, preview = false, stillUrl = '', timestampSeconds = null } = {}) {
  if (running) return { ok: false, status: 409, error: 'A cover is already being made. Try again in a minute.' };
  const busy = siteBusyReason(db);
  if (busy) return { ok: false, status: 503, error: 'The site is busy right now. Try again in a few minutes.', ...busy };
  const found = await db.query(
    `SELECT p.id, p.status, p.extra_fields,
            (SELECT COUNT(*)::int FROM property_images pi
              WHERE pi.property_id = p.id AND COALESCE(pi.slot_key, '') ~* '^video_key_frame_') AS video_still_count
       FROM properties p
      WHERE p.id = $1`,
    [propertyId]
  );
  const property = found.rows[0];
  if (!property) return { ok: false, status: 404, error: 'Listing not found.' };
  const status = String(property.status || '').toLowerCase();
  const liveCover = ['approved', 'live', 'published'].includes(status);
  if (status !== 'pending' && !liveCover) return { ok: false, status: 409, error: 'Covers can only be made for listings still in review.' };
  const { mediaHost, sameVideoUrl } = require('../utils/realListingPhoto');
  const sources = coverSourceUrls(property.extra_fields || {}, { mediaHost: mediaHost() });
  if (!sources.length) {
    return { ok: false, status: 422, error: 'This listing\'s video is a TikTok or Facebook page, not a video file we can open, so a cover can\'t be made from it. Upload a photo instead.' };
  }
  const chosen = String(videoUrl || '').trim();
  let selected = sources;
  if (chosen) {
    const match = sources.find((item) => sameVideoUrl(item.url, chosen));
    if (!match) {
      return { ok: false, status: 422, error: 'That video is not one we can take a cover from. Pick one of this listing\'s videos, or upload a photo.' };
    }
    selected = [match];
  } else if (sources.length > 1) {
    return { ok: false, status: 400, error: 'Choose which video to take the cover from.' };
  }
  running = true;
  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), budgetMs);
  const backfill = injected || require('../scripts/backfill-whatsapp-video-stills');
  try {
    controller.signal.addEventListener('abort', () => { try { backfill.killLiveChildren?.(); } catch (_) {} }, { once: true });
    const requestedTime = timestampSeconds == null || timestampSeconds === '' ? null : Number(timestampSeconds);
    const hasTime = Number.isFinite(requestedTime) && requestedTime >= 0 && timestampSeconds != null && timestampSeconds !== '';
    const chosenStill = String(stillUrl || '').trim();
    let uploaded;
    if (chosenStill) {
      let parsed;
      try { parsed = new URL(chosenStill); } catch (_) { parsed = null; }
      const candidates = Array.isArray(property.extra_fields?.video_cover_candidates) ? property.extra_fields.video_cover_candidates : [];
      const match = candidates.find((item) => item && item.url === chosenStill);
      const hostedStill = parsed && parsed.protocol === 'https:' && /staff-video-cover|video-key-frame|whatsapp-employee-intake/i.test(parsed.pathname);
      if (!match && !hostedStill) {
        return { ok: false, status: 422, error: 'Choose one of the frames from this listing.' };
      }
      uploaded = [{
        url: chosenStill,
        sha256: match?.sha256 || '',
        sourceVideoUrl: match?.source_video_url || selected[0].url,
        sourceVideoIndex: 0,
        timestampSeconds: Number(match?.timestamp_seconds || 0),
        sharpness: 0,
        entropy: 0,
        bytes: 0
      }];
    } else if (preview && selected[0].kind === 'youtube') {
      uploaded = await youtubeCoverCandidates(property, selected[0].url, { fetchImpl, uploadBuffer });
    } else if (hasTime && selected[0].kind === 'youtube') {
      uploaded = await youtubeFrameAtTime(property, selected[0].url, requestedTime, { uploadBuffer, deadline: Date.now() + budgetMs });
    } else if (hasTime && typeof backfill.uploadStillAtTimestamp === 'function' && selected[0].kind === 'file') {
      uploaded = await backfill.uploadStillAtTimestamp(
        property,
        selected[0].url,
        requestedTime,
        { deadline: Date.now() + budgetMs, signal: controller.signal, fetchImpl }
      );
    } else if (selected[0].kind === 'youtube') {
      const crypto = require('crypto');
      const shot = await fetchYouTubeThumbnail(selected[0].url, fetchImpl);
      const store = uploadBuffer || ((args) => require('../services/cloudMediaStorageService').uploadBufferToS3(args));
      const sha256 = crypto.createHash('sha256').update(shot.bytes).digest('hex');
      const stored = await store({
        bytes: shot.bytes,
        mimeType: 'image/jpeg',
        key: `staff-video-cover/youtube/${property.id}/candidate-${sha256}.jpg`
      });
      if (!stored?.publicUrl) return { ok: false, status: 422, error: 'The YouTube thumbnail could not be saved as a cover. Upload a photo instead.' };
      uploaded = [{
        url: stored.publicUrl,
        sha256: stored.sha256 || sha256,
        sourceVideoUrl: selected[0].url,
        sourceVideoIndex: 0,
        timestampSeconds: 0,
        sharpness: 0,
        entropy: 0,
        bytes: stored.bytes || shot.bytes.length
      }];
    } else {
      ffmpegReady();
      uploaded = await backfill.makeAndUploadStills(
        { ...property, extra_fields: { ...(property.extra_fields || {}), video_urls: selected.map((item) => item.url) } },
        {
          frameCandidates: backfill.FRAME_CANDIDATE_COUNT,
          maxVideos: chosen ? 1 : MAX_VIDEOS_PER_TICK,
          deadline: Date.now() + budgetMs,
          signal: controller.signal,
          ...(preview ? { framesNeeded: 4 } : {})
        }
      );
    }
    if (preview) {
      const candidates = (uploaded || []).map((item, index) => coverCandidateRecord(item, item.label || `Frame ${index + 1}`));
      if (!candidates.length) return { ok: true, attached: 0, preview: true, candidates: [], note: 'No frames could be read from this video.' };
      await rememberCoverCandidates(db, property.id, candidates);
      return { ok: true, attached: 0, preview: true, candidates, listingStatus: status };
    }
    if (!uploaded.length) return { ok: true, attached: 0, note: 'This listing already has stills from its video.' };
    const attached = await backfill.attachStills(property.id, uploaded, {
      keepListingText: true,
      actorId,
      setAsCover: true,
      ...(liveCover ? { coverLiveListing: true } : {})
    });
    if (attached.skipped === 'status_changed') return { ok: false, status: 409, error: 'The listing changed while the cover was being made. Reload and try again.' };
    if (attached.skipped === 'duplicate_stills') {
      return { ok: true, attached: 0, reused: attached.reused || 0, listingStatus: status, note: 'That frame is already on the listing.' };
    }
    return { ok: true, attached: attached.attached || 0, reused: attached.reused || 0, listingStatus: status };
  } catch (error) {
    try { backfill.killLiveChildren?.(); } catch (_) {}
    logger.warn('Staff video cover failed', { propertyId: property.id, error: String(error?.message || error).slice(0, 300) });
    return { ok: false, status: 422, error: coverErrorMessage(error) };
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
  coverErrorMessage,
  coverSourceUrls,
  coverVideoUrls,
  youtubeVideoId,
  makeVideoCoverForListing,
  selectionQuery,
  siteBusyReason,
  startVideoStillScheduler,
  tickVideoStills
};
