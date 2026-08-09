'use strict';

function cleanUrlText(value = '') {
  return String(value || '')
    .trim()
    .replace(/^[<("'`]+/, '')
    .replace(/[>)"'`,.;]+$/, '');
}

function normalizedPath(pathname = '') {
  const path = String(pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/g, '');
  return path || '';
}

const TRACKING_QUERY_KEYS = new Set([
  'fbclid', 'gclid', 'igshid', 'si', 'ref', 'refer', 'referrer', 'feature', 'source',
]);

function isTrackingQueryKey(key = '') {
  const normalized = String(key || '').toLowerCase();
  return TRACKING_QUERY_KEYS.has(normalized) || normalized.startsWith('utm_');
}

function normalizeSourceUrl(value = '') {
  const raw = cleanUrlText(value);
  if (!/^https?:\/\//i.test(raw)) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return '';
  }

  const host = parsed.hostname.toLowerCase().replace(/^m\./, 'www.');
  const path = normalizedPath(parsed.pathname);

  if (/(^|\.)tiktok\.com$/i.test(host)) {
    const match = path.match(/^\/@([^/]+)\/video\/(\d+)/i);
    if (match) return `https://www.tiktok.com/@${match[1].toLowerCase()}/video/${match[2]}`;
  }

  if (/(^|\.)youtu\.be$/i.test(host)) {
    const videoId = path.replace(/^\//, '').split('/')[0];
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
  }

  if (/(^|\.)youtube\.com$/i.test(host)) {
    const videoId = parsed.searchParams.get('v') || path.match(/^\/shorts\/([^/]+)/i)?.[1] || '';
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (/(^|\.)twitter\.com$/i.test(host) || /(^|\.)x\.com$/i.test(host)) {
    const match = path.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/i);
    if (match) return `https://x.com/${match[1].toLowerCase()}/status/${match[2]}`;
  }

  if (/(^|\.)instagram\.com$/i.test(host)) {
    const match = path.match(/^\/(p|reel|tv)\/([^/]+)/i);
    if (match) return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}`;
  }

  if (/(^|\.)facebook\.com$/i.test(host) || /^fb\.watch$/i.test(host)) {
    const reel = path.match(/^\/(?:reel|videos)\/(\d+)/i);
    if (reel) return `https://www.facebook.com/reel/${reel[1]}`;
    const post = path.match(/^\/([^/]+)\/(?:posts|videos)\/([^/]+)/i);
    if (post) return `https://www.facebook.com/${post[1].toLowerCase()}/posts/${post[2]}`;
    const storyId = parsed.searchParams.get('story_fbid') || parsed.searchParams.get('fbid');
    const ownerId = parsed.searchParams.get('id');
    if (storyId) return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(storyId)}${ownerId ? `&id=${encodeURIComponent(ownerId)}` : ''}`;
  }

  const keptQuery = [...parsed.searchParams.entries()]
    .filter(([key]) => !isTrackingQueryKey(key));
  const query = keptQuery.length ? `?${new URLSearchParams(keptQuery).toString()}` : '';
  return `${parsed.protocol.toLowerCase()}//${host}${path}${query}`;
}

function stablePlatformPostIdentity(value = '') {
  const normalized = normalizeSourceUrl(value);
  if (!normalized) return { platform: '', id: '', key: '', canonical_url: '' };
  const checks = [
    ['youtube', normalized.match(/[?&]v=([^&#]+)/i)?.[1]],
    ['tiktok', normalized.match(/\/video\/(\d+)/i)?.[1]],
    ['x', normalized.match(/\/status\/(\d+)/i)?.[1]],
    ['instagram', normalized.match(/\/(?:p|reel|tv)\/([^/?#]+)/i)?.[1]],
    ['facebook', normalized.match(/\/(?:posts|reel|videos)\/([^/?#]+)/i)?.[1] || new URL(normalized).searchParams.get('story_fbid')],
  ];
  const [platform, id] = checks.find(([, candidate]) => candidate) || ['', ''];
  return {
    platform,
    id: id || '',
    key: platform && id ? `${platform}:${id}` : '',
    canonical_url: normalized,
  };
}

async function resolveSourceShortUrl(value = '', { fetchImpl = fetch } = {}) {
  const raw = cleanUrlText(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return '';
  }
  const needsRedirect = /(^|\.)(?:vt|vm)\.tiktok\.com$/i.test(parsed.hostname)
    || /^fb\.watch$/i.test(parsed.hostname);
  if (!needsRedirect) return normalizeSourceUrl(raw);
  const response = await fetchImpl(raw, {
    method: 'HEAD',
    redirect: 'follow',
    headers: { 'User-Agent': 'makaug-harvest-url-resolver/1.0' },
  });
  return normalizeSourceUrl(response.url || raw);
}

function uniqueNormalizedSourceUrls(values = []) {
  const seen = new Set();
  const normalized = [];
  values.flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value) => {
    const url = normalizeSourceUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    normalized.push(url);
  });
  return normalized;
}

module.exports = {
  normalizeSourceUrl,
  resolveSourceShortUrl,
  stablePlatformPostIdentity,
  uniqueNormalizedSourceUrls,
};
