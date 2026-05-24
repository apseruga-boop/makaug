#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const FOUND_ONLINE_SOURCE = 'found_online_property_source_v1';
const LEGACY_SOURCE = 'sourced_inventory_candidate_v1';
const SOURCE_VALUES = [FOUND_ONLINE_SOURCE, LEGACY_SOURCE];

const args = process.argv.slice(2);
const argValue = (name) => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
};

const FILE = argValue('file');
const DRY_RUN = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const CONFIRM_RIGHTS = args.includes('--confirm-rights');
const APPEND = args.includes('--append');
const ACTOR_ID = argValue('actor') || 'found_online_image_import';
const MAX_IMAGES_PER_LISTING = 20;
const MAX_LOCAL_IMAGE_BYTES = 2 * 1024 * 1024;

function usage() {
  return [
    'Usage:',
    '  npm run inventory:import-found-online-images -- --file=authorised-images.csv --confirm --confirm-rights',
    '',
    'Accepted CSV/JSON fields:',
    '  property_id OR inquiry_reference OR candidate_number',
    '  image_1,image_2,... OR image_urls (pipe/comma/newline separated)',
    '  source_url OR source_urls (pipe/comma/newline separated)',
    '  consent_confirmed=true and image_rights_confirmed=true unless --confirm-rights is passed',
    '',
    'Only found-online intake records are updated.'
  ].join('\n');
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on', 'authorised', 'authorized'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  return cleanText(value)
    .split(/\s*(?:\||\n|,)\s*/g)
    .map(cleanText)
    .filter(Boolean);
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  const [headersRaw = [], ...dataRows] = rows.filter((item) => item.some((value) => cleanText(value)));
  const headers = headersRaw.map((header) => cleanText(header).toLowerCase());
  return dataRows.map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      if (header) out[header] = cleanText(values[index]);
    });
    return out;
  });
}

