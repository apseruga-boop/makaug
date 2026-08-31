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

const BACKFILL_MARKER = 'whatsapp-video-still-backfill-20260831';
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEOS_PER_PROPERTY = 10;

const SELECTION_SQL = `
  SELECT p.id, p.status, p.extra_fields, p.created_at
    FROM properties p
   WHERE p.source = 'whatsapp_employee_intake'
     AND p.status = 'pending'
     AND jsonb_typeof(p.extra_fields->'video_urls') = 'array'
     AND jsonb_array_length(p.extra_fields->'video_urls') > 0
     AND NOT EXISTS (
       SELECT 1 FROM property_images pi WHERE pi.property_id = p.id
     )
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

async function makeAndUploadStills(property) {
  const urls = extractVideoUrls(property.extra_fields);
  if (!urls.length) throw new Error('no valid HTTPS video URL');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `makaug-video-still-${property.id}-`));
  const uploaded = [];
  try {
    for (let index = 0; index < urls.length; index += 1) {
      const videoPath = path.join(tempDir, `video-${index + 1}.bin`);
      const stillPath = path.join(tempDir, `still-${index + 1}.jpg`);
      try {
        await downloadVideo(urls[index], videoPath);
        await extractStill(videoPath, stillPath);
        const bytes = await fsp.readFile(stillPath);
        const stored = await uploadBufferToS3({
          bytes,
          mimeType: 'image/jpeg',
          key: `whatsapp-employee-intake/video-still/${property.id}/${Date.now()}-${crypto.randomUUID()}.jpg`
        });
        if (!stored.publicUrl) throw new Error('S3_PUBLIC_BASE_URL is required for review media');
        uploaded.push({
          url: stored.publicUrl,
          sha256: stored.sha256,
          sourceVideoUrl: urls[index],
          bytes: stored.bytes
        });
      } catch (error) {
        process.stderr.write(`WARN ${property.id} video ${index + 1}: ${error.message || error}\n`);
      }
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
  if (!uploaded.length) throw new Error('no video still could be generated');
  return uploaded;
}

async function attachStills(propertyId, uploaded) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id, status, extra_fields
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
      'SELECT COUNT(*)::int AS count FROM property_images WHERE property_id = $1',
      [propertyId]
    );
    if (Number(existing.rows[0]?.count || 0) > 0) {
      await client.query('ROLLBACK');
      return { attached: 0, skipped: 'image_already_present' };
    }

    for (let index = 0; index < uploaded.length; index += 1) {
      await client.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          propertyId,
          uploaded[index].url,
          index === 0,
          index,
          `video_still_${index + 1}`,
          `Still image from property video ${index + 1}`
        ]
      );
    }

    const currentExtra = property.extra_fields && typeof property.extra_fields === 'object'
      ? property.extra_fields
      : {};
    const hashes = Array.isArray(currentExtra.media_sha256) ? currentExtra.media_sha256 : [];
    const nextExtra = {
      video_still_urls: uploaded.map((item) => item.url),
      video_still_backfilled_at: new Date().toISOString(),
      video_still_backfill_marker: BACKFILL_MARKER,
      media_count: Number(currentExtra.media_count || 0) + uploaded.length,
      media_sha256: [...new Set([...hashes, ...uploaded.map((item) => item.sha256).filter(Boolean)])],
      review_only: true,
      auto_publish: false
    };
    await client.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [propertyId, JSON.stringify(nextExtra)]
    );
    await client.query(
      `INSERT INTO property_moderation_events
        (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1, 'whatsapp-video-still-backfill', 'whatsapp_video_still_backfilled',
               'pending', 'pending', $2, $3, $4::jsonb)`,
      [
        propertyId,
        'Recovered still images from existing Cloudflare-hosted WhatsApp property videos.',
        `${uploaded.length} video still image(s) attached. Listing remained in staff review.`,
        JSON.stringify({
          marker: BACKFILL_MARKER,
          stills_attached: uploaded.length,
          source_videos: uploaded.map((item) => item.sourceVideoUrl),
          auto_publish: false
        })
      ]
    );
    await client.query('COMMIT');
    return { attached: uploaded.length };
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
    properties: selected.map((row) => ({ id: row.id, videos: extractVideoUrls(row.extra_fields).length }))
  }, null, 2)}\n`);
  if (!options.apply) return;

  const summary = { repaired: 0, stillsAttached: 0, skipped: 0, failed: 0, errors: [] };
  for (const property of selected) {
    try {
      const uploaded = await makeAndUploadStills(property);
      const attached = await attachStills(property.id, uploaded);
      if (attached.attached) {
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
  SELECTION_SQL,
  extractVideoUrls,
  parseArgs
};
