'use strict';

// X/Twitter harvests were storing pbs.twimg.com links as source_* rows. Those
// hotlinks are hidden on public pages (and twimg rejects our cache user agent).
// A photo copied onto our media host under /x-post-photos/ with slot
// x_post_photo is the post's own photo and can be shown. source_* rows stay
// hidden. source URLs already on the row are left in place when the copy fails,
// so a later backfill can try again.

const { storeRemoteImageUrl } = require('../services/cloudMediaStorageService');

const X_POST_PHOTO_SLOT = 'x_post_photo';
const X_POST_PHOTO_PATH = '/x-post-photos/';
const X_POST_PHOTO_LABEL = 'Photo from the X post';
const X_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const X_REFERER = 'https://x.com/';

function isTwimgPhotoUrl(url = '') {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'pbs.twimg.com' || host === 'video.twimg.com' || host.endsWith('.twimg.com');
  } catch (_) {
    return false;
  }
}

// Photo media URLs need format and name or twimg returns an HTML error page.
// https://pbs.twimg.com/media/AbC.jpg -> https://pbs.twimg.com/media/AbC?format=jpg&name=large
function normalizeTwimgPhotoUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return '';
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'pbs.twimg.com' && host !== 'video.twimg.com' && !host.endsWith('.twimg.com')) return raw;
  parsed.protocol = 'https:';
  parsed.hostname = host;
  if (/\/media\//i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname
      .replace(/:(?:thumb|small|medium|large|orig)$/i, '')
      .replace(/\.(?:jpe?g|png|webp|gif)$/i, '');
    parsed.searchParams.set('format', 'jpg');
    parsed.searchParams.set('name', 'large');
  }
  return parsed.toString();
}

function isXPlatform(platform = '') {
  const value = String(platform || '').trim().toLowerCase();
  return value === 'x' || value === 'twitter' || value === 'x/twitter';
}

function xPhotoFilename(url = '') {
  try {
    const parsed = new URL(normalizeTwimgPhotoUrl(url) || url);
    const part = parsed.pathname.split('/').filter(Boolean).pop() || 'x-post-photo';
    return part.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x-post-photo';
  } catch (_) {
    return 'x-post-photo';
  }
}

async function cacheXPostPhoto(remoteUrl, options = {}) {
  const normalized = normalizeTwimgPhotoUrl(remoteUrl);
  if (!isTwimgPhotoUrl(normalized)) return null;
  const store = options.store || storeRemoteImageUrl;
  try {
    return await store(normalized, {
      keyPrefix: options.keyPrefix || 'x-post-photos',
      filename: options.filename || xPhotoFilename(normalized),
      allowedHosts: ['pbs.twimg.com', 'video.twimg.com', 'twimg.com'],
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: options.maxBytes || (8 * 1024 * 1024),
      label: 'X post photo',
      userAgent: options.userAgent || X_BROWSER_USER_AGENT,
      referer: options.referer || X_REFERER,
      fetchImpl: options.fetchImpl,
      uploadFetchImpl: options.uploadFetchImpl,
    });
  } catch (error) {
    if (typeof options.onError === 'function') options.onError(error);
    return null;
  }
}

// Swap twimg rows for hosted copies. A null copy (storage off, or a download
// error) keeps the original source_* row.
async function replaceTwimgRowsWithHostedCopies(images = [], options = {}) {
  const cache = options.cache || ((url, cacheOptions) => cacheXPostPhoto(url, cacheOptions));
  const rows = Array.isArray(images) ? images : [];
  const out = [];
  const copiedSources = [];
  const failures = [];
  for (const image of rows) {
    const original = String(image?.url || '').trim();
    if (!image || !isTwimgPhotoUrl(original)) {
      if (image) out.push(image);
      continue;
    }
    let cached = null;
    try {
      cached = await cache(original, {
        onError(error) {
          failures.push({ url: original, error: error?.message || String(error) });
        },
      });
    } catch (error) {
      failures.push({ url: original, error: error?.message || String(error) });
      cached = null;
    }
    if (!cached) {
      out.push(image);
      continue;
    }
    const normalized = normalizeTwimgPhotoUrl(original);
    copiedSources.push(original);
    if (normalized && normalized !== original) copiedSources.push(normalized);
    out.push({
      ...image,
      url: cached,
      slot_key: X_POST_PHOTO_SLOT,
      room_label: X_POST_PHOTO_LABEL,
    });
  }
  return { images: out, copiedSources, failures };
}

function extraUrlList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function twimgUrlsFromListing({ images = [], extra = {} } = {}) {
  const fields = extra && typeof extra === 'object' ? extra : {};
  const bags = [
    (Array.isArray(images) ? images : []).map((image) => image?.url || image),
    extraUrlList(fields.photo_source_urls),
    extraUrlList(fields.authorised_photo_urls),
    extraUrlList(fields.image_urls),
    extraUrlList(fields.xImageUrl),
    extraUrlList(fields.twitterImageUrl),
  ];
  const seen = new Set();
  const urls = [];
  for (const bag of bags) {
    for (const item of bag) {
      const url = String(item || '').trim();
      if (!isTwimgPhotoUrl(url)) continue;
      const key = normalizeTwimgPhotoUrl(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    }
  }
  return urls;
}

function twimgUrlsStillToCopy(candidates = [], alreadyCopied = []) {
  const done = new Set((Array.isArray(alreadyCopied) ? alreadyCopied : []).map((url) => normalizeTwimgPhotoUrl(url)).filter(Boolean));
  return (Array.isArray(candidates) ? candidates : []).filter((url) => !done.has(normalizeTwimgPhotoUrl(url)));
}

module.exports = {
  X_POST_PHOTO_SLOT,
  X_POST_PHOTO_PATH,
  X_POST_PHOTO_LABEL,
  X_BROWSER_USER_AGENT,
  X_REFERER,
  isTwimgPhotoUrl,
  normalizeTwimgPhotoUrl,
  isXPlatform,
  cacheXPostPhoto,
  replaceTwimgRowsWithHostedCopies,
  twimgUrlsFromListing,
  twimgUrlsStillToCopy,
};
