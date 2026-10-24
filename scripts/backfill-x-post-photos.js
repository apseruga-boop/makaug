#!/usr/bin/env node
'use strict';

// Copies X/Twitter post photos that are still stored as twimg links onto
// MakaUg media and inserts an x_post_photo row. Dry-run unless --confirm.
// Do not run this against production unless that copy is intended.

require('dotenv').config();

const db = require('../config/database');
const {
  X_POST_PHOTO_LABEL,
  X_POST_PHOTO_SLOT,
  cacheXPostPhoto,
  normalizeTwimgPhotoUrl,
  twimgUrlsFromListing,
  twimgUrlsStillToCopy,
} = require('../utils/xPostPhoto');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const REFERENCE = argValue('reference');
const LIMIT = positiveInt(argValue('limit'));

function argValue(name) {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

function positiveInt(value) {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function usage() {
  return [
    'Usage:',
    '  npm run inventory:backfill-x-post-photos',
    '  npm run inventory:backfill-x-post-photos -- --reference=MK-20261009-540173',
    '  npm run inventory:backfill-x-post-photos -- --confirm --limit=25',
    '',
    'Default is a dry run. It lists found-online X/Twitter rows that still have',
    'a pbs.twimg.com or video.twimg.com photo and does not download or write.',
    '--confirm copies each remaining photo onto MakaUg media and inserts an',
    'x_post_photo row. URLs already listed in extra_fields.x_post_photo_source_urls',
    'are skipped, so a second run does not duplicate them.',
  ].join('\n');
}

function asImageList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return asImageList(JSON.parse(value)); } catch (_) { return []; }
  }
  return [];
}

async function loadCandidates() {
  const params = [];
  const filters = [
    `COALESCE(p.status, '') <> 'deleted'`,
    `(
      p.listed_via = 'found_online'
      OR p.source = 'found_online_property_source_v1'
      OR LOWER(COALESCE(p.extra_fields->>'found_online', '')) IN ('true', '1', 'yes')
    )`,
    `(
      LOWER(COALESCE(p.extra_fields->>'source_platform', '')) IN ('x', 'twitter', 'x/twitter')
      OR COALESCE(p.extra_fields->>'source_url', '') ~* 'https?://([^/]+\\.)?(x|twitter)\\.com'
      OR COALESCE(p.extra_fields->>'source_post_url', '') ~* 'https?://([^/]+\\.)?(x|twitter)\\.com'
      OR COALESCE(p.extra_fields->>'x_url', '') ~* 'https?://([^/]+\\.)?(x|twitter)\\.com'
      OR EXISTS (
        SELECT 1 FROM property_images tw
        WHERE tw.property_id = p.id AND tw.url ~* 'twimg\\.com'
      )
    )`,
  ];
  if (REFERENCE) {
    params.push(REFERENCE);
    filters.push(`p.inquiry_reference = $${params.length}`);
  }
  let limitSql = '';
  if (LIMIT) {
    params.push(LIMIT);
    limitSql = `LIMIT $${params.length}`;
  }
  const result = await db.query(
    `SELECT p.id::text AS id,
            p.inquiry_reference,
            p.extra_fields,
            COALESCE(
              json_agg(json_build_object('url', i.url, 'slot_key', i.slot_key, 'sort_order', i.sort_order))
              FILTER (WHERE i.id IS NOT NULL),
              '[]'::json
            ) AS images
     FROM properties p
     LEFT JOIN property_images i ON i.property_id = p.id
     WHERE ${filters.join('\n       AND ')}
     GROUP BY p.id
     ORDER BY p.created_at ASC
     ${limitSql}`,
    params
  );
  return result.rows || [];
}

function planForRow(row) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const images = asImageList(row.images);
  const pending = twimgUrlsStillToCopy(
    twimgUrlsFromListing({ images, extra }),
    extra.x_post_photo_source_urls
  );
  return {
    id: row.id,
    inquiry_reference: row.inquiry_reference,
    urls: pending,
    images,
    alreadyCopied: Array.isArray(extra.x_post_photo_source_urls) ? extra.x_post_photo_source_urls : [],
  };
}

async function writeCopies(item, uploaded) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const maxSort = item.images.reduce((max, image) => Math.max(max, Number(image.sort_order) || 0), 0);
    const existingUrls = new Set(item.images.map((image) => String(image.url || '')));
    const stored = [];
    for (let index = 0; index < uploaded.length; index += 1) {
      const photo = uploaded[index];
      if (existingUrls.has(photo.hosted)) continue;
      await client.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1, $2, false, $3, $4, $5)`,
        [item.id, photo.hosted, maxSort + stored.length + 1, X_POST_PHOTO_SLOT, X_POST_PHOTO_LABEL]
      );
      stored.push(photo);
    }
    const nextSources = [...item.alreadyCopied];
    for (const photo of stored) {
      nextSources.push(photo.url);
      const normalized = normalizeTwimgPhotoUrl(photo.url);
      if (normalized && normalized !== photo.url) nextSources.push(normalized);
    }
    if (stored.length) {
      await client.query(
        `UPDATE properties
         SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object('x_post_photo_source_urls', $2::jsonb)
         WHERE id = $1::uuid`,
        [item.id, JSON.stringify(nextSources)]
      );
    }
    await client.query('COMMIT');
    return stored.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (args.includes('--help')) {
    console.log(usage());
    return;
  }
  const rows = await loadCandidates();
  const plan = rows.map(planForRow).filter((item) => item.urls.length);
  if (!CONFIRM) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      listings: plan.length,
      photos: plan.reduce((sum, item) => sum + item.urls.length, 0),
      rows: plan.map((item) => ({
        id: item.id,
        inquiry_reference: item.inquiry_reference,
        urls: item.urls,
      })),
      note: 'Dry run. Pass --confirm to copy photos and write x_post_photo rows.',
    }, null, 2));
    return;
  }

  const copied = [];
  const failures = [];
  for (const item of plan) {
    const uploaded = [];
    for (const url of item.urls) {
      let noted = false;
      const hosted = await cacheXPostPhoto(url, {
        onError(error) {
          noted = true;
          failures.push({
            id: item.id,
            inquiry_reference: item.inquiry_reference,
            url,
            error: error?.message || 'x_post_photo_cache_failed',
          });
        },
      });
      if (!hosted) {
        if (!noted) {
          failures.push({
            id: item.id,
            inquiry_reference: item.inquiry_reference,
            url,
            error: 'not_copied',
          });
        }
        continue;
      }
      uploaded.push({ url, hosted });
    }
    if (!uploaded.length) continue;
    try {
      const count = await writeCopies(item, uploaded);
      copied.push({ id: item.id, inquiry_reference: item.inquiry_reference, count });
    } catch (error) {
      failures.push({
        id: item.id,
        inquiry_reference: item.inquiry_reference,
        error: error.message || 'x_post_photo_write_failed',
      });
    }
  }
  console.log(JSON.stringify({
    ok: failures.length === 0,
    dry_run: false,
    copied,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .then(() => db.pool.end())
    .catch(async (error) => {
      console.error(error.message || error);
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { usage, planForRow };
