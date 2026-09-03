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
const sharp = require('sharp');
const db = require('../config/database');
const { uploadBufferToS3 } = require('../services/cloudMediaStorageService');
const {
  buildEmployeePublicDescription,
  cleanEmployeePropertyCaption
} = require('../services/whatsappEmployeeIntakeService');

const BACKFILL_MARKER = 'whatsapp-video-distinct-clear-frames-20260903';
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEOS_PER_PROPERTY = 10;
const MIN_VIDEO_KEY_FRAMES = 5;
const FRAME_CANDIDATE_COUNT = 30;
const FRAME_HASH_SIZE = 16;
const MIN_FRAME_HASH_DISTANCE = 0.2;

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
    replaceExisting: argv.includes('--replace-video-frames'),
    reopenApproved: argv.includes('--reopen-approved'),
    propertyIds: argv
      .filter((arg) => arg.startsWith('--property-id='))
      .map((arg) => arg.slice('--property-id='.length).trim())
      .filter(Boolean)
  };
}

function selectionSqlFor({ reopenApproved = false } = {}) {
  if (!reopenApproved) return SELECTION_SQL;
  return SELECTION_SQL
    .replace("AND p.status = 'pending'", "AND p.status IN ('pending', 'approved')")
    .replace(/HAVING[\s\S]+?ORDER BY p\.created_at ASC/, 'HAVING TRUE\n   ORDER BY p.created_at ASC');
}

