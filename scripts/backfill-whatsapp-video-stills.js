#!/usr/bin/env node
'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const db = require('../config/database');
const { uploadBufferToS3 } = require('../services/cloudMediaStorageService');
const {
  buildEmployeePublicDescription,
  cleanEmployeePropertyCaption
} = require('../services/whatsappEmployeeIntakeService');

const BACKFILL_MARKER = 'whatsapp-video-five-key-frames-20260831';
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEOS_PER_PROPERTY = 10;
const MIN_VIDEO_KEY_FRAMES = 5;

const SELECTION_SQL = `
  SELECT p.id, p.status, p.listing_type, p.description, p.district, p.area, p.price,
         p.lister_name, p.extra_fields, p.created_at,
         COUNT(pi.id) FILTER (
           WHERE COALESCE(pi.slot_key, '') LIKE 'video_%'
              OR COALESCE(pi.room_label, '') ILIKE '%video%'
         )::int AS video_still_count
    FROM properties p
    LEFT JOIN property_images pi ON pi.property_id = p.id
   WHERE p.source = 'whatsapp_employee_intake'
     AND p.status = 'pending'
     AND jsonb_typeof(p.extra_fields->'video_urls') = 'array'
     AND jsonb_array_length(p.extra_fields->'video_urls') > 0
   GROUP BY p.id
   HAVING COUNT(pi.id) FILTER (
            WHERE COALESCE(pi.slot_key, '') LIKE 'video_%'
               OR COALESCE(pi.room_label, '') ILIKE '%video%'
          ) < ${MIN_VIDEO_KEY_FRAMES}
       OR COALESCE(p.description, '') ~* '^\\s*forwarded'
   ORDER BY p.created_at ASC
`;

function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: argv.includes('--apply'),
    propertyIds: argv
      .filter((arg) => arg.startsWith('--property-id='))
      .map((arg) => arg.slice('--property-id='.length).trim())
      .filter(Boolean)
  };
}

