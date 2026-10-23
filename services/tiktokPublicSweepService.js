'use strict';

const { tiktokSourceSweepEnabled } = require('../utils/harvestFeatureFlags');

const TIKTOK_PUBLIC_SWEEP_METHOD = 'public_page_and_oembed';
const DEFAULT_PACING_MS = 1200;
const DEFAULT_MAX_SOURCES = 8;
const DEFAULT_MAX_VIDEOS_PER_SOURCE = 4;
const DEFAULT_MAX_OEMBED = 16;
const DEFAULT_MAX_HTTP_CALLS = 40;
const PUBLIC_HTML_SCAN_CHARS = 1500000;
const USER_AGENT = 'makaug-found-online-source-review/1.0';

const CANNOT_CAPTURE = Object.freeze([
  'Posts that are only rendered after a TikTok login, captcha, or app session.',
  'Video links that are absent from the unauthenticated public HTML.',
  'Comment text, on-screen stickers, and captions longer than the public oEmbed title.',
  'Private accounts, friends-only posts, and anything behind TikTok search that is not in the public page.',
]);

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function discoveryApi() {
  return require('./socialPlatformPostDiscoveryService');
}

function headerValue(response, name) {
  const headers = response?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || headers.get(name.toLowerCase()) || '');
  return String(headers[name] || headers[name.toLowerCase()] || '');
}

