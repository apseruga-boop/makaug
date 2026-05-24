#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const FILE = argValue('file');
const OUT_DIR = path.resolve(argValue('out', 'outputs/found-online-video-stills'));
const DRY_RUN = args.includes('--dry-run');
const CONFIRM_RIGHTS = args.includes('--confirm-rights');
const KEEP_VIDEO = args.includes('--keep-video');
const MAX_FRAMES_PER_LISTING = 8;

function usage() {
  return [
    'Usage:',
    '  node scripts/prepare-found-online-video-stills.js --file=source-videos.csv --out=outputs/found-online-video-stills --dry-run',
    '  node scripts/prepare-found-online-video-stills.js --file=source-videos.csv --out=outputs/found-online-video-stills --confirm-rights',
    '',
    'CSV/JSON fields:',
    '  property_id OR inquiry_reference OR title',
    '  youtube_url OR tiktok_url OR video_url OR source_url',
    '  timestamps: exterior=00:00:05|living room=00:00:18|kitchen=00:00:39',
    '  or image_1_time,image_1_label ... image_8_time,image_8_label',
    '',
    'The output CSV can be imported with:',
    '  npm run inventory:import-found-online-images -- --file=outputs/found-online-video-stills/found-online-image-import.csv --confirm --confirm-rights',
  ].join('\n');
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'found-online-video';
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
    if (char === '"') quoted = true;
    else if (char === ',') {
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
  const [headersRaw = [], ...dataRows] = rows.filter((item) => item.some((value) => clean(value)));
  const headers = headersRaw.map((header) => clean(header).toLowerCase());
  return dataRows.map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      if (header) out[header] = clean(values[index]);
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
    throw new Error('JSON must be an array or contain rows/listings');
  }
  return parseCsv(content);
}

function splitTimestampList(value) {
  return clean(value)
    .split(/\s*(?:\||\n|,)\s*/g)
    .map(clean)
    .filter(Boolean)
    .map((part) => {
      const [labelRaw, timeRaw] = part.includes('=')
        ? part.split('=')
        : part.split('@');
      return {
        label: clean(labelRaw),
        time: clean(timeRaw),
      };
    })
    .filter((item) => item.label && item.time);
}

function framesFromRow(row) {
  const frames = [];
  frames.push(...splitTimestampList(row.timestamps || row.frame_timestamps || row.video_timestamps));
  for (let i = 1; i <= MAX_FRAMES_PER_LISTING; i += 1) {
    const time = clean(row[`image_${i}_time`] || row[`frame_${i}_time`] || row[`timestamp_${i}`]);
    const label = clean(row[`image_${i}_label`] || row[`frame_${i}_label`] || row[`label_${i}`]);
    if (time && label) frames.push({ label, time });
  }
  const seen = new Set();
  return frames
    .filter((frame) => {
      const key = `${frame.label.toLowerCase()}|${frame.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FRAMES_PER_LISTING);
}

function videoUrlFromRow(row) {
  return clean(row.youtube_url || row.tiktok_url || row.video_url || row.source_url || row.original_url);
}

function commandExists(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureTools() {
  const missing = ['yt-dlp', 'ffmpeg'].filter((command) => !commandExists(command));
  if (missing.length) {
    throw new Error(`Missing required tool(s): ${missing.join(', ')}. Install them before extracting video frames.`);
  }
}

function csvEscape(value) {
  const text = clean(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(rows, filePath) {
  const maxImages = Math.max(1, ...rows.map((row) => row.images.length));
  const headers = [
    'property_id',
    'inquiry_reference',
    'title',
    'source_url',
    'source_urls',
    'consent_confirmed',
    'image_rights_confirmed',
  ];
  for (let i = 1; i <= maxImages; i += 1) {
    headers.push(`image_${i}`, `image_${i}_label`, `image_${i}_slot`);
  }
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = [
      row.property_id,
      row.inquiry_reference,
      row.title,
      row.source_url,
      row.source_url,
      'true',
      'true',
    ];
    for (let i = 0; i < maxImages; i += 1) {
      const image = row.images[i] || {};
      values.push(image.file || '', image.label || '', image.slot || '');
    }
    lines.push(values.map(csvEscape).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function extractFrames(row, rowIndex) {
  const videoUrl = videoUrlFromRow(row);
  if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com)\//i.test(videoUrl)) {
    throw new Error(`Row ${rowIndex}: youtube_url/tiktok_url/video_url must be a public YouTube or TikTok URL`);
  }
  const frames = framesFromRow(row);
  if (!frames.length) {
    throw new Error(`Row ${rowIndex}: add timestamps with labels, for example exterior=00:00:05|kitchen=00:00:39`);
  }
  const title = clean(row.title || row.inquiry_reference || row.property_id || `row-${rowIndex}`);
  const rowSlug = slugify(`${rowIndex}-${title}`);
  const rowDir = path.join(OUT_DIR, rowSlug);
  const tmpDir = path.join(OUT_DIR, '.tmp');
  const videoPath = path.join(tmpDir, `${rowSlug}.mp4`);
  if (!DRY_RUN) {
    fs.mkdirSync(rowDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    execFileSync('yt-dlp', [
      '--no-playlist',
      '-f',
      'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
      '-o',
      videoPath,
      videoUrl,
    ], { stdio: 'inherit' });
  }
  const images = frames.map((frame, index) => {
    const slot = slugify(frame.label);
    const file = path.join(rowDir, `${String(index + 1).padStart(2, '0')}-${slot}.jpg`);
    if (!DRY_RUN) {
      execFileSync('ffmpeg', [
        '-y',
        '-ss',
        frame.time,
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=min(1600\\,iw):-2',
        '-q:v',
        '3',
        file,
      ], { stdio: 'ignore' });
    }
    return {
      file,
      label: frame.label,
      slot,
      time: frame.time,
    };
  });
  if (!DRY_RUN && !KEEP_VIDEO) {
    fs.rmSync(videoPath, { force: true });
  }
  return {
    property_id: clean(row.property_id || row.id),
    inquiry_reference: clean(row.inquiry_reference || row.reference || row.ref),
    title,
    source_url: videoUrl,
    images,
  };
}

async function main() {
  if (!FILE) {
    console.error(usage());
    process.exit(1);
  }
  if (!DRY_RUN && !CONFIRM_RIGHTS) {
    throw new Error('Refusing to extract/import-ready frames without --confirm-rights. Confirm source/video image rights first.');
  }
  if (!DRY_RUN) ensureTools();
  const rows = readRows(FILE);
  const prepared = [];
  const failures = [];
  rows.forEach((row, index) => {
    try {
      prepared.push(extractFrames(row, index + 1));
    } catch (error) {
      failures.push({ row: index + 2, error: error.message });
    }
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifestPath = path.join(OUT_DIR, 'found-online-image-import.csv');
  if (!DRY_RUN && prepared.length) writeCsv(prepared, manifestPath);
  const result = {
    ok: failures.length === 0,
    dry_run: DRY_RUN,
    rows: rows.length,
    prepared_count: prepared.length,
    failures,
    manifest: DRY_RUN ? null : manifestPath,
    prepared: prepared.map((row) => ({
      title: row.title,
      source_url: row.source_url,
      frames: row.images.map((image) => ({ label: image.label, time: image.time })),
    })),
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  framesFromRow,
  readRows,
  extractFrames,
};
