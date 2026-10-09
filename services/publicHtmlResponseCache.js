'use strict';

// S6: edge-cacheable public HTML and a small in-process cache for the pages
// crawlers and visitors hit most. Anonymous, cookie-less requests only.

const EDGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';
const PRIVATE_CACHE_CONTROL = 'private, no-store';
const TTL_MS = 120 * 1000;
const MAX_ENTRIES = 16;
const CACHEABLE_PATHS = new Set(['/', '/for-sale', '/to-rent', '/land', '/brokers']);

// Cookies that never change what the server renders. Anything else (a session
// or auth cookie, or one we do not know) keeps the request out of the cache.
const HARMLESS_COOKIE = /^(?:_ga(?:_.*)?|_gid|_gat.*|_gcl_.*|_fbp|_clck|_clsk|__cf.*|cf_.*|cookie_?consent.*|makaug_cookie_consent.*)$/i;

function cookieNames(header = '') {
  return String(header || '').split(';').map((part) => part.split('=')[0].trim()).filter(Boolean);
}

function carriesAuth(req) {
  const get = (name) => (typeof req.get === 'function' ? req.get(name) : req.headers?.[name]);
  if (get('authorization') || get('x-api-key') || get('x-admin-api-key')) return true;
  return /(?:^|;\s*)makaug_auth_token=/.test(String(get('cookie') || ''));
}

function isAnonymousRequest(req) {
  if (!req || !['GET', 'HEAD'].includes(req.method)) return false;
  const get = (name) => (typeof req.get === 'function' ? req.get(name) : req.headers?.[name]);
  if (carriesAuth(req)) return false;
  return cookieNames(get('cookie')).every((name) => HARMLESS_COOKIE.test(name));
}

// 'edge' | 'private' | 'default' for a public SSR HTML response.
function cacheDecision(req) {
  if (carriesAuth(req)) return 'private';
  return isAnonymousRequest(req) ? 'edge' : 'default';
}

function cacheKeyFor(req) {
  if (!req || req.method !== 'GET') return '';
  const url = String(req.originalUrl || req.url || '');
  if (url.includes('?')) return '';
  const pathName = (url.replace(/\/+$/, '') || '/').toLowerCase();
  return CACHEABLE_PATHS.has(pathName) ? pathName : '';
}

const store = new Map();

function get(key, now = Date.now()) {
  const hit = store.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit;
}

function set(key, entry, now = Date.now()) {
  store.delete(key);
  store.set(key, { ...entry, at: now });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
}

function clear() {
  const size = store.size;
  store.clear();
  return size;
}

module.exports = {
  EDGE_CACHE_CONTROL, PRIVATE_CACHE_CONTROL, TTL_MS, CACHEABLE_PATHS,
  cacheDecision, cacheKeyFor, isAnonymousRequest, carriesAuth, get, set, clear
};
