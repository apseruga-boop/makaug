'use strict';

/**
 * Read burned-in text from a WhatsApp listing video and compare it with the
 * caption and the listing. Runs only after the video file is already stored.
 * It does not send WhatsApp messages, touch sessions, webhooks, or Render
 * settings.
 *
 * CPU and memory (shared 0.5 CPU web container):
 *   - one listing at a time, ffmpeg under nice -n 19 on one thread
 *   - one frame every 2 seconds, at most 20, then near-duplicate frames dropped
 *   - frames scaled to 800px before OCR
 *   - whole job budget VIDEO_OCR_TIMEOUT_MS (45s). On timeout the row is
 *     marked "ocr pending" and approval is not blocked
 *   - tesseract CLI when it is installed, otherwise tesseract.js
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const logger = require('../config/logger');

const OCR_PENDING = 'ocr pending';
const STATUS_PENDING = 'pending';
const STATUS_DONE = 'done';
const FRAME_INTERVAL_SECONDS = 2;
const MAX_FRAMES = 20;
const MAX_VIDEOS = 2;
const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
const JOB_TIMEOUT_MS = () => Math.max(8000, parseInt(process.env.VIDEO_OCR_TIMEOUT_MS || '45000', 10) || 45000);
const FRAME_TIMEOUT_MS = () => Math.max(2000, parseInt(process.env.VIDEO_OCR_FRAME_TIMEOUT_MS || '8000', 10) || 8000);
const PRICE_TOLERANCE = 0.1;
const USD_TO_UGX = 3800;
const MIN_OVERRIDE_REASON = 8;

const queue = [];
const queued = new Set();
let draining = false;
const liveChildren = new Set();

function database() {
  return require('../config/database');
}

function locationResolver() {
  return require('../utils/locationRegistry');
}

function niceBinary() {
  return ['/usr/bin/nice', '/bin/nice'].find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_) {
      return false;
    }
  }) || '';
}

function ffmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bin = require('ffmpeg-static');
    if (bin) return bin;
  } catch (_) { /* system ffmpeg */ }
  return 'ffmpeg';
}

function killLiveChildren() {
  for (const child of liveChildren) {
    try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
  }
  liveChildren.clear();
}

function runProcess(file, args, { timeoutMs = 15000, env = null } = {}) {
  return new Promise((resolve, reject) => {
    const nice = niceBinary();
    const useNice = Boolean(nice) && /ffmpeg|tesseract/i.test(path.basename(file));
    const command = useNice ? nice : file;
    const commandArgs = useNice ? ['-n', '19', file, ...args] : args;
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OMP_THREAD_LIMIT: '1', ...(env || {}) }
    });
    liveChildren.add(child);
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      finish(Object.assign(new Error('process timed out'), { code: 'OCR_TIMEOUT' }));
    }, timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveChildren.delete(child);
      if (error) reject(error);
      else resolve(value);
    };
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        const error = new Error(`${path.basename(file)} exited ${code}: ${err.slice(0, 300)}`);
        error.code = code;
        error.stdout = out;
        error.stderr = err;
        finish(error);
        return;
      }
      finish(null, { stdout: out, stderr: err });
    });
  });
}

function stripPhones(value = '') {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?:\+?256|0)\s*7\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, ' ')
    .replace(/\bMK-\d{8}-[0-9A-F]{6}\b/gi, ' ');
}

function roundMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function magnitudeMultiplier(word = '') {
  const token = String(word || '').toLowerCase();
  if (token === 'b' || token === 'bn' || token === 'billion') return 1_000_000_000;
  if (token === 'm' || token === 'mn' || token === 'million' || token === 'millions') return 1_000_000;
  return 1;
}

function currencyFromToken(token = '') {
  const value = String(token || '').toLowerCase();
  if (!value) return null;
  if (value === '$' || value === 'usd' || value === 'us$') return 'USD';
  return 'UGX';
}

function magnitudeNumber(raw = '') {
  const value = String(raw || '').replace(/[ \t]/g, '');
  const comma = value.match(/^([0-9]+),([0-9]+)$/);
  if (comma) return Number(comma[2].length === 3 ? `${comma[1]}${comma[2]}` : `${comma[1]}.${comma[2]}`);
  return Number(value.replace('\u00b7', '.'));
}