function readRows(filePath) {
  if (!filePath) throw new Error(`--file is required\n${usage()}`);
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf8');
  if (/\.json$/i.test(absolute)) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.listings)) return parsed.listings;
    throw new Error('JSON import must be an array, or contain rows/listings array');
  }
  return parseCsv(content);
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function normalizeImageValue(value, baseDir) {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) return raw;
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Local image not found: ${raw}`);
  }
  const stat = fs.statSync(absolute);
  if (stat.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error(`Local image is too large for DB import (${stat.size} bytes): ${raw}`);
  }
  const bytes = fs.readFileSync(absolute);
  return `data:${mimeFromPath(absolute)};base64,${bytes.toString('base64')}`;
}

function imagesFromRow(row, baseDir) {
  const values = [];
  values.push(...splitList(row.image_urls || row.images || row.photos || row.photo_urls));
  for (let i = 1; i <= MAX_IMAGES_PER_LISTING; i += 1) {
    values.push(...splitList(row[`image_${i}`] || row[`image_url_${i}`] || row[`photo_${i}`] || row[`photo_url_${i}`]));
  }
  return [...new Set(values)]
    .slice(0, MAX_IMAGES_PER_LISTING)
    .map((value, index) => ({
      url: normalizeImageValue(value, baseDir),
      slot_key: cleanText(row[`image_${index + 1}_slot`] || row[`photo_${index + 1}_slot`]) || null,
      room_label: cleanText(row[`image_${index + 1}_label`] || row[`photo_${index + 1}_label`]) || (index === 0 ? 'Primary authorised photo' : `Authorised photo ${index + 1}`),
      is_primary: index === 0,
      sort_order: index
    }));
}

function sourceUrlsFromRow(row) {
  return [...new Set([
    ...splitList(row.source_url || row.source_link || row.original_url),
    ...splitList(row.source_urls || row.source_links || row.original_urls),
    ...splitList(row.photo_source_url || row.photo_source_urls)
  ].filter((url) => /^https?:\/\//i.test(url)))];
}

async function findCandidate(client, row) {
  const propertyId = cleanText(row.property_id || row.id);
  const inquiryReference = cleanText(row.inquiry_reference || row.reference || row.ref);
  const candidateNumber = cleanText(row.candidate_number || row.candidate_no);
  const title = cleanText(row.title);
  const params = [SOURCE_VALUES];
  const filters = ['source = ANY($1::text[])'];
  if (propertyId) {
    params.push(propertyId);
    filters.push(`id::text = $${params.length}`);
  } else if (inquiryReference) {
    params.push(inquiryReference);
    filters.push(`inquiry_reference = $${params.length}`);
  } else if (candidateNumber) {
    params.push(candidateNumber);
    filters.push(`extra_fields->>'candidate_number' = $${params.length}`);
  } else if (title) {
    params.push(title);
    filters.push(`LOWER(title) = LOWER($${params.length})`);
  } else {
    throw new Error('Row needs property_id, inquiry_reference, candidate_number, or title');
  }

  const result = await client.query(
    `SELECT id::text AS id, title, inquiry_reference, status, extra_fields
     FROM properties
     WHERE ${filters.join(' AND ')}
     LIMIT 2`,
    params
  );
  if (!result.rows.length) throw new Error(`No found-online record found for ${propertyId || inquiryReference || candidateNumber || title}`);
  if (result.rows.length > 1) throw new Error(`Multiple found-online records matched ${propertyId || inquiryReference || candidateNumber || title}`);
  return result.rows[0];
}

async function importRow(client, row, baseDir) {
  const consentConfirmed = CONFIRM_RIGHTS || parseBooleanLike(row.consent_confirmed || row.consent || row.permission_confirmed, false);
  const imageRightsConfirmed = CONFIRM_RIGHTS || parseBooleanLike(row.image_rights_confirmed || row.photo_rights_confirmed || row.authorised_images || row.authorized_images, false);
  if (!consentConfirmed || !imageRightsConfirmed) {
    throw new Error('Row is missing consent_confirmed=true and image_rights_confirmed=true');
  }
  const images = imagesFromRow(row, baseDir);
  if (!images.length) throw new Error('Row has no image URLs or local image files');
  const sourceUrls = sourceUrlsFromRow(row);
  const candidate = await findCandidate(client, row);

  if (DRY_RUN) {
    return {
      property_id: candidate.id,
      inquiry_reference: candidate.inquiry_reference,
      title: candidate.title,
      images: images.length,
      source_urls: sourceUrls.length,
      dry_run: true
    };
  }

  if (!APPEND) {
    await client.query('DELETE FROM property_images WHERE property_id = $1', [candidate.id]);
  }
  for (const image of images) {
    await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [candidate.id, image.url, image.is_primary, image.sort_order, image.slot_key, image.room_label]
    );
  }

  const importMeta = {
    at: new Date().toISOString(),
    actor_id: ACTOR_ID,
    image_count: images.length,
    source_urls: sourceUrls,
    consent_confirmed: true,
    image_rights_confirmed: true,
    append: APPEND
  };

  await client.query(
    `UPDATE properties
     SET
       extra_fields = COALESCE(extra_fields, '{}'::jsonb)
         || jsonb_build_object(
           'source_urls', $2::jsonb,
           'photo_source_urls', $2::jsonb,
           'image_rights_status', 'authorised_imported',
           'consent_confirmed', true,
           'image_rights_confirmed', true,
           'authorised_image_import', $3::jsonb
         ),
       updated_at = NOW()
     WHERE id = $1
       AND source = ANY($4::text[])`,
    [candidate.id, JSON.stringify(sourceUrls), JSON.stringify(importMeta), SOURCE_VALUES]
  );

  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, reason, notes, delivery
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      candidate.id,
      ACTOR_ID,
      'found_online_authorised_images_imported',
      candidate.status,
      candidate.status,
      'Imported authorised found-online photos and source evidence.',
      `Imported ${images.length} authorised image(s) for found-online review.`,
      JSON.stringify(importMeta)
    ]
  );

  return {
    property_id: candidate.id,
    inquiry_reference: candidate.inquiry_reference,
    title: candidate.title,
    images: images.length,
    source_urls: sourceUrls.length,
    dry_run: false
  };
}

async function main() {
  if (!FILE) {
    console.error(usage());
    process.exit(1);
  }
  if (!DRY_RUN && process.env.NODE_ENV === 'production' && !CONFIRM) {
    throw new Error('Refusing to write in production without --confirm');
  }
  if (!DRY_RUN && !CONFIRM_RIGHTS) {
    console.warn('Each row must include consent_confirmed=true and image_rights_confirmed=true. Use --confirm-rights only after legal/photo rights have been verified.');
  }

  const absoluteFile = path.resolve(FILE);
  const rows = readRows(absoluteFile);
  const client = await db.pool.connect();
  const imported = [];
  const failures = [];
  try {
    await client.query('BEGIN');
    for (const [index, row] of rows.entries()) {
      try {
        imported.push(await importRow(client, row, path.dirname(absoluteFile)));
      } catch (error) {
        failures.push({ row: index + 2, error: error.message });
      }
    }
    if (failures.length) {
      throw new Error(`${failures.length} row(s) failed validation`);
    }
    if (DRY_RUN) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(JSON.stringify({ ok: false, error: error.message, imported, failures }, null, 2));
    process.exit(1);
  } finally {
    client.release();
  }

  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    source: SOURCE,
    rows: rows.length,
    imported_count: imported.length,
    imported
  }, null, 2));
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

module.exports = {
  imagesFromRow,
  sourceUrlsFromRow,
  parseCsv,
  readRows
};
