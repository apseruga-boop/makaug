'use strict';

// A saved copy of a TikTok listing's cover picture.
//
// Why: TikTok's own cover links (tiktokcdn *-sign* with x-expires) stop working
// within days, so listings that came from a TikTok video had no picture at all
// (a "source evidence card" is not a photo and can't be approved on). Arthur,
// 28 Nov 2026: fetch the cover from TikTok's free public page, keep OUR OWN
// copy on our media host, and treat it as the listing's cover.
//
// Same rule as C1 (10 Oct 2026) for stills taken from a listing's own video:
// the cover is the first frame of the listing's own TikTok video, stored on
// our media host as slot video_still_tiktok_cover, so the approval gate counts
// it as a photo and a found-online listing may show it. The agent's branding
// stays on it (never cropped or blurred). Free public sources only: the video
// page's embedded data, its og:image, then TikTok's oEmbed thumbnail.
//
// This file does the fetching and saving for one listing. When it runs, and
// which listings, is services/tiktokCoverScheduler.js.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 10000;
const COVER_ALLOWED_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibytedtos.com', 'byteimg.com'];
const COVER_SLOT = 'video_still_tiktok_cover';
const COVER_LABEL = 'TikTok video cover';
const COVER_KEY_PREFIX = 'tiktok-covers';
const MAX_COVER_BYTES = 6 * 1024 * 1024;
// TikTok status codes for a video that is gone or not public.
const UNAVAILABLE_STATUS = new Map([
  [10204, 'video_deleted'],
  [10205, 'video_deleted'],
  [10216, 'video_private'],
  [10222, 'video_private'],
  [10223, 'video_private'],
  [10225, 'video_removed'],
  [10231, 'video_region_blocked'],
]);