function parsePrices(text = '') {
  const source = stripPhones(text);
  const found = [];
  // 27 Oct 2026 (MK-…A64E8E): video text read "UGX 1.4 billion" as
  // "UGX 1,4 billion" / "1. 4 billion", and the reader kept only "4 billion".
  // A comma, middle dot or spaced point between digits is a decimal point,
  // except a comma followed by exactly three digits (thousands: 1,400 million).
  const withMagnitude = /(?:(usd|us\$|\$|ugx|ush|ugshs|shs)\s*)?([0-9]+(?:(?:[ \t]*[.\u00b7][ \t]*|,)[0-9]+)?)\s*(billion|bn|million|millions|mn|m)\b/gi;
  let match = withMagnitude.exec(source);
  while (match) {
    const amount = roundMoney(magnitudeNumber(match[2]) * magnitudeMultiplier(match[3]));
    if (amount && amount >= 1000) {
      found.push({ amount, currency: currencyFromToken(match[1]) || 'UGX' });
    }
    match = withMagnitude.exec(source);
  }
  const plain = /(?:(usd|us\$|\$|ugx|ush|ugshs|shs)\s+)([0-9][0-9,]*(?:\.[0-9]+)?)\b(?![ \t]*[.,\u00b7]?[ \t]*[0-9]*\s*(?:billion|bn|million|millions|mn|m)\b)/gi;
  match = plain.exec(source);
  while (match) {
    const amount = roundMoney(String(match[2]).replace(/,/g, ''));
    if (amount && amount >= 1000) found.push({ amount, currency: currencyFromToken(match[1]) || 'UGX' });
    match = plain.exec(source);
  }
  return found;
}

