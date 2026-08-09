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

  return `${parsed.protocol.toLowerCase()}//${host}${path}`;
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
  uniqueNormalizedSourceUrls,
};
