'use strict';

// Harvest-time capture for TikTok and YouTube imports. Best-effort only:
// every fetch is wrapped so a failure never blocks the import. Free public
// sources only (TikTok video/profile page, TikTok oEmbed, YouTube oEmbed,
// i.ytimg.com thumbnails, YouTube Data API v3 channels.list when a key is
// already configured). Small delays between items respect rate limits.

const crypto = require('crypto');
const logger = require('../config/logger');
const { ugandanPhoneFromSourceText, normalizeUgandanSourcePhone } = require('../utils/sourceIntakeIntegrity');

const FETCH_TIMEOUT_MS = 8000;
const DELAY_BETWEEN_ITEMS_MS = 600;
const MAX_ITEMS_PER_RUN = 25;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COVER_ALLOWED_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibytedtos.com', 'byteimg.com', 'ytimg.com', 'ggpht.com', 'googleusercontent.com'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function tiktokVideoUrl(item = {}) {
  const candidates = [item.sourceUrl, item.source_url, item.tiktokUrl, item.tiktok_url, item.raw_source_post?.source_url, item.raw_source_post?.url];
  return candidates.map((v) => String(v || '').trim()).find((v) => /^https:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\//i.test(v)) || '';
}

function youtubeVideoIdFor(item = {}) {
  if (item.youtubeId) return String(item.youtubeId);
  const candidates = [item.sourceUrl, item.source_url, item.youtube_url, item.youtubeUrl];
  for (const raw of candidates) {
    const value = String(raw || '');
    const match = value.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{6,20})/);
    if (match) return match[1];
  }
  return '';
}

function platformFor(item = {}) {
  if (youtubeVideoIdFor(item)) return 'youtube';
  if (tiktokVideoUrl(item)) return 'tiktok';
  return '';
}

function decodeJsonString(value = '') {
  try { return JSON.parse(`"${value}"`); } catch (_) { return String(value || ''); }
}

// Parses TikTok's public video page (__UNIVERSAL_DATA_FOR_REHYDRATION__).
function parseTikTokVideoPage(html = '') {
  const text = String(html || '');
  const pick = (re) => { const m = text.match(re); return m ? decodeJsonString(m[1]) : ''; };
  return {
    caption: pick(/"desc":"((?:[^"\\]|\\.)*)"/),
    // The poster's own bio sits in the "author" object; the first
    // "signature" in the page can belong to another account.
    bio: pick(/"author":\{[^{}]*?"signature":"((?:[^"\\]|\\.)*)"/) || pick(/"signature":"((?:[^"\\]|\\.)*)"/),
    cover: pick(/"(?:originCover|cover)":"((?:[^"\\]|\\.)*)"/),
    handle: pick(/"uniqueId":"((?:[^"\\]|\\.)*)"/)
  };
}

function tiktokHandleFromUrl(url = '') {
  const m = String(url || '').match(/tiktok\.com\/@([A-Za-z0-9._-]+)/i);
  return m ? m[1] : '';
}

async function captureTikTok(item, { fetchImpl }) {
  const url = tiktokVideoUrl(item);
  const out = { caption: '', bio: '', coverSourceUrl: '', errors: [] };
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } }, fetchImpl);
    if (res?.ok) {
      const parsed = parseTikTokVideoPage(await res.text());
      out.caption = parsed.caption;
      out.bio = parsed.bio;
      out.coverSourceUrl = parsed.cover;
      out.handle = parsed.handle;
    } else out.errors.push(`video_page_${res?.status || 'error'}`);
  } catch (error) { out.errors.push(`video_page_${error.name || 'error'}`); }
  if (!out.caption || !out.coverSourceUrl) {
    try {
      const res = await fetchWithTimeout(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {}, fetchImpl);
      if (res?.ok) {
        const data = await res.json();
        out.caption = out.caption || String(data.title || '');
        out.coverSourceUrl = out.coverSourceUrl || String(data.thumbnail_url || '');
        out.handle = out.handle || tiktokHandleFromUrl(data.author_url);
      } else out.errors.push(`oembed_${res?.status || 'error'}`);
    } catch (error) { out.errors.push(`oembed_${error.name || 'error'}`); }
  }
  const handle = out.handle || tiktokHandleFromUrl(url);
  if (!out.bio && handle) {
    try {
      const res = await fetchWithTimeout(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } }, fetchImpl);
      if (res?.ok) out.bio = parseTikTokVideoPage(await res.text()).bio;
      else out.errors.push(`profile_${res?.status || 'error'}`);
    } catch (error) { out.errors.push(`profile_${error.name || 'error'}`); }
  }
  return out;
}