function extractVideoUrls(extraFields = {}) {
  const values = Array.isArray(extraFields?.video_urls) ? extraFields.video_urls : [];
  return [...new Set(values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }))].slice(0, MAX_VIDEOS_PER_PROPERTY);
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}${stderr ? `: ${String(stderr).trim()}` : ''}`;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function downloadVideo(url, outputPath, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`video download failed with HTTP ${response.status}`);
  }
  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (declaredBytes > MAX_DOWNLOAD_BYTES) {
    throw new Error(`video exceeds ${MAX_DOWNLOAD_BYTES} byte repair limit`);
  }
  let received = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) {
        callback(new Error(`video exceeds ${MAX_DOWNLOAD_BYTES} byte repair limit`));
        return;
      }
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(outputPath));
  if (!received) throw new Error('video download returned no bytes');
  return received;
}

async function extractStill(videoPath, stillPath) {
  const ffmpeg = String(process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
  const baseArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', "scale='min(1280,iw)':-2",
    '-q:v', '3',
    stillPath
  ];
  try {
    await execFileAsync(ffmpeg, ['-ss', '00:00:01', ...baseArgs]);
  } catch {
    await execFileAsync(ffmpeg, ['-ss', '00:00:00', ...baseArgs]);
  }
  const stat = await fsp.stat(stillPath);
  if (!stat.size) throw new Error('ffmpeg produced an empty still');
  return stat.size;
}

async function videoDurationSeconds(videoPath) {
  const ffprobe = String(process.env.FFPROBE_PATH || 'ffprobe').trim() || 'ffprobe';
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ]);
  const duration = Number(String(stdout || '').trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function representativeFrameOffsets(durationSeconds, count) {
  const duration = Number(durationSeconds || 0);
  const targetCount = Math.max(0, Number(count || 0));
  if (!targetCount) return [];
  if (!Number.isFinite(duration) || duration <= 0.25) {
    return Array.from({ length: targetCount }, (_, index) => index * 0.1);
  }
  return Array.from({ length: targetCount }, (_, index) => {
    const fraction = targetCount === 1 ? 0.5 : (index + 1) / (targetCount + 1);
    return Math.min(Math.max(0.05, duration * fraction), Math.max(0.05, duration - 0.05));
  });
}

async function extractStillAt(videoPath, stillPath, seconds) {
  const ffmpeg = String(process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
  await execFileAsync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoPath,
    '-ss', Number(seconds || 0).toFixed(3),
    '-frames:v', '1',
    '-vf', "scale='min(1280,iw)':-2",
    '-q:v', '3',
    stillPath
  ]);
  const stat = await fsp.stat(stillPath).catch(() => null);
  if (!stat) throw new Error(`ffmpeg produced no key frame at ${Number(seconds || 0).toFixed(3)}s`);
  if (!stat.size) throw new Error('ffmpeg produced an empty key frame');
  return stat.size;
}

async function extractStillWithFallback(videoPath, stillPath, requestedSeconds) {
  const requested = Math.max(0, Number(requestedSeconds || 0));
  const attempts = fallbackFrameOffsets(requested);
  let lastError = null;
  for (const seconds of attempts) {
    await fsp.rm(stillPath, { force: true }).catch(() => {});
    try {
      await extractStillAt(videoPath, stillPath, seconds);
      return seconds;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('ffmpeg could not produce a key frame');
}

function fallbackFrameOffsets(requestedSeconds) {
  const requested = Math.max(0, Number(requestedSeconds || 0));
  return [...new Set([
    requested,
    requested * 0.75,
    requested * 0.5,
    requested * 0.25,
    0.1,
    0
  ].map((value) => Number(value.toFixed(3))))];
}

function keyFramesNeeded(property = {}) {
  return Math.max(0, MIN_VIDEO_KEY_FRAMES - Number(property.video_still_count || 0));
}

async function makeAndUploadStills(property) {
  const urls = extractVideoUrls(property.extra_fields);
  if (!urls.length) throw new Error('no valid HTTPS video URL');
  const required = keyFramesNeeded(property);
  if (!required) return [];
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `makaug-video-still-${property.id}-`));
  const uploaded = [];
  try {
    for (let index = 0; index < urls.length; index += 1) {
      const remaining = required - uploaded.length;
      if (remaining <= 0) break;
      const remainingVideos = urls.length - index;
      const frameCount = Math.max(1, Math.ceil(remaining / remainingVideos));
      const videoPath = path.join(tempDir, `video-${index + 1}.bin`);
      try {
        await downloadVideo(urls[index], videoPath);
        const duration = await videoDurationSeconds(videoPath);
        const offsets = representativeFrameOffsets(duration, frameCount);
        for (let frameIndex = 0; frameIndex < offsets.length && uploaded.length < required; frameIndex += 1) {
          const stillPath = path.join(tempDir, `still-${index + 1}-${frameIndex + 1}.jpg`);
          const actualTimestampSeconds = await extractStillWithFallback(videoPath, stillPath, offsets[frameIndex]);
          const bytes = await fsp.readFile(stillPath);
          const stored = await uploadBufferToS3({
            bytes,
            mimeType: 'image/jpeg',
            key: `whatsapp-employee-intake/video-key-frame/${property.id}/${Date.now()}-${crypto.randomUUID()}.jpg`
          });
          if (!stored.publicUrl) throw new Error('S3_PUBLIC_BASE_URL is required for review media');
          uploaded.push({
            url: stored.publicUrl,
            sha256: stored.sha256,
            sourceVideoUrl: urls[index],
            sourceVideoIndex: index,
            timestampSeconds: actualTimestampSeconds,
            bytes: stored.bytes
          });
        }
      } catch (error) {
        process.stderr.write(`WARN ${property.id} video ${index + 1}: ${error.message || error}\n`);
      }
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
  if (uploaded.length < required) {
    throw new Error(`generated ${uploaded.length} of ${required} required video key frames`);
  }
  return uploaded;
}

async function attachStills(propertyId, uploaded) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id, status, listing_type, description, district, area, price, lister_name, extra_fields
         FROM properties
        WHERE id = $1
        FOR UPDATE`,
      [propertyId]
    );
    const property = locked.rows[0];
    if (!property || property.status !== 'pending') {
      await client.query('ROLLBACK');
      return { attached: 0, skipped: 'status_changed' };
    }
    const existing = await client.query(
      `SELECT COUNT(*) FILTER (
                WHERE COALESCE(slot_key, '') LIKE 'video_%'
                   OR COALESCE(room_label, '') ILIKE '%video%'
              )::int AS video_count,
              COALESCE(MAX(sort_order), -1)::int AS max_sort_order
         FROM property_images
        WHERE property_id = $1`,
      [propertyId]
    );
    const existingVideoCount = Number(existing.rows[0]?.video_count || 0);
    const required = Math.max(0, MIN_VIDEO_KEY_FRAMES - existingVideoCount);
    const selectedUploads = uploaded.slice(0, required);
    const cleanCaption = cleanEmployeePropertyCaption(property.extra_fields?.source_caption || property.description || '');
    const publicDescription = buildEmployeePublicDescription({
      caption: property.extra_fields?.source_caption || property.description || '',
      facts: {
        listingType: property.listing_type,
        price: property.price,
        priceMetadata: {
          price_original_currency: property.extra_fields?.price_original_currency || property.extra_fields?.price_currency || 'UGX',
          price_original: property.extra_fields?.price_original || property.price
        },
        locationPatch: { area: property.area, district: property.district }
      },
      listerName: property.lister_name,
      videoCount: extractVideoUrls(property.extra_fields).length,
      keyFrameCount: existingVideoCount + selectedUploads.length
    });
    if (!selectedUploads.length && publicDescription === property.description) {
      await client.query('ROLLBACK');
      return { attached: 0, skipped: 'already_has_five_key_frames_and_clean_description' };
    }

    const firstSortOrder = Number(existing.rows[0]?.max_sort_order ?? -1) + 1;
    for (let index = 0; index < selectedUploads.length; index += 1) {
      const keyFrameNumber = existingVideoCount + index + 1;
      await client.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          propertyId,
          selectedUploads[index].url,
          firstSortOrder + index === 0,
          firstSortOrder + index,
          `video_key_frame_${keyFrameNumber}`,
          `Video key image ${keyFrameNumber} of ${MIN_VIDEO_KEY_FRAMES}`
        ]
      );
    }

    const currentExtra = property.extra_fields && typeof property.extra_fields === 'object'
      ? property.extra_fields
      : {};
    const hashes = Array.isArray(currentExtra.media_sha256) ? currentExtra.media_sha256 : [];
    const nextExtra = {
      source_caption_display: cleanCaption.slice(0, 2000),
      video_url: extractVideoUrls(property.extra_fields)[0] || null,
      video_urls: extractVideoUrls(property.extra_fields),
      video_tours: extractVideoUrls(property.extra_fields).map((url, index) => ({
        url,
        label: `WhatsApp property video ${index + 1}`,
        sort_order: index
      })),
      video_count: extractVideoUrls(property.extra_fields).length,
      video_still_urls: [...new Set([
        ...(Array.isArray(currentExtra.video_still_urls) ? currentExtra.video_still_urls : []),
        ...selectedUploads.map((item) => item.url)
      ])],
      video_still_backfilled_at: new Date().toISOString(),
      video_still_backfill_marker: BACKFILL_MARKER,
      video_key_frame_count: existingVideoCount + selectedUploads.length,
      media_count: Number(currentExtra.media_count || 0) + selectedUploads.length,
      media_sha256: [...new Set([...hashes, ...selectedUploads.map((item) => item.sha256).filter(Boolean)])],
      review_only: true,
      auto_publish: false
    };
    await client.query(
      `UPDATE properties
          SET description = $3,
              extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [propertyId, JSON.stringify(nextExtra), publicDescription]
    );
    await client.query(
      `INSERT INTO property_moderation_events
        (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1, 'whatsapp-video-still-backfill', 'whatsapp_video_still_backfilled',
               'pending', 'pending', $2, $3, $4::jsonb)`,
      [
        propertyId,
        'Prepared five representative key images and retained the playable WhatsApp property video.',
        `${selectedUploads.length} key image(s) attached and the public description was cleaned. Listing remained in staff review.`,
        JSON.stringify({
          marker: BACKFILL_MARKER,
          stills_attached: selectedUploads.length,
          total_video_key_frames: existingVideoCount + selectedUploads.length,
          source_videos: selectedUploads.map((item) => item.sourceVideoUrl),
          frame_timestamps_seconds: selectedUploads.map((item) => Number(item.timestampSeconds || 0)),
          description_cleaned: publicDescription !== property.description,
          auto_publish: false
        })
      ]
    );
    await client.query('COMMIT');
    return {
      attached: selectedUploads.length,
      totalVideoKeyFrames: existingVideoCount + selectedUploads.length,
      descriptionCleaned: publicDescription !== property.description
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs();
  const result = await db.query(SELECTION_SQL);
  const selected = options.propertyIds.length
    ? result.rows.filter((row) => options.propertyIds.includes(String(row.id)))
    : result.rows;
  process.stdout.write(`${JSON.stringify({
    marker: BACKFILL_MARKER,
    mode: options.apply ? 'apply' : 'dry-run',
    selected: selected.length,
    properties: selected.map((row) => ({
      id: row.id,
      videos: extractVideoUrls(row.extra_fields).length,
      existingVideoKeyFrames: Number(row.video_still_count || 0),
      keyFramesNeeded: keyFramesNeeded(row)
    }))
  }, null, 2)}\n`);
  if (!options.apply) return;

  const summary = { repaired: 0, stillsAttached: 0, skipped: 0, failed: 0, errors: [] };
  for (const property of selected) {
    try {
      const uploaded = await makeAndUploadStills(property);
      const attached = await attachStills(property.id, uploaded);
      if (attached.attached || attached.descriptionCleaned) {
        summary.repaired += 1;
        summary.stillsAttached += attached.attached;
      } else {
        summary.skipped += 1;
      }
      process.stdout.write(`${JSON.stringify({ propertyId: property.id, ...attached })}\n`);
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({ propertyId: property.id, error: error.message || String(error) });
      process.stderr.write(`ERROR ${property.id}: ${error.message || error}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({ marker: BACKFILL_MARKER, summary }, null, 2)}\n`);
  if (summary.failed) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message || error}\n`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  BACKFILL_MARKER,
  MIN_VIDEO_KEY_FRAMES,
  SELECTION_SQL,
  extractVideoUrls,
  extractStillAt,
  extractStillWithFallback,
  fallbackFrameOffsets,
  keyFramesNeeded,
  representativeFrameOffsets,
  parseArgs
};