const TIKTOK_VIDEO_RE = /^https:\/\/(?:www\.|m\.)?tiktok\.com\/@[A-Za-z0-9._-]+\/video\/(\d{8,25})(?:[/?#]|$)/i;
const TIKTOK_SHORT_RE = /^https:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+\/?(?:[?#]|$)/i;

function cleanUrl(value) {
  return String(value || '').trim();
}

function isTikTokVideoUrl(value) {
  const url = cleanUrl(value);
  return TIKTOK_VIDEO_RE.test(url) || TIKTOK_SHORT_RE.test(url);
}

function tiktokVideoId(value) {
  const match = cleanUrl(value).match(TIKTOK_VIDEO_RE);
  return match ? match[1] : '';
}

function asExtra(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return asExtra(JSON.parse(value)); } catch (_) { return {}; }
  }
  return {};
}

// The listing's own TikTok video link, from the fields intake fills in.
function tiktokVideoUrlFromExtra(extraFields) {
  const extra = asExtra(extraFields);
  return [
    extra.tiktok_url, extra.video_url, extra.source_post_url, extra.canonical_source_url, extra.source_url,
  ].map(cleanUrl).find(isTikTokVideoUrl) || '';
}

async function fetchWithTimeout(url, options, fetchImpl, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Reads the video's own data out of the public page. Returns the cover links
// and, for a video that no longer exists, TikTok's status code.
function parseTikTokPage(html = '', videoId = '') {
  const text = String(html || '');
  const out = { cover: '', statusCode: null, ogImage: '' };
  const script = text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (script) {
    try {
      const scope = JSON.parse(script[1])['__DEFAULT_SCOPE__'] || {};
      const detail = scope['webapp.video-detail'] || {};
      if (Number.isFinite(Number(detail.statusCode))) out.statusCode = Number(detail.statusCode);
      const item = detail.itemInfo && detail.itemInfo.itemStruct;
      const video = item && item.video;
      // Only this video's cover: the page can also carry other videos' data.
      if (video && (!videoId || !item.id || String(item.id) === String(videoId))) {
        out.cover = cleanUrl(video.cover) || cleanUrl(video.originCover) || cleanUrl(video.dynamicCover);
      }
    } catch (_) { /* fall through to og:image */ }
  }
  const og = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) out.ogImage = decodeHtmlEntities(og[1]);
  return out;
}

function isAllowedCoverUrl(value) {
  try {
    const url = new URL(cleanUrl(value));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return COVER_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch (_) {
    return false;
  }
}

// Finds where TikTok serves this video's cover right now. Never throws.
// Result: { coverUrl, kind: 'page'|'og_image'|'oembed'|'', unavailable: reason|'', errors: [] }
async function findTikTokCoverSource(videoUrl, { fetchImpl = fetch } = {}) {
  const out = { coverUrl: '', kind: '', unavailable: '', errors: [] };
  const url = cleanUrl(videoUrl);
  if (!isTikTokVideoUrl(url)) {
    out.errors.push('not_a_tiktok_video_url');
    return out;
  }
  const videoId = tiktokVideoId(url);
  let page = null;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' }, fetchImpl);
    if (res && res.ok) page = parseTikTokPage(await res.text(), videoId);
    else if (res && res.status === 404) out.unavailable = 'video_deleted';
    else out.errors.push(`video_page_${(res && res.status) || 'error'}`);
  } catch (error) {
    out.errors.push(`video_page_${error.name || 'error'}`);
  }
  if (page) {
    if (page.cover && isAllowedCoverUrl(page.cover)) return { ...out, coverUrl: page.cover, kind: 'page' };
    if (page.statusCode && page.statusCode !== 0) {
      out.unavailable = UNAVAILABLE_STATUS.get(page.statusCode) || '';
      out.errors.push(`video_status_${page.statusCode}`);
    }
    if (!out.unavailable && page.ogImage && isAllowedCoverUrl(page.ogImage)) return { ...out, coverUrl: page.ogImage, kind: 'og_image' };
    if (!page.cover && !page.ogImage && !out.unavailable) out.errors.push('video_page_no_cover');
  }
  if (!out.unavailable) {
    try {
      const res = await fetchWithTimeout(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { 'User-Agent': BROWSER_UA } }, fetchImpl);
      if (res && res.ok) {
        const data = await res.json();
        const thumb = cleanUrl(data && data.thumbnail_url);
        if (thumb && isAllowedCoverUrl(thumb)) return { ...out, coverUrl: thumb, kind: 'oembed' };
        out.errors.push('oembed_no_thumbnail');
      } else if (res && (res.status === 400 || res.status === 404)) {
        // TikTok's oEmbed answers 400 for a video that is gone or private.
        out.errors.push(`oembed_${res.status}`);
      } else {
        out.errors.push(`oembed_${(res && res.status) || 'error'}`);
      }
    } catch (error) {
      out.errors.push(`oembed_${error.name || 'error'}`);
    }
  }
  return out;
}

// Downloads the cover and keeps our own copy. Returns the hosted URL or throws.
async function saveCoverCopy(coverUrl, videoUrl, { fetchImpl = fetch, storeRemoteImage } = {}) {
  const store = storeRemoteImage || ((url, options) => require('./cloudMediaStorageService').storeRemoteImageUrl(url, options));
  const stored = await store(coverUrl, {
    label: 'TikTok cover',
    keyPrefix: COVER_KEY_PREFIX,
    filename: `${tiktokVideoId(videoUrl) || 'cover'}.jpg`,
    allowedHosts: COVER_ALLOWED_HOSTS,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: MAX_COVER_BYTES,
    userAgent: BROWSER_UA,
    referer: 'https://www.tiktok.com/',
    fetchImpl,
  });
  if (typeof stored !== 'string' || !stored) {
    const error = new Error('storage_not_configured');
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }
  return stored;
}

function realPhotoUrl(url, extra = {}) {
  const { realPhotoRejection } = require('../utils/realListingPhoto');
  return realPhotoRejection({ url, slot_key: extra.slot_key, room_label: extra.room_label }) === null;
}

// Saves the cover row for one listing, in one transaction, with a log row that
// is the backup: it names the row added and any rows made non-primary, so
// scripts/rollback-253-tiktok-covers.sql can put everything back.
// The listing's status and every other field are left alone.
async function recordCover(client, propertyId, { hostedUrl, sourceCoverUrl, kind, videoUrl }) {
  await client.query('BEGIN');
  try {
    const existing = await client.query(
      `SELECT id::text AS id, url, slot_key, room_label, is_primary, sort_order
         FROM property_images WHERE property_id = $1::uuid FOR UPDATE`,
      [propertyId]
    );
    const rows = existing.rows || [];
    if (rows.some((row) => row.slot_key === COVER_SLOT && realPhotoUrl(row.url, row))) {
      await client.query('COMMIT');
      return { saved: false, reason: 'already_has_cover' };
    }
    // The cover leads when nothing the listing has now is a real photo of its
    // own (evidence cards, guide drawings and expired links are not).
    const hasRealPrimary = rows.some((row) => row.is_primary && realPhotoUrl(row.url, row));
    const demote = hasRealPrimary ? [] : rows.filter((row) => row.is_primary).map((row) => row.id);
    if (demote.length) {
      await client.query('UPDATE property_images SET is_primary = false WHERE id = ANY($1::uuid[])', [demote]);
    }
    const maxSort = rows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), -1);
    const inserted = await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
       VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
      [propertyId, hostedUrl, !hasRealPrimary, maxSort + 1, COVER_SLOT, COVER_LABEL]
    );
    const imageId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO tiktok_cover_log (property_id, image_id, cover_url, source_video_url, source_kind, demoted_image_ids)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid[])`,
      [propertyId, imageId, hostedUrl, videoUrl, kind, demote]
    );
    await client.query(
      `UPDATE properties
          SET extra_fields = (COALESCE(extra_fields, '{}'::jsonb)
                - 'tiktok_cover_error' - 'tiktok_cover_attempts' - 'tiktok_cover_unavailable')
              || jsonb_build_object(
                   'tiktok_cover_status', 'saved',
                   'tiktok_cover_url', $2::text,
                   'tiktok_cover_source', $3::text,
                   'tiktok_cover_saved_at', NOW()::text)
        WHERE id = $1::uuid`,
      [propertyId, hostedUrl, kind]
    );
    await client.query('COMMIT');
    return { saved: true, imageId, demoted: demote.length, primary: !hasRealPrimary };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

// One listing: find, download, save. Returns { status, ... }. Does not write
// failure notes; the scheduler does that so a retry can back off.
async function saveTikTokCoverForListing(db, listing, deps = {}) {
  const videoUrl = tiktokVideoUrlFromExtra(listing.extra_fields);
  if (!videoUrl) return { status: 'failed', error: 'no_tiktok_video_url' };
  const found = await (deps.findSource || findTikTokCoverSource)(videoUrl, deps);
  if (!found.coverUrl) {
    if (found.unavailable) return { status: 'unavailable', error: found.unavailable, detail: found.errors };
    return { status: 'failed', error: found.errors[0] || 'no_cover_found', detail: found.errors };
  }
  let hostedUrl;
  try {
    hostedUrl = await saveCoverCopy(found.coverUrl, videoUrl, deps);
  } catch (error) {
    return { status: 'failed', error: `cover_download_${String(error.status || error.code || error.name || 'error')}`, detail: [String(error.message || '').slice(0, 160)] };
  }
  const client = await db.pool.connect();
  try {
    const result = await recordCover(client, listing.id, { hostedUrl, sourceCoverUrl: found.coverUrl, kind: found.kind, videoUrl });
    return { status: result.saved ? 'saved' : 'skipped', hostedUrl, kind: found.kind, ...result };
  } finally {
    client.release();
  }
}

module.exports = {
  COVER_SLOT,
  COVER_LABEL,
  COVER_KEY_PREFIX,
  COVER_ALLOWED_HOSTS,
  UNAVAILABLE_STATUS,
  isTikTokVideoUrl,
  tiktokVideoId,
  tiktokVideoUrlFromExtra,
  parseTikTokPage,
  findTikTokCoverSource,
  saveCoverCopy,
  recordCover,
  saveTikTokCoverForListing,
};