function selectionQueryFor(options = {}) {
  if (!options.propertyIds?.length) {
    return { text: selectionSqlFor(options), values: [] };
  }
  const statusSql = options.reopenApproved
    ? "p.status IN ('pending', 'approved')"
    : "p.status = 'pending'";
  return {
    text: `
      SELECT p.id, p.status, p.listing_type, p.description, p.district, p.area, p.price,
             p.lister_name, p.extra_fields, p.created_at,
             COUNT(pi.id) FILTER (
               WHERE COALESCE(pi.slot_key, '') LIKE 'video_%'
                  OR COALESCE(pi.room_label, '') ILIKE '%video%'
             )::int AS video_still_count
        FROM properties p
        LEFT JOIN property_images pi ON pi.property_id = p.id
       WHERE p.source = 'whatsapp_employee_intake'
         AND ${statusSql}
         AND p.id = ANY($1::uuid[])
       GROUP BY p.id
       ORDER BY p.created_at ASC
    `,
    values: [options.propertyIds]
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

function candidateFrameOffsets(durationSeconds, count = FRAME_CANDIDATE_COUNT) {
  const duration = Number(durationSeconds || 0);
  const targetCount = Math.max(MIN_VIDEO_KEY_FRAMES, Number(count || FRAME_CANDIDATE_COUNT));
  if (!Number.isFinite(duration) || duration <= 0.25) {
    return representativeFrameOffsets(duration, MIN_VIDEO_KEY_FRAMES);
  }
  return Array.from({ length: targetCount }, (_, index) => {
    const fraction = 0.04 + ((0.92 * index) / Math.max(1, targetCount - 1));
    return Math.min(Math.max(0.05, duration * fraction), Math.max(0.05, duration - 0.05));
  });
}

function hammingDistance(left = '', right = '') {
  if (!left || !right || left.length !== right.length) return 1;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance / left.length;
}

function selectDistinctFrameCandidates(candidates = [], count = MIN_VIDEO_KEY_FRAMES, minimumDistance = MIN_FRAME_HASH_DISTANCE) {
  const pool = candidates
    .filter((candidate) => candidate?.hash && Number.isFinite(Number(candidate.quality)))
    .sort((left, right) => Number(right.quality) - Number(left.quality));
  if (!pool.length || count <= 0) return [];
  const selected = [pool.shift()];
  while (selected.length < count && pool.length) {
    let bestIndex = -1;
    let bestDistance = -1;
    let bestQuality = -1;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const nearestDistance = Math.min(...selected.map((item) => hammingDistance(candidate.hash, item.hash)));
      if (nearestDistance > bestDistance || (nearestDistance === bestDistance && candidate.quality > bestQuality)) {
        bestIndex = index;
        bestDistance = nearestDistance;
        bestQuality = candidate.quality;
      }
    }
    if (bestIndex < 0 || bestDistance < minimumDistance) break;
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return selected.sort((left, right) => Number(left.timestampSeconds) - Number(right.timestampSeconds));
}

async function frameCandidateMetrics(stillPath) {
  const pipeline = sharp(stillPath).rotate();
  const [stats, hashData] = await Promise.all([
    pipeline.clone().stats(),
    pipeline.clone()
      .resize(FRAME_HASH_SIZE, FRAME_HASH_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer()
  ]);
  const pixels = [...hashData];
  const mean = pixels.reduce((total, value) => total + value, 0) / Math.max(1, pixels.length);
  return {
    hash: pixels.map((value) => value >= mean ? '1' : '0').join(''),
    quality: (Number(stats.sharpness || 0) * 4) + Number(stats.entropy || 0),
    sharpness: Number(stats.sharpness || 0),
    entropy: Number(stats.entropy || 0)
  };
}

async function normalizeSelectedFrame(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 0.7, m1: 0.8, m2: 1.6 })
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(outputPath);
  const stat = await fsp.stat(outputPath);
  if (!stat.size) throw new Error('image normalization produced an empty key frame');
  return stat.size;
}

function colourDistance(left = [], right = []) {
  return [0, 1, 2].reduce((total, index) => total + Math.abs(Number(left[index] || 0) - Number(right[index] || 0)), 0);
}

async function whatsappMessagePreviewBounds(imagePath) {
  const image = sharp(imagePath).rotate().removeAlpha();
  const { data, info } = await image.clone().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 900 || info.height < 260) return null;
  const pixel = (x, y) => {
    const safeX = Math.max(0, Math.min(info.width - 1, Math.round(x)));
    const safeY = Math.max(0, Math.min(info.height - 1, Math.round(y)));
    const offset = ((safeY * info.width) + safeX) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const contentAtLandscapeEdge = pixel(info.width * 0.35, Math.min(100, info.height * 0.25));
  const backgroundReference = pixel(info.width * 0.74, Math.min(100, info.height * 0.25));
  const landscape = colourDistance(contentAtLandscapeEdge, backgroundReference) > 60;
  const left = Math.round(info.width * 0.069);
  const top = Math.min(30, Math.max(0, info.height - 1));
  const width = landscape ? Math.round(info.width * 0.35) : Math.round(info.width * 0.255);
  const requestedHeight = landscape ? Math.round(width * (9 / 16)) : Math.round(width * (4 / 2.84));
  const height = Math.min(requestedHeight, info.height - top - Math.max(28, Math.round(info.height * 0.08)));
  if (width < 180 || height < 160) return null;
  return { left, top, width, height, landscape };
}

async function makeAndUploadCroppedPreview(property, fetchImpl = fetch) {
  const imageResult = await db.query(
    `SELECT url
       FROM property_images
      WHERE property_id = $1
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC
      LIMIT 1`,
    [property.id]
  );
  const sourceUrl = String(imageResult.rows[0]?.url || '').trim();
  if (!sourceUrl) throw new Error('no source image is available for media repair');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `makaug-preview-repair-${property.id}-`));
  try {
    const inputPath = path.join(tempDir, 'source-image');
    const outputPath = path.join(tempDir, 'repaired-preview.jpg');
    await downloadVideo(sourceUrl, inputPath, fetchImpl);
    const bounds = await whatsappMessagePreviewBounds(inputPath);
    if (!bounds) throw new Error('source screenshot does not contain a recoverable full property preview');
    await sharp(inputPath)
      .rotate()
      .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
      .resize({ width: bounds.landscape ? 1280 : 960, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 0.7, m1: 0.8, m2: 1.6 })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toFile(outputPath);
    const metrics = await frameCandidateMetrics(outputPath);
    if (metrics.sharpness < 0.25 || metrics.entropy < 5) {
      throw new Error('source screenshot preview is incomplete or too unclear to reuse');
    }
    const bytes = await fsp.readFile(outputPath);
    const stored = await uploadBufferToS3({
      bytes,
      mimeType: 'image/jpeg',
      key: `whatsapp-employee-intake/repaired-preview/${property.id}/${Date.now()}-${crypto.randomUUID()}.jpg`
    });
    if (!stored.publicUrl) throw new Error('S3_PUBLIC_BASE_URL is required for review media');
    return {
      url: stored.publicUrl,
      sha256: stored.sha256,
      bytes: stored.bytes,
      sourceUrl,
      bounds,
      sharpness: metrics.sharpness,
      entropy: metrics.entropy
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
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

function keyFramesNeeded(property = {}, { replaceExisting = false } = {}) {
  if (replaceExisting) return MIN_VIDEO_KEY_FRAMES;
  return Math.max(0, MIN_VIDEO_KEY_FRAMES - Number(property.video_still_count || 0));
}

async function makeAndUploadStills(property, { replaceExisting = false } = {}) {
  const urls = extractVideoUrls(property.extra_fields);
  if (!urls.length) throw new Error('no valid HTTPS video URL');
  const required = keyFramesNeeded(property, { replaceExisting });
  if (!required) return [];
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `makaug-video-still-${property.id}-`));
  const uploaded = [];
  const candidates = [];
  try {
    for (let index = 0; index < urls.length; index += 1) {
      const videoPath = path.join(tempDir, `video-${index + 1}.bin`);
      try {
        await downloadVideo(urls[index], videoPath);
        const duration = await videoDurationSeconds(videoPath);
        const perVideoCandidates = Math.max(MIN_VIDEO_KEY_FRAMES, Math.ceil(FRAME_CANDIDATE_COUNT / urls.length));
        const offsets = candidateFrameOffsets(duration, perVideoCandidates);
        for (let frameIndex = 0; frameIndex < offsets.length; frameIndex += 1) {
          const stillPath = path.join(tempDir, `candidate-${index + 1}-${frameIndex + 1}.jpg`);
          const actualTimestampSeconds = await extractStillWithFallback(videoPath, stillPath, offsets[frameIndex]);
          const metrics = await frameCandidateMetrics(stillPath);
          candidates.push({
            path: stillPath,
            ...metrics,
            sourceVideoUrl: urls[index],
            sourceVideoIndex: index,
            timestampSeconds: actualTimestampSeconds
          });
        }
      } catch (error) {
        process.stderr.write(`WARN ${property.id} video ${index + 1}: ${error.message || error}\n`);
      }
    }

    const selected = selectDistinctFrameCandidates(candidates, required);
    if (!selected.length) throw new Error('no clear, visually distinct frame could be extracted');
    for (let index = 0; index < selected.length; index += 1) {
      const normalizedPath = path.join(tempDir, `selected-${index + 1}.jpg`);
      await normalizeSelectedFrame(selected[index].path, normalizedPath);
      const bytes = await fsp.readFile(normalizedPath);
      const stored = await uploadBufferToS3({
        bytes,
        mimeType: 'image/jpeg',
        key: `whatsapp-employee-intake/video-key-frame/${property.id}/${Date.now()}-${crypto.randomUUID()}.jpg`
      });
      if (!stored.publicUrl) throw new Error('S3_PUBLIC_BASE_URL is required for review media');
      uploaded.push({
        url: stored.publicUrl,
        sha256: stored.sha256,
        sourceVideoUrl: selected[index].sourceVideoUrl,
        sourceVideoIndex: selected[index].sourceVideoIndex,
        timestampSeconds: selected[index].timestampSeconds,
        sharpness: selected[index].sharpness,
        entropy: selected[index].entropy,
        bytes: stored.bytes
      });
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
  if (!uploaded.length) throw new Error('generated no usable video key frames');
  return uploaded;
}

async function attachStills(propertyId, uploaded, { replaceExisting = false, reopenApproved = false } = {}) {
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
    const allowedStatuses = reopenApproved ? ['pending', 'approved'] : ['pending'];
    if (!property || !allowedStatuses.includes(property.status)) {
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
    const existingVideoCountBeforeRepair = Number(existing.rows[0]?.video_count || 0);
    if (replaceExisting) {
      await client.query(
        `DELETE FROM property_images
          WHERE property_id = $1
            AND (COALESCE(slot_key, '') LIKE 'video_%'
              OR COALESCE(room_label, '') ILIKE '%video%')`,
        [propertyId]
      );
      await client.query(
        `UPDATE property_images
            SET is_primary = FALSE,
                sort_order = sort_order + $2
          WHERE property_id = $1`,
        [propertyId, MIN_VIDEO_KEY_FRAMES]
      );
    }
    const existingVideoCount = replaceExisting ? 0 : existingVideoCountBeforeRepair;
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

    const firstSortOrder = replaceExisting ? 0 : Number(existing.rows[0]?.max_sort_order ?? -1) + 1;
    for (let index = 0; index < selectedUploads.length; index += 1) {
      const keyFrameNumber = existingVideoCount + index + 1;
      await client.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          propertyId,
          selectedUploads[index].url,
          replaceExisting ? index === 0 : firstSortOrder + index === 0,
          firstSortOrder + index,
          `video_key_frame_${keyFrameNumber}`,
          `Distinct video key image ${keyFrameNumber} of ${existingVideoCount + selectedUploads.length}`
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
      video_frame_selection_policy: 'perceptual_hash_distance_and_sharpness_v1',
      video_frame_minimum_hash_distance: MIN_FRAME_HASH_DISTANCE,
      video_frame_quality: selectedUploads.map((item, index) => ({
        frame: existingVideoCount + index + 1,
        timestamp_seconds: Number(item.timestampSeconds || 0),
        sharpness: Number(Number(item.sharpness || 0).toFixed(4)),
        entropy: Number(Number(item.entropy || 0).toFixed(4))
      })),
      video_key_frame_count: existingVideoCount + selectedUploads.length,
      media_count: Number(currentExtra.media_count || 0) + selectedUploads.length,
      media_sha256: [...new Set([...hashes, ...selectedUploads.map((item) => item.sha256).filter(Boolean)])],
      review_only: true,
      auto_publish: false
    };
    await client.query(
      `UPDATE properties
          SET description = $3,
              status = CASE WHEN $4::boolean THEN 'pending' ELSE status END,
              moderation_stage = CASE WHEN $4::boolean THEN 'submitted' ELSE moderation_stage END,
              moderation_reason = CASE WHEN $4::boolean THEN 'Media repaired; manual re-review required' ELSE moderation_reason END,
              reviewed_at = CASE WHEN $4::boolean THEN NULL ELSE reviewed_at END,
              approved_at = CASE WHEN $4::boolean THEN NULL ELSE approved_at END,
              extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND status = ANY($5::text[])`,
      [propertyId, JSON.stringify(nextExtra), publicDescription, reopenApproved, allowedStatuses]
    );
    await client.query(
      `INSERT INTO property_moderation_events
        (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1, 'whatsapp-video-still-backfill', 'whatsapp_video_still_backfilled',
               $5, 'pending', $2, $3, $4::jsonb)`,
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
          frame_sharpness: selectedUploads.map((item) => Number(Number(item.sharpness || 0).toFixed(4))),
          visually_distinct: true,
          replaced_existing_video_frames: replaceExisting,
          description_cleaned: publicDescription !== property.description,
          auto_publish: false
        }),
        property.status
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

async function attachCroppedPreview(property, preview) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id, status, listing_type, description, district, area, price, lister_name, extra_fields
         FROM properties
        WHERE id = $1
        FOR UPDATE`,
      [property.id]
    );
    const current = locked.rows[0];
    if (!current || current.status !== 'pending') {
      await client.query('ROLLBACK');
      return { attached: 0, skipped: 'status_changed' };
    }
    const cleanCaption = cleanEmployeePropertyCaption(current.extra_fields?.source_caption || current.description || '');
    const publicDescription = buildEmployeePublicDescription({
      caption: current.extra_fields?.source_caption || current.description || '',
      facts: {
        listingType: current.listing_type,
        price: current.price,
        priceMetadata: {
          price_original_currency: current.extra_fields?.price_original_currency || current.extra_fields?.price_currency || 'UGX',
          price_original: current.extra_fields?.price_original || current.price
        },
        locationPatch: { area: current.area, district: current.district }
      },
      listerName: current.lister_name,
      videoCount: 0,
      keyFrameCount: 0
    });
    await client.query(
      `UPDATE property_images
          SET is_primary = FALSE,
              sort_order = sort_order + 1,
              slot_key = CASE WHEN is_primary THEN 'source_evidence_original' ELSE slot_key END,
              room_label = CASE WHEN is_primary THEN 'Original WhatsApp source evidence' ELSE room_label END
        WHERE property_id = $1`,
      [property.id]
    );
    await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
       VALUES ($1, $2, TRUE, 0, 'repaired_primary', 'Clear property preview from source video')`,
      [property.id, preview.url]
    );
    await client.query(
      `UPDATE properties
          SET description = $2,
              moderation_stage = 'submitted',
              moderation_reason = 'Media repaired; manual re-review required',
              extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [property.id, publicDescription, JSON.stringify({
        source_caption_display: cleanCaption.slice(0, 2000),
        review_only: true,
        auto_publish: false,
        media_repair_marker: BACKFILL_MARKER,
        media_repair_mode: 'whatsapp_source_preview_crop',
        media_repair_source_url: preview.sourceUrl,
        media_repair_crop_bounds: preview.bounds,
        media_repair_sharpness: Number(Number(preview.sharpness || 0).toFixed(4)),
        media_repair_entropy: Number(Number(preview.entropy || 0).toFixed(4)),
        media_repaired_at: new Date().toISOString()
      })]
    );
    await client.query(
      `INSERT INTO property_moderation_events
        (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1, 'whatsapp-video-still-backfill', 'whatsapp_source_preview_repaired',
               'pending', 'pending', $2, $3, $4::jsonb)`,
      [
        property.id,
        'Cropped the actual property preview out of the WhatsApp message screenshot.',
        'A clearer primary preview was attached. The original screenshot remains as source evidence and the listing remains in staff review.',
        JSON.stringify({
          marker: BACKFILL_MARKER,
          source_url: preview.sourceUrl,
          crop_bounds: preview.bounds,
          sharpness: Number(Number(preview.sharpness || 0).toFixed(4)),
          entropy: Number(Number(preview.entropy || 0).toFixed(4)),
          auto_publish: false
        })
      ]
    );
    await client.query('COMMIT');
    return { attached: 1, mode: 'cropped_source_preview', descriptionCleaned: publicDescription !== current.description };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function reopenPropertyForMediaReview(property) {
  if (!property || property.status !== 'approved') return { reopened: false, status: property?.status || null };
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE properties
          SET status = 'pending',
              moderation_stage = 'submitted',
              moderation_reason = 'Media repair required; manual re-review required',
              moderation_notes = 'Removed from public inventory while clearer, visually distinct property media is prepared.',
              reviewed_at = NULL,
              approved_at = NULL,
              updated_at = NOW(),
              extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb
        WHERE id = $1 AND status = 'approved'
        RETURNING id, status`,
      [property.id, JSON.stringify({
        review_only: true,
        auto_publish: false,
        media_repair_requested_at: new Date().toISOString(),
        media_repair_marker: BACKFILL_MARKER
      })]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return { reopened: false, status: 'status_changed' };
    }
    await client.query(
      `INSERT INTO property_moderation_events
        (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1, 'whatsapp-video-still-backfill', 'media_repair_reopened',
               'approved', 'pending', $2, $3, $4::jsonb)`,
      [
        property.id,
        'Media clarity or duplicate-frame issue requires staff re-review.',
        'Listing removed from public inventory before media repair. It must be manually approved again.',
        JSON.stringify({ marker: BACKFILL_MARKER, auto_publish: false })
      ]
    );
    await client.query('COMMIT');
    property.status = 'pending';
    return { reopened: true, status: 'pending' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs();
  const selection = selectionQueryFor(options);
  const result = await db.query(selection.text, selection.values);
  const selected = result.rows;
  process.stdout.write(`${JSON.stringify({
    marker: BACKFILL_MARKER,
    mode: options.apply ? 'apply' : 'dry-run',
    selected: selected.length,
    properties: selected.map((row) => ({
      id: row.id,
      videos: extractVideoUrls(row.extra_fields).length,
      existingVideoKeyFrames: Number(row.video_still_count || 0),
      keyFramesNeeded: keyFramesNeeded(row, options),
      willReopenForReview: options.reopenApproved && row.status === 'approved',
      replaceExisting: options.replaceExisting
    }))
  }, null, 2)}\n`);
  if (!options.apply) return;

  const summary = {
    selected: selected.length,
    reopenedForReview: 0,
    repaired: 0,
    stillsAttached: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  for (const property of selected) {
    try {
      if (options.reopenApproved) {
        const reopening = await reopenPropertyForMediaReview(property);
        if (reopening.reopened) summary.reopenedForReview += 1;
      }
      let attached;
      if (extractVideoUrls(property.extra_fields).length) {
        const uploaded = await makeAndUploadStills(property, options);
        attached = await attachStills(property.id, uploaded, options);
      } else {
        const preview = await makeAndUploadCroppedPreview(property);
        attached = await attachCroppedPreview(property, preview);
      }
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
  frameCandidateMetrics,
  fallbackFrameOffsets,
  keyFramesNeeded,
  candidateFrameOffsets,
  hammingDistance,
  selectDistinctFrameCandidates,
  whatsappMessagePreviewBounds,
  representativeFrameOffsets,
  selectionSqlFor,
  selectionQueryFor,
  parseArgs
};