async function captureYouTube(item, { fetchImpl, apiKey }) {
  const id = youtubeVideoIdFor(item);
  const out = { caption: '', bio: '', coverSourceUrl: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`, errors: [] };
  const raw = item.raw_source_post || item.rawSourcePost || {};
  out.caption = String(item.youtubeDescription || raw.description || item.description || '');
  let channelId = String(item.channelId || item.youtubeChannelId || raw.channel_id || raw.channelId || '');
  if (apiKey) {
    try {
      if (!channelId || !out.caption) {
        const res = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(apiKey)}`, {}, fetchImpl);
        if (res?.ok) {
          const snippet = (await res.json())?.items?.[0]?.snippet || {};
          out.caption = String(snippet.description || '') || out.caption;
          channelId = channelId || String(snippet.channelId || '');
        } else out.errors.push(`yt_videos_${res?.status || 'error'}`);
      }
      if (channelId) {
        const res = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`, {}, fetchImpl);
        if (res?.ok) out.bio = String((await res.json())?.items?.[0]?.snippet?.description || '');
        else out.errors.push(`yt_channels_${res?.status || 'error'}`);
      }
    } catch (error) { out.errors.push(`yt_api_${error.name || 'error'}`); }
  } else {
    out.errors.push('yt_api_key_missing');
  }
  if (!out.caption) {
    try {
      const res = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {}, fetchImpl);
      if (res?.ok) out.caption = String((await res.json())?.title || '');
    } catch (_) { /* best effort */ }
  }
  return out;
}

async function storeCover(sourceUrl, item, { fetchImpl, storeRemoteImage }) {
  if (!/^https:\/\//i.test(String(sourceUrl || ''))) return '';
  const store = storeRemoteImage || ((url, opts) => require('./cloudMediaStorageService').storeRemoteImageUrl(url, opts));
  const key = crypto.createHash('sha256').update(String(item.sourceUrl || item.youtubeId || sourceUrl)).digest('hex').slice(0, 24);
  const stored = await store(sourceUrl, {
    label: 'harvest cover frame',
    keyPrefix: 'staff-video-cover/harvest',
    filename: `${key}.jpg`,
    allowedHosts: COVER_ALLOWED_HOSTS,
    userAgent: BROWSER_UA,
    referer: 'https://www.tiktok.com/',
    fetchImpl
  });
  return typeof stored === 'string' ? stored : '';
}

// Returns extra_fields to merge onto the listing; never throws.
async function captureHarvestDetails(item = {}, { fetchImpl = fetch, apiKey, storeRemoteImage } = {}) {
  const platform = platformFor(item);
  if (!platform) return null;
  const key = apiKey !== undefined ? apiKey : (process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '');
  let got = { caption: '', bio: '', coverSourceUrl: '', errors: [] };
  try {
    got = platform === 'tiktok' ? await captureTikTok(item, { fetchImpl }) : await captureYouTube(item, { fetchImpl, apiKey: key });
  } catch (error) {
    got.errors.push(`capture_${error.name || 'error'}`);
  }
  let coverUrl = '';
  try {
    coverUrl = await storeCover(got.coverSourceUrl, item, { fetchImpl, storeRemoteImage });
  } catch (error) {
    got.errors.push(`cover_store_${String(error.status || error.name || 'error')}`);
  }
  const existingCaption = String(item.caption || item.raw_source_post?.caption || '');
  const caption = String(got.caption || '').length >= existingCaption.length ? String(got.caption || '') : existingCaption;
  const phone = ugandanPhoneFromSourceText(got.bio || '') || '';
  const captionPhone = ugandanPhoneFromSourceText(caption) || ugandanPhoneFromSourceText(existingCaption) || '';
  return {
    harvest_capture_platform: platform,
    harvest_caption_full: caption.slice(0, 5000),
    poster_bio_phone: phone,
    harvest_caption_phone: captionPhone,
    harvest_cover_frame_url: coverUrl,
    harvest_cover_source_url: got.coverSourceUrl || '',
    harvest_captured_at: new Date().toISOString(),
    ...(got.errors.length ? { harvest_capture_errors: got.errors.slice(0, 8) } : {})
  };
}

// Phone for a found-online post: a number in the caption wins, then the
// poster's bio, then whatever the source already carried (e.g. a registry
// account default). Always +256-normalised or ''.
function resolveHarvestPhone({ captionText = '', bioText = '', bioPhone = '', fallback = '' } = {}) {
  return ugandanPhoneFromSourceText(captionText)
    || normalizeUgandanSourcePhone(bioPhone)
    || ugandanPhoneFromSourceText(bioText)
    || normalizeUgandanSourcePhone(fallback)
    || '';
}

// Captures for a batch with small delays. Never throws; failures are logged.
async function captureHarvestDetailsForItems(items = [], options = {}) {
  const delayMs = options.delayMs ?? DELAY_BETWEEN_ITEMS_MS;
  const max = options.maxItems ?? MAX_ITEMS_PER_RUN;
  let done = 0;
  for (const item of items) {
    if (done >= max) break;
    if (!item || item.harvestCapture || !platformFor(item)) continue;
    if (done > 0 && delayMs) await sleep(delayMs);
    try {
      item.harvestCapture = await captureHarvestDetails(item, options);
    } catch (error) {
      logger.warn('Harvest capture failed', { message: String(error?.message || error).slice(0, 200) });
    }
    done += 1;
  }
  return done;
}

module.exports = {
  captureHarvestDetails,
  captureHarvestDetailsForItems,
  parseTikTokVideoPage,
  resolveHarvestPhone,
  platformFor,
  COVER_ALLOWED_HOSTS
};
