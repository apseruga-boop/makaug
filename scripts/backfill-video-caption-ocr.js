#!/usr/bin/env node
'use strict';

// Read burned-in text from listing videos that are already stored and report
// where it disagrees with the caption or the listing. Dry-run is the default.
// This script never updates a listing. --publish-review-list only inserts rows
// into video_ocr_review_items so the admin list can show them.

require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  parseListingFacts,
  factsFromListing,
  conflictFacts,
  dedupeConflicts,
  captionTextFromProperty,
  videoUrlsFromProperty,
  ocrPropertyVideos,
  reportId
} = require('../services/videoCaptionOcrService');

const SELECTION_SQL = `
  SELECT p.id, p.status, p.title, p.inquiry_reference, p.area, p.district, p.price,
         p.price_original_currency, p.bedrooms, p.property_type, p.listing_type,
         p.land_size_value, p.land_size_unit, p.description, p.lister_phone,
         p.lister_name, p.extra_fields
    FROM properties p
   WHERE p.status IN ('pending', 'approved')
     AND (
       (jsonb_typeof(p.extra_fields->'video_urls') = 'array'
         AND jsonb_array_length(p.extra_fields->'video_urls') > 0)
       OR COALESCE(p.extra_fields->>'video_url', '') <> ''
     )
   ORDER BY p.created_at ASC`;

function parseArgs(argv = process.argv.slice(2)) {
  const outArg = argv.find((arg) => arg.startsWith('--out='));
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : 0;
  return {
    publishReviewList: argv.includes('--publish-review-list'),
    out: outArg ? outArg.slice('--out='.length) : '',
    limit: Number.isInteger(limit) && limit > 0 ? limit : 0,
    propertyIds: argv
      .filter((arg) => arg.startsWith('--property-id='))
      .map((arg) => arg.slice('--property-id='.length).trim())
      .filter(Boolean)
  };
}

function rowConflicts(property, videoFacts, ocrText = '') {
  const caption = captionTextFromProperty(property);
  const captionFacts = parseListingFacts(caption);
  const listingFacts = factsFromListing(property);
  const conflicts = dedupeConflicts([
    ...conflictFacts(videoFacts, captionFacts, 'caption'),
    ...conflictFacts(videoFacts, listingFacts, 'listing')
  ]);
  return {
    property_id: property.id,
    inquiry_reference: property.inquiry_reference || '',
    listing_status: property.status || '',
    lister_phone: property.lister_phone || '',
    lister_name: property.lister_name || '',
    title: property.title || '',
    video_url: videoUrlsFromProperty(property)[0] || '',
    caption_text: caption,
    ocr_text: ocrText,
    caption_facts: captionFacts,
    video_facts: videoFacts,
    listing_facts: listingFacts,
    conflicts,
    mismatch: conflicts.length > 0
  };
}

function reportFromRows(rows = []) {
  const mismatches = rows.filter((row) => row.mismatch);
  const unread = rows.filter((row) => row.ocr_status === 'ocr pending');
  return {
    dry_run: true,
    changes_listings: false,
    scanned: rows.length,
    mismatches: mismatches.length,
    unread: unread.length,
    items: mismatches
  };
}

function csvCell(value) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function reportToCsv(report) {
  const headers = [
    'property_id', 'inquiry_reference', 'listing_status', 'lister_phone', 'title',
    'video_url', 'caption_text', 'ocr_text', 'conflicts'
  ];
  const lines = [headers.join(',')];
  (report.items || []).forEach((item) => {
    lines.push(headers.map((key) => csvCell(item[key])).join(','));
  });
  return `${lines.join('\n')}\n`;
}

async function writeReport(report, outDir) {
  if (!outDir) return null;
  await fsp.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'video-caption-ocr-mismatches.json');
  const csvPath = path.join(outDir, 'video-caption-ocr-mismatches.csv');
  await fsp.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fsp.writeFile(csvPath, reportToCsv(report));
  return { jsonPath, csvPath };
}

async function publishReviewList(report, id) {
  const db = require('../config/database');
  for (const item of report.items || []) {
    await db.query(
      `INSERT INTO video_ocr_review_items (
         report_id, property_id, inquiry_reference, listing_status, video_url,
         caption_text, ocr_text, caption_facts, video_facts, listing_facts, conflicts
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)`,
      [
        id,
        item.property_id || null,
        item.inquiry_reference || null,
        item.listing_status || null,
        item.video_url || null,
        item.caption_text || null,
        item.ocr_text || null,
        JSON.stringify(item.caption_facts || {}),
        JSON.stringify(item.video_facts || {}),
        JSON.stringify(item.listing_facts || {}),
        JSON.stringify(item.conflicts || [])
      ]
    );
  }
  return { report_id: id, inserted: (report.items || []).length };
}

async function selectProperties(args) {
  const db = require('../config/database');
  if (args.propertyIds.length) {
    const result = await db.query(
      `${SELECTION_SQL.replace('ORDER BY p.created_at ASC', 'AND p.id = ANY($1::uuid[])\n   ORDER BY p.created_at ASC')}`,
      [args.propertyIds]
    );
    return result.rows;
  }
  const result = await db.query(SELECTION_SQL);
  return args.limit ? result.rows.slice(0, args.limit) : result.rows;
}

async function scanProperties(properties, { recognize } = {}) {
  const reader = recognize || ((property) => ocrPropertyVideos(property));
  const rows = [];
  for (const property of properties) {
    let text = '';
    try {
      const read = await reader(property);
      text = read?.text || '';
    } catch (error) {
      text = '';
      rows.push({
        ...rowConflicts(property, parseListingFacts(''), ''),
        mismatch: false,
        ocr_error: String(error.message || error).slice(0, 300),
        ocr_status: 'ocr pending'
      });
      continue;
    }
    rows.push(rowConflicts(property, parseListingFacts(text), text));
  }
  return rows;
}

async function main() {
  const args = parseArgs();
  const properties = await selectProperties(args);
  const rows = await scanProperties(properties);
  const report = reportFromRows(rows);
  report.dry_run = !args.publishReviewList;
  report.changes_listings = false;
  const files = await writeReport(report, args.out);
  let published = null;
  if (args.publishReviewList) {
    published = await publishReviewList(report, reportId());
  }
  process.stdout.write(`${JSON.stringify({ ...report, files, published }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SELECTION_SQL,
  parseArgs,
  rowConflicts,
  reportFromRows,
  reportToCsv,
  writeReport,
  publishReviewList,
  scanProperties
};
