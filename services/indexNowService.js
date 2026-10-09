'use strict';

// IndexNow: tell Bing and other participating engines when a listing goes live
// or is removed. Fire-and-forget by design: it can never delay or fail a
// moderation action. The key lives only in INDEXNOW_KEY and is never logged.

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const TIMEOUT_MS = 5000;
const MIN_INTERVAL_MS = 10000;
const MAX_URLS_PER_CALL = 100;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

const pending = new Set();
let timer = null;
let lastSentAt = 0;

function cleanKey() {
  const key = String(process.env.INDEXNOW_KEY || '').trim();
  return KEY_PATTERN.test(key) ? key : '';
}

function siteBase() {
  return String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function enabled() {
  return process.env.NODE_ENV === 'production' && Boolean(cleanKey());
}

// Absolute URLs on our own host only; anything else is dropped.
function normalizeUrls(urls = []) {
  const base = siteBase();
  const host = new URL(base).host;
  const out = [];
  for (const raw of Array.isArray(urls) ? urls : [urls]) {
    const text = String(raw || '').trim();
    if (!text) continue;
    try {
      const url = new URL(text.startsWith('/') ? `${base}${text}` : text);
      if (url.host === host) out.push(`${url.origin}${url.pathname}`);
    } catch (_) { /* ignore malformed */ }
  }
  return out;
}

async function flush(fetchImpl = globalThis.fetch) {
  timer = null;
  const key = cleanKey();
  if (!key || !pending.size || typeof fetchImpl !== 'function') {
    pending.clear();
    return { sent: 0 };
  }
  const urlList = Array.from(pending).slice(0, MAX_URLS_PER_CALL);
  for (const url of urlList) pending.delete(url);
  lastSentAt = Date.now();
  const base = siteBase();
  const body = {
    host: new URL(base).host,
    key,
    keyLocation: `${base}/${key}.txt`,
    urlList
  };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const abort = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
  } catch (_) {
    // No retry loop, and nothing logged that could carry the key.
  } finally {
    if (abort) clearTimeout(abort);
  }
  if (pending.size) schedule();
  return { sent: urlList.length };
}

function schedule() {
  if (timer) return;
  const wait = Math.max(0, lastSentAt + MIN_INTERVAL_MS - Date.now());
  timer = setTimeout(() => { flush().catch(() => {}); }, wait);
  if (typeof timer.unref === 'function') timer.unref();
}

// notify never throws and never returns a promise the caller must await.
function notify(urls = []) {
  try {
    if (!enabled()) return false;
    const list = normalizeUrls(urls);
    if (!list.length) return false;
    for (const url of list) pending.add(url);
    schedule();
    return true;
  } catch (_) {
    return false;
  }
}

// URLs worth pinging when this listing changes: its page and its category hubs.
function urlsForListing(listing = {}) {
  try {
    const { CATEGORY_SEO, publicCategoryKeysForRow } = require('./publicSeoService');
    const urls = [];
    if (listing.id) urls.push(`/property/${encodeURIComponent(listing.id)}`);
    for (const key of publicCategoryKeysForRow(listing) || []) {
      if (CATEGORY_SEO[key]?.route) urls.push(CATEGORY_SEO[key].route);
    }
    return urls;
  } catch (_) {
    return listing.id ? [`/property/${encodeURIComponent(listing.id)}`] : [];
  }
}

function notifyListing(listing = {}) {
  return notify(urlsForListing(listing));
}

// Body for GET /<key>.txt, or null when the path is not our key.
function keyFileFor(requestPath = '') {
  const key = cleanKey();
  if (!key) return null;
  return String(requestPath) === `/${key}.txt` ? key : null;
}

function resetForTests() {
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  lastSentAt = 0;
}

module.exports = { notify, notifyListing, urlsForListing, keyFileFor, flush, enabled, resetForTests, MIN_INTERVAL_MS };