function tiktokPublicSourceUrl(source = {}) {
  const raw = String(source.source_url || source.url || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    return '';
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') return '';
  if (host !== 'www.tiktok.com' && host !== 'tiktok.com') return '';
  if (/\/(login|signup|auth)\b/i.test(parsed.pathname)) return '';
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function canonicalTikTokVideoUrl(value = '') {
  const match = String(value || '').match(/https?:\/\/(?:www\.)?tiktok\.com\/@[^/?#\s"'<>]+\/video\/\d+/i);
  if (!match) return '';
  return match[0]
    .replace(/^http:\/\//i, 'https://')
    .replace(/^https:\/\/tiktok\.com/i, 'https://www.tiktok.com');
}

function videoUrlsFromPublicHtml(html = '') {
  const { extractTikTokVideoUrls } = discoveryApi();
  const expanded = String(html || '')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/(^|[^a-z0-9])(\/@[^/"'\s<>]+\/video\/\d+)/gi, '$1https://www.tiktok.com$2');
  return [...new Set(extractTikTokVideoUrls(expanded).map(canonicalTikTokVideoUrl).filter(Boolean))];
}

function videoPostedAtIso(url = '') {
  const match = String(url || '').match(/\/video\/(\d+)/);
  if (!match) return '';
  try {
    const seconds = Number(BigInt(match[1]) >> 32n);
    const date = new Date(seconds * 1000);
    const year = date.getUTCFullYear();
    return year >= 2016 && year <= 2036 ? date.toISOString() : '';
  } catch (_error) {
    return '';
  }
}

function classifyTikTokPublicPage({ status = 0, location = '', html = '', videoCount = 0 } = {}) {
  const code = Number(status) || 0;
  const dest = String(location || '');
  if (code === 404 || code === 410) return 'broken';
  if (code === 429) return 'rate_limited';
  if (code === 401 || code === 403) return 'auth_wall';
  if (code >= 300 && code < 400 && /login|signup|challenge|captcha/i.test(dest)) return 'auth_wall';
  if (!code || code >= 500) return 'unreachable';
  if (code >= 300 && code < 400) return 'redirect_unfollowed';
  if (videoCount > 0) return 'ok';
  const sample = String(html || '').slice(0, 8000).toLowerCase();
  if (/captcha|verify you are human|log in to tiktok|login to tiktok|continue with google|log in to see more/.test(sample)) {
    return 'auth_wall';
  }
  return 'no_public_video_urls';
}

function emptyDisabledResult(reason) {
  return {
    enabled: false,
    skipped_reason: reason,
    method: TIKTOK_PUBLIC_SWEEP_METHOD,
    sources_considered: 0,
    sources_fetched: 0,
    http_call_count: 0,
    video_urls_found: 0,
    duplicates_skipped: 0,
    outside_lookback_count: 0,
    oembed_fetch_count: 0,
    posts: [],
    broken_sources: [],
    auth_wall_sources: [],
    no_video_sources: [],
    rate_limited: false,
    partial_results: false,
    reports: [],
    limits: {},
    cannot_capture: CANNOT_CAPTURE,
  };
}

async function fetchTikTokPublicSourcePosts({
  enabled = false,
  sources = [],
  fetchImpl = fetch,
  env = process.env,
  publishedAfter = '',
  deadlineAt = 0,
  minRemainingMs = 0,
  sleep = delay,
} = {}) {
  if (enabled !== true) return emptyDisabledResult('TIKTOK_SOURCE_SWEEP_ENABLED is off');
  const pacingMs = boundedInt(env.TIKTOK_SOURCE_SWEEP_PACING_MS, DEFAULT_PACING_MS, 0, 10000);
  const maxSources = boundedInt(env.TIKTOK_SOURCE_SWEEP_MAX_SOURCES, DEFAULT_MAX_SOURCES, 1, 30);
  const maxVideosPerSource = boundedInt(env.TIKTOK_SOURCE_SWEEP_MAX_VIDEOS_PER_SOURCE, DEFAULT_MAX_VIDEOS_PER_SOURCE, 1, 10);
  const maxOembed = boundedInt(env.TIKTOK_SOURCE_SWEEP_MAX_OEMBED, DEFAULT_MAX_OEMBED, 1, 40);
  const maxHttpCalls = boundedInt(env.TIKTOK_SOURCE_SWEEP_MAX_HTTP_CALLS, DEFAULT_MAX_HTTP_CALLS, 1, 60);
  const selected = (Array.isArray(sources) ? sources : []).slice(0, maxSources);
  const floorMs = Date.parse(publishedAfter);
  const reports = [];
  const brokenSources = [];
  const authWallSources = [];
  const noVideoSources = [];
  const seenVideos = new Set();
  const videosForOembed = [];
  let httpCalls = 0;
  let duplicatesSkipped = 0;
  let outsideLookback = 0;
  let paced = false;
  let rateLimited = false;
  let partial = false;

  function outOfTime() {
    if (!deadlineAt) return false;
    return Date.now() >= Number(deadlineAt) - Math.max(0, Number(minRemainingMs) || 0);
  }

  async function pace() {
    if (!paced) {
      paced = true;
      return;
    }
    if (pacingMs > 0) await sleep(pacingMs);
  }

  async function publicGet(url, accept) {
    if (httpCalls >= maxHttpCalls) {
      partial = true;
      return { skipped: true, reason: 'tiktok_public_http_cap' };
    }
    if (outOfTime()) {
      partial = true;
      return { skipped: true, reason: 'source_sweep_time_budget_exhausted' };
    }
    await pace();
    httpCalls += 1;
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: accept,
        'User-Agent': USER_AGENT,
      },
    });
    return { response };
  }

  for (const source of selected) {
    if (rateLimited || partial) break;
    const pageUrl = tiktokPublicSourceUrl(source);
    const sourceKey = String(source.source_key || source.key || pageUrl || 'tiktok-source');
    const sourceName = String(source.source_name || source.name || sourceKey);
    if (!pageUrl) {
      reports.push({
        source_key: sourceKey,
        source_name: sourceName,
        source_url: String(source.source_url || source.url || ''),
        classification: 'skipped',
        reason: 'not_a_public_tiktok_https_page',
        video_urls_found: 0,
      });
      continue;
    }
    let fetched;
    try {
      fetched = await publicGet(pageUrl, 'text/html,application/xhtml+xml');
    } catch (error) {
      reports.push({
        source_key: sourceKey,
        source_name: sourceName,
        source_url: pageUrl,
        classification: 'unreachable',
        reason: error?.message || 'tiktok_public_page_request_failed',
        video_urls_found: 0,
      });
      continue;
    }
    if (fetched.skipped) {
      reports.push({
        source_key: sourceKey,
        source_name: sourceName,
        source_url: pageUrl,
        classification: 'skipped',
        reason: fetched.reason,
        video_urls_found: 0,
      });
      break;
    }
    const response = fetched.response;
    const status = Number(response?.status) || 0;
    const location = headerValue(response, 'location');
    let html = '';
    if (status === 200 && typeof response.text === 'function') {
      html = String(await response.text().catch(() => '')).slice(0, PUBLIC_HTML_SCAN_CHARS);
    }
    const pageVideos = status === 200 ? videoUrlsFromPublicHtml(html) : [];
    const classification = classifyTikTokPublicPage({
      status,
      location,
      html,
      videoCount: pageVideos.length,
    });
    const accepted = [];
    for (const videoUrl of pageVideos) {
      if (seenVideos.has(videoUrl)) {
        duplicatesSkipped += 1;
        continue;
      }
      const postedAt = videoPostedAtIso(videoUrl);
      if (postedAt && Number.isFinite(floorMs) && Date.parse(postedAt) < floorMs) {
        outsideLookback += 1;
        seenVideos.add(videoUrl);
        continue;
      }
      if (accepted.length >= maxVideosPerSource) break;
      seenVideos.add(videoUrl);
      accepted.push({ videoUrl, postedAt, sourceKey, sourceName, pageUrl });
    }
    const report = {
      source_key: sourceKey,
      source_name: sourceName,
      source_url: pageUrl,
      http_status: status || null,
      classification,
      reason: classification === 'ok' ? '' : classification,
      video_urls_found: pageVideos.length,
      video_urls_accepted: accepted.length,
    };
    reports.push(report);
    if (classification === 'broken') brokenSources.push(report);
    else if (classification === 'auth_wall') authWallSources.push(report);
    else if (classification === 'no_public_video_urls') noVideoSources.push(report);
    else if (classification === 'rate_limited') {
      rateLimited = true;
      partial = true;
    }
    videosForOembed.push(...accepted);
  }

  const oembedByUrl = {};
  const oembedReportsByUrl = {};
  const seeds = [];
  function seedFromVideo(video) {
    return {
      post_url: video.videoUrl,
      source_url: video.videoUrl,
      source_registry_key: video.sourceKey,
      source_key: video.sourceKey,
      source_name: video.sourceName,
      source_page_url: video.pageUrl,
      source_contact_url: video.pageUrl,
      first_posted_at: video.postedAt,
      platform_posted_at: video.postedAt,
      discovery_method: TIKTOK_PUBLIC_SWEEP_METHOD,
      public_sweep: true,
    };
  }
  const stopHttp = rateLimited || partial;
  if (stopHttp) seeds.push(...videosForOembed.slice(0, maxOembed).map(seedFromVideo));
  for (const video of stopHttp ? [] : videosForOembed) {
    if (seeds.length >= maxOembed || rateLimited || partial) {
      if (seeds.length >= maxOembed) partial = true;
      break;
    }
    const { TIKTOK_OEMBED_URL } = discoveryApi();
    const endpoint = new URL(TIKTOK_OEMBED_URL);
    endpoint.searchParams.set('url', video.videoUrl);
    let fetched;
    try {
      fetched = await publicGet(endpoint, 'application/json');
    } catch (error) {
      oembedReportsByUrl[video.videoUrl] = {
        post_url: video.videoUrl,
        ok: false,
        reason: error?.message || 'tiktok_oembed_failed',
      };
      continue;
    }
    if (fetched.skipped) {
      partial = true;
      break;
    }
    const response = fetched.response;
    const status = Number(response?.status) || 0;
    const payload = typeof response?.json === 'function'
      ? await response.json().catch(() => ({}))
      : {};
    if (status === 429) {
      rateLimited = true;
      partial = true;
      reports.push({
        source_key: video.sourceKey,
        source_url: video.videoUrl,
        http_status: 429,
        classification: 'rate_limited',
        reason: 'tiktok_oembed_rate_limited',
      });
      break;
    }
    const ok = status >= 200 && status < 300 && payload && typeof payload === 'object';
    oembedReportsByUrl[video.videoUrl] = {
      post_url: video.videoUrl,
      ok,
      status: status || null,
      reason: ok ? '' : (payload?.message || payload?.error || 'tiktok_oembed_failed'),
    };
    if (status === 404 || status === 410) {
      brokenSources.push({
        source_key: video.sourceKey,
        source_name: video.sourceName,
        source_url: video.videoUrl,
        http_status: status,
        classification: 'broken',
        reason: 'tiktok_oembed_unavailable',
      });
      continue;
    }
    if (ok) oembedByUrl[video.videoUrl] = payload;
    seeds.push(seedFromVideo(video));
  }

  const { buildTikTokExactPostImportRows } = discoveryApi();
  const posts = seeds.length
    ? buildTikTokExactPostImportRows({
      posts: seeds,
      oembedByUrl,
      oembedReportsByUrl,
    })
    : [];

  return {
    enabled: true,
    skipped_reason: partial ? 'tiktok_public_sweep_partial' : '',
    method: TIKTOK_PUBLIC_SWEEP_METHOD,
    sources_considered: selected.length,
    sources_fetched: reports.filter((item) => item.http_status).length,
    http_call_count: httpCalls,
    video_urls_found: seenVideos.size,
    duplicates_skipped: duplicatesSkipped,
    outside_lookback_count: outsideLookback,
    oembed_fetch_count: Object.keys(oembedReportsByUrl).length,
    posts,
    broken_sources: brokenSources,
    auth_wall_sources: authWallSources,
    no_video_sources: noVideoSources,
    rate_limited: rateLimited,
    partial_results: partial,
    reports,
    limits: {
      pacing_ms: pacingMs,
      max_sources: maxSources,
      max_videos_per_source: maxVideosPerSource,
      max_oembed: maxOembed,
      max_http_calls: maxHttpCalls,
    },
    cannot_capture: CANNOT_CAPTURE,
  };
}

module.exports = {
  CANNOT_CAPTURE,
  DEFAULT_MAX_OEMBED,
  DEFAULT_MAX_SOURCES,
  DEFAULT_MAX_VIDEOS_PER_SOURCE,
  DEFAULT_PACING_MS,
  TIKTOK_PUBLIC_SWEEP_METHOD,
  classifyTikTokPublicPage,
  fetchTikTokPublicSourcePosts,
  tiktokPublicSourceUrl,
  tiktokSourceSweepEnabled,
  videoPostedAtIso,
  videoUrlsFromPublicHtml,
};
