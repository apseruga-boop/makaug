#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const {
  FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
  queueFoundOnlineSourcePostListings,
} = require('../services/socialSearchSourcedListingsService');

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function usage() {
  console.error([
    'Usage:',
    '  node scripts/import-found-online-source-posts.js --input posts.json --dry-run',
    '  node scripts/import-found-online-source-posts.js --input posts.csv --confirm',
    '  node scripts/import-found-online-source-posts.js --input tiktok-posts.csv --confirm',
    '',
    'Input fields accepted include:',
    '  post_url/source_url, source_page_url, source_key, source_name, platform, title, description,',
    '  first_posted_at/published_at/posted_at, district, area/location, price/price_text,',
    '  listing_type, bedrooms, bathrooms, image_urls, contact_phone, contact_email, source_contact_url,',
    '  source_visual_text/video_text/video_ocr_text/frame_text/image_text/screen_text/ocr_text,',
    '  pre_approved, consent_confirmed, image_rights_confirmed, permission_status',
    '',
    'TikTok minimum viable rows:',
    '  source_url/post_url must be the exact public TikTok video URL when available.',
    '  source_page_url can be the TikTok profile/contact path.',
    '  location or area is required before a property row is created.',
    '  missing price is accepted as Price upon application.',
    '  paste visible video-frame/OCR text into source_visual_text or video_ocr_text when the caption is sparse.',
    '  missing dates show as being confirmed and missing images use a labelled makaug evidence card.',
    '  pre-approval and image rights are kept as review metadata; King can override non-location checks at approval.',
  ].join('\n'));
}

function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => String(value || '').trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value || '').trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((values) => headers.reduce((acc, header, index) => {
    if (header) acc[header] = values[index] || '';
    return acc;
  }, {}));
}

function readPosts(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const text = fs.readFileSync(fullPath, 'utf8');
  if (/\.csv$/i.test(fullPath)) return parseCsv(text);
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.posts)) return parsed.posts;
  if (Array.isArray(parsed.items)) return parsed.items;
  throw new Error('JSON input must be an array, or an object with posts/items array.');
}

async function main() {
  const input = argValue('--input');
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  if (!input || (!dryRun && !confirm)) {
    usage();
    process.exit(2);
  }
  const posts = readPosts(input);
  const result = await queueFoundOnlineSourcePostListings({
    db,
    posts,
    dryRun,
    createProfilesForRepeatedSourcesOnly: false,
  });
  console.log(JSON.stringify({
    ok: true,
    batch_id: FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
    input,
    ...result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch (_) {}
  });