function choosePrice(prices = []) {
  if (!prices.length) return { price: null, currency: null };
  const counts = new Map();
  prices.forEach((item) => {
    const key = `${item.currency}:${item.amount}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let best = prices[0];
  let bestCount = 0;
  prices.forEach((item) => {
    const count = counts.get(`${item.currency}:${item.amount}`) || 0;
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  });
  // 27 Oct 2026 (MK-…A64E8E): OCR of "UGX 1.4 billion" gave "4 billion" once
  // and "14 billion" once, and the first fragment won. When different amounts
  // are read equally often the price is unknown, not the first one seen.
  const tied = [...counts.entries()].some(([key, count]) => (
    count === bestCount && key !== `${best.currency}:${best.amount}`
  ));
  if (tied) return { price: null, currency: null, ambiguous: true };
  return { price: best.amount, currency: best.currency };
}

function firstNumber(text, pattern) {
  const match = String(text || '').match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parsePropertyKind(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/\b(apartment|flat|condo)s?\b/.test(lower)) return 'apartment';
  if (/\b(warehouse|office|shop|retail|commercial)\b/.test(lower)) return 'commercial';
  if (/\b(house|home|bungalow|villa|mansion|duplex)\b/.test(lower)) return 'house';
  if (/\b(land|plot|acre|acres|decimal|decimals)\b/.test(lower)) return 'land';
  return null;
}

function parseLocation(text = '') {
  const value = String(text || '').trim();
  if (!value) return null;
  try {
    const resolved = locationResolver().resolveCanonicalUgandaLocationFromText(value);
    if (resolved?.status === 'matched' && resolved.match?.name) {
      return {
        name: resolved.match.name,
        district: resolved.match.district || null,
        key: resolved.match.key || null,
        level: resolved.match.level || null
      };
    }
  } catch (error) {
    logger.warn('Video caption location parse skipped', { error: error.message });
  }
  return null;
}

function parseListingFacts(text = '') {
  const source = String(text || '');
  const price = choosePrice(parsePrices(source));
  const acres = firstNumber(source, /(\d+(?:\.\d+)?)\s*acres?\b/i);
  const decimals = firstNumber(source, /(\d+(?:\.\d+)?)\s*decimals?\b/i);
  const sqm = firstNumber(source, /(\d+(?:\.\d+)?)\s*(?:sqm|sq\.?\s*m|square\s*met(?:re|er)s?)\b/i);
  const beds = firstNumber(source, /(\d+)\s*[- ]?\s*(?:bed\s*rooms?|bedrooms?|beds?|bdrm)\b/i);
  const location = parseLocation(source);
  const type = parsePropertyKind(source);
  return {
    price: price.price,
    currency: price.currency,
    acres,
    decimals,
    sqm,
    beds,
    location,
    type
  };
}

function acresOf(facts = {}) {
  if (Number(facts.acres) > 0) return Number(facts.acres);
  if (Number(facts.decimals) > 0) return Number(facts.decimals) / 100;
  if (Number(facts.sqm) > 0) return Number(facts.sqm) / 4046.86;
  return null;
}

function normPlace(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function locationsCompatible(video, other) {
  if (!video?.name || !other?.name) return true;
  if (video.key && other.key && video.key === other.key) return true;
  const left = normPlace(video.name);
  const right = normPlace(other.name);
  if (!left || !right) return true;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  if (video.district && normPlace(video.district) === right) return true;
  if (other.district && normPlace(other.district) === left) return true;
  return false;
}

function priceInUgx(facts = {}) {
  const amount = Number(facts.price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return String(facts.currency || 'UGX').toUpperCase() === 'USD' ? amount * USD_TO_UGX : amount;
}

function formatPrice(facts = {}) {
  if (!facts?.price) return '';
  const currency = facts.currency || 'UGX';
  return `${currency} ${Number(facts.price).toLocaleString('en-UG')}`;
}

function formatSize(facts = {}) {
  if (Number(facts.acres) > 0) return `${facts.acres} acres`;
  if (Number(facts.decimals) > 0) return `${facts.decimals} decimals`;
  if (Number(facts.sqm) > 0) return `${facts.sqm} sqm`;
  if (Number(facts.beds) > 0) return `${facts.beds} bedrooms`;
  return '';
}

function pricesConflict(video, other) {
  const left = priceInUgx(video);
  const right = priceInUgx(other);
  if (!left || !right) return null;
  const diff = Math.abs(left - right);
  if (diff <= Math.max(1000, Math.max(left, right) * PRICE_TOLERANCE)) return null;
  return { video: formatPrice(video), other: formatPrice(other) };
}

function closeAcres(left, right) {
  const diff = Math.abs(left - right);
  return diff <= Math.max(0.05, Math.max(left, right) * PRICE_TOLERANCE);
}

function sizeConflict(video, other) {
  const videoAcres = acresOf(video);
  const otherAcres = acresOf(other);
  if (videoAcres && otherAcres) {
    if (!closeAcres(videoAcres, otherAcres)) {
      return { video: formatSize({ acres: Number(videoAcres.toFixed(2)) }), other: formatSize({ acres: Number(otherAcres.toFixed(2)) }) };
    }
    return null;
  }
  if (video.beds && other.beds && Number(video.beds) !== Number(other.beds)) {
    return { video: `${video.beds} bedrooms`, other: `${other.beds} bedrooms` };
  }
  if (videoAcres && other.beds && !otherAcres) {
    return { video: formatSize(video), other: `${other.beds} bedrooms` };
  }
  if (video.beds && otherAcres && !videoAcres && !other.beds) {
    return { video: `${video.beds} bedrooms`, other: formatSize(other) };
  }
  return null;
}

function typesCompatible(videoType, otherType) {
  if (!videoType || !otherType) return true;
  return videoType === otherType;
}

function conflictFacts(videoFacts = {}, otherFacts = {}, against = 'caption') {
  const conflicts = [];
  const push = (dimension, video, other) => {
    if (!video || !other) return;
    conflicts.push({
      dimension,
      against,
      video: String(video),
      other: String(other),
      message: `${dimension[0].toUpperCase()}${dimension.slice(1)}: video says ${video} but the ${against} says ${other}.`
    });
  };
  if (videoFacts.location?.name && otherFacts.location?.name && !locationsCompatible(videoFacts.location, otherFacts.location)) {
    push('location', videoFacts.location.name, otherFacts.location.name);
  }
  const price = pricesConflict(videoFacts, otherFacts);
  if (price) push('price', price.video, price.other);
  const size = sizeConflict(videoFacts, otherFacts);
  if (size) push('size', size.video, size.other);
  if (!typesCompatible(videoFacts.type, otherFacts.type)) push('type', videoFacts.type, otherFacts.type);
  return conflicts;
}

function dedupeConflicts(conflicts = []) {
  const seen = new Set();
  return conflicts.filter((item) => {
    const key = `${item.dimension}:${item.against}:${item.video}:${item.other}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function listingRecord(property = {}) {
  const extra = property.extra_fields && typeof property.extra_fields === 'object' ? property.extra_fields : {};
  return { ...property, extra_fields: extra };
}

function factsFromListing(property = {}) {
  const row = listingRecord(property);
  const parsed = parseListingFacts([
    row.title,
    row.description,
    row.area,
    row.address,
    row.property_type
  ].filter(Boolean).join('\n'));
  const columnPrice = Number(row.price);
  const price = Number.isFinite(columnPrice) && columnPrice > 1 ? columnPrice : parsed.price;
  const currency = row.price_original_currency || row.extra_fields.price_original_currency || parsed.currency || (price ? 'UGX' : null);
  const bedrooms = row.bedrooms === null || row.bedrooms === undefined || row.bedrooms === ''
    ? parsed.beds
    : Number(row.bedrooms);
  let acres = parsed.acres;
  const landValue = Number(row.land_size_value);
  const landUnit = String(row.land_size_unit || '').toLowerCase();
  if (Number.isFinite(landValue) && landValue > 0) {
    if (landUnit.includes('decimal')) acres = landValue / 100;
    else if (!landUnit || landUnit.includes('acre')) acres = landValue;
  }
  const columnKind = parsePropertyKind(row.property_type || '');
  const type = columnKind
    || (String(row.listing_type || '').toLowerCase() === 'land' ? 'land' : null)
    || parsed.type;
  const location = parseLocation(row.area || '') || (row.area ? {
    name: row.area,
    district: row.district || null,
    key: null,
    level: 'area'
  } : parsed.location);
  return {
    price: price || null,
    currency: currency ? String(currency).toUpperCase() : null,
    acres: acres || null,
    decimals: parsed.decimals,
    sqm: parsed.sqm,
    beds: Number.isFinite(bedrooms) ? bedrooms : null,
    location,
    type
  };
}

function captionTextFromProperty(property = {}) {
  const extra = listingRecord(property).extra_fields;
  return String(extra.source_caption_display || extra.source_caption || extra.caption || '').trim();
}

function videoUrlsFromProperty(property = {}) {
  const extra = listingRecord(property).extra_fields;
  const values = [
    ...(Array.isArray(extra.video_urls) ? extra.video_urls : []),
    extra.video_url
  ];
  return [...new Set(values.map((value) => String(value || '').trim()).filter((value) => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }))].slice(0, MAX_VIDEOS);
}

function hasVideoFacts(facts = {}) {
  return Boolean(facts?.price || facts?.location?.name || facts?.type || facts?.beds || acresOf(facts));
}

// Facts from the stored video text, read with today's parser, so a parser fix
// also corrects records read before it (stored parsed_facts can be stale).
function videoFactsForRecord(record = null) {
  if (!record) return {};
  const text = String(record.ocr_text || record.text || '').trim();
  if (text) return parseListingFacts(text);
  return record.parsed_facts || record.facts || {};
}

function decideVideoCaptionApproval({
  record = null,
  property = {},
  overrideRequested = false,
  overrideReason = ''
} = {}) {
  if (!record || record.status !== STATUS_DONE) return { blocked: false, conflicts: [] };
  if (record.override?.reason || record.resolution?.kind) return { blocked: false, conflicts: [] };
  const videoFacts = videoFactsForRecord(record);
  if (!hasVideoFacts(videoFacts)) return { blocked: false, conflicts: [] };
  const captionFacts = parseListingFacts(captionTextFromProperty(property));
  const listingFacts = factsFromListing(property);
  const listingConflicts = conflictFacts(videoFacts, listingFacts, 'listing');
  const captionConflicts = conflictFacts(videoFacts, captionFacts, 'caption');
  const conflicts = dedupeConflicts([...listingConflicts, ...captionConflicts]);
  if (!listingConflicts.length) {
    return {
      blocked: false,
      conflicts: [],
      caption_conflicts: captionConflicts,
      cleared_by_edit: conflicts.length > 0 || (Array.isArray(record.conflicts) && record.conflicts.length > 0),
      persist: (Array.isArray(record.conflicts) && record.conflicts.length) || captionConflicts.length
        ? { kind: 'listing_edit' }
        : null
    };
  }
  const reason = String(overrideReason || '').replace(/\s+/g, ' ').trim();
  if (overrideRequested && reason.length >= MIN_OVERRIDE_REASON) {
    return {
      blocked: false,
      conflicts,
      override: { reason, at: new Date().toISOString() },
      persist: { kind: 'override', reason }
    };
  }
  return { blocked: conflicts.length > 0, conflicts, caption_conflicts: captionConflicts, listing_conflicts: listingConflicts };
}

function sampleTimestamps(durationSeconds, { interval = FRAME_INTERVAL_SECONDS, maxFrames = MAX_FRAMES } = {}) {
  const duration = Number(durationSeconds);
  const step = Number(interval) > 0 ? Number(interval) : FRAME_INTERVAL_SECONDS;
  const cap = Math.max(1, Math.min(30, Number(maxFrames) || MAX_FRAMES));
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const times = [];
  let cursor = Math.min(0.4, Math.max(0, duration / 2));
  while (times.length < cap && cursor < duration) {
    times.push(Math.round(Math.min(cursor, Math.max(0, duration - 0.05)) * 100) / 100);
    cursor += step;
  }
  return [...new Set(times)];
}

function hammingDistance(left = '', right = '') {
  if (!left || !right || left.length !== right.length) return 1;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) distance += left[index] === right[index] ? 0 : 1;
  return distance / left.length;
}

function dedupeFrameHashes(frames = [], minimumDistance = 0.08) {
  const kept = [];
  frames.forEach((frame) => {
    if (!frame) return;
    if (!frame.hash) {
      kept.push(frame);
      return;
    }
    const near = kept.some((item) => item.hash && hammingDistance(item.hash, frame.hash) < minimumDistance);
    if (!near) kept.push(frame);
  });
  return kept.slice(0, MAX_FRAMES);
}

function combineOcrText(parts = []) {
  const seen = new Set();
  const lines = [];
  parts.forEach((part) => {
    String(part || '').split(/\n+/).forEach((line) => {
      const clean = line.replace(/\s+/g, ' ').trim();
      if (clean.length < 2) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(clean);
    });
  });
  return lines.join('\n').slice(0, 12000);
}

function publicOcrView(record = null) {
  if (!record) return null;
  return {
    status: record.status || STATUS_PENDING,
    text: record.ocr_text || record.text || '',
    facts: videoFactsForRecord(record),
    conflicts: Array.isArray(record.conflicts) ? record.conflicts : [],
    override: record.override || null,
    resolution: record.resolution || null,
    error: record.error || null,
    frame_count: record.frame_count || null,
    updated_at: record.updated_at || null
  };
}

function extraPatch(record) {
  return {
    video_caption_ocr: publicOcrView(record)
  };
}

async function saveVideoCaptionRecord(propertyId, record) {
  const db = database();
  const facts = JSON.stringify(record.parsed_facts || {});
  const conflicts = JSON.stringify(record.conflicts || []);
  const override = record.override ? JSON.stringify(record.override) : null;
  const resolution = record.resolution ? JSON.stringify(record.resolution) : null;
  try {
    await db.query(
      `INSERT INTO property_video_ocr (
         property_id, status, ocr_text, parsed_facts, conflicts, override, resolution,
         frame_count, video_count, error, updated_at
       ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,NOW())
       ON CONFLICT (property_id) DO UPDATE SET
         status = EXCLUDED.status,
         ocr_text = EXCLUDED.ocr_text,
         parsed_facts = EXCLUDED.parsed_facts,
         conflicts = EXCLUDED.conflicts,
         override = EXCLUDED.override,
         resolution = EXCLUDED.resolution,
         frame_count = EXCLUDED.frame_count,
         video_count = EXCLUDED.video_count,
         error = EXCLUDED.error,
         updated_at = NOW()`,
      [
        propertyId,
        record.status,
        record.ocr_text || null,
        facts,
        conflicts,
        override,
        resolution,
        record.frame_count || null,
        record.video_count || null,
        record.error || null
      ]
    );
  } catch (error) {
    if (error.code !== '42P01') {
      logger.warn('Video caption OCR table write failed', { property_id: propertyId, error: error.message });
    }
  }
  await db.query(
    `UPDATE properties
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb
      WHERE id = $1`,
    [propertyId, JSON.stringify(extraPatch({ ...record, updated_at: new Date().toISOString() }))]
  );
}

async function loadVideoCaptionRecord(property = {}) {
  const extra = listingRecord(property).extra_fields.video_caption_ocr;
  if (!property.id) return extra || null;
  try {
    const result = await database().query(
      `SELECT property_id, status, ocr_text, parsed_facts, conflicts, override, resolution,
              frame_count, video_count, error, updated_at
         FROM property_video_ocr
        WHERE property_id = $1`,
      [property.id]
    );
    if (result.rows[0]) {
      const row = result.rows[0];
      return {
        status: row.status,
        ocr_text: row.ocr_text,
        parsed_facts: row.parsed_facts || {},
        conflicts: row.conflicts || [],
        override: row.override || null,
        resolution: row.resolution || null,
        frame_count: row.frame_count,
        video_count: row.video_count,
        error: row.error,
        updated_at: row.updated_at
      };
    }
  } catch (error) {
    if (error.code !== '42P01') {
      logger.warn('Video caption OCR lookup skipped', { property_id: property.id, error: error.message });
    }
  }
  if (!extra || typeof extra !== 'object') return null;
  return {
    status: extra.status,
    ocr_text: extra.text || '',
    parsed_facts: extra.facts || {},
    conflicts: extra.conflicts || [],
    override: extra.override || null,
    resolution: extra.resolution || null,
    error: extra.error || null,
    frame_count: extra.frame_count || null,
    updated_at: extra.updated_at || null
  };
}

async function evaluateVideoCaptionApproval(property, { overrideRequested = false, overrideReason = '' } = {}) {
  const record = await loadVideoCaptionRecord(property);
  return decideVideoCaptionApproval({ record, property, overrideRequested, overrideReason });
}

async function persistVideoCaptionResolution(propertyId, decision, actorId) {
  if (!decision?.persist || !propertyId) return;
  const resolution = {
    kind: decision.persist.kind,
    at: new Date().toISOString(),
    actor_id: actorId || null,
    reason: decision.persist.reason || null
  };
  const override = decision.override
    ? { ...decision.override, actor_id: actorId || null }
    : null;
  try {
    const db = database();
    await db.query(
      `UPDATE property_video_ocr
          SET conflicts = '[]'::jsonb,
              override = $2::jsonb,
              resolution = $3::jsonb,
              updated_at = NOW()
        WHERE property_id = $1`,
      [propertyId, override ? JSON.stringify(override) : null, JSON.stringify(resolution)]
    );
    await db.query(
      `UPDATE properties
          SET extra_fields = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    COALESCE(extra_fields, '{}'::jsonb),
                    '{video_caption_ocr,conflicts}',
                    '[]'::jsonb,
                    true
                  ),
                  '{video_caption_ocr,override}',
                  COALESCE($2::jsonb, 'null'::jsonb),
                  true
                ),
                '{video_caption_ocr,resolution}',
                $3::jsonb,
                true
              )
        WHERE id = $1`,
      [propertyId, override ? JSON.stringify(override) : null, JSON.stringify(resolution)]
    );
  } catch (error) {
    logger.warn('Video caption OCR resolution was not stored', { property_id: propertyId, error: error.message });
  }
}

const LIVE_CONFLICT_SQL = `
  SELECT p.id, p.inquiry_reference, p.status, p.title, p.area, p.district, p.price,
         p.lister_name, p.lister_phone, p.source,
         o.status AS ocr_status, o.ocr_text, o.parsed_facts, o.conflicts, o.updated_at
    FROM property_video_ocr o
    JOIN properties p ON p.id = o.property_id
   WHERE p.status IN ('pending', 'approved')
     AND o.override IS NULL
     AND o.resolution IS NULL
     AND jsonb_typeof(o.conflicts) = 'array'
     AND jsonb_array_length(o.conflicts) > 0
   ORDER BY o.updated_at DESC
   LIMIT 200`;

const BACKFILL_LIST_SQL = `
  SELECT id, report_id, property_id, inquiry_reference, listing_status, video_url,
         caption_text, ocr_text, caption_facts, video_facts, listing_facts, conflicts, created_at
    FROM video_ocr_review_items
   ORDER BY created_at DESC
   LIMIT 200`;

function mapLiveConflict(row) {
  return {
    source: 'import',
    id: row.id,
    inquiry_reference: row.inquiry_reference,
    status: row.status,
    title: row.title,
    area: row.area,
    district: row.district,
    price: row.price,
    lister_name: row.lister_name,
    lister_phone: row.lister_phone,
    listing_source: row.source,
    ocr_status: row.ocr_status,
    ocr_text: row.ocr_text,
    facts: row.parsed_facts || {},
    conflicts: row.conflicts || [],
    updated_at: row.updated_at
  };
}

function mapBackfillItem(row) {
  return {
    source: 'backfill',
    id: row.property_id,
    report_id: row.report_id,
    inquiry_reference: row.inquiry_reference,
    status: row.listing_status,
    video_url: row.video_url,
    caption_text: row.caption_text,
    ocr_text: row.ocr_text,
    caption_facts: row.caption_facts || {},
    video_facts: row.video_facts || {},
    listing_facts: row.listing_facts || {},
    conflicts: row.conflicts || [],
    created_at: row.created_at
  };
}

async function listVideoCaptionConflicts() {
  const db = database();
  try {
    const [live, backfill] = await Promise.all([
      db.query(LIVE_CONFLICT_SQL),
      db.query(BACKFILL_LIST_SQL)
    ]);
    return {
      items: live.rows.map(mapLiveConflict),
      backfill_items: backfill.rows.map(mapBackfillItem)
    };
  } catch (error) {
    if (error.code === '42P01') return { items: [], backfill_items: [], warning: 'migration_161_not_applied' };
    throw error;
  }
}

function parseDuration(stderr = '') {
  const match = String(stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

async function videoDurationSeconds(videoPath) {
  try {
    await runProcess(ffmpegBinary(), ['-hide_banner', '-i', videoPath], { timeoutMs: 8000 });
    return 0;
  } catch (error) {
    return parseDuration(`${error.stdout || ''}\n${error.stderr || ''}`);
  }
}

async function extractFrame(videoPath, framePath, seconds) {
  await runProcess(ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-threads', '1',
    '-ss', String(seconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', "scale='min(800,iw)':-2",
    '-q:v', '5',
    framePath
  ], { timeoutMs: FRAME_TIMEOUT_MS() });
  const stat = await fsp.stat(framePath);
  if (!stat.size) throw new Error('ffmpeg produced an empty frame');
}

async function frameHash(framePath) {
  try {
    const sharp = require('sharp');
    const pixels = await sharp(framePath).rotate().resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
    const values = [...pixels];
    const mean = values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
    return values.map((value) => (value >= mean ? '1' : '0')).join('');
  } catch (_) {
    const stat = await fsp.stat(framePath);
    return `size:${stat.size}`;
  }
}

let tesseractCli = null;
async function tesseractCliAvailable() {
  if (tesseractCli !== null) return tesseractCli;
  const binary = process.env.TESSERACT_PATH || 'tesseract';
  try {
    await runProcess(binary, ['--version'], { timeoutMs: 4000 });
    tesseractCli = binary;
  } catch (_) {
    tesseractCli = '';
  }
  return tesseractCli;
}

async function recognizeWithCli(imagePath, binary) {
  const result = await runProcess(binary, [imagePath, 'stdout', '-l', 'eng', '--psm', '6', '--oem', '1'], {
    timeoutMs: FRAME_TIMEOUT_MS()
  });
  return result.stdout || '';
}

let jsWorker = null;
async function recognizeWithTesseractJs(imagePath) {
  const { createWorker } = require('tesseract.js');
  if (!jsWorker) {
    jsWorker = await createWorker('eng', 1, {
      cachePath: path.join(os.tmpdir(), 'makaug-tesseract'),
      errorHandler: () => {}
    });
    await jsWorker.setParameters({ tessedit_pageseg_mode: '6' });
  }
  const result = await jsWorker.recognize(imagePath);
  return result?.data?.text || '';
}

async function terminateJsWorker() {
  if (!jsWorker) return;
  const worker = jsWorker;
  jsWorker = null;
  try { await worker.terminate(); } catch (_) { /* worker already gone */ }
}

async function recognizeFrame(imagePath) {
  const cli = await tesseractCliAvailable();
  if (cli) return recognizeWithCli(imagePath, cli);
  return recognizeWithTesseractJs(imagePath);
}

async function downloadVideo(url, outputPath, signal) {
  const response = await fetch(url, { redirect: 'follow', signal });
  if (!response.ok || !response.body) throw new Error(`video download failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('video is too large to OCR on this server');
  let received = 0;
  const limiter = new (require('stream').Transform)({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) {
        callback(new Error('video is too large to OCR on this server'));
        return;
      }
      callback(null, chunk);
    }
  });
  const webBody = typeof Readable.fromWeb === 'function' ? Readable.fromWeb(response.body) : response.body;
  await pipeline(webBody, limiter, fs.createWriteStream(outputPath));
  if (!received) throw new Error('video download returned no bytes');
}

async function ocrVideoFile(videoPath, { signal, deadline } = {}) {
  const duration = await videoDurationSeconds(videoPath);
  const timestamps = duration > 0 ? sampleTimestamps(duration) : sampleTimestamps(MAX_FRAMES * FRAME_INTERVAL_SECONDS);
  const frames = [];
  const dir = path.dirname(videoPath);
  for (let index = 0; index < timestamps.length; index += 1) {
    if (signal?.aborted || (deadline && Date.now() > deadline)) {
      const error = new Error('ocr timed out');
      error.code = 'OCR_TIMEOUT';
      throw error;
    }
    const framePath = path.join(dir, `frame-${index}.jpg`);
    try {
      await extractFrame(videoPath, framePath, timestamps[index]);
      const hash = await frameHash(framePath);
      frames.push({ path: framePath, hash, at: timestamps[index] });
    } catch (error) {
      if (error.code === 'OCR_TIMEOUT') throw error;
    }
  }
  const distinct = dedupeFrameHashes(frames);
  const texts = [];
  for (const frame of distinct) {
    if (signal?.aborted || (deadline && Date.now() > deadline)) {
      const error = new Error('ocr timed out');
      error.code = 'OCR_TIMEOUT';
      throw error;
    }
    try {
      texts.push(await recognizeFrame(frame.path));
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' || /cannot find module/i.test(error.message || '')) {
        const missing = new Error('tesseract_unavailable');
        missing.code = 'OCR_ENGINE_UNAVAILABLE';
        throw missing;
      }
      if (error.code === 'OCR_TIMEOUT') throw error;
    }
  }
  return { text: combineOcrText(texts), frameCount: distinct.length };
}

async function ocrPropertyVideos(property, { signal, deadline } = {}) {
  const urls = videoUrlsFromProperty(property);
  if (!urls.length) return { text: '', frameCount: 0, videoCount: 0 };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'makaug-video-ocr-'));
  const texts = [];
  let frames = 0;
  try {
    for (let index = 0; index < urls.length; index += 1) {
      const videoPath = path.join(dir, `video-${index}.mp4`);
      await downloadVideo(urls[index], videoPath, signal);
      const result = await ocrVideoFile(videoPath, { signal, deadline });
      if (result.text) texts.push(result.text);
      frames += result.frameCount;
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    await terminateJsWorker();
  }
  return { text: combineOcrText(texts), frameCount: frames, videoCount: urls.length };
}

async function runVideoCaptionOcr(propertyId) {
  const started = Date.now();
  const deadline = started + JOB_TIMEOUT_MS();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS());
  try {
    const result = await database().query(
      `SELECT id, title, description, area, district, price, price_original_currency,
              bedrooms, property_type, listing_type, land_size_value, land_size_unit,
              extra_fields
         FROM properties
        WHERE id = $1`,
      [propertyId]
    );
    const property = result.rows[0];
    if (!property || !videoUrlsFromProperty(property).length) return;
    await saveVideoCaptionRecord(propertyId, {
      status: STATUS_PENDING,
      ocr_text: '',
      parsed_facts: {},
      conflicts: [],
      error: null
    });
    const read = await ocrPropertyVideos(property, { signal: controller.signal, deadline });
    if (controller.signal.aborted || Date.now() > deadline) {
      await saveVideoCaptionRecord(propertyId, {
        status: OCR_PENDING,
        ocr_text: read.text || '',
        parsed_facts: {},
        conflicts: [],
        error: 'timeout',
        frame_count: read.frameCount,
        video_count: read.videoCount
      });
      return;
    }
    if (!read.frameCount) {
      await saveVideoCaptionRecord(propertyId, {
        status: OCR_PENDING,
        ocr_text: '',
        parsed_facts: {},
        conflicts: [],
        error: 'no_frames',
        frame_count: 0,
        video_count: read.videoCount
      });
      return;
    }
    const facts = parseListingFacts(read.text);
    const captionFacts = parseListingFacts(captionTextFromProperty(property));
    const listingFacts = factsFromListing(property);
    const conflicts = hasVideoFacts(facts)
      ? dedupeConflicts([
        ...conflictFacts(facts, captionFacts, 'caption'),
        ...conflictFacts(facts, listingFacts, 'listing')
      ])
      : [];
    await saveVideoCaptionRecord(propertyId, {
      status: STATUS_DONE,
      ocr_text: read.text,
      parsed_facts: facts,
      conflicts,
      error: null,
      frame_count: read.frameCount,
      video_count: read.videoCount
    });
  } catch (error) {
    const timedOut = error.code === 'OCR_TIMEOUT' || controller.signal.aborted || /timed out/i.test(error.message || '');
    try {
      await saveVideoCaptionRecord(propertyId, {
        status: OCR_PENDING,
        ocr_text: '',
        parsed_facts: {},
        conflicts: [],
        error: timedOut ? 'timeout' : String(error.message || error).slice(0, 300)
      });
    } catch (saveError) {
      logger.warn('Video caption OCR could not record its pending state', {
        property_id: propertyId,
        error: saveError.message
      });
    }
  } finally {
    clearTimeout(timer);
    killLiveChildren();
    await terminateJsWorker();
  }
}

function scheduleVideoCaptionOcr(propertyId) {
  try {
    const id = String(propertyId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    if (queued.has(id)) return false;
    queued.add(id);
    queue.push(id);
    setImmediate(() => {
      drainQueue().catch((error) => {
        logger.warn('Video caption OCR queue failed', { error: error.message });
      });
    });
    return true;
  } catch (error) {
    logger.warn('Video caption OCR schedule failed', { error: error.message });
    return false;
  }
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      queued.delete(id);
      await runVideoCaptionOcr(id);
    }
  } finally {
    draining = false;
    if (queue.length) {
      setImmediate(() => {
        drainQueue().catch((error) => {
          logger.warn('Video caption OCR queue failed', { error: error.message });
        });
      });
    }
  }
}

function reportId() {
  return `video-caption-ocr-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = {
  OCR_PENDING,
  STATUS_PENDING,
  STATUS_DONE,
  FRAME_INTERVAL_SECONDS,
  MAX_FRAMES,
  MIN_OVERRIDE_REASON,
  parseListingFacts,
  conflictFacts,
  dedupeConflicts,
  factsFromListing,
  decideVideoCaptionApproval,
  videoFactsForRecord,
  sampleTimestamps,
  hammingDistance,
  dedupeFrameHashes,
  combineOcrText,
  scheduleVideoCaptionOcr,
  evaluateVideoCaptionApproval,
  persistVideoCaptionResolution,
  listVideoCaptionConflicts,
  saveVideoCaptionRecord,
  ocrVideoFile,
  ocrPropertyVideos,
  videoUrlsFromProperty,
  captionTextFromProperty,
  publicOcrView,
  reportId,
  LIVE_CONFLICT_SQL,
  BACKFILL_LIST_SQL
};
