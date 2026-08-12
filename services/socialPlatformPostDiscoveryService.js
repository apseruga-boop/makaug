'use strict';

const {
  getPropertySourceRegistry,
  sourceRecordKind,
} = require('./propertySourceRegistryService');
const {
  FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
  LAUNCH_SOURCE_POST_WINDOW_START,
  queueFoundOnlineSourcePostListings,
  reprocessExistingFoundOnlineSourcePostListings,
} = require('./socialSearchSourcedListingsService');
const {
  cloudMediaStorageConfigured,
  storeRemoteImageUrl,
} = require('./cloudMediaStorageService');
const {
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText,
} = require('../utils/locationRegistry');
const {
  maskPhonesForPriceExtraction,
  normalizeUgandanSourcePhone,
  ugandanPhoneFromSourceText,
} = require('../utils/sourceIntakeIntegrity');
const { resolveSourceShortUrl } = require('../utils/sourceUrlNormalization');
const {
  buildHarvestFingerprints,
  primaryImagePerceptualHashes,
} = require('./propertyHarvestDedupService');
const { recordHarvestImportResult } = require('./propertyHarvestMonitoringService');

const SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID = 'social_platform_post_discovery_20260525';
const DEFAULT_MAX_SOURCES = 40;
const MAX_PLATFORM_SWEEP_SOURCES = 60000;
const SOCIAL_SWEEP_FAST_MAX_SOURCES = 60;
const SOCIAL_SWEEP_FAST_DEFAULT_SOURCES = 50;
const SOCIAL_SWEEP_FAST_MAX_RESULTS_PER_SOURCE = 25;
const SOCIAL_SWEEP_FAST_MAX_PAGES_PER_SOURCE = 1;
const SOCIAL_SWEEP_BACKFILL_MAX_PAGES_PER_SOURCE = 10;
const SOCIAL_SWEEP_TIKTOK_DATA_SOURCE_MAX_POSTS = 200;
const SOCIAL_SWEEP_IMPORT_POST_LIMIT = 60;
const DEFAULT_SOCIAL_SWEEP_TIME_BUDGET_MS = 45000;
const MAX_SOCIAL_SWEEP_TIME_BUDGET_MS = 45000;
const SOCIAL_SWEEP_MIN_REMAINING_MS = 2500;
const SOCIAL_SWEEP_COMMIT_RESERVE_MS = 12000;
const SOCIAL_SWEEP_BACKLOG_MIN_REMAINING_MS = 20000;
const SOCIAL_SWEEP_REQUEST_TIMEOUT_MS = 5500;
const SOCIAL_SWEEP_SOURCE_START_MIN_REMAINING_MS = SOCIAL_SWEEP_COMMIT_RESERVE_MS + SOCIAL_SWEEP_REQUEST_TIMEOUT_MS;
const SOCIAL_SWEEP_BACKLOG_REPROCESS_LIMIT = 5;
const DEFAULT_X_RESULTS_PER_SOURCE = 25;
const X_TWEET_LOOKUP_URL = 'https://api.x.com/2/tweets';
const X_RECENT_SEARCH_URL = 'https://api.x.com/2/tweets/search/recent';
const X_FULL_ARCHIVE_SEARCH_URL = 'https://api.x.com/2/tweets/search/all';
const X_USER_TIMELINE_URL_BASE = 'https://api.x.com/2/users';
const DEFAULT_X_AUTHOR_EXPANSION_LIMIT = 3;
const X_BEARER_ENV_NAMES = ['X_BEARER_TOKEN', 'TWITTER_BEARER_TOKEN', 'X_API_BEARER_TOKEN'];
const X_FULL_ARCHIVE_SEARCH_PACING_MS = 1100;
const DEFAULT_YOUTUBE_RESULTS_PER_SOURCE = 25;
const DEFAULT_YOUTUBE_PAGES_PER_SOURCE = 1;
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_COMMENT_THREADS_URL = 'https://www.googleapis.com/youtube/v3/commentThreads';
const YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed';
const YOUTUBE_SOURCE_POST_WINDOW_START = '2026-01-01T00:00:00.000Z';
const DEFAULT_YOUTUBE_COMMENT_LOOKUP_LIMIT = 80;
const DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO = 3;
const DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT = 160;
const YOUTUBE_SOURCE_TEXT_ENRICHMENT_VERSION = 'youtube-source-text-enrichment-20260707';
const YOUTUBE_PENDING_REPROCESS_ADVISORY_LOCK_ID = 2026070701;
const YOUTUBE_API_KEY_ENV_NAMES = ['YOUTUBE_API_KEY', 'GOOGLE_YOUTUBE_API_KEY', 'GOOGLE_API_KEY'];
const META_GRAPH_ACCESS_TOKEN_ENV_NAMES = ['META_GRAPH_ACCESS_TOKEN', 'FACEBOOK_GRAPH_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'INSTAGRAM_GRAPH_ACCESS_TOKEN'];
const FACEBOOK_PAGE_ID_ENV_NAMES = ['FACEBOOK_PAGE_IDS', 'FACEBOOK_PAGE_ID'];
const INSTAGRAM_BUSINESS_ACCOUNT_ID_ENV_NAMES = ['INSTAGRAM_BUSINESS_ACCOUNT_IDS', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'];
const TIKTOK_ACCESS_TOKEN_ENV_NAMES = ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_RESEARCH_API_ACCESS_TOKEN'];
const TIKTOK_CLIENT_KEY_ENV_NAMES = ['TIKTOK_CLIENT_KEY'];
const TIKTOK_CLIENT_SECRET_ENV_NAMES = ['TIKTOK_CLIENT_SECRET'];
const TIKTOK_DATA_SOURCE_URL_ENV_NAMES = ['TIKTOK_DATA_SOURCE_URL', 'TIKTOK_SOURCE_FEED_URL', 'TIKTOK_SEARCH_EXPORT_URL'];
const TIKTOK_OEMBED_URL = 'https://www.tiktok.com/oembed';
const KING_TIKTOK_HARVEST_E2E_MARKER = 'king-tiktok-harvester-e2e-20260809';
const TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION = 'tiktok-oembed-thumbnail-reprocess-20260709';
const TIKTOK_OEMBED_THUMBNAIL_CACHE_VERSION = 'tiktok-oembed-thumbnail-cache-20260709';
const DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT = 80;
const TIKTOK_PENDING_REPROCESS_ADVISORY_LOCK_ID = 2026070902;
const TIKTOK_EXACT_VIDEO_URL_PATTERN = /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i;
const TIKTOK_EXACT_VIDEO_URL_GLOBAL_PATTERN = /https?:\/\/(?:www\.)?tiktok\.com\/@[^/\s?#]+\/video\/\d+(?:[^\s]*)?/ig;
const SOCIAL_URL_GLOBAL_PATTERN = /https?:\/\/[^\s<>"']+/ig;

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function metadataReportIsRetryable(report = {}) {
  const status = Number(report.status || 0);
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchMetadataWithRetry(fetcher, {
  maxAttempts = 3,
  baseDelayMs = 50,
  fallbackReason = 'metadata_fetch_failed',
} = {}) {
  let report = null;
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      report = await fetcher();
    } catch (error) {
      report = { ok: false, reason: error.message || fallbackReason };
    }
    report = { ...(report || {}), attempts: attempt, retried: attempt > 1 };
    if (report.ok === true || !metadataReportIsRetryable(report) || attempt === attempts) return report;
    await delay(baseDelayMs * (2 ** (attempt - 1)));
  }
  return report || { ok: false, reason: fallbackReason, attempts: 0, retried: false };
}

const CORE_PROPERTY_QUERY = [
  'property', 'house', 'home', 'apartment', 'land', 'plot', 'rent', 'rental',
  '"for sale"', '"to let"', 'hostel', '"student accommodation"', 'commercial', 'warehouse',
].join(' OR ');

const YOUTUBE_LOCAL_LANGUAGE_QUERY_TERMS = [
  'ettaka', 'bibanja', 'ebibanja', 'akabanja', 'amayumba', 'nyumba',
  'nyumba ya kupanga', 'nyumba inauzwa', 'kupangisa', 'obupangisa',
  'muzigo', 'emizigo', 'kiwanja', 'viwanja',
];

const YOUTUBE_CATEGORY_QUERY_TERMS = {
  sale: ['house for sale', 'homes for sale', 'property for sale', 'house tour'],
  rent: ['rent', 'rental', 'to let', 'apartment for rent', 'house for rent', 'monthly'],
  land: ['land for sale', 'plots for sale', 'plot', 'acres', 'decimals', 'mailo', 'title'],
  students: ['student accommodation', 'hostel', 'student room', 'campus', 'Makerere', 'Kyambogo', 'MUBS', 'UCU'],
  commercial: ['commercial property', 'office space', 'shop for rent', 'warehouse', 'showroom', 'factory', 'arcade'],
};

const GENERIC_YOUTUBE_LOCATION_TERMS = new Set([
  'uganda',
  'kampala',
  'wakiso',
  'greater kampala',
]);

const UGANDA_LOCATION_QUERY = [
  'Uganda', 'Kampala', 'Wakiso', 'Mukono', 'Entebbe', 'Jinja', 'Kira', 'Ntinda',
  'Naalya', 'Muyenga', 'Namugongo', 'Najjera', 'Makerere', 'Kyambogo',
  'MUBS', 'UCU', 'Ndejje', 'Nakawa', 'Banda', 'Kikoni', 'Namanve', 'Kikuubo',
].join(' OR ');

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourceVisualTextFromObject(source = {}) {
  const values = [
    source.source_visual_text,
    source.visual_text,
    source.video_text,
    source.video_ocr_text,
    source.frame_text,
    source.frame_ocr_text,
    source.image_text,
    source.image_ocr_text,
    source.screen_text,
    source.overlay_text,
    source.still_text,
    source.ocr_text,
  ].flatMap((value) => (Array.isArray(value) ? value : [value]));
  return cleanText(values.filter(Boolean).join(' '));
}

function sourceListingTitleFromText(value = '') {
  const raw = cleanText(value);
  if (!raw) return '';
  const labelled = raw.match(/\b(?:listing|title|property)\s*:\s*([^.!?]+?)(?=\s+(?:overview|location and access|apartment highlights|house highlights|property highlights|who this suits)\b|$)/i);
  if (labelled) return cleanText(labelled[1]);
  const patterns = [
    /\b(?:Luxury\s+)?(?:\d{1,2}\s*(?:-)?\s*)?(?:bedroom|bed|br|studio)\s+(?:apartment|flat|house|home|villa|mansion|bungalow|property)\s+for\s+(?:rent|sale)\s+in\s+[^.!?]+/i,
    /\b(?:Luxury\s+)?(?:apartment|flat|house|home|villa|mansion|bungalow|property)\s+for\s+(?:rent|sale)\s+in\s+[^.!?]+/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return cleanText(match[0]);
  }
  return '';
}

function normalizePlatform(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'twitter') return 'x';
  return normalized;
}

function envBearerToken(env = process.env) {
  for (const name of X_BEARER_ENV_NAMES) {
    const token = String(env[name] || '').trim();
    if (token) return { name, token };
  }
  return { name: '', token: '' };
}

function envYouTubeApiKey(env = process.env) {
  for (const name of YOUTUBE_API_KEY_ENV_NAMES) {
    const apiKey = String(env[name] || '').trim();
    if (apiKey) return { name, apiKey };
  }
  return { name: '', apiKey: '' };
}

function envValue(names = [], env = process.env) {
  for (const name of names) {
    const value = String(env[name] || '').trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

function envListValue(names = [], env = process.env) {
  const found = envValue(names, env);
  const values = found.value
    ? found.value.split(',').map((value) => cleanText(value)).filter(Boolean)
    : [];
  return { ...found, values };
}

function socialDiscoveryApiReadiness(env = process.env) {
  const youtube = envYouTubeApiKey(env);
  const x = envBearerToken(env);
  const metaToken = envValue(META_GRAPH_ACCESS_TOKEN_ENV_NAMES, env);
  const facebookPageIds = envListValue(FACEBOOK_PAGE_ID_ENV_NAMES, env);
  const instagramBusinessIds = envListValue(INSTAGRAM_BUSINESS_ACCOUNT_ID_ENV_NAMES, env);
  const tiktokAccessToken = envValue(TIKTOK_ACCESS_TOKEN_ENV_NAMES, env);
  const tiktokClientKey = envValue(TIKTOK_CLIENT_KEY_ENV_NAMES, env);
  const tiktokClientSecret = envValue(TIKTOK_CLIENT_SECRET_ENV_NAMES, env);
  const tiktokDataSourceUrl = envValue(TIKTOK_DATA_SOURCE_URL_ENV_NAMES, env);
  return {
    source_registry_target_count: MAX_PLATFORM_SWEEP_SOURCES,
    youtube: {
      configured: Boolean(youtube.apiKey),
      credential_env: youtube.name || '',
      mode: 'direct_youtube_data_api_search',
      required_any_of: YOUTUBE_API_KEY_ENV_NAMES,
    },
    x: {
      configured: Boolean(x.token),
      credential_env: x.name || '',
      mode: 'direct_x_api_search',
      required_any_of: X_BEARER_ENV_NAMES,
    },
    facebook: {
      configured: Boolean(metaToken.value && facebookPageIds.values.length),
      credential_env: metaToken.value ? metaToken.name : '',
      page_ids_env: facebookPageIds.value ? facebookPageIds.name : '',
      mode: 'meta_graph_page_or_post_review_then_exact_link_import',
      required_any_of: META_GRAPH_ACCESS_TOKEN_ENV_NAMES,
      required_page_id_env_any_of: FACEBOOK_PAGE_ID_ENV_NAMES,
      note: 'Facebook broad public search is not treated as available. Use approved Graph access for owned/approved pages, then import exact public post URLs through King review.',
    },
    instagram: {
      configured: Boolean(metaToken.value && instagramBusinessIds.values.length),
      credential_env: metaToken.value ? metaToken.name : '',
      business_account_ids_env: instagramBusinessIds.value ? instagramBusinessIds.name : '',
      mode: 'instagram_graph_hashtag_or_business_media_then_exact_link_import',
      required_any_of: META_GRAPH_ACCESS_TOKEN_ENV_NAMES,
      required_business_account_env_any_of: INSTAGRAM_BUSINESS_ACCOUNT_ID_ENV_NAMES,
      note: 'Instagram hashtag/media access requires an eligible Instagram Business or Creator account connected through Meta Graph permissions.',
    },
    tiktok: {
      configured: Boolean(tiktokAccessToken.value || (tiktokClientKey.value && tiktokClientSecret.value) || tiktokDataSourceUrl.value),
      credential_env: tiktokAccessToken.value ? tiktokAccessToken.name : '',
      client_key_env: tiktokClientKey.value ? tiktokClientKey.name : '',
      client_secret_env: tiktokClientSecret.value ? tiktokClientSecret.name : '',
      data_source_url_env: tiktokDataSourceUrl.value ? tiktokDataSourceUrl.name : '',
      mode: 'official_tiktok_api_or_configured_data_source_plus_oembed_exact_url_import',
      required_any_of: TIKTOK_ACCESS_TOKEN_ENV_NAMES,
      required_client_env_any_of: [...TIKTOK_CLIENT_KEY_ENV_NAMES, ...TIKTOK_CLIENT_SECRET_ENV_NAMES],
      required_data_source_env_any_of: TIKTOK_DATA_SOURCE_URL_ENV_NAMES,
      note: 'TikTok broad public discovery is approval-gated. Current production-safe path uses exact video URLs plus TikTok oEmbed thumbnails and King evidence review; configure a TikTok data-source/export URL when official search access is not available.',
    },
  };
}

function cappedNumber(value, fallback, min = 1, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
}

function sweepTimeBudgetMs(value, env = process.env) {
  return cappedNumber(
    value ?? env.STAFF_SOCIAL_SWEEP_TIME_BUDGET_MS,
    DEFAULT_SOCIAL_SWEEP_TIME_BUDGET_MS,
    1,
    MAX_SOCIAL_SWEEP_TIME_BUDGET_MS
  );
}

function sweepRemainingMs(deadlineAt = 0) {
  const parsed = Number(deadlineAt);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, parsed - Date.now());
}

function sweepDeadlineReached(deadlineAt = 0, minRemainingMs = SOCIAL_SWEEP_MIN_REMAINING_MS) {
  return sweepRemainingMs(deadlineAt) <= Math.max(0, Number(minRemainingMs) || 0);
}

function sourceSweepTimeoutError(reason = 'source_sweep_time_budget_exhausted') {
  const error = new Error(reason);
  error.code = 'SOURCE_SWEEP_TIME_BUDGET_EXHAUSTED';
  error.reason = reason;
  return error;
}

function sourceSweepErrorReason(error) {
  if (error?.code === 'SOURCE_SWEEP_TIME_BUDGET_EXHAUSTED') return error.reason || 'source_sweep_time_budget_exhausted';
  return error?.message || 'source_sweep_fetch_failed';
}

function fetchWithSweepDeadline(fetchImpl = fetch, deadlineAt = 0, {
  perRequestTimeoutMs = SOCIAL_SWEEP_REQUEST_TIMEOUT_MS,
} = {}) {
  return async (url, options = {}) => {
    const remaining = sweepRemainingMs(deadlineAt);
    if (remaining <= 0) throw sourceSweepTimeoutError();
    const timeoutMs = Math.max(1, Math.min(Number(perRequestTimeoutMs) || SOCIAL_SWEEP_REQUEST_TIMEOUT_MS, remaining));
    const supportsAbort = typeof AbortController !== 'undefined';
    const controller = supportsAbort ? new AbortController() : null;
    const upstreamSignal = options?.signal;
    let upstreamAbortHandler = null;
    if (controller && upstreamSignal) {
      if (upstreamSignal.aborted) throw sourceSweepTimeoutError('source_sweep_api_call_aborted');
      upstreamAbortHandler = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener('abort', upstreamAbortHandler, { once: true });
    }
    let timeout = null;
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        if (controller) controller.abort();
        reject(sourceSweepTimeoutError('source_sweep_api_call_timed_out'));
      }, timeoutMs);
    });
    try {
      const requestOptions = controller ? { ...options, signal: controller.signal } : options;
      const fetchPromise = Promise.resolve(fetchImpl(url, requestOptions)).catch((error) => {
        if (timedOut || error?.name === 'AbortError') {
          throw sourceSweepTimeoutError(timedOut ? 'source_sweep_api_call_timed_out' : 'source_sweep_api_call_aborted');
        }
        throw error;
      });
      return await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (upstreamSignal && upstreamAbortHandler) {
        upstreamSignal.removeEventListener('abort', upstreamAbortHandler);
      }
    }
  };
}

function cappedOffset(value, max = MAX_PLATFORM_SWEEP_SOURCES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed), max);
}

function isoStartTimeForLookbackDays(days = 0) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  const ms = Math.round(parsed) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function urlParam(url = '', key = '') {
  try {
    return new URL(url).searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

function sourceUrl(source = {}) {
  return cleanText(source.source_url || source.url || source.channel_url || source.website_url);
}

function sourceKey(source = {}) {
  return cleanText(source.source_key || source.key || source.source_name || source.name || sourceUrl(source));
}

function sourceName(source = {}) {
  return cleanText(source.source_name || source.name || source.handle || sourceKey(source));
}

function sourceListValues(source = {}, camelKey = '', snakeKey = '') {
  const value = source[camelKey] || source[snakeKey] || [];
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '')
    .split(/[,|]/)
    .map(cleanText)
    .filter(Boolean);
}

function sourceHandle(source = {}) {
  const handle = cleanText(source.handle || source.username);
  if (handle) return handle.replace(/^@/, '');
  const url = sourceUrl(source);
  const match = url.match(/(?:x|twitter)\.com\/([^/?#]+)/i) || url.match(/tiktok\.com\/@([^/?#]+)/i);
  if (!match) return '';
  const value = match[1];
  return value && !['search', 'hashtag', 'tag'].includes(value.toLowerCase()) ? value.replace(/^@/, '') : '';
}

function sourceHashtag(source = {}) {
  const tags = Array.isArray(source.hashtags) ? source.hashtags : [];
  const url = sourceUrl(source);
  const tagMatch = url.match(/(?:tiktok\.com\/tag|youtube\.com\/hashtag|instagram\.com\/explore\/tags|facebook\.com\/hashtag)\/([^/?#]+)/i);
  if (tagMatch) return decodeURIComponent(tagMatch[1]);
  return cleanText(tags[0] || '').replace(/^#/, '');
}

function sourceHashtags(source = {}) {
  const tags = [];
  const first = sourceHashtag(source);
  if (first) tags.push(first);
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  [
    ...(Array.isArray(source.hashtags) ? source.hashtags : []),
    metadata.hashtag,
    ...(Array.isArray(metadata.hashtag_watchlist) ? metadata.hashtag_watchlist : []),
  ].forEach((tag) => {
    const cleaned = cleanText(tag).replace(/^#/, '');
    if (cleaned) tags.push(cleaned);
  });
  const seen = new Set();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeYouTubeVideoId(value = '') {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{6,}$/.test(raw) && !/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (/youtu\.be$/i.test(url.hostname)) return url.pathname.split('/').filter(Boolean)[0] || '';
    if (/youtube\.com$/i.test(url.hostname) || /\.youtube\.com$/i.test(url.hostname)) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const shorts = url.pathname.match(/^\/shorts\/([^/?#]+)/i);
      if (shorts) return shorts[1] || '';
      const embed = url.pathname.match(/^\/embed\/([^/?#]+)/i);
      if (embed) return embed[1] || '';
    }
  } catch (_) {}
  return '';
}

function youtubeWatchUrl(videoId = '') {
  const id = normalizeYouTubeVideoId(videoId);
  return id ? `https://www.youtube.com/watch?v=${id}` : '';
}

function normalizeYouTubeVideoUrl(value = '') {
  return youtubeWatchUrl(value);
}

function youtubeChannelUrl(channelId = '') {
  const id = cleanText(channelId);
  return id ? `https://www.youtube.com/channel/${id}` : '';
}

function youtubeHandleUrl(handle = '') {
  const value = cleanText(handle).replace(/^@/, '');
  return value ? `https://www.youtube.com/@${value}` : '';
}

function youtubeChannelIdFromUrl(value = '') {
  const raw = cleanText(value);
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{20,})/i);
    return match ? match[1] : '';
  } catch (_) {
    return '';
  }
}

function youtubeHandleFromUrl(value = '') {
  const raw = cleanText(value);
  if (/^@?[a-zA-Z0-9._-]{3,}$/.test(raw) && !/^https?:\/\//i.test(raw)) return raw.replace(/^@/, '');
  try {
    const url = new URL(raw);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/^\/@([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]).replace(/^@/, '') : '';
  } catch (_) {
    return '';
  }
}

function normalizeYouTubeChannelSourceUrl(value = '') {
  const raw = cleanText(value);
  if (!raw) return '';
  const channelId = youtubeChannelIdFromUrl(raw);
  if (channelId) return youtubeChannelUrl(channelId);
  const handle = youtubeHandleFromUrl(raw);
  if (handle) return youtubeHandleUrl(handle);
  return '';
}

function normalizeTikTokVideoUrl(value = '') {
  const raw = cleanText(value).replace(/[),.;]+$/g, '');
  if (!raw) return '';
  const httpsUrl = raw.replace(/^http:\/\//i, 'https://');
  return TIKTOK_EXACT_VIDEO_URL_PATTERN.test(httpsUrl) ? httpsUrl : '';
}

function extractTikTokVideoUrls(text = '') {
  const matches = String(text || '').match(TIKTOK_EXACT_VIDEO_URL_GLOBAL_PATTERN) || [];
  return [...new Set(matches.map(normalizeTikTokVideoUrl).filter(Boolean))];
}

function tiktokHandleFromUrl(url = '') {
  const match = cleanText(url).match(/tiktok\.com\/@([^/?#]+)/i);
  return match ? match[1] : '';
}

function tiktokProfileUrlFromVideoUrl(url = '') {
  const handle = tiktokHandleFromUrl(url);
  return handle ? `https://www.tiktok.com/@${handle}` : '';
}

function normalizeXPostUrl(value = '') {
  const raw = cleanText(value).replace(/[),.;]+$/g, '').replace(/^http:\/\//i, 'https://');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return '';
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
    if (!match) return '';
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch (_) {
    return '';
  }
}

function normalizeInstagramPostUrl(value = '') {
  const raw = cleanText(value).replace(/[),.;]+$/g, '').replace(/^http:\/\//i, 'https://');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/^\/(p|reel|tv)\/([^/?#]+)/i);
    if (!match) return '';
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  } catch (_) {
    return '';
  }
}

function normalizeFacebookPostUrl(value = '') {
  const raw = cleanText(value).replace(/[),.;]+$/g, '').replace(/^http:\/\//i, 'https://');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname) && !/^fb\.watch$/i.test(url.hostname)) return '';
    const path = url.pathname.replace(/\/+$/g, '');
    if (!/(\/posts\/|\/videos\/|\/reel\/|\/watch\/|\/share\/|\/permalink\.php|\/photo(?:\.php)?)/i.test(`${path}${url.search}`)) {
      return '';
    }
    return `https://www.facebook.com${path || '/'}${url.search || ''}`;
  } catch (_) {
    return '';
  }
}

function normalizeExactSocialPostUrl(value = '') {
  const raw = cleanText(value).replace(/[),.;]+$/g, '');
  return normalizeTikTokVideoUrl(raw)
    || normalizeYouTubeVideoUrl(raw)
    || normalizeXPostUrl(raw)
    || normalizeInstagramPostUrl(raw)
    || normalizeFacebookPostUrl(raw)
    || '';
}

function extractExactSocialPostUrls(text = '') {
  const matches = String(text || '').match(SOCIAL_URL_GLOBAL_PATTERN) || [];
  return [...new Set(matches.map(normalizeExactSocialPostUrl).filter(Boolean))];
}

function platformForExactSocialPostUrl(url = '') {
  const raw = cleanText(url);
  if (/tiktok\.com/i.test(raw)) return 'TikTok';
  if (/youtube\.com|youtu\.be/i.test(raw)) return 'YouTube';
  if (/(^|\/\/)(x|twitter)\.com/i.test(raw)) return 'X';
  if (/instagram\.com/i.test(raw)) return 'Instagram';
  if (/facebook\.com|fb\.watch/i.test(raw)) return 'Facebook';
  return 'Social';
}

function sourcePageUrlFromExactPostUrl(url = '') {
  const exactUrl = cleanText(url);
  if (/tiktok\.com/i.test(exactUrl)) return tiktokProfileUrlFromVideoUrl(exactUrl);
  if (/(^|\/\/)(x|twitter)\.com/i.test(exactUrl)) {
    const match = exactUrl.match(/x\.com\/([^/]+)\/status/i);
    return match ? `https://x.com/${match[1]}` : '';
  }
  if (/instagram\.com/i.test(exactUrl)) {
    try {
      const parsed = new URL(exactUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts.length > 2 ? `https://www.instagram.com/${parts[0]}/` : '';
    } catch (_) {}
  }
  if (/facebook\.com/i.test(exactUrl)) {
    try {
      const parsed = new URL(exactUrl);
      const first = parsed.pathname.split('/').filter(Boolean)[0];
      return first && !/^(watch|reel|share|permalink\.php|photo\.php)$/i.test(first)
        ? `https://www.facebook.com/${first}`
        : '';
    } catch (_) {}
  }
  return '';
}

function fieldKey(value = '') {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseDelimitedTikTokLine(line = '') {
  const url = extractTikTokVideoUrls(line)[0] || '';
  if (!url || !line.includes('|')) return null;
  const parts = line.split('|').map((part) => cleanText(part)).filter(Boolean);
  const withoutUrl = parts.filter((part) => !extractTikTokVideoUrls(part).length);
  return {
    post_url: url,
    title: withoutUrl[0] || '',
    area: withoutUrl[1] || '',
    price_text: withoutUrl[2] || '',
    first_posted_at: withoutUrl[3] || '',
    caption: withoutUrl.join(' '),
  };
}

function parseDelimitedSocialLine(line = '') {
  const url = extractExactSocialPostUrls(line)[0] || '';
  if (!url || !line.includes('|')) return null;
  const parts = line.split('|').map((part) => cleanText(part)).filter(Boolean);
  const withoutUrl = parts.filter((part) => !extractExactSocialPostUrls(part).length);
  return {
    post_url: url,
    title: withoutUrl[0] || '',
    area: withoutUrl[1] || '',
    price_text: withoutUrl[2] || '',
    first_posted_at: withoutUrl[3] || '',
    caption: withoutUrl.join(' '),
  };
}

function parseTikTokFields(block = '') {
  const fields = {};
  const freeText = [];
  for (const rawLine of String(block || '').split(/\r?\n/)) {
    const line = cleanText(rawLine);
    if (!line) continue;
    const fieldMatch = line.match(/^([a-zA-Z][a-zA-Z _-]{1,32})\s*:\s*(.+)$/);
    if (fieldMatch) {
      const key = fieldKey(fieldMatch[1]);
      const value = cleanText(fieldMatch[2]);
      if (key) fields[key] = value;
      continue;
    }
    if (!extractTikTokVideoUrls(line).length && !extractExactSocialPostUrls(line).length) freeText.push(line);
  }
  if (freeText.length && !fields.caption && !fields.description) {
    fields.caption = freeText.join(' ');
  }
  return fields;
}

function normalizeParsedTikTokFields(fields = {}) {
  const commentEvidence = cleanText([
    fields.comments,
    fields.comment,
    fields.owner_comment,
    fields.owner_comments,
    fields.owner_response,
    fields.poster_reply,
    fields.poster_response,
    fields.reply,
    fields.replies,
  ].filter(Boolean).join(' '));
  return {
    title: fields.title || fields.property || fields.listing || '',
    caption: fields.caption || fields.description || fields.notes || '',
    comments: commentEvidence,
    area: fields.area || fields.location || fields.neighbourhood || fields.neighborhood || '',
    district: fields.district || fields.city || '',
    price_text: fields.price || fields.price_text || fields.guide_price || '',
    listing_type: fields.type || fields.listing_type || fields.category || '',
    bedrooms: fields.bedrooms || fields.beds || '',
    bathrooms: fields.bathrooms || fields.baths || '',
    first_posted_at: fields.posted || fields.posted_at || fields.date || fields.first_posted_at || fields.published_at || '',
    source_name: fields.source || fields.source_name || fields.agent || fields.account || '',
    source_page_url: fields.profile || fields.source_page_url || fields.source_contact_url || fields.contact_url || '',
    source_contact_url: fields.contact || fields.source_contact_url || fields.profile || '',
    contact_phone: fields.phone || fields.contact_phone || fields.whatsapp || '',
    contact_email: fields.email || fields.contact_email || '',
    image_urls: fields.images || fields.image_urls || fields.photos || fields.media_urls || '',
    source_visual_text: sourceVisualTextFromObject(fields),
    pre_approved: fields.pre_approved || fields.preapproved || fields.agent_preapproved || '',
    consent_confirmed: fields.consent_confirmed || fields.agent_authorised || fields.agent_authorized || '',
    image_rights_confirmed: fields.image_rights_confirmed || fields.authorised_images || fields.authorized_images || '',
    permission_status: fields.permission_status || '',
  };
}

function normalizeParsedSocialFields(fields = {}) {
  return {
    ...normalizeParsedTikTokFields(fields),
    post_url: fields.url || fields.post_url || fields.source_url || fields.video_url || '',
    platform: fields.platform || '',
    youtube_video_id: fields.youtube_video_id || fields.youtube_id || '',
    channel_url: fields.channel || fields.channel_url || fields.youtube_channel || '',
    profile_url: fields.profile || fields.source_page_url || fields.account || '',
  };
}

function tikTokSeedsFromText(rawText = '') {
  const blocks = String(rawText || '')
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  const seeds = [];
  for (const block of blocks.length ? blocks : [String(rawText || '')]) {
    const delimited = block.split(/\r?\n/).map(parseDelimitedTikTokLine).filter(Boolean);
    if (delimited.length) {
      seeds.push(...delimited);
      continue;
    }
    const urls = extractTikTokVideoUrls(block);
    if (!urls.length) continue;
    const fields = normalizeParsedTikTokFields(parseTikTokFields(block));
    for (const url of urls) {
      seeds.push({ ...fields, post_url: url });
    }
  }
  return seeds;
}

function tikTokSeedsFromInputs({ posts = [], urls = [], rawText = '' } = {}) {
  const postSeeds = (Array.isArray(posts) ? posts : [])
    .map((post) => (typeof post === 'string' ? { post_url: post } : post))
    .filter(Boolean);
  const urlSeeds = (Array.isArray(urls) ? urls : [])
    .map((url) => ({ post_url: url }));
  const textSeeds = tikTokSeedsFromText(rawText);
  return [...postSeeds, ...urlSeeds, ...textSeeds]
    .map((seed) => ({
      ...seed,
      post_url: normalizeTikTokVideoUrl(seed.post_url || seed.source_url || seed.url),
    }))
    .filter((seed) => seed.post_url);
}

function tikTokDataSourceItemsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['posts', 'videos', 'items', 'results', 'data', 'records', 'rows']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [payload];
}

function tikTokSeedFromDataSourceItem(item = {}, index = 0) {
  if (typeof item === 'string') return { post_url: item };
  if (!item || typeof item !== 'object') return null;
  const rawText = cleanText([
    item.caption,
    item.description,
    item.text,
    item.title,
    item.body,
    item.source_text,
    item.video_text,
    item.comments,
  ].filter(Boolean).join(' '));
  return {
    ...item,
    post_url: item.post_url || item.source_url || item.video_url || item.tiktok_url || item.url || item.link || '',
    caption: item.caption || item.description || item.text || item.title || '',
    description: item.description || item.caption || item.text || '',
    source_text: item.source_text || rawText,
    source_name: item.source_name || item.author_name || item.account_name || item.account || '',
    source_page_url: item.source_page_url || item.author_url || item.profile_url || item.profile || '',
    source_contact_url: item.source_contact_url || item.author_url || item.profile_url || item.profile || '',
    source_registry_key: item.source_registry_key || item.registry_key || `tiktok-data-source-${index + 1}`,
  };
}

function tikTokSeedsFromDataSourcePayload(payload) {
  if (typeof payload === 'string') {
    const raw = payload.trim();
    if (!raw) return [];
    try {
      return tikTokSeedsFromDataSourcePayload(JSON.parse(raw));
    } catch (_) {
      return tikTokSeedsFromInputs({ rawText: raw });
    }
  }
  const seeds = tikTokDataSourceItemsFromPayload(payload)
    .map(tikTokSeedFromDataSourceItem)
    .filter(Boolean);
  return tikTokSeedsFromInputs({ posts: seeds });
}

function socialSeedsFromText(rawText = '') {
  const blocks = String(rawText || '')
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  const seeds = [];
  for (const block of blocks.length ? blocks : [String(rawText || '')]) {
    const delimited = block.split(/\r?\n/).map(parseDelimitedSocialLine).filter(Boolean);
    if (delimited.length) {
      seeds.push(...delimited);
      continue;
    }
    const urls = extractExactSocialPostUrls(block);
    if (!urls.length) continue;
    const fields = normalizeParsedSocialFields(parseTikTokFields(block));
    for (const url of urls) {
      seeds.push({ ...fields, post_url: url });
    }
  }
  return seeds;
}

function socialSeedsFromInputs({ posts = [], urls = [], rawText = '' } = {}) {
  const postSeeds = (Array.isArray(posts) ? posts : [])
    .map((post) => (typeof post === 'string' ? { post_url: post } : post))
    .filter(Boolean);
  const urlSeeds = (Array.isArray(urls) ? urls : [])
    .map((url) => ({ post_url: url }));
  const textSeeds = socialSeedsFromText(rawText);
  return [...postSeeds, ...urlSeeds, ...textSeeds]
    .map((seed) => ({
      ...seed,
      post_url: normalizeExactSocialPostUrl(seed.post_url || seed.source_url || seed.url || seed.video_url),
    }))
    .filter((seed) => seed.post_url);
}

function normalizeTikTokOEmbed(payload = {}) {
  return {
    title: cleanText(payload.title || ''),
    author_name: cleanText(payload.author_name || ''),
    author_url: cleanText(payload.author_url || ''),
    thumbnail_url: cleanText(payload.thumbnail_url || ''),
    thumbnail_original_url: cleanText(payload.thumbnail_original_url || payload.oembed_thumbnail_original_url || ''),
    thumbnail_cache_url: cleanText(payload.thumbnail_cache_url || ''),
    thumbnail_cache_status: cleanText(payload.thumbnail_cache_status || ''),
    thumbnail_cache_error: cleanText(payload.thumbnail_cache_error || ''),
    provider_name: cleanText(payload.provider_name || 'TikTok'),
  };
}

function tiktokVideoIdFromUrl(url = '') {
  const match = cleanText(url).match(/\/video\/(\d+)/i);
  return match ? match[1] : '';
}

function tiktokThumbnailFilename(sourceUrl = '', thumbnailUrl = '') {
  const videoId = tiktokVideoIdFromUrl(sourceUrl);
  if (videoId) return `tiktok-cover-${videoId}`;
  const urlPart = cleanText(thumbnailUrl).replace(/^https?:\/\//i, '').replace(/[^a-z0-9]+/ig, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return urlPart || 'tiktok-cover';
}

async function cacheTikTokOEmbedThumbnail(oembedPayload = {}, sourceUrl = '', { fetchImpl = fetch } = {}) {
  const payload = normalizeTikTokOEmbed(oembedPayload);
  const originalThumbnailUrl = cleanText(payload.thumbnail_original_url || payload.thumbnail_url || '');
  if (!originalThumbnailUrl) {
    return {
      payload,
      report: { ok: true, skipped: true, reason: 'missing_tiktok_oembed_thumbnail_url' },
    };
  }
  if (!cloudMediaStorageConfigured()) {
    return {
      payload: {
        ...payload,
        thumbnail_original_url: originalThumbnailUrl,
        thumbnail_cache_status: 'cloud_media_storage_not_configured',
      },
      report: { ok: true, skipped: true, reason: 'cloud_media_storage_not_configured', thumbnail_original_url: originalThumbnailUrl },
    };
  }
  try {
    const cachedUrl = await storeRemoteImageUrl(originalThumbnailUrl, {
      keyPrefix: 'source-previews/tiktok',
      filename: tiktokThumbnailFilename(sourceUrl, originalThumbnailUrl),
      allowedHosts: ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'muscdn.com', 'byteoversea.com'],
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 4 * 1024 * 1024,
      label: 'TikTok oEmbed source-preview thumbnail',
      fetchImpl,
    });
    if (!cachedUrl) {
      return {
        payload: {
          ...payload,
          thumbnail_original_url: originalThumbnailUrl,
          thumbnail_cache_status: 'cloud_media_storage_not_configured',
        },
        report: { ok: true, skipped: true, reason: 'cloud_media_storage_not_configured', thumbnail_original_url: originalThumbnailUrl },
      };
    }
    return {
      payload: {
        ...payload,
        thumbnail_url: cachedUrl,
        thumbnail_cache_url: cachedUrl,
        thumbnail_original_url: originalThumbnailUrl,
        thumbnail_cache_status: 'cached_to_makaug_storage',
      },
      report: { ok: true, cached: true, thumbnail_url: cachedUrl, thumbnail_original_url: originalThumbnailUrl },
    };
  } catch (error) {
    return {
      payload: {
        ...payload,
        thumbnail_original_url: originalThumbnailUrl,
        thumbnail_cache_status: 'cache_failed_raw_oembed_url_retained',
        thumbnail_cache_error: error.message || 'tiktok_thumbnail_cache_failed',
      },
      report: {
        ok: false,
        reason: error.message || 'tiktok_thumbnail_cache_failed',
        thumbnail_original_url: originalThumbnailUrl,
      },
    };
  }
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlMetaContent(html = '', key = '') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(decodeHtmlEntities(match[1]));
  }
  return '';
}

function htmlJsonStringValue(html = '', key = '') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, 'i'));
  return match ? cleanText(decodeHtmlEntities(match[1].replace(/\\u0026/g, '&'))) : '';
}

function normalizeYouTubeOEmbed(payload = {}) {
  return {
    title: cleanText(payload.title || ''),
    author_name: cleanText(payload.author_name || ''),
    author_url: cleanText(payload.author_url || ''),
    thumbnail_url: cleanText(payload.thumbnail_url || ''),
    provider_name: cleanText(payload.provider_name || 'YouTube'),
  };
}

async function fetchYouTubeOEmbed(url = '', { fetchImpl = fetch } = {}) {
  const exactUrl = normalizeYouTubeVideoUrl(url);
  if (!exactUrl) return { ok: false, skipped: true, reason: 'missing_exact_youtube_video_url' };
  const endpoint = new URL(YOUTUBE_OEMBED_URL);
  endpoint.searchParams.set('url', exactUrl);
  endpoint.searchParams.set('format', 'json');
  const response = await fetchImpl(endpoint, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: payload?.error || payload?.message || 'youtube_oembed_failed',
      payload,
    };
  }
  return {
    ok: true,
    payload: normalizeYouTubeOEmbed(payload),
  };
}

async function fetchPublicPageMetadata(url = '', { fetchImpl = fetch } = {}) {
  const exactUrl = normalizeExactSocialPostUrl(url);
  if (!exactUrl) return { ok: false, skipped: true, reason: 'missing_exact_social_post_url' };
  const response = await fetchImpl(exactUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'makaug-found-online-source-review/1.0',
    },
  });
  const html = await response.text().catch(() => '');
  if (!response.ok || !html) {
    return {
      ok: false,
      status: response.status,
      reason: 'public_page_metadata_failed',
    };
  }
  const title = htmlMetaContent(html, 'og:title')
    || htmlMetaContent(html, 'twitter:title')
    || htmlJsonStringValue(html, 'title')
    || '';
  const description = htmlMetaContent(html, 'og:description')
    || htmlMetaContent(html, 'description')
    || htmlJsonStringValue(html, 'shortDescription')
    || htmlJsonStringValue(html, 'description')
    || '';
  const image = htmlMetaContent(html, 'og:image')
    || htmlMetaContent(html, 'twitter:image')
    || htmlMetaContent(html, 'thumbnailUrl')
    || htmlJsonStringValue(html, 'thumbnailUrl')
    || '';
  const publishedAt = htmlMetaContent(html, 'datePublished')
    || htmlMetaContent(html, 'uploadDate')
    || htmlJsonStringValue(html, 'datePublished')
    || htmlJsonStringValue(html, 'uploadDate')
    || htmlJsonStringValue(html, 'publishDate')
    || '';
  const channelId = htmlJsonStringValue(html, 'channelId') || htmlJsonStringValue(html, 'externalId') || '';
  const channelTitle = htmlJsonStringValue(html, 'ownerChannelName') || htmlJsonStringValue(html, 'author') || '';
  return {
    ok: true,
    payload: {
      title,
      description,
      image_url: image,
      published_at: publishedAt,
      channel_id: channelId,
      channel_title: channelTitle,
      channel_url: youtubeChannelUrl(channelId),
    },
  };
}

function inferTikTokPostedAtFromVideoId(url = '') {
  const match = cleanText(url).match(/\/video\/(\d+)/i);
  if (!match) return '';
  try {
    const unixSeconds = Number(BigInt(match[1]) >> 32n);
    const date = new Date(unixSeconds * 1000);
    const year = date.getUTCFullYear();
    return year >= 2016 && year <= 2036 ? date.toISOString() : '';
  } catch (_) {
    return '';
  }
}

function inferXPostedAtFromStatusId(url = '') {
  const match = cleanText(url).match(/\/status\/(\d+)/i);
  if (!match) return '';
  try {
    const twitterEpochMs = 1288834974657n;
    const unixMs = (BigInt(match[1]) >> 22n) + twitterEpochMs;
    const date = new Date(Number(unixMs));
    const year = date.getUTCFullYear();
    return year >= 2010 && year <= 2036 ? date.toISOString() : '';
  } catch (_) {
    return '';
  }
}

function inferredPlatformPostedAt(url = '') {
  if (/tiktok\.com/i.test(url)) return inferTikTokPostedAtFromVideoId(url);
  if (/(^|\/\/)(x|twitter)\.com/i.test(url)) return inferXPostedAtFromStatusId(url);
  return '';
}

async function fetchTikTokOEmbed(url = '', { fetchImpl = fetch } = {}) {
  const exactUrl = normalizeTikTokVideoUrl(url);
  if (!exactUrl) return { ok: false, skipped: true, reason: 'missing_exact_tiktok_video_url' };
  const endpoint = new URL(TIKTOK_OEMBED_URL);
  endpoint.searchParams.set('url', exactUrl);
  const response = await fetchImpl(endpoint, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: payload?.message || payload?.error || 'tiktok_oembed_failed',
      payload,
    };
  }
  return {
    ok: true,
    payload: normalizeTikTokOEmbed(payload),
  };
}

function sourceUnavailableFromMetadataReport(report = {}) {
  if (!report || report.ok === true) return null;
  const status = Number(report.status || 0);
  const reason = cleanText(report.reason || report.message || report.error || '');
  if ([404, 410].includes(status) || /not found|unavailable|deleted|removed|does.?not exist|private|gone/i.test(reason)) {
    return {
      source_unavailable: true,
      source_url_status: status ? `unavailable_${status}` : 'unavailable',
      source_unavailable_reason: reason || 'This source video is no longer available.',
    };
  }
  return null;
}

function buildTikTokExactPostImportRows({
  posts = [],
  urls = [],
  rawText = '',
  oembedByUrl = {},
  oembedReportsByUrl = {},
} = {}) {
  const seeds = tikTokSeedsFromInputs({ posts, urls, rawText });
  const seen = new Set();
  return seeds
    .filter((seed) => {
      if (seen.has(seed.post_url)) return false;
      seen.add(seed.post_url);
      return true;
    })
    .map((seed, index) => {
      const oembed = normalizeTikTokOEmbed(oembedByUrl[seed.post_url] || {});
      const sourceHealth = sourceUnavailableFromMetadataReport(oembedReportsByUrl[seed.post_url]) || {};
      const sourceUrl = seed.post_url;
      const profileUrl = seed.source_page_url || seed.source_contact_url || oembed.author_url || tiktokProfileUrlFromVideoUrl(sourceUrl);
      const handle = tiktokHandleFromUrl(sourceUrl);
      const sourceName = cleanText(seed.source_name || oembed.author_name || (handle ? `@${handle}` : 'TikTok property source'));
      const commentEvidence = cleanText(seed.comments || seed.comment || seed.owner_comment || seed.owner_comments || seed.owner_response || seed.poster_reply || seed.poster_response || seed.reply || seed.replies || '');
      const visualText = sourceVisualTextFromObject(seed);
      const caption = cleanText(seed.caption || seed.description || oembed.title || seed.title || '');
      const sourceDerivedTitle = sourceListingTitleFromText(`${visualText} ${caption} ${commentEvidence}`);
      const title = cleanText(seed.title || sourceDerivedTitle || oembed.title || caption || `TikTok property post ${index + 1}`);
      const combinedText = cleanText(`${sourceDerivedTitle} ${title} ${caption} ${visualText} ${commentEvidence}`);
      const rawArea = cleanText(seed.area || seed.location || '');
      const locationResolution = canonicalSocialLocation(rawArea, seed.district, combinedText);
      const canonicalLocation = locationResolution.status === 'matched' ? locationResolution.match : null;
      const area = canonicalLocation && !['district', 'region'].includes(canonicalLocation.level)
        ? canonicalLocation.name
        : '';
      const district = canonicalLocation?.district || '';
      const locationEvidenceConfirmed = Boolean(canonicalLocation);
      const priceText = cleanText(seed.price_text || priceTextFromText(combinedText) || seed.price);
      const contactPhone = cleanText(normalizeUgandanPhone(seed.contact_phone || seed.phone || seed.whatsapp || '') || phoneFromText(combinedText));
      const contactEmail = cleanText(seed.contact_email || seed.email || emailFromText(combinedText));
      const imageUrls = [
        ...String(seed.image_urls || seed.images || seed.photo_urls || seed.media_urls || '')
          .split(/[\n,|]+/)
          .map(cleanText)
          .filter(Boolean),
        oembed.thumbnail_url,
      ].filter(Boolean);
      return {
        post_url: sourceUrl,
        source_url: sourceUrl,
        source_page_url: profileUrl,
        source_contact_url: seed.source_contact_url || profileUrl || sourceUrl,
        source_unavailable: sourceHealth.source_unavailable === true,
        source_url_status: sourceHealth.source_url_status || '',
        source_unavailable_reason: sourceHealth.source_unavailable_reason || '',
        source_key: seed.source_key || handle || sourceUrl,
        source_name: sourceName,
        platform: 'TikTok',
        source_verified: oembedReportsByUrl[seed.post_url]?.ok === true,
        source_verification_status: oembedReportsByUrl[seed.post_url]?.ok === true
          ? 'official_oembed_verified'
          : 'unverified_source',
        tiktok_url: sourceUrl,
        thumbnail_url: oembed.thumbnail_url,
        source_thumbnail_url: oembed.thumbnail_url,
        video_thumbnail_url: oembed.thumbnail_url,
        tiktok_thumbnail_url: oembed.thumbnail_url,
        oembed_thumbnail_url: oembed.thumbnail_url,
        tiktok_thumbnail_original_url: oembed.thumbnail_original_url,
        oembed_thumbnail_original_url: oembed.thumbnail_original_url,
        tiktok_thumbnail_cache_url: oembed.thumbnail_cache_url,
        tiktok_thumbnail_cache_status: oembed.thumbnail_cache_status,
        tiktok_thumbnail_cache_error: oembed.thumbnail_cache_error,
        title,
        caption,
        comments: commentEvidence,
        source_visual_text: visualText,
        video_text: visualText,
        source_text: combinedText,
        description: cleanText([
          caption || title,
          visualText ? `Visible video/still text adds: ${visualText}` : '',
          commentEvidence ? `Visible source comments add: ${commentEvidence}` : '',
        ].filter(Boolean).join(' ')),
        area,
        district,
        location: area || district,
        location_evidence_confirmed: locationEvidenceConfirmed,
        latitude: seed.latitude || seed.lat || canonicalLocation?.lat || '',
        longitude: seed.longitude || seed.lng || canonicalLocation?.lng || '',
        price_text: priceText,
        listing_type: seed.listing_type || listingTypeFromText(`${combinedText} ${rawArea}`),
        bedrooms: seed.bedrooms || bedroomsFromText(combinedText),
        bathrooms: seed.bathrooms || '',
        first_posted_at: seed.first_posted_at || seed.first_posted_online_at || seed.posted_at || seed.platform_posted_at || seed.video_posted_at || seed.published_at || seed.source_published_at || '',
        platform_posted_at: seed.platform_posted_at || seed.first_posted_at || seed.posted_at || seed.published_at || '',
        video_posted_at: seed.video_posted_at || seed.first_posted_at || seed.posted_at || seed.published_at || '',
        image_urls: imageUrls,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        pre_approved: seed.pre_approved || seed.preApproved || '',
        consent_confirmed: seed.consent_confirmed || seed.consentConfirmed || seed.agent_authorised || seed.agentAuthorised || '',
        image_rights_confirmed: seed.image_rights_confirmed || seed.imageRightsConfirmed || seed.authorised_images || seed.authorisedImages || '',
        permission_status: seed.permission_status || seed.permissionStatus || 'exact_tiktok_source_pending_king_review',
        source_batch: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
        source_registry_key: seed.source_registry_key || '',
        source_urls: [profileUrl, sourceUrl].filter(Boolean),
        raw_source_post: {
          ...seed,
          oembed,
          tiktok_thumbnail_cache_status: oembed.thumbnail_cache_status,
          tiktok_thumbnail_original_url: oembed.thumbnail_original_url,
          oembed_status: sourceHealth.source_url_status || '',
          oembed_reason: sourceHealth.source_unavailable_reason || '',
          source_unavailable: sourceHealth.source_unavailable === true,
          comments: commentEvidence,
          source_visual_text: visualText,
          import_method: 'tiktok_exact_video_intake',
        },
      };
    });
}

async function importTikTokExactVideoPosts({
  db,
  posts = [],
  urls = [],
  rawText = '',
  dryRun = false,
  fetchOembed = true,
  fetchImpl = fetch,
} = {}) {
  const seeds = tikTokSeedsFromInputs({ posts, urls, rawText });
  const oembedByUrl = {};
  const oembedReportsByUrl = {};
  const oembedReports = [];
  if (fetchOembed) {
    for (const seed of seeds) {
      if (oembedByUrl[seed.post_url]) continue;
      const report = await fetchMetadataWithRetry(
        () => fetchTikTokOEmbed(seed.post_url, { fetchImpl }),
        { fallbackReason: 'tiktok_oembed_failed' }
      );
      const reportSummary = {
        post_url: seed.post_url,
        ok: report.ok === true,
        status: report.status || null,
        attempts: report.attempts || 1,
        retried: report.retried === true,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
      };
      if (report.ok && report.payload) {
        const cached = await cacheTikTokOEmbedThumbnail(report.payload, seed.post_url, { fetchImpl });
        report.payload = cached.payload;
        reportSummary.thumbnail_cache_status = cached.payload.thumbnail_cache_status || '';
        reportSummary.thumbnail_cached = cached.report.cached === true;
        reportSummary.thumbnail_cache_reason = cached.report.reason || '';
      }
      oembedReports.push(reportSummary);
      oembedReportsByUrl[seed.post_url] = reportSummary;
      if (report.ok && report.payload) oembedByUrl[seed.post_url] = report.payload;
    }
  }
  const importRows = buildTikTokExactPostImportRows({
    posts: seeds,
    oembedByUrl,
    oembedReportsByUrl,
  });
  const importResult = await queueFoundOnlineSourcePostListings({
    db,
    posts: importRows,
    dryRun,
    createProfilesForRepeatedSourcesOnly: false,
  });
  return {
    ok: true,
    batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    dry_run: dryRun,
    exact_video_url_count: importRows.length,
    tiktok_import_rows: importRows,
    oembed_fetch_count: oembedReports.length,
    thumbnail_cached_count: oembedReports.filter((item) => item.thumbnail_cached === true).length,
    thumbnail_cache_skipped_count: oembedReports.filter((item) => item.thumbnail_cache_reason || item.thumbnail_cache_status === 'cloud_media_storage_not_configured').length,
    oembed_reports: oembedReports,
    import_result: importResult,
    ...importResult,
  };
}

async function fetchTikTokDataSourcePosts({
  env = process.env,
  fetchImpl = fetch,
  limit = 500,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_SOURCE_START_MIN_REMAINING_MS,
} = {}) {
  const dataSource = envValue(TIKTOK_DATA_SOURCE_URL_ENV_NAMES, env);
  if (!dataSource.value) {
    return {
      api_configured: false,
      data_source_url_env: '',
      skipped_reason: 'Set TIKTOK_DATA_SOURCE_URL, TIKTOK_SOURCE_FEED_URL, or TIKTOK_SEARCH_EXPORT_URL to import approved TikTok search/export results.',
      posts: [],
      reports: [],
      oembed_fetch_count: 0,
    };
  }
  if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
    return {
      api_configured: true,
      data_source_url_env: dataSource.name,
      skipped_reason: 'source_sweep_time_budget_exhausted',
      posts: [],
      reports: [{
        ok: false,
        skipped: true,
        reason: 'source_sweep_time_budget_exhausted',
      }],
      oembed_fetch_count: 0,
      partial_results: true,
      timed_out: true,
    };
  }
  const cappedLimit = cappedNumber(limit, 500, 1, 1000);
  const reports = [];
  try {
    const response = await fetchImpl(dataSource.value, {
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
    });
    const body = await response.text();
    if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
      return {
        api_configured: true,
        data_source_url_env: dataSource.name,
        skipped_reason: 'source_sweep_time_budget_reserved_for_partial_commit',
        posts: [],
        reports: [{
          ok: false,
          skipped: true,
          reason: 'source_sweep_time_budget_reserved_for_partial_commit',
        }],
        oembed_fetch_count: 0,
        partial_results: true,
        timed_out: true,
      };
    }
    if (!response.ok) {
      return {
        api_configured: true,
        data_source_url_env: dataSource.name,
        skipped_reason: `tiktok_data_source_fetch_failed_${response.status}`,
        posts: [],
        reports: [{
          ok: false,
          status: response.status,
          reason: cleanText(body).slice(0, 220) || 'tiktok_data_source_fetch_failed',
        }],
        oembed_fetch_count: 0,
      };
    }
    const seeds = tikTokSeedsFromDataSourcePayload(body).slice(0, cappedLimit);
    const seedsForImport = [];
    const oembedByUrl = {};
    const oembedReportsByUrl = {};
    let skippedDueToTimeBudget = 0;
    let timedOut = false;
    for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
      const seed = seeds[seedIndex];
      if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
        timedOut = true;
        skippedDueToTimeBudget = seeds.length - seedIndex;
        reports.push({
          ok: false,
          skipped: true,
          reason: 'source_sweep_time_budget_reserved_for_partial_commit',
          remaining_seed_count: skippedDueToTimeBudget,
        });
        break;
      }
      seedsForImport.push(seed);
      if (!seed.post_url || oembedByUrl[seed.post_url] || oembedReportsByUrl[seed.post_url]) continue;
      const report = await fetchMetadataWithRetry(
        () => fetchTikTokOEmbed(seed.post_url, { fetchImpl }),
        { fallbackReason: 'tiktok_oembed_failed' }
      );
      if (/source_sweep/.test(report.reason || '')) timedOut = true;
      const reportSummary = {
        post_url: seed.post_url,
        ok: report.ok === true,
        status: report.status || null,
        attempts: report.attempts || 1,
        retried: report.retried === true,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
      };
      if (report.ok && report.payload) {
        const cached = await cacheTikTokOEmbedThumbnail(report.payload, seed.post_url, { fetchImpl }).catch((error) => ({
          payload: report.payload,
          report: {
            cached: false,
            reason: sourceSweepErrorReason(error) || error.message || 'tiktok_thumbnail_cache_failed',
          },
        }));
        report.payload = cached.payload;
        reportSummary.thumbnail_cache_status = cached.payload.thumbnail_cache_status || '';
        reportSummary.thumbnail_cached = cached.report.cached === true;
        reportSummary.thumbnail_cache_reason = cached.report.reason || '';
      }
      reports.push(reportSummary);
      oembedReportsByUrl[seed.post_url] = reportSummary;
      if (report.ok && report.payload) oembedByUrl[seed.post_url] = report.payload;
      if (timedOut) {
        skippedDueToTimeBudget = Math.max(0, seeds.length - seedIndex - 1);
        break;
      }
    }
    return {
      api_configured: true,
      data_source_url_env: dataSource.name,
      skipped_reason: timedOut ? 'source_sweep_time_budget_reserved_for_partial_commit' : '',
      received_rows: seeds.length,
      processed_rows: seedsForImport.length,
      rows_skipped_due_to_time_budget: skippedDueToTimeBudget,
      posts: buildTikTokExactPostImportRows({
        posts: seedsForImport,
        oembedByUrl,
        oembedReportsByUrl,
      }),
      reports,
      oembed_fetch_count: reports.length,
      thumbnail_cached_count: reports.filter((item) => item.thumbnail_cached === true).length,
      thumbnail_cache_skipped_count: reports.filter((item) => item.thumbnail_cache_reason || item.thumbnail_cache_status === 'cloud_media_storage_not_configured').length,
      partial_results: timedOut,
      timed_out: timedOut,
    };
  } catch (error) {
    const reason = sourceSweepErrorReason(error);
    return {
      api_configured: true,
      data_source_url_env: dataSource.name,
      skipped_reason: /source_sweep/.test(reason) ? reason : 'tiktok_data_source_fetch_error',
      posts: [],
      reports: [{ ok: false, reason: reason || error.message || 'tiktok_data_source_fetch_error' }],
      oembed_fetch_count: 0,
      partial_results: /source_sweep/.test(reason),
      timed_out: /source_sweep/.test(reason),
    };
  }
}

function tiktokVideoUrlFromExtra(extra = {}, row = {}) {
  return normalizeTikTokVideoUrl(
    extra.tiktok_url
      || extra.tiktok_video_url
      || extra.video_url
      || extra.source_post_url
      || extra.source_url
      || extra.original_url
      || row.source_url
      || ''
  );
}

async function pendingTikTokSourceRowsForThumbnailEnrichment(db, {
  limit = DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT,
  offset = 0,
  queryClient = null,
} = {}) {
  const client = queryClient || db;
  if (!client?.query) {
    return { ok: false, reason: 'missing_db_connection', rows: [] };
  }
  const cappedLimit = cappedNumber(limit, DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT, 1, 500);
  const cappedRowOffset = cappedOffset(offset, 50000);
  const sql = `
    SELECT
      id::text AS id,
      title,
      status,
      extra_fields,
      COALESCE(
        extra_fields->>'tiktok_url',
        extra_fields->>'tiktok_video_url',
        extra_fields->>'video_url',
        extra_fields->>'source_post_url',
        extra_fields->>'source_url',
        extra_fields->>'original_url',
        ''
      ) AS source_url
    FROM properties
    WHERE COALESCE(status, '') <> 'deleted'
      AND (
        LOWER(COALESCE(extra_fields->>'source_platform', '')) = 'tiktok'
        OR COALESCE(extra_fields->>'tiktok_url', '') ~* 'tiktok\\.com/@[^/]+/video/[0-9]+'
        OR COALESCE(extra_fields->>'video_url', '') ~* 'tiktok\\.com/@[^/]+/video/[0-9]+'
        OR COALESCE(extra_fields->>'source_url', '') ~* 'tiktok\\.com/@[^/]+/video/[0-9]+'
        OR COALESCE(extra_fields->>'source_post_url', '') ~* 'tiktok\\.com/@[^/]+/video/[0-9]+'
      )
      AND COALESCE(extra_fields->>'source_unavailable', '') !~* '^(true|1|yes)$'
      AND (
        COALESCE(extra_fields->>'tiktok_thumbnail_url', extra_fields->>'oembed_thumbnail_url', extra_fields->>'source_thumbnail_url', extra_fields->>'video_thumbnail_url', extra_fields->>'thumbnail_url', '') = ''
        OR (
          COALESCE(extra_fields->>'tiktok_thumbnail_cache_status', '') <> 'cached_to_makaug_storage'
          AND COALESCE(extra_fields->>'tiktok_thumbnail_url', extra_fields->>'oembed_thumbnail_url', extra_fields->>'source_thumbnail_url', extra_fields->>'video_thumbnail_url', extra_fields->>'thumbnail_url', '') ~* '(tiktokcdn|muscdn|byteoversea)'
        )
      )
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT $1 OFFSET $2
  `;
  try {
    const result = await client.query(sql, [cappedLimit, cappedRowOffset]);
    return { ok: true, rows: result.rows || [] };
  } catch (error) {
    return { ok: false, reason: error.message || 'pending_tiktok_thumbnail_rows_unavailable', rows: [] };
  }
}

async function enrichPendingTikTokSourceThumbnailRows({
  db,
  dryRun = false,
  fetchImpl = fetch,
  limit = DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT,
  offset = 0,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_MIN_REMAINING_MS,
} = {}) {
  if (!db?.pool) {
    return {
      ok: false,
      skipped: true,
      reason: 'db_pool_required',
      version: TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
      rows_considered: 0,
      oembed_fetch_count: 0,
      updated_properties: 0,
      unavailable_properties: 0,
      reports: [],
    };
  }
  const lockClient = await db.pool.connect();
  let lockAcquired = false;
  try {
    const lock = await lockClient.query(
      'SELECT pg_try_advisory_lock($1)::boolean AS locked',
      [TIKTOK_PENDING_REPROCESS_ADVISORY_LOCK_ID]
    );
    lockAcquired = lock.rows[0]?.locked === true;
    if (!lockAcquired) {
      return {
        ok: true,
        skipped: true,
        reason: 'pending_tiktok_thumbnail_reprocess_already_running',
        lock_id: TIKTOK_PENDING_REPROCESS_ADVISORY_LOCK_ID,
        version: TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
        rows_considered: 0,
        oembed_fetch_count: 0,
        updated_properties: 0,
        unavailable_properties: 0,
        reports: [],
      };
    }
    const pending = await pendingTikTokSourceRowsForThumbnailEnrichment(db, { limit, offset, queryClient: lockClient });
    if (!pending.ok) {
      return {
        ok: false,
        skipped: true,
        reason: pending.reason || 'pending_tiktok_thumbnail_rows_unavailable',
        version: TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
        rows_considered: 0,
        oembed_fetch_count: 0,
        updated_properties: 0,
        unavailable_properties: 0,
        reports: [],
      };
    }
    let updatedProperties = 0;
    let unavailableProperties = 0;
    let cachedThumbnailProperties = 0;
    let thumbnailCacheSkippedProperties = 0;
    const reports = [];
    let timedOut = false;
    let rowsSkippedDueToTimeBudget = 0;
    const rows = pending.rows || [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
        timedOut = true;
        rowsSkippedDueToTimeBudget = rows.length - rowIndex;
        reports.push({
          ok: false,
          skipped: true,
          reason: 'source_sweep_time_budget_exhausted',
          remaining_row_count: rowsSkippedDueToTimeBudget,
        });
        break;
      }
      const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
      const sourceUrl = tiktokVideoUrlFromExtra(extra, row);
      if (!sourceUrl) {
        reports.push({ property_id: row.id, ok: false, skipped: true, reason: 'missing_exact_tiktok_video_url' });
        continue;
      }
      const report = await fetchMetadataWithRetry(
        () => fetchTikTokOEmbed(sourceUrl, { fetchImpl }),
        { fallbackReason: 'tiktok_oembed_failed' }
      );
      if (/source_sweep/.test(report.reason || '')) timedOut = true;
      const sourceHealth = sourceUnavailableFromMetadataReport({
        ok: report.ok === true,
        status: report.status || null,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
      }) || {};
      const cached = report.ok && report.payload
        ? await cacheTikTokOEmbedThumbnail(report.payload, sourceUrl, { fetchImpl }).catch((error) => ({
          payload: report.payload,
          report: {
            cached: false,
            reason: sourceSweepErrorReason(error) || error.message || 'tiktok_thumbnail_cache_failed',
          },
        }))
        : null;
      if (/source_sweep/.test(cached?.report?.reason || '')) timedOut = true;
      const oembed = cached?.payload ? normalizeTikTokOEmbed(cached.payload) : {};
      const thumbnailUrl = cleanText(oembed.thumbnail_url || '');
      const patch = {
        tiktok_oembed_thumbnail_reprocess_version: TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
        tiktok_oembed_thumbnail_cache_version: TIKTOK_OEMBED_THUMBNAIL_CACHE_VERSION,
        tiktok_oembed_thumbnail_reprocessed_at: new Date().toISOString(),
        tiktok_url: sourceUrl,
        video_url: sourceUrl,
        ...(thumbnailUrl ? {
          thumbnail_url: thumbnailUrl,
          source_thumbnail_url: thumbnailUrl,
          video_thumbnail_url: thumbnailUrl,
          tiktok_thumbnail_url: thumbnailUrl,
          oembed_thumbnail_url: thumbnailUrl,
        } : {}),
        ...(oembed.thumbnail_original_url ? {
          tiktok_thumbnail_original_url: oembed.thumbnail_original_url,
          oembed_thumbnail_original_url: oembed.thumbnail_original_url,
        } : {}),
        ...(oembed.thumbnail_cache_url ? { tiktok_thumbnail_cache_url: oembed.thumbnail_cache_url } : {}),
        ...(oembed.thumbnail_cache_status ? { tiktok_thumbnail_cache_status: oembed.thumbnail_cache_status } : {}),
        ...(oembed.thumbnail_cache_error ? { tiktok_thumbnail_cache_error: oembed.thumbnail_cache_error } : {}),
        ...(oembed.title ? { source_title: extra.source_title || oembed.title } : {}),
        ...(oembed.author_name ? { source_name: extra.source_name || oembed.author_name } : {}),
        ...(oembed.author_url ? { source_contact_url: extra.source_contact_url || oembed.author_url } : {}),
        ...(sourceHealth.source_unavailable ? sourceHealth : {}),
      };
      if (sourceHealth.source_unavailable) unavailableProperties += 1;
      if (thumbnailUrl) updatedProperties += 1;
      if (cached?.report?.cached === true) cachedThumbnailProperties += 1;
      if (cached?.report?.skipped || cached?.report?.ok === false) thumbnailCacheSkippedProperties += 1;
      if (!dryRun && (thumbnailUrl || sourceHealth.source_unavailable)) {
        await lockClient.query(
          `UPDATE properties
           SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, JSON.stringify(patch)]
        );
      }
      reports.push({
        property_id: row.id,
        source_url: sourceUrl,
        ok: report.ok === true,
        status: report.status || null,
        thumbnail_url: thumbnailUrl,
        thumbnail_original_url: oembed.thumbnail_original_url || '',
        thumbnail_cache_status: oembed.thumbnail_cache_status || '',
        thumbnail_cached: cached?.report?.cached === true,
        thumbnail_cache_reason: cached?.report?.reason || '',
        updated: Boolean(thumbnailUrl),
        source_unavailable: sourceHealth.source_unavailable === true,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
      });
      if (timedOut) {
        rowsSkippedDueToTimeBudget = Math.max(0, rows.length - rowIndex - 1);
        break;
      }
    }
    return {
      ok: true,
      skipped: false,
      partial_results: timedOut,
      timed_out: timedOut,
      dry_run: dryRun,
      version: TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
      rows_considered: (pending.rows || []).length,
      rows_skipped_due_to_time_budget: rowsSkippedDueToTimeBudget,
      oembed_fetch_count: reports.filter((item) => !item.skipped).length,
      updated_properties: dryRun ? 0 : updatedProperties,
      update_candidates: updatedProperties,
      cached_thumbnail_properties: dryRun ? 0 : cachedThumbnailProperties,
      cached_thumbnail_candidates: cachedThumbnailProperties,
      thumbnail_cache_skipped_properties: thumbnailCacheSkippedProperties,
      unavailable_properties: dryRun ? 0 : unavailableProperties,
      unavailable_candidates: unavailableProperties,
      reports: reports.slice(0, 50),
    };
  } finally {
    if (lockAcquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [TIKTOK_PENDING_REPROCESS_ADVISORY_LOCK_ID]);
      } catch (_) {}
    }
    lockClient.release();
  }
}

function buildExactSocialPostImportRows({
  posts = [],
  urls = [],
  rawText = '',
  metadataByUrl = {},
} = {}) {
  const seeds = socialSeedsFromInputs({ posts, urls, rawText });
  const seen = new Set();
  return seeds
    .filter((seed) => {
      if (seen.has(seed.post_url)) return false;
      seen.add(seed.post_url);
      return true;
    })
    .map((seed, index) => {
      const sourceUrl = seed.post_url;
      const platform = cleanText(seed.platform || platformForExactSocialPostUrl(sourceUrl));
      const metadata = metadataByUrl[sourceUrl] || {};
      seed = { ...(metadata.x_post || {}), ...seed };
      const oembed = metadata.oembed || {};
      const page = metadata.page || {};
      const sourceHealth = sourceUnavailableFromMetadataReport(metadata.oembed_error)
        || sourceUnavailableFromMetadataReport(metadata.page_error)
        || {};
      const inferredPostedAt = inferredPlatformPostedAt(sourceUrl);
      const videoId = normalizeYouTubeVideoId(seed.youtube_video_id || sourceUrl);
      const sourcePageUrl = seed.source_page_url
        || seed.profile_url
        || seed.channel_url
        || page.channel_url
        || oembed.author_url
        || sourcePageUrlFromExactPostUrl(sourceUrl)
        || sourceUrl;
      const sourceName = cleanText(
        seed.source_name
        || page.channel_title
        || oembed.author_name
        || sourcePageUrl.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[/?#].*$/g, '')
        || `${platform} property source`
      );
      const commentEvidence = cleanText(seed.comments || seed.comment || seed.owner_comment || seed.owner_comments || seed.owner_response || seed.poster_reply || seed.poster_response || seed.reply || seed.replies || '');
      const visualText = sourceVisualTextFromObject(seed);
      const caption = cleanText(seed.caption || seed.description || page.description || oembed.title || page.title || '');
      const sourceDerivedTitle = sourceListingTitleFromText(`${visualText} ${caption} ${commentEvidence}`);
      const title = cleanText(seed.title || sourceDerivedTitle || page.title || oembed.title || `Found-online ${platform} property post ${index + 1}`);
      const combinedText = cleanText(`${sourceDerivedTitle} ${title} ${caption} ${visualText} ${commentEvidence}`);
      const rawArea = cleanText(seed.area || seed.location || '');
      const locationResolution = canonicalSocialLocation(rawArea, seed.district, combinedText);
      const canonicalLocation = locationResolution.status === 'matched' ? locationResolution.match : null;
      const area = canonicalLocation && !['district', 'region'].includes(canonicalLocation.level)
        ? canonicalLocation.name
        : '';
      const district = canonicalLocation?.district || '';
      const locationEvidenceConfirmed = Boolean(canonicalLocation);
      const priceText = cleanText(seed.price_text || priceTextFromText(combinedText) || seed.price);
      const contactPhone = cleanText(normalizeUgandanPhone(seed.contact_phone || seed.phone || seed.whatsapp || '') || phoneFromText(combinedText));
      const contactEmail = cleanText(seed.contact_email || seed.email || emailFromText(combinedText));
      const firstPostedAt = cleanText(
        seed.first_posted_at
        || seed.first_posted_online_at
        || seed.posted_at
        || seed.platform_posted_at
        || seed.published_at
        || page.published_at
      );
      const imageUrls = [
        ...String(seed.image_urls || seed.images || seed.photo_urls || seed.media_urls || '')
          .split(/[\n,|]+/)
          .map(cleanText)
          .filter(Boolean),
        page.image_url,
        oembed.thumbnail_url,
      ].filter(Boolean);
      return {
        post_url: sourceUrl,
        source_url: sourceUrl,
        source_page_url: sourcePageUrl,
        source_contact_url: seed.source_contact_url || seed.contact_url || sourcePageUrl || sourceUrl,
        source_unavailable: sourceHealth.source_unavailable === true,
        source_url_status: sourceHealth.source_url_status || '',
        source_unavailable_reason: sourceHealth.source_unavailable_reason || '',
        source_key: seed.source_key || sourceName || sourceUrl,
        source_name: sourceName,
        platform,
        youtube_url: videoId ? youtubeWatchUrl(videoId) : '',
        youtube_video_id: videoId || '',
        tiktok_url: /tiktok\.com/i.test(sourceUrl) ? sourceUrl : '',
        x_url: /(x|twitter)\.com/i.test(sourceUrl) ? sourceUrl : '',
        instagram_url: /instagram\.com/i.test(sourceUrl) ? sourceUrl : '',
        facebook_url: /facebook\.com|fb\.watch/i.test(sourceUrl) ? sourceUrl : '',
        video_url: /youtube\.com|youtu\.be|tiktok\.com/i.test(sourceUrl) ? sourceUrl : '',
        thumbnail_url: page.image_url || oembed.thumbnail_url || '',
        source_thumbnail_url: page.image_url || oembed.thumbnail_url || '',
        video_thumbnail_url: page.image_url || oembed.thumbnail_url || '',
        tiktok_thumbnail_url: /tiktok\.com/i.test(sourceUrl) ? (oembed.thumbnail_url || '') : '',
        oembed_thumbnail_url: oembed.thumbnail_url || '',
        tiktok_thumbnail_original_url: /tiktok\.com/i.test(sourceUrl) ? (oembed.thumbnail_original_url || '') : '',
        oembed_thumbnail_original_url: oembed.thumbnail_original_url || '',
        tiktok_thumbnail_cache_url: /tiktok\.com/i.test(sourceUrl) ? (oembed.thumbnail_cache_url || '') : '',
        tiktok_thumbnail_cache_status: /tiktok\.com/i.test(sourceUrl) ? (oembed.thumbnail_cache_status || '') : '',
        tiktok_thumbnail_cache_error: /tiktok\.com/i.test(sourceUrl) ? (oembed.thumbnail_cache_error || '') : '',
        title,
        caption,
        comments: commentEvidence,
        source_visual_text: visualText,
        video_text: visualText,
        source_text: combinedText,
        description: cleanText([
          caption || title,
          visualText ? `Visible video/still text adds: ${visualText}` : '',
          commentEvidence ? `Visible source comments add: ${commentEvidence}` : '',
        ].filter(Boolean).join(' ')),
        area,
        district,
        location: area || district,
        location_evidence_confirmed: locationEvidenceConfirmed,
        latitude: seed.latitude || seed.lat || canonicalLocation?.lat || '',
        longitude: seed.longitude || seed.lng || canonicalLocation?.lng || '',
        price_text: priceText,
        listing_type: seed.listing_type || listingTypeFromText(`${combinedText} ${rawArea}`),
        bedrooms: seed.bedrooms || bedroomsFromText(combinedText),
        bathrooms: seed.bathrooms || '',
        first_posted_at: firstPostedAt,
        platform_posted_at: firstPostedAt,
        video_posted_at: firstPostedAt,
        image_urls: imageUrls,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        pre_approved: seed.pre_approved || seed.preApproved || '',
        consent_confirmed: seed.consent_confirmed || seed.consentConfirmed || seed.agent_authorised || seed.agentAuthorised || '',
        image_rights_confirmed: seed.image_rights_confirmed || seed.imageRightsConfirmed || seed.authorised_images || seed.authorisedImages || '',
        permission_status: seed.permission_status || seed.permissionStatus || 'exact_social_source_pending_king_review',
        source_batch: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
        source_registry_key: seed.source_registry_key || '',
        source_urls: [sourcePageUrl, sourceUrl].filter(Boolean),
        raw_source_post: {
          ...seed,
          no_api_metadata: metadata,
          tiktok_thumbnail_cache_status: oembed.thumbnail_cache_status || '',
          tiktok_thumbnail_original_url: oembed.thumbnail_original_url || '',
          source_unavailable: sourceHealth.source_unavailable === true,
          source_url_status: sourceHealth.source_url_status || '',
          source_unavailable_reason: sourceHealth.source_unavailable_reason || '',
          comments: commentEvidence,
          source_visual_text: visualText,
          inferred_platform_posted_at: inferredPostedAt || '',
          import_method: 'no_api_exact_social_url_intake',
          date_confidence: seed.first_posted_at || seed.posted_at || seed.published_at
            ? 'operator_supplied'
            : page.published_at
              ? 'public_page_metadata'
              : inferredPostedAt
                ? 'inferred_from_public_post_id_needs_confirmation'
                : 'needs_platform_date_confirmation',
        },
      };
    });
}

async function importExactSocialSourcePosts({
  db,
  posts = [],
  urls = [],
  rawText = '',
  dryRun = false,
  fetchOembed = true,
  fetchPublicMetadata = true,
  skipImageHashLookup = false,
  xBearerToken = '',
  fetchImpl = fetch,
} = {}) {
  const resolutionReports = [];
  const resolveInputUrl = async (value = '') => {
    const rawUrl = cleanText(value);
    if (!/(?:vt|vm)\.tiktok\.com|fb\.watch/i.test(rawUrl)) return rawUrl;
    const resolved = await fetchMetadataWithRetry(
      () => resolveSourceShortUrl(rawUrl, { fetchImpl }).then((url) => url
        ? { ok: true, payload: url }
        : { ok: false, reason: 'short_url_resolution_failed' }),
      { fallbackReason: 'short_url_resolution_failed', maxAttempts: 2 }
    );
    resolutionReports.push({
      input_url: rawUrl,
      resolved_url: resolved.payload || '',
      ok: resolved.ok === true,
      attempts: resolved.attempts || 1,
      reason: resolved.ok ? '' : resolved.reason,
    });
    return resolved.payload || rawUrl;
  };
  const resolvedPosts = [];
  for (const input of Array.isArray(posts) ? posts : []) {
    if (typeof input === 'string') resolvedPosts.push(await resolveInputUrl(input));
    else resolvedPosts.push({
      ...input,
      post_url: await resolveInputUrl(input?.post_url || input?.source_url || input?.url || input?.video_url || ''),
    });
  }
  const resolvedUrls = [];
  for (const input of Array.isArray(urls) ? urls : []) resolvedUrls.push(await resolveInputUrl(input));
  let resolvedRawText = String(rawText || '');
  const shortUrls = [...new Set((resolvedRawText.match(SOCIAL_URL_GLOBAL_PATTERN) || [])
    .map((url) => cleanText(url).replace(/[),.;]+$/g, ''))
    .filter((url) => /(?:vt|vm)\.tiktok\.com|fb\.watch/i.test(url)))];
  for (const shortUrl of shortUrls) {
    const resolved = await resolveInputUrl(shortUrl);
    if (resolved && resolved !== shortUrl) resolvedRawText = resolvedRawText.split(shortUrl).join(resolved);
  }
  const seeds = socialSeedsFromInputs({ posts: resolvedPosts, urls: resolvedUrls, rawText: resolvedRawText });
  const metadataByUrl = {};
  const metadataReports = [];
  for (const seed of seeds) {
    const url = seed.post_url;
    if (!url || metadataByUrl[url]) continue;
    const platform = platformForExactSocialPostUrl(url);
    const metadata = {};
    if (fetchOembed && platform === 'TikTok') {
      const report = await fetchMetadataWithRetry(
        () => fetchTikTokOEmbed(url, { fetchImpl }),
        { fallbackReason: 'tiktok_oembed_failed' }
      );
      metadataReports.push({
        post_url: url,
        platform,
        method: 'tiktok_oembed',
        server_side: true,
        provider_endpoint: TIKTOK_OEMBED_URL,
        ok: report.ok === true,
        status: report.status || null,
        attempts: report.attempts || 1,
        retried: report.retried === true,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
        verified_author_name: cleanText(report.payload?.author_name || ''),
        verified_author_url: cleanText(report.payload?.author_url || ''),
        caption_received: Boolean(cleanText(report.payload?.title || '')),
        thumbnail_received: Boolean(cleanText(report.payload?.thumbnail_url || '')),
      });
      if (report.ok && report.payload) {
        const latestReport = metadataReports[metadataReports.length - 1];
        if (dryRun) {
          metadata.oembed = {
            ...report.payload,
            thumbnail_original_url: report.payload.thumbnail_url || '',
            thumbnail_cache_status: 'preview_metadata_only',
          };
          metadata.thumbnail_cache_report = {
            ok: true,
            skipped: true,
            reason: 'preview_metadata_only',
          };
          latestReport.thumbnail_cache_status = 'preview_metadata_only';
          latestReport.thumbnail_cached = false;
          latestReport.thumbnail_cache_reason = 'preview_metadata_only';
        } else {
          const cached = await cacheTikTokOEmbedThumbnail(report.payload, url, { fetchImpl });
          metadata.oembed = cached.payload;
          metadata.thumbnail_cache_report = cached.report;
          latestReport.thumbnail_cache_status = cached.payload.thumbnail_cache_status || '';
          latestReport.thumbnail_cached = cached.report.cached === true;
          latestReport.thumbnail_cache_reason = cached.report.reason || '';
        }
      }
      if (!report.ok) metadata.oembed_error = { ok: false, status: report.status || null, reason: report.reason || 'tiktok_oembed_failed' };
    }
    if (fetchOembed && platform === 'YouTube') {
      const report = await fetchMetadataWithRetry(
        () => fetchYouTubeOEmbed(url, { fetchImpl }),
        { fallbackReason: 'youtube_oembed_failed' }
      );
      metadataReports.push({
        post_url: url,
        platform,
        method: 'youtube_oembed',
        ok: report.ok === true,
        status: report.status || null,
        attempts: report.attempts || 1,
        retried: report.retried === true,
        reason: report.ok ? '' : (report.reason || 'youtube_oembed_failed'),
      });
      if (report.ok && report.payload) metadata.oembed = report.payload;
      if (!report.ok) metadata.oembed_error = { ok: false, status: report.status || null, reason: report.reason || 'youtube_oembed_failed' };
    }
    if (fetchPublicMetadata && platform === 'YouTube') {
      const report = await fetchMetadataWithRetry(
        () => fetchPublicPageMetadata(url, { fetchImpl }),
        { fallbackReason: 'public_page_metadata_failed' }
      );
      metadataReports.push({
        post_url: url,
        platform,
        method: 'public_page_metadata',
        ok: report.ok === true,
        status: report.status || null,
        attempts: report.attempts || 1,
        retried: report.retried === true,
        reason: report.ok ? '' : (report.reason || 'public_page_metadata_failed'),
      });
      if (report.ok && report.payload) metadata.page = report.payload;
      if (!report.ok) metadata.page_error = { ok: false, status: report.status || null, reason: report.reason || 'public_page_metadata_failed' };
    }
    if (platform === 'X') {
      const report = await fetchMetadataWithRetry(
        () => fetchXPostMetadata(url, { bearerToken: xBearerToken, fetchImpl }),
        { fallbackReason: 'x_post_lookup_failed' }
      );
      metadataReports.push({
        post_url: url,
        platform,
        method: 'x_api_v2_tweet_lookup',
        ok: report.ok === true,
        status: report.status || null,
        attempts: report.attempts || 1,
        retried: report.retried === true,
        reason: report.ok ? '' : (report.reason || 'x_post_lookup_failed'),
        required_any_of: report.required_any_of || undefined,
      });
      if (report.ok && report.payload) metadata.x_post = report.payload;
      if (!report.ok) metadata.x_error = { ok: false, status: report.status || null, reason: report.reason || 'x_post_lookup_failed' };
    }
    metadataByUrl[url] = metadata;
  }
  const importRows = buildExactSocialPostImportRows({
    posts: seeds,
    metadataByUrl,
  });
  const configuredImageHashLookups = Number(process.env.HARVEST_IMAGE_HASH_LOOKUP_LIMIT ?? 20);
  const imageHashLookupEnabled = dryRun !== true && skipImageHashLookup !== true;
  const maxImageHashLookups = Math.max(
    0,
    imageHashLookupEnabled
      ? Math.min(50, Number.isFinite(configuredImageHashLookups) ? configuredImageHashLookups : 20)
      : 0
  );
  let imageHashLookups = 0;
  for (const row of importRows) {
    const imageUrl = row.thumbnail_url || row.source_thumbnail_url || row.image_urls?.[0] || '';
    let imageHashReport = { dhash: '', phash: '', reason: imageUrl ? 'image_hash_lookup_limit' : 'missing_remote_image' };
    if (imageUrl && imageHashLookups < maxImageHashLookups) {
      imageHashLookups += 1;
      imageHashReport = await primaryImagePerceptualHashes(imageUrl, { fetchImpl });
    }
    const fingerprints = buildHarvestFingerprints(row, {
      imageHash: imageHashReport.dhash || imageHashReport.hash || '',
      imagePHash: imageHashReport.phash || '',
    });
    Object.assign(row, fingerprints);
    row.raw_source_post = {
      ...(row.raw_source_post || {}),
      harvest_dedup: {
        ...fingerprints,
        primary_image_hash_status: imageHashReport.dhash || imageHashReport.phash ? 'computed' : imageHashReport.reason,
      },
    };
  }
  const importResult = await queueFoundOnlineSourcePostListings({
    db,
    posts: importRows,
    dryRun,
    createProfilesForRepeatedSourcesOnly: false,
  });
  const tiktokOembedReports = metadataReports.filter((report) => report.method === 'tiktok_oembed');
  return {
    ok: true,
    marker: KING_TIKTOK_HARVEST_E2E_MARKER,
    batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    dry_run: dryRun,
    exact_social_url_count: importRows.length,
    exact_social_import_rows: importRows,
    metadata_fetch_count: metadataReports.length,
    short_url_resolution_reports: resolutionReports,
    image_hash_lookup_count: imageHashLookups,
    image_hash_lookup_skipped_reason: imageHashLookupEnabled ? '' : (dryRun ? 'preview_metadata_only' : 'prepared_preview_reused'),
    metadata_reports: metadataReports,
    server_enrichment: {
      marker: KING_TIKTOK_HARVEST_E2E_MARKER,
      requested: fetchOembed === true && seeds.some((seed) => platformForExactSocialPostUrl(seed.post_url) === 'TikTok'),
      server_side: true,
      provider: 'tiktok_oembed',
      provider_endpoint: TIKTOK_OEMBED_URL,
      attempted: tiktokOembedReports.length,
      succeeded: tiktokOembedReports.filter((report) => report.ok).length,
      failed: tiktokOembedReports.filter((report) => !report.ok).length,
      verified_posts: tiktokOembedReports.map((report) => ({
        post_url: report.post_url,
        ok: report.ok,
        status: report.status,
        attempts: report.attempts,
        author_name: report.verified_author_name,
        author_url: report.verified_author_url,
        caption_received: report.caption_received,
        thumbnail_received: report.thumbnail_received,
        reason: report.reason,
      })),
    },
    import_result: importResult,
    ...importResult,
  };
}

function isDiscoveryFeed(source = {}) {
  return sourceRecordKind(source) === 'discovery_feed';
}

function sourcesForPlatform(platform = 'all') {
  const normalized = normalizePlatform(platform);
  return getPropertySourceRegistry()
    .filter((source) => normalized === 'all' || normalizePlatform(source.platform) === normalized)
    .map((source) => ({
      ...source,
      source_key: source.key || source.source_key,
      source_name: source.name || source.source_name,
      source_type: source.sourceType || source.source_type,
      source_url: source.url || source.source_url,
    }));
}

function rotatingSourceWindow(sources = [], {
  limit = DEFAULT_MAX_SOURCES,
  offset = 0,
} = {}) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  const total = list.length;
  const selectedLimit = Math.min(cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES), total || 1);
  const startOffset = total ? cappedOffset(offset) % total : 0;
  const rotated = total
    ? [...list.slice(startOffset), ...list.slice(0, startOffset)]
      .slice(0, selectedLimit)
      .map((source, index) => ({
        ...source,
        source_registry_offset: (startOffset + index) % total,
        source_window_index: index,
      }))
    : [];
  const nextOffset = total ? (startOffset + rotated.length) % total : cappedOffset(offset) + rotated.length;
  return {
    sources: rotated,
    source_count: total,
    selected_source_count: rotated.length,
    source_offset: startOffset,
    next_source_offset: nextOffset,
  };
}

function sourceWindowSummary(window = {}) {
  return {
    source_count: Number(window.source_count || 0),
    selected_source_count: Number(window.selected_source_count || 0),
    source_offset: Number(window.source_offset || 0),
    next_source_offset: Number(window.next_source_offset || 0),
  };
}

function buildTikTokCaptureTasks({ sources = sourcesForPlatform('tiktok'), limit = DEFAULT_MAX_SOURCES } = {}) {
  return sources
    .filter((source) => normalizePlatform(source.platform) === 'tiktok')
    .slice(0, cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES))
    .map((source) => {
      const hashtag = sourceHashtag(source);
      const handle = sourceHandle(source);
      const query = hashtag ? `#${hashtag}` : (handle ? `@${handle}` : sourceName(source));
      return {
        platform: 'tiktok',
        source_key: sourceKey(source),
        source_name: sourceName(source),
        source_type: source.source_type || source.sourceType || '',
        source_record_kind: isDiscoveryFeed(source) ? 'discovery_feed' : 'source_page',
        source_url: sourceUrl(source),
        query,
        exact_post_url_required: true,
        exact_post_url_pattern: 'https://www.tiktok.com/@{handle}/video/{video_id}',
        import_ready_when: [
          'exact TikTok video URL is captured',
          'source evidence is captured for King review; only location is non-negotiable before approval',
          'caption/overlay gives property title or description',
          'location or area is visible',
          'price is visible or should be marked Price upon application',
          'public source/profile/contact route is available',
          'screenshot/still/thumbnail evidence is captured or a labelled evidence card is used',
        ],
        next_action: `Open ${sourceUrl(source) || query}, collect every 2026+ property video URL, then import with inventory:import-source-posts.`,
      };
    });
}

function buildManualSocialCaptureTasks({ sources = [], platform = 'social', limit = DEFAULT_MAX_SOURCES } = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  return sources
    .filter((source) => normalizedPlatform === 'social' || normalizePlatform(source.platform) === normalizedPlatform)
    .slice(0, cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES))
    .map((source) => {
      const hashtag = sourceHashtag(source);
      const query = hashtag ? `#${hashtag}` : sourceName(source);
      const sourcePlatform = normalizePlatform(source.platform || platform);
      return {
        platform: sourcePlatform,
        source_key: sourceKey(source),
        source_name: sourceName(source),
        source_type: source.source_type || source.sourceType || '',
        source_record_kind: isDiscoveryFeed(source) ? 'discovery_feed' : 'source_page',
        source_url: sourceUrl(source),
        query,
        exact_post_url_required: true,
        exact_post_url_pattern: sourcePlatform === 'facebook'
          ? 'https://www.facebook.com/{page_or_group}/posts/{post_id} or https://www.facebook.com/watch/?v={video_id}'
          : sourcePlatform === 'instagram'
            ? 'https://www.instagram.com/p/{shortcode}/ or https://www.instagram.com/reel/{shortcode}/'
            : 'public social post URL',
        student_housing_focus: true,
        import_ready_when: [
          'exact public post, reel, or video URL is captured',
          'campus, hostel, student accommodation, university, or student-room signal is visible',
          'location or area is visible',
          'source contact path is available',
        ],
        next_action: `Open ${sourceUrl(source) || query}, capture exact student housing post URLs, then paste them into the King exact-link import panel.`,
      };
    });
}

function youtubeCategoryTermsForSource(source = {}) {
  const listingTypes = sourceListValues(source, 'listingTypes', 'listing_types')
    .map((type) => type.toLowerCase());
  const categories = new Set();
  if (listingTypes.length) {
    if (listingTypes.includes('students')) categories.add('students');
    if (listingTypes.includes('commercial')) categories.add('commercial');
    if (listingTypes.includes('land')) categories.add('land');
    if (listingTypes.includes('rent') || listingTypes.includes('apartments')) categories.add('rent');
    if (listingTypes.includes('sale')) categories.add('sale');
  }
  if (!categories.size) {
    const text = cleanText([
      sourceName(source),
      sourceUrl(source),
      sourceListValues(source, 'hashtags', 'hashtags').join(' '),
      source.metadata?.query,
      source.metadata?.hashtag,
    ].join(' ')).toLowerCase();
    if (/student|hostel|campus|makerere|kyambogo|mubs|ucu|accommodation/.test(text)) categories.add('students');
    if (/commercial|office|shop|warehouse|showroom|factory|arcade|retail/.test(text)) categories.add('commercial');
    if (/land|plot|acre|decimal|mailo|ettaka|bibanja|kiwanja/.test(text)) categories.add('land');
    if (/rent|rental|to let|kupangisa|obupangisa|muzigo/.test(text)) categories.add('rent');
    if (!categories.size || /sale|sell|house|home|property|nyumba|amayumba/.test(text)) categories.add('sale');
  }
  return [...categories].flatMap((category) => YOUTUBE_CATEGORY_QUERY_TERMS[category] || []);
}

function dedupeQueryTerms(terms = []) {
  const seen = new Set();
  const output = [];
  for (const term of terms.map(cleanText).filter(Boolean)) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(term);
  }
  return output;
}

function sourceDistrictTerms(source = {}) {
  const values = Array.isArray(source.districts) ? source.districts : [];
  return values.map(cleanText).filter(Boolean).slice(0, 2);
}

function sourceTownTerm(source = {}) {
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const metadataQuery = cleanText(metadata.query || '');
  const beforeHash = cleanText(metadataQuery.split('#')[0]);
  if (beforeHash && beforeHash.length <= 40) return beforeHash;
  const sourceNameText = sourceName(source);
  const bulletMatch = sourceNameText.match(/•\s*([^•]+)$/);
  if (bulletMatch) return cleanText(bulletMatch[1]).slice(0, 40);
  return sourceDistrictTerms(source)[0] || '';
}

function queryHasUgandaContext(query = '') {
  return /\b(uganda|kampala|wakiso|mukono|entebbe|jinja|kira|ntinda|naalya|najjera|namugongo|makerere|kyambogo|mubs|ucu)\b/i.test(query);
}

function focusedYouTubeFallbackTerm(source = {}) {
  const categoryTerms = youtubeCategoryTermsForSource(source);
  const text = cleanText([
    sourceName(source),
    sourceUrl(source),
    sourceListValues(source, 'listingTypes', 'listing_types').join(' '),
    source.metadata?.query,
    source.metadata?.hashtag,
  ].join(' ')).toLowerCase();
  if (/student|hostel|campus|makerere|kyambogo|mubs|ucu/.test(text)) return 'student hostel';
  if (/commercial|office|shop|warehouse|showroom|factory|arcade/.test(text)) return 'commercial property';
  if (/land|plot|acre|decimal|mailo|ettaka|bibanja|kiwanja/.test(text)) return 'land for sale';
  if (/rent|rental|to let|kupangisa|obupangisa|muzigo/.test(text)) return 'house for rent';
  return categoryTerms[0] || 'property';
}

function buildYouTubeQueryForSource(source = {}) {
  const url = sourceUrl(source);
  const existingQuery = urlParam(url, 'search_query') || urlParam(url, 'q');
  if (youtubeChannelLookupForSource(source)) {
    const channelText = cleanText(sourceName(source) || source.handle || url);
    return dedupeQueryTerms([
      channelText || 'Uganda property',
      ...sourceDistrictTerms(source),
      queryHasUgandaContext(channelText) ? '' : 'Uganda',
      focusedYouTubeFallbackTerm(source),
    ]).join(' ');
  }
  if (existingQuery) {
    return dedupeQueryTerms([
      existingQuery,
      queryHasUgandaContext(existingQuery) ? '' : 'Uganda',
    ]).join(' ');
  }
  const metadataQuery = cleanText(source.metadata?.query || '');
  if (metadataQuery) {
    return dedupeQueryTerms([
      metadataQuery,
      queryHasUgandaContext(metadataQuery) ? '' : 'Uganda',
    ]).join(' ');
  }
  const hashtag = sourceHashtag(source);
  if (hashtag) {
    return dedupeQueryTerms([
      `#${hashtag}`,
      ...sourceDistrictTerms(source),
      queryHasUgandaContext(hashtag) ? '' : 'Uganda',
      focusedYouTubeFallbackTerm(source),
    ]).join(' ');
  }
  const tags = Array.isArray(source.hashtags)
    ? source.hashtags.filter(Boolean).slice(0, 4).map((tag) => `#${String(tag).replace(/^#/, '')}`)
    : [];
  const nameWords = cleanText(sourceName(source))
    .replace(/^youtube\s+(?:search|hashtag):?/i, '')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(youtube|search|hashtag|feed|source)$/i.test(word))
    .slice(0, 6);
  const discoveryTerms = [hashtag ? `#${hashtag}` : '', ...tags, ...nameWords]
    .filter(Boolean)
    .join(' ');
  return dedupeQueryTerms([
    discoveryTerms || sourceName(source) || 'Uganda property',
    ...sourceDistrictTerms(source),
    queryHasUgandaContext(discoveryTerms) ? '' : 'Uganda',
    focusedYouTubeFallbackTerm(source),
  ]).join(' ');
}

function youtubeFocusedSearchQueriesForSource(source = {}) {
  if (youtubeChannelLookupForSource(source)) return [buildYouTubeQueryForSource(source)];
  const url = sourceUrl(source);
  const existingQuery = urlParam(url, 'search_query') || urlParam(url, 'q');
  if (youtubeSourceIsHashtag(source)) {
    const town = sourceTownTerm(source);
    const queries = [];
    for (const tag of sourceHashtags(source).slice(0, 3)) {
      const hashtag = `#${String(tag).replace(/^#/, '')}`;
      queries.push(hashtag);
      if (town && !new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hashtag)) {
        queries.push(`${hashtag} ${town}`);
      }
    }
    return dedupeQueryTerms(queries).slice(0, 4);
  }
  if (existingQuery) {
    return [dedupeQueryTerms([
      existingQuery,
      queryHasUgandaContext(existingQuery) ? '' : 'Uganda',
    ]).join(' ')];
  }
  const metadataQuery = cleanText(source.metadata?.query || '');
  if (metadataQuery) {
    const town = sourceTownTerm(source);
    return dedupeQueryTerms([
      metadataQuery,
      town ? `${town} ${focusedYouTubeFallbackTerm(source)}` : '',
    ]).slice(0, 2);
  }
  return [buildYouTubeQueryForSource(source)];
}

function youtubeCoverageTermsForSource(source = {}) {
  return dedupeQueryTerms([
    ...youtubeCategoryTermsForSource(source),
    ...YOUTUBE_LOCAL_LANGUAGE_QUERY_TERMS,
    ...sourceListValues(source, 'hashtags', 'hashtags').map((tag) => `#${String(tag).replace(/^#/, '')}`),
    ...sourceDistrictTerms(source),
  ]);
}

function youtubeChannelLookupForSource(source = {}) {
  const url = sourceUrl(source);
  const directChannelId = youtubeChannelIdFromUrl(url) || youtubeChannelIdFromUrl(source.handle || '');
  const handle = youtubeHandleFromUrl(url) || youtubeHandleFromUrl(source.handle || source.username || '');
  const type = cleanText(source.source_type || source.sourceType || '').toLowerCase();
  const sourcePage = sourceRecordKind(source) === 'source_page' || type.includes('creator_channel') || type.includes('media_channel');
  if (!sourcePage || (!directChannelId && !handle)) return null;
  return {
    channel_id: directChannelId,
    channel_handle: handle,
  };
}

function youtubeSourceIsHashtag(source = {}) {
  const type = cleanText(source.source_type || source.sourceType || '').toLowerCase();
  const kind = cleanText(source.source_record_kind || source.sourceRecordKind || '').toLowerCase();
  const url = sourceUrl(source);
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  return Boolean(
    type.includes('hashtag')
      || kind.includes('hashtag')
      || /youtube\.com\/hashtag\//i.test(url)
      || metadata.generated_hashtag_discovery === true
  );
}

function youtubeDiscoveryPriority(source = {}) {
  const type = cleanText(source.source_type || source.sourceType || '').toLowerCase();
  const url = sourceUrl(source);
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  let score = 50;
  if (youtubeSourceIsHashtag(source)) score = -20;
  else if (type.includes('public_video_search_feed')) score = 0;
  else if (type.includes('search_feed')) score = 10;
  else if (/youtube\.com\/results\?/i.test(url)) score = 30;
  else if (isDiscoveryFeed(source)) score = 40;
  if (metadata.generated_hashtag_discovery) score -= 10;
  else if (metadata.generated_source_discovery) score -= 5;
  if (type.includes('creator_channel') || type.includes('media_channel')) score += 120;
  if (/youtube\.com\/@/i.test(url)) score += 80;
  return score;
}

function sortYouTubeSourcesForDiscovery(sources = []) {
  return sources
    .map((source, index) => ({
      source,
      index,
      priority: youtubeDiscoveryPriority(source),
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.index - b.index;
    })
    .map((item) => item.source);
}

function youtubeKnownChannelSourceKey(url = '') {
  const normalizedUrl = normalizeYouTubeChannelSourceUrl(url);
  const channelId = youtubeChannelIdFromUrl(normalizedUrl);
  const handle = youtubeHandleFromUrl(normalizedUrl);
  return channelId
    ? `youtube-known-channel-${channelId.toLowerCase()}`
    : handle
      ? `youtube-known-handle-${handle.toLowerCase()}`
      : '';
}

function buildKnownYouTubeChannelSourcesFromRows(rows = [], {
  limit = DEFAULT_MAX_SOURCES,
  offset = 0,
} = {}) {
  const sourceLimit = cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES);
  const startOffset = cappedOffset(offset);
  const seen = new Set();
  const sources = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidates = [
      row.youtube_channel_url,
      row.source_channel_url,
      row.source_contact_url,
      row.source_page_url,
      row.channel_url,
      row.source_url,
      row.url,
    ];
    for (const candidate of candidates) {
      const url = normalizeYouTubeChannelSourceUrl(candidate);
      if (!url) continue;
      const key = youtubeKnownChannelSourceKey(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const handle = youtubeHandleFromUrl(url);
      sources.push({
        key,
        name: cleanText(row.source_name || row.source_agent_name || row.public_display_name || row.channel_title || row.title || handle || 'Known YouTube property source'),
        platform: 'youtube',
        sourceType: 'creator_channel',
        source_record_kind: 'source_page',
        url,
        handle: handle ? `@${handle}` : '',
        metadata: {
          generated_known_channel_fallback: true,
          source: 'stored_youtube_source_contact',
        },
      });
      break;
    }
  }
  return sources.slice(startOffset, startOffset + sourceLimit);
}

async function knownYouTubeChannelSourcesFromDb(db, {
  limit = DEFAULT_MAX_SOURCES,
  offset = 0,
} = {}) {
  if (!db || typeof db.query !== 'function') {
    return {
      ok: false,
      reason: 'missing_db_connection',
      sources: [],
    };
  }
  const sourceLimit = cappedNumber(limit, SOCIAL_SWEEP_FAST_DEFAULT_SOURCES, 1, SOCIAL_SWEEP_FAST_MAX_SOURCES);
  const sourceOffset = cappedOffset(offset);
  const rowLimit = Math.min(Math.max(sourceLimit * 12, 200), 720);
  const sql = `
    SELECT
      title,
      listing_type,
      extra_fields->>'source_name' AS source_name,
      extra_fields->>'source_agent_name' AS source_agent_name,
      extra_fields->>'public_display_name' AS public_display_name,
      extra_fields->>'source_contact_url' AS source_contact_url,
      extra_fields->>'source_channel_url' AS source_channel_url,
      extra_fields->>'youtube_channel_url' AS youtube_channel_url,
      extra_fields->>'source_page_url' AS source_page_url,
      extra_fields->>'channel_url' AS channel_url,
      extra_fields->>'source_url' AS source_url
    FROM properties
    WHERE LOWER(COALESCE(extra_fields->>'source_platform', '')) = 'youtube'
      AND (
        COALESCE(extra_fields->>'source_contact_url', '') ~* 'youtube\\.com/(channel/UC|@)'
        OR COALESCE(extra_fields->>'source_channel_url', '') ~* 'youtube\\.com/(channel/UC|@)'
        OR COALESCE(extra_fields->>'youtube_channel_url', '') ~* 'youtube\\.com/(channel/UC|@)'
        OR COALESCE(extra_fields->>'source_page_url', '') ~* 'youtube\\.com/(channel/UC|@)'
        OR COALESCE(extra_fields->>'channel_url', '') ~* 'youtube\\.com/(channel/UC|@)'
      )
    ORDER BY created_at DESC NULLS LAST
    LIMIT $1 OFFSET $2
  `;
  try {
    const result = await db.query(sql, [rowLimit, sourceOffset]);
    const sources = buildKnownYouTubeChannelSourcesFromRows(result.rows || [], {
      limit: sourceLimit,
      offset: 0,
    });
    return {
      ok: true,
      reason: '',
      scanned_row_count: Array.isArray(result.rows) ? result.rows.length : 0,
      sources,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.message || 'known_youtube_channel_source_query_failed',
      sources: [],
    };
  }
}

function buildYouTubeSearchJobs({
  sources = sourcesForPlatform('youtube'),
  limit = DEFAULT_MAX_SOURCES,
  offset = 0,
  publishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START,
  publishedBefore = '',
  maxPagesPerSource = DEFAULT_YOUTUBE_PAGES_PER_SOURCE,
  jobMode = 'all',
} = {}) {
  const start = cleanText(publishedAfter) || YOUTUBE_SOURCE_POST_WINDOW_START;
  const pageLimit = cappedNumber(maxPagesPerSource, DEFAULT_YOUTUBE_PAGES_PER_SOURCE, 1, 10);
  const normalizedJobMode = normalizeYouTubeJobMode(jobMode);
  const sortedSources = sortYouTubeSourcesForDiscovery(sources
    .filter((source) => normalizePlatform(source.platform) === 'youtube')
  );
  const jobs = sortedSources.flatMap((source, sourceIndex) => {
      const channelLookup = youtubeChannelLookupForSource(source);
      const searchMethod = channelLookup ? 'channel_uploads' : 'search';
      const queries = searchMethod === 'channel_uploads'
        ? [buildYouTubeQueryForSource(source)]
        : youtubeFocusedSearchQueriesForSource(source);
      return queries.map((query, queryIndex) => ({
        platform: 'youtube',
        source_registry_offset: sourceIndex,
        source_key: queryIndex ? `${sourceKey(source)}:q${queryIndex + 1}` : sourceKey(source),
        source_root_key: sourceKey(source),
        source_name: sourceName(source),
        source_type: source.source_type || source.sourceType || '',
        source_record_kind: isDiscoveryFeed(source) ? 'discovery_feed' : 'source_page',
        source_url: sourceUrl(source),
        source_phone: cleanText(source.phone || source.contact_phone || ''),
        source_phone_alt: cleanText(source.phoneAlt || source.phone_alt || source.contact_phone_alt || ''),
        source_email: cleanText(source.email || source.contact_email || ''),
        source_listing_types: sourceListValues(source, 'listingTypes', 'listing_types'),
        source_hashtags: sourceListValues(source, 'hashtags', 'hashtags'),
        source_can_contact_directly: source.canContactDirectly === true || source.can_contact_directly === true,
        source_trust_level: cleanText(source.trustLevel || source.trust_level || ''),
        source_consent_status: cleanText(source.consentStatus || source.consent_status || ''),
        discovery_priority: youtubeDiscoveryPriority(source),
        query: cleanText(query).slice(0, 500),
        query_variant: queryIndex + 1,
        query_strategy: searchMethod === 'channel_uploads'
          ? 'channel_uploads'
          : (youtubeSourceIsHashtag(source) ? 'single_hashtag_or_hashtag_plus_town' : 'focused_registry_query'),
        coverage_terms: youtubeCoverageTermsForSource(source).slice(0, 80),
        search_method: searchMethod,
        channel_id: channelLookup?.channel_id || '',
        channel_handle: channelLookup?.channel_handle || '',
        endpoint: searchMethod === 'channel_uploads' ? YOUTUBE_PLAYLIST_ITEMS_URL : YOUTUBE_SEARCH_URL,
        channel_lookup_endpoint: searchMethod === 'channel_uploads' ? YOUTUBE_CHANNELS_URL : '',
        published_after: start,
        published_before: cleanText(publishedBefore),
        max_results: DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
        max_pages: pageLimit,
        includes_shorts_and_long_form: true,
      }));
    });
  const filteredJobs = filterYouTubeJobsByMode(jobs, normalizedJobMode);
  const startOffset = filteredJobs.length ? cappedOffset(offset) % filteredJobs.length : 0;
  return filteredJobs
    .slice(startOffset, startOffset + cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES))
    .map((job, sourceWindowIndex) => ({
      ...job,
      source_window_index: sourceWindowIndex,
    }));
}

function normalizeYouTubeJobMode(value = 'all') {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (['channel', 'channels', 'channel_upload', 'channel_uploads', 'uploads', 'known_channels'].includes(normalized)) return 'channel_uploads';
  if (['search', 'broad_search', 'hashtag_search', 'hashtags'].includes(normalized)) return 'search';
  return 'all';
}

function filterYouTubeJobsByMode(jobs = [], jobMode = 'all') {
  const normalizedJobMode = normalizeYouTubeJobMode(jobMode);
  if (normalizedJobMode === 'channel_uploads') return jobs.filter((job) => job.search_method === 'channel_uploads');
  if (normalizedJobMode === 'search') return jobs.filter((job) => job.search_method === 'search');
  return jobs;
}

function youtubeThumbnailUrls(thumbnails = {}) {
  return ['maxres', 'standard', 'high', 'medium', 'default']
    .map((key) => thumbnails?.[key]?.url)
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 5);
}

function youtubeHasPropertySignal(text = '', job = {}) {
  const raw = cleanText(text).toLowerCase();
  const sourceTypes = Array.isArray(job.source_listing_types) ? job.source_listing_types.join(' ') : '';
  const sourceText = `${raw} ${sourceTypes}`.toLowerCase();
  return /\b(property|properties|real estate|house|home|apartment|flat|villa|mansion|bungalow|duplex|bedroom|bedrooms|beds?|land|plot|plots|acre|acres|decimal|decimals|mailo|hostel|student accommodation|student room|rental|rent|to let|commercial|office|shop|warehouse|showroom|factory|arcade|ettaka|bibanja|ebibanja|akabanja|amayumba|nyumba|kupangisa|obupangisa|muzigo|emizigo|kiwanja|viwanja)\b/i.test(sourceText)
    || /\b(?:for sale|for rent|on sale|selling|ugx|ush|shs?|million|billion|monthly|per month)\b/i.test(sourceText);
}

function youtubeHasExplicitListingIntent(text = '', listingType = '') {
  const raw = cleanText(text).toLowerCase();
  if (!raw) return false;
  if (/\b(?:for sale|on sale|house for sale|home for sale|property for sale|land for sale|plot(?:s)? for sale|acre(?:s)? for sale|selling|available for sale|buy this|asking price|guide price|price[:\s]|ugx|ush|shs?|usd|\$)\b/i.test(raw)) return true;
  if (/\b(?:for rent|to let|rental|rentals|rent per month|monthly rent|per month|available for rent|house for rent|apartment for rent|office space for rent|shop for rent)\b/i.test(raw)) return true;
  if (/\b(?:student accommodation|hostel room|student room|room available|rooms available|campus hostel)\b/i.test(raw)) return true;
  if (listingType === 'land' && /\b(?:mailo|title|decimals?|acres?|plots?)\b/i.test(raw) && /\b(?:sale|selling|available|price|ugx|ush|shs?)\b/i.test(raw)) return true;
  if (listingType === 'commercial' && /\b(?:office|shop|warehouse|showroom|factory|arcade|commercial)\b/i.test(raw) && /\b(?:for rent|to let|for sale|lease|available|price|ugx|ush|shs?)\b/i.test(raw)) return true;
  return false;
}

function youtubeSourcePreapprovalFields(job = {}) {
  const sourcePhone = normalizeUgandanPhone(job.source_phone || job.source_phone_alt || '');
  const trustText = cleanText(`${job.source_consent_status || ''} ${job.source_trust_level || ''}`).toLowerCase();
  const trusted = Boolean(sourcePhone)
    && /\b(founder_reported_agent_permission|authorised_founder_contact|authorized_founder_contact|agent_preapproved|owner_agent_preapproved|founder_confirmed_preapproved)\b/i.test(trustText);
  return {
    pre_approved: trusted,
    consent_confirmed: trusted,
    image_rights_confirmed: trusted,
    permission_status: trusted
      ? 'founder_reported_agent_authorised_upload'
      : 'youtube_api_source_pending_king_review',
  };
}

function youtubeLocationConfidence(area = '', district = '') {
  const normalizedArea = cleanText(area).toLowerCase();
  if (!normalizedArea) return 'missing_location';
  if (!GENERIC_YOUTUBE_LOCATION_TERMS.has(normalizedArea)) return 'area_or_neighbourhood_detected';
  return district ? 'district_or_city_level_needs_review' : 'generic_location_needs_review';
}

function youtubeDateStatus(publishedAt = '', publishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START) {
  const date = publishedAt ? new Date(publishedAt) : null;
  const start = new Date(cleanText(publishedAfter) || YOUTUBE_SOURCE_POST_WINDOW_START);
  if (!date || Number.isNaN(date.getTime())) return 'needs_source_platform_date_confirmation';
  return date >= start ? 'confirmed_2026_plus_source_window' : 'before_requested_source_window';
}

function youtubeConfidenceReviewForPost({
  combinedText = '',
  area = '',
  district = '',
  contactPhone = '',
  contactEmail = '',
  sourceContactUrl = '',
  publishedAt = '',
  publishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START,
  listingType = '',
  preapproval = {},
  hashtagSource = false,
} = {}) {
  const propertySignal = youtubeHasPropertySignal(combinedText, { source_listing_types: [listingType] });
  const explicitListingIntent = youtubeHasExplicitListingIntent(combinedText, listingType);
  const locationStatus = youtubeLocationConfidence(area, district);
  const dateStatus = youtubeDateStatus(publishedAt, publishedAfter);
  const hasDirectPhone = Boolean(contactPhone);
  const hasContactPath = Boolean(contactPhone || contactEmail || sourceContactUrl);
  const categoryStatus = listingType ? `categorized_${listingType}` : 'category_needs_review';
  const checks = {
    property_signal: propertySignal,
    source_date_2026_plus: dateStatus === 'confirmed_2026_plus_source_window',
    direct_phone: hasDirectPhone,
    contact_path: hasContactPath,
    location_area_detected: locationStatus === 'area_or_neighbourhood_detected',
    explicit_listing_intent: explicitListingIntent,
    preapproved_source: preapproval.pre_approved === true,
    hashtag_source: hashtagSource === true,
  };
  const score = [
    checks.property_signal ? 20 : 0,
    checks.source_date_2026_plus ? 20 : 0,
    checks.location_area_detected ? 20 : locationStatus === 'district_or_city_level_needs_review' ? 8 : 0,
    checks.direct_phone ? 15 : checks.contact_path ? 6 : 0,
    checks.preapproved_source ? 15 : 0,
    listingType ? 10 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const preapprovedLiveReady = score >= 85
    && checks.property_signal
    && checks.source_date_2026_plus
    && checks.location_area_detected
    && checks.direct_phone
    && checks.explicit_listing_intent
    && checks.preapproved_source;
  const hashtagAutoLiveReady = score >= 70
    && checks.hashtag_source
    && checks.property_signal
    && checks.source_date_2026_plus
    && checks.location_area_detected
    && checks.contact_path
    && checks.explicit_listing_intent
    && Boolean(listingType);
  const youtubeApiAutoLiveReady = score >= 70
    && checks.property_signal
    && checks.source_date_2026_plus
    && checks.location_area_detected
    && checks.contact_path
    && checks.explicit_listing_intent
    && Boolean(listingType);
  const liveReady = preapprovedLiveReady || hashtagAutoLiveReady || youtubeApiAutoLiveReady;
  return {
    score,
    status: hashtagAutoLiveReady
      ? 'youtube_hashtag_auto_live_ready'
      : youtubeApiAutoLiveReady
        ? 'youtube_api_auto_live_ready'
      : preapprovedLiveReady
        ? 'youtube_confident_live_ready'
        : 'youtube_review_required',
    live_ready: liveReady,
    auto_live_ready: youtubeApiAutoLiveReady,
    date_status: dateStatus,
    phone_status: hasDirectPhone ? 'direct_phone_present' : (hasContactPath ? (youtubeApiAutoLiveReady ? 'source_contact_only_ok' : 'source_contact_only_needs_review') : 'missing_contact'),
    location_status: locationStatus,
    category_status: categoryStatus,
    checks,
  };
}

function youtubeSnippetForItem(item = {}) {
  return item.video_details?.snippet || item.videoDetails?.snippet || item.youtube_video_details?.snippet || item.snippet || {};
}

function youtubeLocationDescriptionForItem(item = {}) {
  return cleanText(
    item.recordingDetails?.locationDescription
    || item.video_details?.recordingDetails?.locationDescription
    || item.videoDetails?.recordingDetails?.locationDescription
    || item.youtube_video_details?.recordingDetails?.locationDescription
    || ''
  );
}

function flattenCleanTextValues(values = []) {
  const output = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) output.push(...value);
    else output.push(value);
  }
  return output.map((value) => cleanText(value)).filter(Boolean);
}

function youtubeCommentTextFromThread(thread = {}) {
  if (typeof thread === 'string') return cleanText(thread);
  const snippet = thread.snippet?.topLevelComment?.snippet
    || thread.topLevelComment?.snippet
    || thread.snippet
    || thread;
  return cleanText(snippet.textOriginal || snippet.textDisplay || snippet.text || snippet.comment || '');
}

function youtubeCommentEvidenceFromItem(item = {}) {
  const threadValues = [
    item.youtube_comment_threads?.items,
    item.youtube_comment_threads,
    item.comment_threads?.items,
    item.comment_threads,
  ].flatMap((value) => (Array.isArray(value) ? value : []))
    .map((thread) => youtubeCommentTextFromThread(thread));
  return cleanText(flattenCleanTextValues([
    item.youtube_top_comments,
    item.top_comments,
    item.comments,
    item.comment,
    item.owner_comment,
    item.owner_comments,
    item.owner_response,
    item.poster_reply,
    item.poster_response,
    item.reply,
    item.replies,
    threadValues,
  ]).join(' '));
}

function youtubeEvidenceTextForItem(item = {}, job = {}, { includeComments = true } = {}) {
  const snippet = youtubeSnippetForItem(item);
  const tags = Array.isArray(snippet.tags) ? snippet.tags.join(' ') : '';
  const visualText = sourceVisualTextFromObject(item);
  const commentEvidence = includeComments ? youtubeCommentEvidenceFromItem(item) : '';
  return cleanText([
    snippet.title,
    snippet.description,
    tags,
    youtubeLocationDescriptionForItem(item),
    visualText,
    commentEvidence,
    Array.isArray(job.source_listing_types) ? job.source_listing_types.join(' ') : '',
  ].filter(Boolean).join(' '));
}

function youtubeShouldFetchCommentEvidence(item = {}, job = {}) {
  const combinedText = youtubeEvidenceTextForItem(item, job, { includeComments: false });
  if (!youtubeHasPropertySignal(combinedText, job)) return false;
  const area = extractArea(combinedText);
  const district = districtForArea(area, combinedText);
  const listingType = listingTypeFromText(`${combinedText} ${(job.source_listing_types || []).join(' ')}`);
  const missingSpecificLocation = youtubeLocationConfidence(area, district) !== 'area_or_neighbourhood_detected';
  const missingIntent = !youtubeHasExplicitListingIntent(combinedText, listingType);
  return missingSpecificLocation || missingIntent;
}

function youtubeMergeVideoDetailsIntoItem(item = {}, detail = null) {
  if (!detail) return item;
  const existingSnippet = item.snippet || {};
  const detailSnippet = detail.snippet || {};
  const mergedSnippet = {
    ...existingSnippet,
    ...detailSnippet,
    title: cleanText(detailSnippet.title) || existingSnippet.title,
    description: cleanText(detailSnippet.description) || existingSnippet.description,
    publishedAt: detailSnippet.publishedAt || existingSnippet.publishedAt,
    channelId: detailSnippet.channelId || existingSnippet.channelId,
    channelTitle: detailSnippet.channelTitle || existingSnippet.channelTitle,
    thumbnails: detailSnippet.thumbnails || existingSnippet.thumbnails,
    tags: Array.isArray(detailSnippet.tags) ? detailSnippet.tags : existingSnippet.tags,
    resourceId: existingSnippet.resourceId || detailSnippet.resourceId,
    videoOwnerChannelId: existingSnippet.videoOwnerChannelId || detailSnippet.videoOwnerChannelId,
  };
  return {
    ...item,
    snippet: mergedSnippet,
    recordingDetails: detail.recordingDetails || item.recordingDetails,
    video_details: detail,
    videoDetails: detail,
    youtube_video_details: detail,
  };
}

async function fetchYouTubeVideoDetailsForItems(items = [], {
  apiKey = '',
  fetchImpl = fetch,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_COMMIT_RESERVE_MS,
} = {}) {
  const ids = Array.from(new Set((Array.isArray(items) ? items : [])
    .map((item) => normalizeYouTubeVideoId(item.id?.videoId || item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || item.id || ''))
    .filter(Boolean)));
  if (!apiKey || !ids.length) {
    return { ok: false, skipped: true, reason: apiKey ? 'no_youtube_video_ids' : 'missing_youtube_api_key', detailsById: new Map(), reports: [] };
  }
  const detailsById = new Map();
  const reports = [];
  let timedOut = false;
  for (let index = 0; index < ids.length; index += 50) {
    if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
      timedOut = true;
      reports.push({
        ok: false,
        skipped: true,
        reason: 'source_sweep_time_budget_reserved_for_partial_commit',
        remaining_id_count: ids.length - index,
      });
      break;
    }
    const batch = ids.slice(index, index + 50);
    const url = new URL(YOUTUBE_VIDEOS_URL);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('part', 'snippet,recordingDetails');
    url.searchParams.set('id', batch.join(','));
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      const reason = sourceSweepErrorReason(error);
      if (/source_sweep/.test(reason)) {
        timedOut = true;
        reports.push({
          ok: false,
          skipped: true,
          reason,
          requested_count: batch.length,
        });
        break;
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    const report = {
      ok: response.ok,
      status: response.status,
      requested_count: batch.length,
      returned_count: Array.isArray(payload.items) ? payload.items.length : 0,
    };
    if (!response.ok) {
      const firstError = Array.isArray(payload?.error?.errors) ? payload.error.errors[0] : null;
      report.reason = firstError?.message || payload?.error?.message || 'youtube_video_details_failed';
      report.error_reason = firstError?.reason || '';
      reports.push(report);
      continue;
    }
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const id = normalizeYouTubeVideoId(item.id || '');
      if (id) detailsById.set(id, item);
    }
    reports.push(report);
  }
  return {
    ok: reports.some((report) => report.ok),
    detailsById,
    reports,
    result_count: detailsById.size,
    timed_out: timedOut,
  };
}

async function fetchYouTubeCommentEvidenceForItems(items = [], job = {}, {
  apiKey = '',
  fetchImpl = fetch,
  commentLookupBudget = null,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_COMMIT_RESERVE_MS,
} = {}) {
  const budget = commentLookupBudget || { remaining: 0, perVideo: DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO };
  if (!apiKey || !budget.remaining) {
    return { commentsById: new Map(), attempted_count: 0, fetched_count: 0, reports: [] };
  }
  const candidates = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const videoId = normalizeYouTubeVideoId(item.id?.videoId || item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || item.id || '');
    if (!videoId || seen.has(videoId)) continue;
    if (!youtubeShouldFetchCommentEvidence(item, job)) continue;
    seen.add(videoId);
    candidates.push({ item, videoId });
    if (candidates.length >= budget.remaining) break;
  }
  const commentsById = new Map();
  const reports = [];
  let timedOut = false;
  for (const candidate of candidates) {
    if (budget.remaining <= 0) break;
    if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
      timedOut = true;
      reports.push({
        ok: false,
        skipped: true,
        reason: 'source_sweep_time_budget_reserved_for_partial_commit',
        remaining_candidate_count: candidates.length - reports.length,
      });
      break;
    }
    budget.remaining -= 1;
    const url = new URL(YOUTUBE_COMMENT_THREADS_URL);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('videoId', candidate.videoId);
    url.searchParams.set('maxResults', String(cappedNumber(budget.perVideo, DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO, 1, 10)));
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('textFormat', 'plainText');
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      const reason = sourceSweepErrorReason(error);
      if (/source_sweep/.test(reason)) {
        timedOut = true;
        reports.push({
          ok: false,
          skipped: true,
          reason,
          video_id: candidate.videoId,
        });
        break;
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    const report = {
      ok: response.ok,
      status: response.status,
      video_id: candidate.videoId,
      returned_count: Array.isArray(payload.items) ? payload.items.length : 0,
    };
    if (!response.ok) {
      const firstError = Array.isArray(payload?.error?.errors) ? payload.error.errors[0] : null;
      report.reason = firstError?.message || payload?.error?.message || 'youtube_comment_threads_failed';
      report.error_reason = firstError?.reason || '';
      reports.push(report);
      continue;
    }
    const comments = (Array.isArray(payload.items) ? payload.items : [])
      .map((thread) => youtubeCommentTextFromThread(thread))
      .filter(Boolean)
      .slice(0, cappedNumber(budget.perVideo, DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO, 1, 10));
    if (comments.length) commentsById.set(candidate.videoId, cleanText(comments.join(' ')));
    reports.push(report);
  }
  return {
    commentsById,
    attempted_count: candidates.length,
    fetched_count: commentsById.size,
    reports,
    timed_out: timedOut,
  };
}

async function enrichYouTubeApiItems(items = [], job = {}, {
  apiKey = '',
  fetchImpl = fetch,
  commentLookupBudget = null,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_COMMIT_RESERVE_MS,
} = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (!apiKey || !rows.length) {
    return {
      rows,
      video_details_fetched_count: 0,
      comment_threads_attempted_count: 0,
      comment_threads_fetched_count: 0,
      detail_reports: [],
      comment_reports: [],
    };
  }
  const detailResult = await fetchYouTubeVideoDetailsForItems(rows, {
    apiKey,
    fetchImpl,
    deadlineAt,
    minRemainingMs,
  });
  const detailRows = rows.map((row) => {
    const videoId = normalizeYouTubeVideoId(row.id?.videoId || row.contentDetails?.videoId || row.snippet?.resourceId?.videoId || row.id || '');
    return youtubeMergeVideoDetailsIntoItem(row, detailResult.detailsById.get(videoId));
  });
  const commentResult = await fetchYouTubeCommentEvidenceForItems(detailRows, job, {
    apiKey,
    fetchImpl,
    commentLookupBudget,
    deadlineAt,
    minRemainingMs,
  });
  const enrichedRows = detailRows.map((row) => {
    const videoId = normalizeYouTubeVideoId(row.id?.videoId || row.contentDetails?.videoId || row.snippet?.resourceId?.videoId || row.id || '');
    const commentEvidence = cleanText(commentResult.commentsById.get(videoId) || '');
    if (!commentEvidence) return row;
    return {
      ...row,
      comments: cleanText(`${row.comments || ''} ${commentEvidence}`),
      youtube_top_comments: commentEvidence,
      youtube_comment_evidence: commentEvidence,
    };
  });
  return {
    rows: enrichedRows,
    video_details_fetched_count: detailResult.result_count || 0,
    comment_threads_attempted_count: commentResult.attempted_count || 0,
    comment_threads_fetched_count: commentResult.fetched_count || 0,
    detail_reports: detailResult.reports || [],
    comment_reports: commentResult.reports || [],
    timed_out: detailResult.timed_out === true || commentResult.timed_out === true,
  };
}

function normalizeYouTubeApiPost(item = {}, job = {}) {
  const videoId = normalizeYouTubeVideoId(item.id?.videoId || item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || item.id || '');
  if (!videoId) return null;
  const snippet = youtubeSnippetForItem(item);
  const title = cleanText(snippet.title || `YouTube property video ${videoId}`);
  const description = cleanText(snippet.description || '');
  const commentEvidence = youtubeCommentEvidenceFromItem(item);
  const visualText = sourceVisualTextFromObject(item);
  const combinedText = youtubeEvidenceTextForItem(item, job);
  if (!youtubeHasPropertySignal(combinedText, job)) return null;
  const area = extractArea(combinedText);
  const district = districtForArea(area, combinedText);
  const priceText = priceTextFromText(combinedText);
  const contactPhone = cleanText(phoneFromText(combinedText) || normalizeUgandanPhone(job.source_phone || job.source_phone_alt || ''));
  const contactEmail = cleanText(emailFromText(combinedText) || job.source_email || '');
  const channelId = snippet.videoOwnerChannelId || snippet.channelId || job.channel_id || '';
  const channelUrl = youtubeChannelUrl(channelId) || job.source_url || '';
  const sourceUrl = youtubeWatchUrl(videoId);
  const publishedAt = item.contentDetails?.videoPublishedAt || snippet.publishedAt || '';
  const listingType = listingTypeFromText(`${combinedText} ${(job.source_listing_types || []).join(' ')}`);
  const preapproval = youtubeSourcePreapprovalFields(job);
  const hashtagSource = youtubeSourceIsHashtag(job);
  const confidence = youtubeConfidenceReviewForPost({
    combinedText,
    area,
    district,
    contactPhone,
    contactEmail,
    sourceContactUrl: channelUrl || sourceUrl,
    publishedAt,
    publishedAfter: job.published_after || YOUTUBE_SOURCE_POST_WINDOW_START,
    listingType,
    preapproval,
    hashtagSource,
  });
  return {
    post_id: videoId,
    source_key: snippet.channelId || job.source_key || videoId,
    source_registry_key: job.source_key || '',
    source_name: cleanText(snippet.channelTitle || job.source_name || 'YouTube property source'),
    platform: 'YouTube',
    source_verified: true,
    source_verification_status: 'official_api_verified',
    source_url: sourceUrl,
    post_url: sourceUrl,
    source_page_url: channelUrl,
    source_contact_url: channelUrl || sourceUrl,
    youtube_url: sourceUrl,
    youtube_video_id: videoId,
    video_url: sourceUrl,
    title,
    source_title: title,
    caption: description,
    description: description || title,
    comments: commentEvidence,
    source_text: combinedText,
    source_visual_text: visualText,
    first_posted_at: publishedAt,
    published_at: publishedAt,
    platform_posted_at: publishedAt,
    youtube_published_at: publishedAt,
    youtube_source_published_at: publishedAt,
    area,
    district,
    location: area || district,
    price_text: priceText,
    listing_type: listingType,
    bedrooms: bedroomsFromText(combinedText),
    contact_phone: contactPhone,
    contact_email: contactEmail,
    pre_approved: preapproval.pre_approved,
    consent_confirmed: preapproval.consent_confirmed,
    image_rights_confirmed: preapproval.image_rights_confirmed,
    permission_status: preapproval.permission_status,
    image_urls: youtubeThumbnailUrls(snippet.thumbnails),
    source_batch: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    source_urls: [job.source_url, channelUrl, sourceUrl].filter(Boolean),
    raw_source_post: {
      youtube_search_item: item,
      youtube_video_details: item.youtube_video_details || item.video_details || item.videoDetails || null,
      youtube_top_comments: commentEvidence,
      comments: commentEvidence,
      source_text: combinedText,
      source_visual_text: visualText,
      source_job: job,
      import_method: 'youtube_data_api_search',
      youtube_hashtag_source: hashtagSource,
      published_after: job.published_after || YOUTUBE_SOURCE_POST_WINDOW_START,
      includes_shorts_and_long_form: true,
      youtube_confidence_review: confidence,
    },
  };
}

async function fetchYouTubeSearchJob(job = {}, {
  apiKey = '',
  maxResults = DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
  pageToken = '',
  fetchImpl = fetch,
  commentLookupBudget = null,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_COMMIT_RESERVE_MS,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_youtube_api_key',
      posts: [],
    };
  }
  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'date');
  url.searchParams.set('q', job.query);
  url.searchParams.set('publishedAfter', job.published_after || YOUTUBE_SOURCE_POST_WINDOW_START);
  if (job.published_before) url.searchParams.set('publishedBefore', job.published_before);
  url.searchParams.set('maxResults', String(cappedNumber(maxResults, DEFAULT_YOUTUBE_RESULTS_PER_SOURCE, 1, 50)));
  url.searchParams.set('safeSearch', 'none');
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Array.isArray(payload?.error?.errors) ? payload.error.errors[0] : null;
    return {
      ok: false,
      status: response.status,
      reason: firstError?.message || payload?.error?.message || 'youtube_api_search_failed',
      error_reason: firstError?.reason || '',
      posts: [],
    };
  }
  const rows = Array.isArray(payload.items) ? payload.items : [];
  const enriched = await enrichYouTubeApiItems(rows, job, {
    apiKey,
    fetchImpl,
    commentLookupBudget,
    deadlineAt,
    minRemainingMs,
  });
  return {
    ok: true,
    result_count: rows.length,
    posts: enriched.rows.map((row) => normalizeYouTubeApiPost(row, job)).filter(Boolean),
    next_page_token: payload.nextPageToken || '',
    page_info: payload.pageInfo || {},
    video_details_fetched_count: enriched.video_details_fetched_count || 0,
    comment_threads_attempted_count: enriched.comment_threads_attempted_count || 0,
    comment_threads_fetched_count: enriched.comment_threads_fetched_count || 0,
    detail_reports: enriched.detail_reports || [],
    comment_reports: enriched.comment_reports || [],
    timed_out: enriched.timed_out === true,
  };
}

function youtubePublishedAtForItem(item = {}) {
  return item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || '';
}

function youtubePublishedInWindow(item = {}, publishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START, publishedBefore = '') {
  const publishedAt = youtubePublishedAtForItem(item);
  const date = publishedAt ? new Date(publishedAt) : null;
  const start = new Date(cleanText(publishedAfter) || YOUTUBE_SOURCE_POST_WINDOW_START);
  if (!date || Number.isNaN(date.getTime()) || Number.isNaN(start.getTime())) return false;
  const end = cleanText(publishedBefore) ? new Date(publishedBefore) : null;
  return date >= start && (!end || Number.isNaN(end.getTime()) || date < end);
}

async function fetchYouTubeChannelDetails(job = {}, {
  apiKey = '',
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_youtube_api_key',
    };
  }
  const directChannelId = cleanText(job.channel_id || '');
  const handle = cleanText(job.channel_handle || '').replace(/^@/, '');
  if (!directChannelId && !handle) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_youtube_channel_identifier',
    };
  }
  const url = new URL(YOUTUBE_CHANNELS_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'id,snippet,contentDetails');
  if (directChannelId) url.searchParams.set('id', directChannelId);
  else url.searchParams.set('forHandle', `@${handle}`);
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Array.isArray(payload?.error?.errors) ? payload.error.errors[0] : null;
    return {
      ok: false,
      status: response.status,
      reason: firstError?.message || payload?.error?.message || 'youtube_channel_lookup_failed',
      error_reason: firstError?.reason || '',
    };
  }
  const channel = Array.isArray(payload.items) ? payload.items[0] : null;
  const uploadsPlaylistId = cleanText(channel?.contentDetails?.relatedPlaylists?.uploads || '');
  if (!channel?.id || !uploadsPlaylistId) {
    return {
      ok: false,
      status: 404,
      reason: 'youtube_channel_uploads_playlist_not_found',
      items_returned: Array.isArray(payload.items) ? payload.items.length : 0,
    };
  }
  return {
    ok: true,
    channel_id: channel.id,
    channel_title: cleanText(channel.snippet?.title || ''),
    uploads_playlist_id: uploadsPlaylistId,
  };
}

async function fetchYouTubeChannelUploadsJob(job = {}, {
  apiKey = '',
  maxResults = DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
  pageToken = '',
  fetchImpl = fetch,
  channelDetails = null,
  commentLookupBudget = null,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_COMMIT_RESERVE_MS,
} = {}) {
  const details = channelDetails || await fetchYouTubeChannelDetails(job, { apiKey, fetchImpl });
  if (!details.ok) {
    return {
      ...details,
      posts: [],
    };
  }
  const url = new URL(YOUTUBE_PLAYLIST_ITEMS_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('playlistId', details.uploads_playlist_id);
  url.searchParams.set('maxResults', String(cappedNumber(maxResults, DEFAULT_YOUTUBE_RESULTS_PER_SOURCE, 1, 50)));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Array.isArray(payload?.error?.errors) ? payload.error.errors[0] : null;
    return {
      ok: false,
      status: response.status,
      reason: firstError?.message || payload?.error?.message || 'youtube_channel_uploads_failed',
      error_reason: firstError?.reason || '',
      channel_id: details.channel_id,
      uploads_playlist_id: details.uploads_playlist_id,
      posts: [],
    };
  }
  const rows = Array.isArray(payload.items) ? payload.items : [];
  const inWindowRows = rows.filter((row) => youtubePublishedInWindow(
    row,
    job.published_after || YOUTUBE_SOURCE_POST_WINDOW_START,
    job.published_before || ''
  ));
  const normalizedJob = {
    ...job,
    channel_id: details.channel_id,
    source_name: details.channel_title || job.source_name,
  };
  const enriched = await enrichYouTubeApiItems(inWindowRows, normalizedJob, {
    apiKey,
    fetchImpl,
    commentLookupBudget,
    deadlineAt,
    minRemainingMs,
  });
  return {
    ok: true,
    result_count: rows.length,
    in_window_result_count: inWindowRows.length,
    posts: enriched.rows.map((row) => normalizeYouTubeApiPost(row, normalizedJob)).filter(Boolean),
    next_page_token: payload.nextPageToken || '',
    page_info: payload.pageInfo || {},
    channel_id: details.channel_id,
    channel_title: details.channel_title,
    uploads_playlist_id: details.uploads_playlist_id,
    hit_older_than_window: rows.length > 0 && inWindowRows.length < rows.length,
    video_details_fetched_count: enriched.video_details_fetched_count || 0,
    comment_threads_attempted_count: enriched.comment_threads_attempted_count || 0,
    comment_threads_fetched_count: enriched.comment_threads_fetched_count || 0,
    detail_reports: enriched.detail_reports || [],
    comment_reports: enriched.comment_reports || [],
    timed_out: enriched.timed_out === true,
  };
}

async function fetchYouTubePostsForJobs(jobs = [], options = {}) {
  const posts = [];
  const reports = [];
  let timedOut = false;
  let jobsAttemptedCount = 0;
  let jobsSkippedDueToTimeBudget = 0;
  const deadlineAt = Number(options.deadlineAt || 0) || 0;
  const minRemainingMs = Math.max(0, Number(options.minRemainingMs ?? SOCIAL_SWEEP_SOURCE_START_MIN_REMAINING_MS) || 0);
  const maxPages = cappedNumber(
    options.maxPagesPerSource || options.maxPages || DEFAULT_YOUTUBE_PAGES_PER_SOURCE,
    DEFAULT_YOUTUBE_PAGES_PER_SOURCE,
    1,
    options.backfillMode === true ? SOCIAL_SWEEP_BACKFILL_MAX_PAGES_PER_SOURCE : SOCIAL_SWEEP_FAST_MAX_PAGES_PER_SOURCE
  );
  const env = options.env || process.env;
  const commentLookupBudget = options.youtubeCommentLookupBudget || {
    remaining: cappedNumber(
      options.maxYouTubeCommentLookups
      ?? options.youtubeCommentLookupLimit
      ?? env.STAFF_YOUTUBE_COMMENT_LOOKUP_LIMIT,
      DEFAULT_YOUTUBE_COMMENT_LOOKUP_LIMIT,
      0,
      500
    ),
    perVideo: cappedNumber(
      options.youtubeCommentsPerVideo
      ?? env.STAFF_YOUTUBE_COMMENTS_PER_VIDEO,
      DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO,
      1,
      10
    ),
  };
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];
    if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
      timedOut = true;
      jobsSkippedDueToTimeBudget = jobs.length - jobIndex;
      reports.push({
        ...job,
        ok: false,
        skipped: true,
        reason: 'source_sweep_time_budget_exhausted',
        remaining_job_count: jobsSkippedDueToTimeBudget,
        result_count: 0,
        in_window_result_count: 0,
        normalized_post_count: 0,
        pages_fetched: 0,
        max_pages: maxPages,
        next_page_token: '',
      });
      break;
    }
    jobsAttemptedCount += 1;
    let pageToken = '';
    let totalResultCount = 0;
    let totalInWindowResultCount = 0;
    let normalizedPostCount = 0;
    let videoDetailsFetchedCount = 0;
    let commentThreadsAttemptedCount = 0;
    let commentThreadsFetchedCount = 0;
    let pagesFetched = 0;
    let lastReport = null;
    let channelDetails = null;
    let stopAfterCurrentJob = false;
    if (job.search_method === 'channel_uploads') {
      try {
        channelDetails = await fetchYouTubeChannelDetails(job, options);
      } catch (error) {
        const reason = sourceSweepErrorReason(error);
        lastReport = { ok: false, skipped: true, status: 0, reason, posts: [] };
        channelDetails = lastReport;
        stopAfterCurrentJob = /source_sweep/.test(reason);
        if (stopAfterCurrentJob) timedOut = true;
      }
      if (!channelDetails.ok) {
        reports.push({
          ...job,
          ok: lastReport?.ok || false,
          skipped: lastReport?.skipped || channelDetails.skipped,
          status: lastReport?.status || channelDetails.status,
          reason: lastReport?.reason || channelDetails.reason,
          error_reason: channelDetails.error_reason,
          result_count: 0,
          in_window_result_count: 0,
          normalized_post_count: 0,
          pages_fetched: 0,
          max_pages: maxPages,
          next_page_token: '',
        });
        if (stopAfterCurrentJob) break;
        continue;
      }
    }
    for (let page = 0; page < maxPages; page += 1) {
      if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
        lastReport = {
          ok: false,
          skipped: true,
          reason: 'source_sweep_time_budget_exhausted',
          posts: [],
        };
        timedOut = true;
        stopAfterCurrentJob = true;
        break;
      }
      let report;
      try {
        report = job.search_method === 'channel_uploads'
          ? await fetchYouTubeChannelUploadsJob(job, {
            ...options,
            pageToken,
            channelDetails,
            commentLookupBudget,
            deadlineAt,
            minRemainingMs,
          })
          : await fetchYouTubeSearchJob(job, {
            ...options,
            pageToken,
            commentLookupBudget,
            deadlineAt,
            minRemainingMs,
          });
      } catch (error) {
        const reason = sourceSweepErrorReason(error);
        report = {
          ok: false,
          skipped: true,
          status: 0,
          reason,
          posts: [],
        };
        stopAfterCurrentJob = /source_sweep/.test(reason);
        if (stopAfterCurrentJob) timedOut = true;
      }
      if (report?.timed_out || /source_sweep/.test(report?.reason || '')) {
        stopAfterCurrentJob = true;
        timedOut = true;
      }
      lastReport = report;
      pagesFetched += 1;
      totalResultCount += report.result_count || 0;
      totalInWindowResultCount += report.in_window_result_count == null ? (report.result_count || 0) : report.in_window_result_count;
      normalizedPostCount += Array.isArray(report.posts) ? report.posts.length : 0;
      videoDetailsFetchedCount += report.video_details_fetched_count || 0;
      commentThreadsAttemptedCount += report.comment_threads_attempted_count || 0;
      commentThreadsFetchedCount += report.comment_threads_fetched_count || 0;
      posts.push(...(report.posts || []));
      pageToken = report.next_page_token || '';
      if (stopAfterCurrentJob) break;
      if (!report.ok || !pageToken) break;
      if (job.search_method === 'channel_uploads' && report.hit_older_than_window) break;
    }
    reports.push({
      ...job,
      ok: lastReport?.ok,
      skipped: lastReport?.skipped,
      status: lastReport?.status,
      reason: lastReport?.reason,
      error_reason: lastReport?.error_reason,
      result_count: totalResultCount,
      in_window_result_count: totalInWindowResultCount,
      normalized_post_count: normalizedPostCount,
      video_details_fetched_count: videoDetailsFetchedCount,
      comment_threads_attempted_count: commentThreadsAttemptedCount,
      comment_threads_fetched_count: commentThreadsFetchedCount,
      pages_fetched: pagesFetched,
      max_pages: maxPages,
      next_page_token: pageToken,
      channel_id: lastReport?.channel_id || channelDetails?.channel_id || job.channel_id || '',
      channel_title: lastReport?.channel_title || channelDetails?.channel_title || '',
      uploads_playlist_id: lastReport?.uploads_playlist_id || channelDetails?.uploads_playlist_id || '',
    });
    if (stopAfterCurrentJob) {
      jobsSkippedDueToTimeBudget += Math.max(0, jobs.length - jobIndex - 1);
      break;
    }
  }
  return { posts, reports, timed_out: timedOut, jobs_attempted_count: jobsAttemptedCount, jobs_skipped_due_to_time_budget: jobsSkippedDueToTimeBudget };
}

function youtubeSearchQuotaExceededFromReports(reports = []) {
  return (Array.isArray(reports) ? reports : []).some((report) => {
    if (report.search_method && report.search_method !== 'search') return false;
    const status = Number(report.status || 0);
    const text = cleanText(`${report.reason || ''} ${report.error_reason || ''}`).toLowerCase();
    return status === 429 && /quota|search queries|daily limit|rate limit/.test(text);
  });
}

function normalizeXSearchQuery(query = '') {
  const cleaned = cleanText(query)
    .replace(/\s+-is:retweet\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? `${cleaned} -is:retweet` : '-is:retweet';
}

function metadataQueryFromSource(source = {}) {
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  return cleanText(metadata.query || metadata.x_query || source.query);
}

function orGroup(values = []) {
  const terms = [...new Set(values.map(cleanText).filter(Boolean))];
  if (!terms.length) return '';
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

function buildXQueryForSource(source = {}) {
  const metadataQuery = metadataQueryFromSource(source);
  if (metadataQuery) return normalizeXSearchQuery(metadataQuery);

  const url = sourceUrl(source);
  const existingQuery = urlParam(url, 'q');
  if (existingQuery) {
    return normalizeXSearchQuery(existingQuery);
  }
  const handle = sourceHandle(source);
  if (handle) {
    return normalizeXSearchQuery(`from:${handle}`);
  }
  const tags = Array.isArray(source.hashtags) ? source.hashtags.filter(Boolean).slice(0, 4).map((tag) => `#${String(tag).replace(/^#/, '')}`) : [];
  const sourceWords = cleanText(sourceName(source)).split(/\s+/).filter((word) => word.length > 3).slice(0, 4);
  const districts = sourceListValues(source, 'districts', 'districts').slice(0, 3);
  const listingTypes = sourceListValues(source, 'listingTypes', 'listing_types')
    .slice(0, 3)
    .map((type) => {
      if (/student/i.test(type)) return '"student accommodation"';
      if (/commercial/i.test(type)) return '"commercial property"';
      if (/land/i.test(type)) return '"land for sale"';
      if (/rent/i.test(type)) return '"for rent"';
      return '"for sale"';
    });
  const discoveryTerms = orGroup([...tags, ...sourceWords, ...listingTypes]) || orGroup(['Uganda property']);
  const locationTerms = orGroup(districts.length ? [...districts, 'Uganda'] : ['Uganda', 'Kampala', 'Wakiso']);
  return normalizeXSearchQuery(`${locationTerms} ${discoveryTerms}`);
}

function buildXSearchJobs({ sources = sourcesForPlatform('x'), limit = DEFAULT_MAX_SOURCES, searchMode = 'all', startTime = '' } = {}) {
  const endpoint = searchMode === 'recent' ? X_RECENT_SEARCH_URL : X_FULL_ARCHIVE_SEARCH_URL;
  const archiveStartTime = cleanText(startTime) || LAUNCH_SOURCE_POST_WINDOW_START;
  return sources
    .filter((source) => normalizePlatform(source.platform) === 'x')
    .slice(0, cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES))
    .map((source) => ({
      platform: 'x',
      source_key: sourceKey(source),
      source_name: sourceName(source),
      source_type: source.source_type || source.sourceType || '',
      source_record_kind: isDiscoveryFeed(source) ? 'discovery_feed' : 'source_page',
      source_registry_offset: Number.isFinite(Number(source.source_registry_offset)) ? Number(source.source_registry_offset) : null,
      source_window_index: Number.isFinite(Number(source.source_window_index)) ? Number(source.source_window_index) : null,
      source_url: sourceUrl(source),
      query: buildXQueryForSource(source).slice(0, searchMode === 'recent' ? 1024 : 4096),
      endpoint,
      start_time: searchMode === 'recent' ? null : archiveStartTime,
      max_results: DEFAULT_X_RESULTS_PER_SOURCE,
    }));
}

function extractArea(text = '') {
  const resolution = resolveCanonicalUgandaLocationFromText(cleanText(text));
  return resolution.status === 'matched' ? resolution.match.name : '';
}

function districtForArea(area = '', text = '') {
  const explicit = resolveCanonicalUgandaLocation(cleanText(area));
  if (explicit.status === 'matched') return explicit.match.district;
  const resolution = resolveCanonicalUgandaLocationFromText(cleanText(`${area} ${text}`));
  return resolution.status === 'matched' ? resolution.match.district : '';
}

function canonicalSocialLocation(rawArea = '', suppliedDistrict = '', sourceText = '') {
  const explicit = resolveCanonicalUgandaLocation(rawArea, suppliedDistrict);
  if (explicit.status === 'matched' && !['district', 'region'].includes(explicit.match.level)) {
    return explicit;
  }
  const fromText = resolveCanonicalUgandaLocationFromText(`${rawArea} ${sourceText}`, suppliedDistrict);
  if (fromText.status === 'matched') return fromText;
  return explicit.status === 'matched' ? explicit : fromText;
}

function listingTypeFromText(text = '') {
  const raw = cleanText(text).toLowerCase();
  const hasDwelling = /\b(apartment|flat|house|home|villa|mansion|duplex|bungalow|bedroom|bedrooms|beds?|living room|sitting room|muzigo|mizigo|rental room)\b/.test(raw);
  if (/\b(hostel|student|campus|makerere|kyambogo|mubs|ucu|university|campus room)\b/.test(raw)) return 'students';
  if (/\b(commercial|office|shop|retail|warehouse|factory|showroom|arcade|duuka|madduuka|store)\b/.test(raw)) return 'commercial';
  if (/\b(rent|rental|to let|month|monthly|kupangisa|renti|for rent|ku rentinga|muzigo|mizigo)\b/.test(raw)) return 'rent';
  if (/\b(land|plot|acre|acres|decimal|decimals|mailo|ettaka|kibanja|bibanja|akabanja|plots?)\b/.test(raw) && !hasDwelling) return 'land';
  if (hasDwelling && /\b(for sale|sale|selling|buy|purchase|kitundibwa|kutunda|gula|okugula)\b/.test(raw)) return 'sale';
  return 'sale';
}

function priceTextFromText(text = '') {
  const raw = maskPhonesForPriceExtraction(cleanText(text));
  const localPriceMatch = raw.match(/\b(?:bei|omuwendo|price|ugx|ush|shs?)?\s*\d+(?:\.\d+)?\s*(?:obukadde|akakadde|bukadde|emitwalo|mitwalo|laki|lakhs?)\b(?:\s*(?:negotiable|asking|only|za mwezi|per month|monthly))?/i);
  if (localPriceMatch) return cleanText(localPriceMatch[0]);
  const negotiableMatch = raw.match(/\b(?:UGX|USh|Shs?)?\s*\d[\d,.]*(?:\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands))\s*(?:negotiable|asking|only)\b/i);
  if (negotiableMatch) return cleanText(negotiableMatch[0]);
  const gluedLocalMatch = raw.match(/\b\d+(?:\.\d+)?\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands)(?:UGX|USh|Shs?)\b(?:\/month| per month| monthly)?/i);
  if (gluedLocalMatch) return cleanText(gluedLocalMatch[0]);
  const usdMatch = raw.match(/(?:\$|US\$|USD)\s*\d[\d,.]*(?:\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands))?(?:\/month| per month| monthly|\/mo)?/i);
  if (usdMatch) return cleanText(usdMatch[0]);
  const contextualPlainAmount = raw.match(/\b(?:price|asking(?:\s+price)?|guide\s+price|at|only|going\s+for|selling\s+at|rent(?:ed)?\s+at)\s*(?:is|of|:|-)?\s*(?:UGX|USh|Shs?)?\s*(?:\d{1,3}(?:,\d{3})+|\d{5,})(?:\/month| per month| monthly)?/i);
  if (contextualPlainAmount) return cleanText(contextualPlainAmount[0]);
  const patterns = [
    /\b(?:UGX|USh|Shs?)\s*\d[\d,.]*(?:\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands))?(?:\/month| per month| monthly| kwa mwezi| za mwezi)?/i,
    /\b\d+(?:\.\d+)?\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands)\b(?:\/month| per month| monthly)?/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[0];
  }
  return '';
}

function normalizeUgandanPhone(value = '') {
  return normalizeUgandanSourcePhone(value);
}

function phoneFromText(text = '') {
  return ugandanPhoneFromSourceText(text);
}

function emailFromText(text = '') {
  const match = cleanText(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function bedroomsFromText(text = '') {
  const match = cleanText(text).match(/\b(\d{1,2})\s*(?:-|–|—)?\s*(?:bed|bedroom|bdrm|br)\b/i);
  return match ? Number(match[1]) : null;
}

function xPostUrl(username = '', id = '') {
  return username && id ? `https://x.com/${username}/status/${id}` : '';
}

function mediaUrlsFromIncludes(tweet = {}, includes = {}) {
  const keys = tweet.attachments?.media_keys || [];
  if (!Array.isArray(keys) || !keys.length) return [];
  const media = Array.isArray(includes.media) ? includes.media : [];
  return keys
    .map((key) => media.find((item) => item.media_key === key))
    .filter(Boolean)
    .map((item) => item.url || item.preview_image_url)
    .filter(Boolean);
}

function normalizeXApiPost(tweet = {}, includes = {}, job = {}) {
  const users = Array.isArray(includes.users) ? includes.users : [];
  const author = users.find((user) => String(user.id) === String(tweet.author_id)) || {};
  const username = cleanText(author.username || job.source_name || '').replace(/^@/, '');
  const text = cleanText(tweet.text || '');
  const source_url = xPostUrl(username, tweet.id);
  const area = extractArea(text);
  const district = districtForArea(area, text);
  const priceText = priceTextFromText(text);
  return {
    post_id: tweet.id,
    source_key: job.source_key || username || tweet.author_id,
    source_name: cleanText(author.name || username || job.source_name || 'X property source'),
    platform: 'x',
    source_verified: true,
    source_verification_status: 'official_api_verified',
    source_url,
    post_url: source_url,
    source_page_url: username ? `https://x.com/${username}` : job.source_url,
    source_contact_url: username ? `https://x.com/${username}` : job.source_url,
    x_url: source_url,
    title: text.slice(0, 90) || `X property post ${tweet.id}`,
    caption: text,
    description: text,
    first_posted_at: tweet.created_at || null,
    created_at: tweet.created_at || null,
    area,
    district,
    location: area || district,
    price_text: priceText,
    listing_type: listingTypeFromText(text),
    bedrooms: bedroomsFromText(text),
    image_urls: mediaUrlsFromIncludes(tweet, includes),
    source_batch: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    source_registry_key: job.source_key,
    source_urls: [job.source_url, source_url].filter(Boolean),
    audience_label: author.public_metrics?.followers_count != null
      ? `${author.public_metrics.followers_count.toLocaleString('en-UG')} X followers at import`
      : '',
    raw_source_post: {
      tweet,
      source_job: job,
    },
  };
}

function xPostIdFromUrl(url = '') {
  return cleanText(url).match(/\/status\/(\d+)/i)?.[1] || '';
}

async function fetchXPostMetadata(url = '', {
  bearerToken = '',
  fetchImpl = fetch,
} = {}) {
  const postId = xPostIdFromUrl(normalizeXPostUrl(url));
  if (!postId) return { ok: false, skipped: true, reason: 'missing_exact_x_post_url' };
  const token = cleanText(bearerToken) || envBearerToken().token;
  if (!token) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_x_bearer_token',
      required_any_of: X_BEARER_ENV_NAMES,
    };
  }
  const endpoint = new URL(X_TWEET_LOOKUP_URL);
  endpoint.searchParams.set('ids', postId);
  endpoint.searchParams.set('tweet.fields', 'author_id,created_at,attachments,entities,geo,lang,public_metrics');
  endpoint.searchParams.set('expansions', 'author_id,attachments.media_keys,geo.place_id');
  endpoint.searchParams.set('user.fields', 'username,name,url,description,public_metrics,verified');
  endpoint.searchParams.set('media.fields', 'media_key,type,url,preview_image_url,width,height');
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: payload?.title || payload?.detail || payload?.error || 'x_post_lookup_failed',
      errors: payload?.errors || [],
    };
  }
  const tweet = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!tweet?.id) {
    return { ok: false, status: 404, reason: 'x_post_not_returned', errors: payload?.errors || [] };
  }
  const originalHandle = cleanText(url).match(/(?:x|twitter)\.com\/([^/]+)\/status/i)?.[1] || '';
  return {
    ok: true,
    payload: normalizeXApiPost(tweet, payload.includes || {}, {
      platform: 'x',
      source_name: originalHandle,
      source_url: originalHandle ? `https://x.com/${originalHandle}` : '',
    }),
  };
}

async function fetchXSearchJob(job = {}, {
  bearerToken = '',
  maxResults = DEFAULT_X_RESULTS_PER_SOURCE,
  searchMode = 'all',
  fetchImpl = fetch,
} = {}) {
  if (!bearerToken) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_x_bearer_token',
      posts: [],
    };
  }
  const endpoint = searchMode === 'recent' ? X_RECENT_SEARCH_URL : X_FULL_ARCHIVE_SEARCH_URL;
  const url = new URL(endpoint);
  url.searchParams.set('query', job.query);
  url.searchParams.set('max_results', String(cappedNumber(maxResults, DEFAULT_X_RESULTS_PER_SOURCE, 10, 500)));
  url.searchParams.set('tweet.fields', 'author_id,created_at,attachments,entities,geo,lang,public_metrics');
  url.searchParams.set('expansions', 'author_id,attachments.media_keys,geo.place_id');
  url.searchParams.set('user.fields', 'username,name,url,description,public_metrics,verified');
  url.searchParams.set('media.fields', 'media_key,type,url,preview_image_url,width,height');
  if (searchMode === 'recent' && job.since_id) url.searchParams.set('since_id', String(job.since_id));
  if (searchMode !== 'recent') url.searchParams.set('start_time', job.start_time || LAUNCH_SOURCE_POST_WINDOW_START);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: payload?.title || payload?.detail || payload?.error || 'x_api_search_failed',
      errors: payload?.errors || [],
      posts: [],
    };
  }
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return {
    ok: true,
    result_count: rows.length,
    posts: rows.map((tweet) => normalizeXApiPost(tweet, payload.includes || {}, job)).filter((post) => post.source_url),
    meta: payload.meta || {},
  };
}

async function fetchXPostsForJobs(jobs = [], options = {}) {
  const posts = [];
  const reports = [];
  let timedOut = false;
  let jobsAttemptedCount = 0;
  let jobsSkippedDueToTimeBudget = 0;
  const deadlineAt = Number(options.deadlineAt || 0) || 0;
  const minRemainingMs = Math.max(0, Number(options.minRemainingMs ?? SOCIAL_SWEEP_SOURCE_START_MIN_REMAINING_MS) || 0);
  const searchMode = String(options.searchMode || 'all').trim().toLowerCase() === 'recent' ? 'recent' : 'all';
  const fullArchivePacingMs = searchMode === 'recent'
    ? 0
    : Math.max(0, Number(options.fullArchivePacingMs ?? X_FULL_ARCHIVE_SEARCH_PACING_MS) || 0);
  let previousFullArchiveStartedAt = 0;
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];
    if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
      timedOut = true;
      jobsSkippedDueToTimeBudget = jobs.length - jobIndex;
      reports.push({
        ...job,
        ok: false,
        skipped: true,
        reason: 'source_sweep_time_budget_exhausted',
        remaining_job_count: jobsSkippedDueToTimeBudget,
        result_count: 0,
        error_count: 0,
      });
      break;
    }
    if (fullArchivePacingMs > 0 && previousFullArchiveStartedAt > 0) {
      const waitMs = fullArchivePacingMs - (Date.now() - previousFullArchiveStartedAt);
      if (waitMs > 0) await delay(waitMs);
      if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
        timedOut = true;
        jobsSkippedDueToTimeBudget = jobs.length - jobIndex;
        reports.push({
          ...job,
          ok: false,
          skipped: true,
          reason: 'source_sweep_time_budget_exhausted_after_x_full_archive_pacing',
          remaining_job_count: jobsSkippedDueToTimeBudget,
          result_count: 0,
          error_count: 0,
        });
        break;
      }
    }
    jobsAttemptedCount += 1;
    if (fullArchivePacingMs > 0) previousFullArchiveStartedAt = Date.now();
    let report;
    try {
      report = await fetchXSearchJob(job, options);
    } catch (error) {
      const reason = sourceSweepErrorReason(error);
      report = {
        ok: false,
        skipped: true,
        status: 0,
        reason,
        posts: [],
        errors: [],
      };
      if (/source_sweep/.test(reason)) {
        timedOut = true;
        jobsSkippedDueToTimeBudget = jobs.length - jobIndex - 1;
      }
    }
    reports.push({
      ...job,
      ok: report.ok,
      skipped: report.skipped,
      status: report.status,
      reason: report.reason,
      result_count: report.result_count || 0,
      since_id: job.since_id || '',
      newest_id: report.meta?.newest_id || '',
      error_count: Array.isArray(report.errors) ? report.errors.length : 0,
    });
    posts.push(...(report.posts || []));
    if (timedOut) break;
  }
  return { posts, reports, timed_out: timedOut, jobs_attempted_count: jobsAttemptedCount, jobs_skipped_due_to_time_budget: jobsSkippedDueToTimeBudget };
}

function xHashtagTerms(posts = []) {
  return [...new Set((Array.isArray(posts) ? posts : []).flatMap((post) => {
    const text = cleanText(post.caption || post.description || post.title);
    return [...text.matchAll(/#([a-z0-9_]{2,50})/gi)].map((match) => match[1].toLowerCase());
  }))].slice(0, 100);
}

async function fetchXAuthorExpansion(seedPosts = [], {
  bearerToken = '',
  fetchImpl = fetch,
  authorLimit = DEFAULT_X_AUTHOR_EXPANSION_LIMIT,
  maxResults = 10,
  deadlineAt = 0,
} = {}) {
  const seeds = [...new Map((Array.isArray(seedPosts) ? seedPosts : [])
    .map((post) => [cleanText(post.raw_source_post?.tweet?.author_id), post])
    .filter(([authorId]) => authorId)).entries()]
    .slice(0, cappedNumber(authorLimit, DEFAULT_X_AUTHOR_EXPANSION_LIMIT, 0, 10));
  const posts = [];
  const reports = [];
  for (const [authorId, seedPost] of seeds) {
    if (sweepDeadlineReached(deadlineAt, SOCIAL_SWEEP_SOURCE_START_MIN_REMAINING_MS)) {
      reports.push({ author_id: authorId, ok: false, skipped: true, reason: 'source_sweep_time_budget_exhausted' });
      break;
    }
    const endpoint = new URL(`${X_USER_TIMELINE_URL_BASE}/${encodeURIComponent(authorId)}/tweets`);
    endpoint.searchParams.set('max_results', String(cappedNumber(maxResults, 10, 5, 100)));
    endpoint.searchParams.set('exclude', 'retweets,replies');
    endpoint.searchParams.set('tweet.fields', 'author_id,created_at,attachments,entities,geo,lang,public_metrics');
    endpoint.searchParams.set('expansions', 'author_id,attachments.media_keys,geo.place_id');
    endpoint.searchParams.set('user.fields', 'username,name,url,description,public_metrics,verified');
    endpoint.searchParams.set('media.fields', 'media_key,type,url,preview_image_url,width,height');
    try {
      const response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${bearerToken}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        reports.push({
          author_id: authorId,
          ok: false,
          status: response.status,
          reason: payload?.title || payload?.detail || payload?.error || 'x_author_timeline_failed',
        });
        continue;
      }
      const rows = Array.isArray(payload.data) ? payload.data : [];
      const authorPosts = rows
        .map((tweet) => normalizeXApiPost(tweet, payload.includes || {}, {
          platform: 'x',
          source_key: `x-author-${authorId}`,
          source_name: seedPost.source_name,
          source_url: seedPost.source_page_url || seedPost.source_urls?.[0] || '',
        }))
        .filter((post) => post.source_url);
      posts.push(...authorPosts);
      reports.push({
        author_id: authorId,
        ok: true,
        result_count: authorPosts.length,
        display_name: seedPost.source_name || '',
        profile_url: seedPost.source_page_url || seedPost.source_urls?.[0] || '',
      });
    } catch (error) {
      reports.push({ author_id: authorId, ok: false, reason: sourceSweepErrorReason(error) });
    }
  }
  return { posts: uniquePosts(posts), reports, hashtag_terms: xHashtagTerms(posts) };
}

function uniquePosts(posts = []) {
  const seen = new Set();
  return posts.filter((post) => {
    const key = cleanText(post.source_url || post.post_url || post.post_id || post.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function youtubeConfidenceReviewFromPost(post = {}) {
  return post.raw_source_post?.youtube_confidence_review || post.rawSourcePost?.youtube_confidence_review || null;
}

function summarizeYouTubeConfidence(posts = []) {
  return posts.reduce((summary, post) => {
    const review = youtubeConfidenceReviewFromPost(post) || {};
    const status = review.status || 'youtube_review_required';
    summary.total += 1;
    summary.by_status[status] = (summary.by_status[status] || 0) + 1;
    if (review.live_ready === true) summary.live_ready_count += 1;
    if (review.auto_live_ready === true || review.status === 'youtube_hashtag_auto_live_ready' || review.status === 'youtube_api_auto_live_ready') summary.auto_live_ready_count += 1;
    if (review.phone_status === 'direct_phone_present') summary.direct_phone_count += 1;
    if (review.phone_status === 'source_contact_only_needs_review' || review.phone_status === 'source_contact_only_ok') summary.source_contact_only_count += 1;
    if (review.location_status === 'area_or_neighbourhood_detected') summary.area_level_location_count += 1;
    if (review.location_status && review.location_status !== 'area_or_neighbourhood_detected') {
      summary.location_review_count += 1;
    }
    const category = cleanText(post.listing_type || review.category_status || 'uncategorized');
    summary.by_listing_type[category] = (summary.by_listing_type[category] || 0) + 1;
    return summary;
  }, {
    total: 0,
    live_ready_count: 0,
    auto_live_ready_count: 0,
    direct_phone_count: 0,
    source_contact_only_count: 0,
    area_level_location_count: 0,
    location_review_count: 0,
    by_listing_type: {},
    by_status: {},
  });
}

function youtubeSourceUrlFromPropertyExtra(extra = {}) {
  return cleanText(
    extra.source_url
    || extra.source_post_url
    || extra.youtube_url
    || extra.video_url
    || extra.original_url
    || ''
  );
}

function youtubePendingRowVideoId(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return normalizeYouTubeVideoId(
    extra.youtube_video_id
    || extra.youtube_id
    || youtubeSourceUrlFromPropertyExtra(extra)
    || ''
  );
}

function firstCleanText(values = []) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function youtubeApiItemFromPendingPropertyRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const sourceUrl = youtubeSourceUrlFromPropertyExtra(extra);
  const videoId = youtubePendingRowVideoId(row);
  if (!videoId) return null;
  const description = cleanText([
    extra.source_description,
    extra.source_caption,
    extra.source_text,
    extra.source_visual_text,
    row.description,
  ].filter(Boolean).join(' '));
  return {
    id: { videoId },
    snippet: {
      publishedAt: firstCleanText([
        extra.youtube_source_published_at,
        extra.youtube_published_at,
        extra.source_published_at,
        extra.first_posted_online_at,
        extra.video_published_at,
        row.created_at,
      ]),
      title: firstCleanText([
        extra.source_title,
        extra.youtube_source_title,
        row.title,
      ]) || `YouTube property video ${videoId}`,
      description,
      channelId: firstCleanText([
        extra.youtube_channel_id,
        extra.source_channel_id,
      ]),
      channelTitle: firstCleanText([
        extra.source_name,
        extra.source_agent_name,
        row.lister_name,
      ]) || 'YouTube property source',
      thumbnails: {},
    },
    comments: extra.source_comments || '',
    source_visual_text: extra.source_visual_text || extra.video_ocr_text || extra.frame_ocr_text || '',
    youtube_top_comments: extra.youtube_top_comments || '',
    pending_property_id: row.id,
    pending_source_url: sourceUrl,
    pending_extra_fields: extra,
  };
}

function youtubeSourceJobFromPendingPropertyRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const sourceUrl = youtubeSourceUrlFromPropertyExtra(extra);
  const videoId = youtubePendingRowVideoId(row);
  const channelUrl = firstCleanText([
    extra.youtube_channel_url,
    extra.source_channel_url,
    extra.source_contact_url,
    extra.source_page_url,
  ]);
  return {
    platform: 'youtube',
    source_key: firstCleanText([
      extra.source_registry_key,
      extra.source_listing_key,
      extra.source_name,
      videoId,
      row.id,
    ]) || `youtube-pending-${row.id}`,
    source_name: firstCleanText([
      extra.source_name,
      extra.source_agent_name,
      row.lister_name,
    ]) || 'YouTube property source',
    source_type: 'youtube_hashtag_pending_backlog_reprocess',
    source_record_kind: 'youtube_hashtag_pending_backlog_reprocess',
    source_url: channelUrl || sourceUrl || (videoId ? youtubeWatchUrl(videoId) : ''),
    source_contact_url: channelUrl || sourceUrl || (videoId ? youtubeWatchUrl(videoId) : ''),
    source_listing_types: [row.listing_type, extra.source_listing_type, extra.listing_type].filter(Boolean),
    published_after: LAUNCH_SOURCE_POST_WINDOW_START,
    source_can_contact_directly: true,
    youtube_hashtag_source: true,
  };
}

async function pendingYouTubeSourceRowsForEnrichment(db, {
  limit = DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT,
  offset = 0,
  queryClient = null,
} = {}) {
  if (!db?.pool) {
    return {
      ok: false,
      reason: 'db_pool_required',
      rows: [],
    };
  }
  const cappedLimit = cappedNumber(limit, DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT, 1, 500);
  const cappedStart = cappedOffset(offset);
  const runner = queryClient || db.pool;
  const result = await runner.query(
    `SELECT
       id::text AS id,
       title,
       description,
       listing_type,
       status,
       moderation_stage,
       district,
       area,
       address,
       price,
       price_period,
       bedrooms,
       bathrooms,
       latitude,
       longitude,
       lister_name,
       created_at,
       updated_at,
       extra_fields
     FROM properties
     WHERE COALESCE(status, 'pending') NOT IN ('approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'archived')
       AND (
         LOWER(COALESCE(extra_fields->>'source_platform', '')) = 'youtube'
         OR COALESCE(extra_fields->>'source_url', '') ~* '(youtube\\.com|youtu\\.be)'
         OR COALESCE(extra_fields->>'source_post_url', '') ~* '(youtube\\.com|youtu\\.be)'
         OR COALESCE(extra_fields->>'youtube_url', '') ~* '(youtube\\.com|youtu\\.be)'
         OR COALESCE(extra_fields->>'video_url', '') ~* '(youtube\\.com|youtu\\.be)'
       )
       AND COALESCE(extra_fields->>'youtube_source_text_enrichment_version', '') <> $1
     ORDER BY created_at DESC NULLS LAST, id DESC
     LIMIT $2 OFFSET $3`,
    [YOUTUBE_SOURCE_TEXT_ENRICHMENT_VERSION, cappedLimit, cappedStart]
  );
  return {
    ok: true,
    limit: cappedLimit,
    offset: cappedStart,
    rows: result.rows || [],
  };
}

async function enrichPendingYouTubeSourceRows({
  db,
  apiKey = '',
  env = process.env,
  fetchImpl = fetch,
  dryRun = false,
  limit = DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT,
  offset = 0,
  commentLookupBudget = null,
  deadlineAt = 0,
  minRemainingMs = SOCIAL_SWEEP_MIN_REMAINING_MS,
} = {}) {
  if (!db?.pool) {
    return {
      ok: false,
      skipped: true,
      reason: 'db_pool_required',
      rows_considered: 0,
      video_details_fetched_count: 0,
      comment_threads_attempted_count: 0,
      comment_threads_fetched_count: 0,
      reprocess_result: null,
    };
  }
  if (!apiKey) {
    return {
      ok: true,
      skipped: true,
      reason: 'youtube_api_key_required',
      rows_considered: 0,
      video_details_fetched_count: 0,
      comment_threads_attempted_count: 0,
      comment_threads_fetched_count: 0,
      reprocess_result: null,
    };
  }
  const lockClient = await db.pool.connect();
  let lockAcquired = false;
  try {
    const lock = await lockClient.query(
      'SELECT pg_try_advisory_lock($1)::boolean AS locked',
      [YOUTUBE_PENDING_REPROCESS_ADVISORY_LOCK_ID]
    );
    lockAcquired = lock.rows[0]?.locked === true;
    if (!lockAcquired) {
      return {
        ok: true,
        skipped: true,
        reason: 'pending_youtube_backlog_reprocess_already_running',
        lock_id: YOUTUBE_PENDING_REPROCESS_ADVISORY_LOCK_ID,
        rows_considered: 0,
        video_details_fetched_count: 0,
        comment_threads_attempted_count: 0,
        comment_threads_fetched_count: 0,
        reprocess_result: null,
      };
    }
    const pending = await pendingYouTubeSourceRowsForEnrichment(db, { limit, offset, queryClient: lockClient });
    if (!pending.ok) {
      return {
        ok: pending.ok,
        skipped: true,
        reason: pending.reason || 'pending_youtube_rows_unavailable',
        rows_considered: 0,
        video_details_fetched_count: 0,
        comment_threads_attempted_count: 0,
        comment_threads_fetched_count: 0,
        reprocess_result: null,
      };
    }
  if (sweepDeadlineReached(deadlineAt, minRemainingMs)) {
    return {
      ok: true,
      skipped: true,
      reason: 'source_sweep_time_budget_exhausted',
      rows_considered: 0,
      video_details_fetched_count: 0,
      comment_threads_attempted_count: 0,
      comment_threads_fetched_count: 0,
      partial_results: true,
      timed_out: true,
      reprocess_result: null,
    };
  }
  const rows = pending.rows || [];
  const pendingApiRows = rows
    .map((row) => ({
      row,
      item: youtubeApiItemFromPendingPropertyRow(row),
      job: youtubeSourceJobFromPendingPropertyRow(row),
    }))
    .filter((entry) => entry.item);
  const sharedCommentLookupBudget = commentLookupBudget || {
    remaining: cappedNumber(
      env.STAFF_YOUTUBE_COMMENT_LOOKUP_LIMIT,
      DEFAULT_YOUTUBE_COMMENT_LOOKUP_LIMIT,
      0,
      500
    ),
    perVideo: cappedNumber(
      env.STAFF_YOUTUBE_COMMENTS_PER_VIDEO,
      DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO,
      1,
      10
    ),
  };
  const genericPendingJob = {
    platform: 'youtube',
    source_type: 'youtube_hashtag_pending_backlog_reprocess',
    source_record_kind: 'youtube_hashtag_pending_backlog_reprocess',
    source_name: 'YouTube hashtag pending backlog reprocess',
    source_url: 'https://www.youtube.com/hashtag/ugandaproperty',
    source_listing_types: ['sale', 'rent', 'land', 'students', 'commercial'],
    published_after: LAUNCH_SOURCE_POST_WINDOW_START,
    source_can_contact_directly: true,
    youtube_hashtag_source: true,
  };
  const enriched = pendingApiRows.length
    ? await enrichYouTubeApiItems(pendingApiRows.map((entry) => entry.item), genericPendingJob, {
      apiKey,
      fetchImpl,
      commentLookupBudget: sharedCommentLookupBudget,
      deadlineAt,
      minRemainingMs,
    })
    : {
      rows: [],
      video_details_fetched_count: 0,
      comment_threads_attempted_count: 0,
      comment_threads_fetched_count: 0,
      detail_reports: [],
      comment_reports: [],
    };
  const enrichedByVideoId = new Map((enriched.rows || []).map((row) => [
    normalizeYouTubeVideoId(row.id?.videoId || row.contentDetails?.videoId || row.snippet?.resourceId?.videoId || row.id || ''),
    row,
  ]));
  const enrichedPosts = [];
  for (const entry of pendingApiRows) {
    const videoId = normalizeYouTubeVideoId(entry.item.id?.videoId || entry.item.id || '');
    const post = normalizeYouTubeApiPost(enrichedByVideoId.get(videoId) || entry.item, entry.job);
    if (post) {
      enrichedPosts.push({
        ...post,
        source_url: entry.item.pending_source_url || post.source_url,
        post_url: entry.item.pending_source_url || post.post_url || post.source_url,
        youtube_url: post.youtube_url || youtubeWatchUrl(post.youtube_video_id || post.post_id),
        source_batch: FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
        raw_source_post: {
          ...(post.raw_source_post || {}),
          pending_property_id: entry.row.id,
          pending_property_title: entry.row.title,
          youtube_source_text_enrichment_version: YOUTUBE_SOURCE_TEXT_ENRICHMENT_VERSION,
        },
      });
    }
  }
  const reprocessResult = enrichedPosts.length
    ? await reprocessExistingFoundOnlineSourcePostListings({
      db,
      posts: enrichedPosts,
      dryRun,
    })
    : {
      ok: true,
      dry_run: dryRun,
      received_posts: 0,
      normalized_posts: 0,
      matched_existing_properties: 0,
      updated_properties: 0,
      auto_live_properties: 0,
      review_queue_properties: 0,
      auto_live_listings: [],
      review_queue_listings: [],
      skipped_records: [],
    };
  return {
    ok: true,
    skipped: false,
    version: YOUTUBE_SOURCE_TEXT_ENRICHMENT_VERSION,
    rows_considered: rows.length,
    api_rows_prepared: pendingApiRows.length,
    enriched_posts_count: enrichedPosts.length,
    video_details_fetched_count: Number(enriched.video_details_fetched_count || 0),
    comment_threads_attempted_count: Number(enriched.comment_threads_attempted_count || 0),
    comment_threads_fetched_count: Number(enriched.comment_threads_fetched_count || 0),
    detail_reports: (enriched.detail_reports || []).slice(0, 50),
    comment_reports: (enriched.comment_reports || []).slice(0, 50),
    partial_results: enriched.timed_out === true,
    timed_out: enriched.timed_out === true,
    reprocess_result: reprocessResult,
  };
  } finally {
    if (lockAcquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [YOUTUBE_PENDING_REPROCESS_ADVISORY_LOCK_ID]);
      } catch (_) {}
    }
    lockClient.release();
  }
}

async function runSocialPlatformPostSweep({
  db,
  platform = 'all',
  focus = '',
  dryRun = true,
  maxSources = DEFAULT_MAX_SOURCES,
  sourceOffset = 0,
  maxResultsPerSource = DEFAULT_X_RESULTS_PER_SOURCE,
  maxPagesPerSource = DEFAULT_YOUTUBE_PAGES_PER_SOURCE,
  youtubeJobMode = 'all',
  searchMode = 'all',
  lookbackDays = 0,
  fetchX = true,
  fetchYouTube = true,
  useSavedCursors = true,
  backfillMode = false,
  youtubePublishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START,
  youtubePublishedBefore = '',
  xPublishedAfter = '',
  publishedAfter = '',
  env = process.env,
  fetchImpl = fetch,
  timeBudgetMs = null,
} = {}) {
  const sweepStartedAt = Date.now();
  const sweepBudget = sweepTimeBudgetMs(timeBudgetMs, env);
  const sweepDeadlineAt = sweepStartedAt + sweepBudget;
  const sweepFetchImpl = fetchWithSweepDeadline(fetchImpl, sweepDeadlineAt);
  let partialResults = false;
  const normalizedPlatform = normalizePlatform(platform || 'all');
  const normalizedFocus = cleanText(focus).toLowerCase();
  const southAfricaSweep = String(env.COUNTRY_CODE || process.env.COUNTRY_CODE || '').trim().toUpperCase() === 'ZA';
  const southAfricaTikTokCuratedOnly = /^(1|true|yes|on)$/i.test(String(env.ZA_TIKTOK_CURATED_INTAKE_ONLY || 'true'));
  const studentHousingFocus = normalizedFocus === 'students'
    || normalizedFocus === 'student'
    || normalizedFocus === 'student_housing'
    || normalizedPlatform === 'student'
    || normalizedPlatform === 'students'
    || normalizedPlatform === 'student_housing';
  const requestedPlatforms = requestedPlatformsForSweep({
    southAfricaSweep,
    normalizedPlatform,
    studentHousingFocus,
    southAfricaTikTokCuratedOnly,
  });
  const platformPolicyBlockReason = southAfricaSweep && !requestedPlatforms.length
    ? `${normalizedPlatform || 'unknown'} is not an automated South Africa source channel; use YouTube/X automation, exact-URL TikTok curation, or manual Facebook marketing.`
    : '';
  const sourceLimit = cappedNumber(maxSources, SOCIAL_SWEEP_FAST_DEFAULT_SOURCES, 1, SOCIAL_SWEEP_FAST_MAX_SOURCES);
  const resultLimit = cappedNumber(maxResultsPerSource, DEFAULT_X_RESULTS_PER_SOURCE, 1, SOCIAL_SWEEP_FAST_MAX_RESULTS_PER_SOURCE);
  const pageLimit = cappedNumber(
    maxPagesPerSource,
    DEFAULT_YOUTUBE_PAGES_PER_SOURCE,
    1,
    backfillMode ? SOCIAL_SWEEP_BACKFILL_MAX_PAGES_PER_SOURCE : SOCIAL_SWEEP_FAST_MAX_PAGES_PER_SOURCE
  );
  const importPostLimit = Math.min(SOCIAL_SWEEP_IMPORT_POST_LIMIT, Math.max(sourceLimit, sourceLimit * resultLimit));
  const normalizedSourceOffset = cappedOffset(sourceOffset);
  const tiktokSources = requestedPlatforms.includes('tiktok') ? sourcesForPlatform('tiktok') : [];
  const youtubeSources = requestedPlatforms.includes('youtube') ? sourcesForPlatform('youtube') : [];
  const xSources = requestedPlatforms.includes('x') ? sourcesForPlatform('x') : [];
  const facebookSources = requestedPlatforms.includes('facebook') ? sourcesForPlatform('facebook') : [];
  const instagramSources = requestedPlatforms.includes('instagram') ? sourcesForPlatform('instagram') : [];
  const tiktokSourceWindow = rotatingSourceWindow(tiktokSources, { limit: sourceLimit, offset: normalizedSourceOffset });
  const youtubeSourceWindow = rotatingSourceWindow(youtubeSources, { limit: sourceLimit, offset: normalizedSourceOffset });
  const xSourceWindow = rotatingSourceWindow(xSources, { limit: sourceLimit, offset: normalizedSourceOffset });
  const facebookSourceWindow = rotatingSourceWindow(facebookSources, { limit: sourceLimit, offset: normalizedSourceOffset });
  const instagramSourceWindow = rotatingSourceWindow(instagramSources, { limit: sourceLimit, offset: normalizedSourceOffset });
  const archiveStartTime = isoStartTimeForLookbackDays(lookbackDays);
  const youtubeStartTime = cleanText(publishedAfter || youtubePublishedAfter) || YOUTUBE_SOURCE_POST_WINDOW_START;
  const xStartTime = cleanText(xPublishedAfter || archiveStartTime) || LAUNCH_SOURCE_POST_WINDOW_START;
  const tiktokCaptureTasks = requestedPlatforms.includes('tiktok')
    ? buildTikTokCaptureTasks({ sources: tiktokSourceWindow.sources, limit: sourceLimit })
    : [];
  const normalizedYoutubeJobMode = normalizeYouTubeJobMode(youtubeJobMode);
  const unfilteredYoutubeSearchJobs = requestedPlatforms.includes('youtube')
    ? buildYouTubeSearchJobs({ sources: youtubeSources, limit: sourceLimit, offset: normalizedSourceOffset, publishedAfter: youtubeStartTime, publishedBefore: youtubePublishedBefore, maxPagesPerSource: pageLimit, jobMode: 'all' })
    : [];
  const primaryYoutubeSearchJobs = requestedPlatforms.includes('youtube')
    ? buildYouTubeSearchJobs({ sources: youtubeSources, limit: sourceLimit, offset: normalizedSourceOffset, publishedAfter: youtubeStartTime, publishedBefore: youtubePublishedBefore, maxPagesPerSource: pageLimit, jobMode: normalizedYoutubeJobMode })
    : [];
  const primaryYoutubeSourceKeys = new Set(primaryYoutubeSearchJobs.map((item) => item.source_key));
  const youtubeRegistryFillSearchJobs = requestedPlatforms.includes('youtube') && normalizedYoutubeJobMode === 'channel_uploads' && primaryYoutubeSearchJobs.length < sourceLimit
    ? buildYouTubeSearchJobs({
      sources: youtubeSources,
      limit: sourceLimit - primaryYoutubeSearchJobs.length,
      offset: normalizedSourceOffset,
      publishedAfter: youtubeStartTime,
      publishedBefore: youtubePublishedBefore,
      maxPagesPerSource: pageLimit,
      backfillMode,
      jobMode: 'search',
    }).filter((job) => !primaryYoutubeSourceKeys.has(job.source_key))
    : [];
  let youtubeSearchJobs = [...primaryYoutubeSearchJobs, ...youtubeRegistryFillSearchJobs];
  if (useSavedCursors && youtubeSearchJobs.length && db?.query) {
    try {
      const cursorRows = await db.query(
        `SELECT source_key, published_after
         FROM property_harvest_cursors
         WHERE platform = 'youtube' AND source_key = ANY($1::text[])`,
        [youtubeSearchJobs.map((job) => job.source_key)]
      );
      const publishedAfterBySource = new Map(cursorRows.rows.map((row) => [
        row.source_key,
        row.published_after ? new Date(row.published_after).toISOString() : '',
      ]));
      youtubeSearchJobs = youtubeSearchJobs.map((job) => ({
        ...job,
        published_after: publishedAfterBySource.get(job.source_key) || job.published_after,
      }));
    } catch (error) {
      if (error?.code !== '42P01') throw error;
    }
  }
  let xSearchJobs = requestedPlatforms.includes('x')
    ? buildXSearchJobs({ sources: xSourceWindow.sources, limit: sourceLimit, searchMode, startTime: xStartTime })
    : [];
  if (searchMode === 'recent' && xSearchJobs.length && db?.query) {
    try {
      const cursorRows = await db.query(
        `SELECT source_key, since_id
         FROM property_harvest_cursors
         WHERE platform = 'x' AND source_key = ANY($1::text[])`,
        [xSearchJobs.map((job) => job.source_key)]
      );
      const sinceIdBySource = new Map(cursorRows.rows.map((row) => [row.source_key, row.since_id]));
      xSearchJobs = xSearchJobs.map((job) => ({ ...job, since_id: sinceIdBySource.get(job.source_key) || '' }));
    } catch (error) {
      if (error?.code !== '42P01') throw error;
    }
  }
  const facebookCaptureTasks = requestedPlatforms.includes('facebook')
    ? buildManualSocialCaptureTasks({ sources: facebookSourceWindow.sources, platform: 'facebook', limit: sourceLimit })
    : [];
  const instagramCaptureTasks = requestedPlatforms.includes('instagram')
    ? buildManualSocialCaptureTasks({ sources: instagramSourceWindow.sources, platform: 'instagram', limit: sourceLimit })
    : [];
  const youtubeApi = envYouTubeApiKey(env);
  const apiReadiness = socialDiscoveryApiReadiness(env);
  const tiktokDataSourceLimit = Math.min(
    SOCIAL_SWEEP_TIKTOK_DATA_SOURCE_MAX_POSTS,
    Math.max(1, sourceLimit) * Math.max(1, resultLimit)
  );
  const tiktokDataSourceFetch = requestedPlatforms.includes('tiktok')
    ? await fetchTikTokDataSourcePosts({
      env,
      fetchImpl: sweepFetchImpl,
      limit: cappedNumber(env.STAFF_TIKTOK_DATA_SOURCE_LIMIT, tiktokDataSourceLimit, 1, SOCIAL_SWEEP_TIKTOK_DATA_SOURCE_MAX_POSTS),
      deadlineAt: sweepDeadlineAt,
      minRemainingMs: SOCIAL_SWEEP_SOURCE_START_MIN_REMAINING_MS,
    })
    : {
      api_configured: false,
      data_source_url_env: '',
      skipped_reason: 'tiktok_not_requested',
      posts: [],
      reports: [],
      oembed_fetch_count: 0,
    };
  if (
    tiktokDataSourceFetch.partial_results === true
    || tiktokDataSourceFetch.timed_out === true
    || /source_sweep/.test(tiktokDataSourceFetch.skipped_reason || '')
  ) partialResults = true;
  const youtubeCommentLookupBudget = {
    remaining: cappedNumber(
      env.STAFF_YOUTUBE_COMMENT_LOOKUP_LIMIT,
      DEFAULT_YOUTUBE_COMMENT_LOOKUP_LIMIT,
      0,
      SOCIAL_SWEEP_BACKLOG_REPROCESS_LIMIT
    ),
    perVideo: cappedNumber(
      env.STAFF_YOUTUBE_COMMENTS_PER_VIDEO,
      DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO,
      1,
      10
    ),
  };
  let youtubeFetch = {
    api_configured: Boolean(youtubeApi.apiKey),
    api_key_env: youtubeApi.name || '',
    published_after: youtubeStartTime,
    skipped_reason: youtubeApi.apiKey ? '' : 'Set YOUTUBE_API_KEY, GOOGLE_YOUTUBE_API_KEY, or GOOGLE_API_KEY to convert YouTube source feeds into exact video imports with snippet.publishedAt.',
    posts: [],
    reports: [],
  };
  let youtubeKnownChannelFallback = {
    attempted: false,
    triggered_by_search_quota: false,
    source_count: 0,
    search_job_count: 0,
    fetched_posts_count: 0,
    skipped_reason: '',
    load_reason: '',
    confidence_summary: summarizeYouTubeConfidence([]),
  };
  if (requestedPlatforms.includes('youtube') && fetchYouTube && youtubeApi.apiKey && youtubeSearchJobs.length) {
    const fetched = await fetchYouTubePostsForJobs(youtubeSearchJobs, {
      apiKey: youtubeApi.apiKey,
      maxResults: resultLimit,
      maxPagesPerSource: pageLimit,
      backfillMode,
      env,
      fetchImpl: sweepFetchImpl,
      youtubeCommentLookupBudget,
      deadlineAt: sweepDeadlineAt,
    });
    if (fetched.timed_out) partialResults = true;
    youtubeFetch = {
      ...youtubeFetch,
      posts: uniquePosts(fetched.posts),
      reports: fetched.reports,
      timed_out: fetched.timed_out === true,
      jobs_attempted_count: fetched.jobs_attempted_count || 0,
      jobs_skipped_due_to_time_budget: fetched.jobs_skipped_due_to_time_budget || 0,
      skipped_reason: '',
    };
  }
  const youtubeSearchQuotaExceeded = youtubeSearchQuotaExceededFromReports(youtubeFetch.reports);
  const shouldFetchKnownYouTubeChannels = requestedPlatforms.includes('youtube')
    && fetchYouTube
    && youtubeApi.apiKey
    && !sweepDeadlineReached(sweepDeadlineAt, SOCIAL_SWEEP_BACKLOG_MIN_REMAINING_MS)
    && (
      youtubeSearchQuotaExceeded
      || normalizedYoutubeJobMode === 'channel_uploads'
      || normalizedYoutubeJobMode === 'all'
    );
  if (shouldFetchKnownYouTubeChannels) {
    const loadedKnownChannels = await knownYouTubeChannelSourcesFromDb(db, {
      limit: sourceLimit,
      offset: normalizedSourceOffset,
    });
    const existingJobKeys = new Set(youtubeSearchJobs.map((job) => job.source_key));
    const knownChannelJobs = loadedKnownChannels.sources.length
      ? buildYouTubeSearchJobs({
        sources: loadedKnownChannels.sources,
        limit: sourceLimit,
        offset: 0,
        publishedAfter: youtubeStartTime,
        publishedBefore: youtubePublishedBefore,
        maxPagesPerSource: pageLimit,
        backfillMode,
        jobMode: 'channel_uploads',
      }).filter((job) => job.search_method === 'channel_uploads' && !existingJobKeys.has(job.source_key))
      : [];
    youtubeKnownChannelFallback = {
      attempted: true,
      triggered_by_search_quota: youtubeSearchQuotaExceeded,
      source_count: loadedKnownChannels.sources.length,
      search_job_count: knownChannelJobs.length,
      fetched_posts_count: 0,
      skipped_reason: knownChannelJobs.length ? '' : (loadedKnownChannels.ok ? 'no_known_youtube_channel_sources_found' : loadedKnownChannels.reason),
      load_reason: youtubeSearchQuotaExceeded
        ? (loadedKnownChannels.reason || 'youtube_search_quota_exceeded')
        : 'high_yield_known_channel_upload_scan',
      confidence_summary: summarizeYouTubeConfidence([]),
    };
    if (knownChannelJobs.length) {
      const fallbackFetched = await fetchYouTubePostsForJobs(knownChannelJobs, {
        apiKey: youtubeApi.apiKey,
        maxResults: resultLimit,
        maxPagesPerSource: pageLimit,
        backfillMode,
        env,
        fetchImpl: sweepFetchImpl,
        youtubeCommentLookupBudget,
        deadlineAt: sweepDeadlineAt,
      });
      if (fallbackFetched.timed_out) partialResults = true;
      const fallbackPosts = uniquePosts(fallbackFetched.posts);
      youtubeFetch = {
        ...youtubeFetch,
        posts: uniquePosts([...youtubeFetch.posts, ...fallbackPosts]),
        reports: [
          ...youtubeFetch.reports,
          ...fallbackFetched.reports.map((report) => ({
            ...report,
            fallback_channel_source: true,
            fallback_reason: youtubeSearchQuotaExceeded ? 'youtube_search_quota_exceeded' : 'high_yield_known_channel_upload_scan',
          })),
        ],
      };
      youtubeKnownChannelFallback = {
        ...youtubeKnownChannelFallback,
        fetched_posts_count: fallbackPosts.length,
        confidence_summary: summarizeYouTubeConfidence(fallbackPosts),
      };
    }
  } else if (requestedPlatforms.includes('youtube') && fetchYouTube && youtubeApi.apiKey && sweepDeadlineReached(sweepDeadlineAt, SOCIAL_SWEEP_BACKLOG_MIN_REMAINING_MS)) {
    partialResults = true;
    youtubeKnownChannelFallback = {
      ...youtubeKnownChannelFallback,
      skipped_reason: 'source_sweep_time_budget_reserved_for_partial_commit',
      load_reason: 'time_budget_guard',
    };
  }
  if (!dryRun && db?.query && youtubeFetch.posts.length) {
    const newestPublishedAtBySource = new Map();
    for (const post of youtubeFetch.posts) {
      const sourceKeyValue = cleanText(post.source_registry_key || post.raw_source_post?.source_job?.source_key);
      const publishedAt = cleanText(post.first_posted_at || post.published_at || post.youtube_published_at);
      const publishedTime = Date.parse(publishedAt);
      if (!sourceKeyValue || !Number.isFinite(publishedTime)) continue;
      const current = newestPublishedAtBySource.get(sourceKeyValue);
      if (!current || publishedTime > Date.parse(current)) newestPublishedAtBySource.set(sourceKeyValue, new Date(publishedTime).toISOString());
    }
    for (const [sourceKeyValue, newestPublishedAt] of newestPublishedAtBySource.entries()) {
      await db.query(
        `INSERT INTO property_harvest_cursors (platform, source_key, published_after, last_polled_at, metadata)
         VALUES ('youtube',$1,$2::timestamptz,NOW(),$3::jsonb)
         ON CONFLICT (platform, source_key) DO UPDATE
           SET published_after = GREATEST(property_harvest_cursors.published_after, EXCLUDED.published_after),
               last_polled_at = NOW(),
               metadata = property_harvest_cursors.metadata || EXCLUDED.metadata,
               updated_at = NOW()`,
        [sourceKeyValue, newestPublishedAt, JSON.stringify({ newest_published_at: newestPublishedAt })]
      ).catch((error) => {
        if (error?.code !== '42P01') throw error;
      });
    }
  }
  const bearer = envBearerToken(env);
  let xFetch = {
    api_configured: Boolean(bearer.token),
    token_env: bearer.name || '',
    search_mode: searchMode,
    lookback_days: Number(lookbackDays) || 0,
    archive_start_time: xStartTime,
    published_after: xStartTime,
    skipped_reason: bearer.token ? '' : 'Set X_BEARER_TOKEN, TWITTER_BEARER_TOKEN, or X_API_BEARER_TOKEN to convert X source feeds into exact post imports.',
    posts: [],
    reports: [],
  };
  if (requestedPlatforms.includes('x') && fetchX && bearer.token && xSearchJobs.length) {
    const fetched = await fetchXPostsForJobs(xSearchJobs, {
      bearerToken: bearer.token,
      maxResults: resultLimit,
      searchMode,
      fetchImpl: sweepFetchImpl,
      deadlineAt: sweepDeadlineAt,
    });
    if (fetched.timed_out) partialResults = true;
    xFetch = {
      ...xFetch,
      posts: uniquePosts(fetched.posts),
      reports: fetched.reports,
      timed_out: fetched.timed_out === true,
      jobs_attempted_count: fetched.jobs_attempted_count || 0,
      jobs_skipped_due_to_time_budget: fetched.jobs_skipped_due_to_time_budget || 0,
      skipped_reason: '',
    };
    if (searchMode === 'recent') {
      const authorExpansion = await fetchXAuthorExpansion(xFetch.posts, {
        bearerToken: bearer.token,
        fetchImpl: sweepFetchImpl,
        authorLimit: cappedNumber(env.X_AUTHOR_EXPANSION_LIMIT, DEFAULT_X_AUTHOR_EXPANSION_LIMIT, 0, 10),
        maxResults: cappedNumber(env.X_AUTHOR_EXPANSION_MAX_RESULTS, 10, 5, 100),
        deadlineAt: sweepDeadlineAt,
      });
      xFetch = {
        ...xFetch,
        posts: uniquePosts([...xFetch.posts, ...authorExpansion.posts]),
        author_expansion: authorExpansion,
      };
      if (!dryRun && db?.query) {
        for (const report of authorExpansion.reports.filter((item) => item.ok)) {
          await db.query(
            `INSERT INTO property_harvest_channels (
               platform, source_key, display_name, profile_url, external_channel_id,
               subscription_status, last_checked_at, metadata
             ) VALUES ('x',$1,$2,$3,$4,'official_author_timeline',NOW(),$5::jsonb)
             ON CONFLICT (platform, source_key) DO UPDATE
               SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), property_harvest_channels.display_name),
                   profile_url = COALESCE(NULLIF(EXCLUDED.profile_url, ''), property_harvest_channels.profile_url),
                   external_channel_id = EXCLUDED.external_channel_id,
                   subscription_status = EXCLUDED.subscription_status,
                   last_checked_at = NOW(),
                   metadata = property_harvest_channels.metadata || EXCLUDED.metadata,
                   updated_at = NOW()`,
            [
              `x-author-${report.author_id}`,
              report.display_name || `X author ${report.author_id}`,
              report.profile_url || null,
              report.author_id,
              JSON.stringify({ hashtag_term_seeds: authorExpansion.hashtag_terms, latest_result_count: report.result_count }),
            ]
          ).catch((error) => {
            if (error?.code !== '42P01') throw error;
          });
        }
      }
    }
    if (!dryRun && db?.query) {
      for (const report of xFetch.reports.filter((item) => item.ok && item.newest_id && item.source_key)) {
        await db.query(
          `INSERT INTO property_harvest_cursors (platform, source_key, since_id, last_polled_at, metadata)
           VALUES ('x',$1,$2,NOW(),$3::jsonb)
           ON CONFLICT (platform, source_key) DO UPDATE
             SET since_id = EXCLUDED.since_id,
                 last_polled_at = NOW(),
                 metadata = property_harvest_cursors.metadata || EXCLUDED.metadata,
                 updated_at = NOW()`,
          [report.source_key, report.newest_id, JSON.stringify({ query: report.query, result_count: report.result_count })]
        ).catch((error) => {
          if (error?.code !== '42P01') throw error;
        });
      }
    }
  }
  const allDiscoveredPosts = uniquePosts([
    ...tiktokDataSourceFetch.posts,
    ...youtubeFetch.posts,
    ...xFetch.posts,
  ]);
  const discoveredPosts = allDiscoveredPosts.slice(0, importPostLimit);
  if (allDiscoveredPosts.length > discoveredPosts.length) partialResults = true;
  const importResult = discoveredPosts.length
    ? await queueFoundOnlineSourcePostListings({
      db,
      posts: discoveredPosts,
      dryRun,
      createProfilesForRepeatedSourcesOnly: false,
    })
    : {
      ok: true,
      dry_run: dryRun,
      received_posts: 0,
      normalized_posts: 0,
      eligible_to_queue_count: 0,
      created_properties: 0,
      existing_properties: 0,
      review_queue_properties: 0,
      queued_listings: [],
      source_review_records: [],
    };
  const observedProviderRequestCount = (tiktokDataSourceFetch.reports || []).length
    + (youtubeFetch.reports || []).length
    + (xFetch.reports || []).length;
  const xPostReadCostUsd = Number(process.env.ZA_X_POST_READ_COST_USD || 0.005);
  const estimatedProviderCostUsd = String(process.env.COUNTRY_CODE || '').trim().toUpperCase() === 'ZA'
    ? Number(((xFetch.posts || []).length * (Number.isFinite(xPostReadCostUsd) ? xPostReadCostUsd : 0.005)).toFixed(4))
    : 0;
  const harvestEventLog = !dryRun
    ? await recordHarvestImportResult(db, importResult, {
      eventType: 'scheduled_social_sweep',
      requestCount: observedProviderRequestCount,
      estimatedCostUsd: estimatedProviderCostUsd,
    }).catch((error) => ({
      ok: false,
      recorded: 0,
      reason: error.message || 'harvest_event_log_failed',
    }))
    : { ok: true, skipped: true, reason: 'dry_run', recorded: 0 };
  let youtubeChannelRegistry = {
    ok: true,
    skipped: true,
    reason: dryRun ? 'dry_run' : 'no_discovered_youtube_channels',
    discovered_channel_count: 0,
    reports: [],
  };
  if (!dryRun && youtubeFetch.posts.length && db?.query && !sweepDeadlineReached(sweepDeadlineAt, SOCIAL_SWEEP_MIN_REMAINING_MS)) {
    const { registerDiscoveredYouTubeChannels } = require('./youtubeWebSubService');
    youtubeChannelRegistry = await registerDiscoveredYouTubeChannels(db, youtubeFetch.posts, {
      autoSubscribe: true,
      fetchImpl: sweepFetchImpl,
      env,
    }).catch((error) => ({
      ok: false,
      reason: error.message || 'youtube_channel_registry_failed',
      discovered_channel_count: 0,
      reports: [],
    }));
  }
  const canRunYouTubeBacklog = requestedPlatforms.includes('youtube') && fetchYouTube && youtubeApi.apiKey
    && !sweepDeadlineReached(sweepDeadlineAt, SOCIAL_SWEEP_BACKLOG_MIN_REMAINING_MS);
  const pendingYouTubeBacklogReprocess = canRunYouTubeBacklog
    ? await enrichPendingYouTubeSourceRows({
      db,
      apiKey: youtubeApi.apiKey,
      env,
      fetchImpl: sweepFetchImpl,
      dryRun,
      limit: Math.min(cappedNumber(env.STAFF_YOUTUBE_PENDING_REPROCESS_LIMIT, DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT, 1, DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT), SOCIAL_SWEEP_BACKLOG_REPROCESS_LIMIT),
      offset: 0,
      commentLookupBudget: youtubeCommentLookupBudget,
      deadlineAt: sweepDeadlineAt,
      minRemainingMs: SOCIAL_SWEEP_MIN_REMAINING_MS,
    })
    : {
      ok: true,
      skipped: true,
      reason: requestedPlatforms.includes('youtube')
        ? (youtubeApi.apiKey ? 'source_sweep_time_budget_reserved_for_partial_commit' : 'youtube_api_key_required')
        : 'youtube_not_requested',
      rows_considered: 0,
      video_details_fetched_count: 0,
      comment_threads_attempted_count: 0,
      comment_threads_fetched_count: 0,
      reprocess_result: null,
    };
  if (requestedPlatforms.includes('youtube') && youtubeApi.apiKey && !canRunYouTubeBacklog) partialResults = true;
  if (pendingYouTubeBacklogReprocess.partial_results === true || pendingYouTubeBacklogReprocess.timed_out === true) partialResults = true;
  const canRunTikTokBacklog = requestedPlatforms.includes('tiktok')
    && !sweepDeadlineReached(sweepDeadlineAt, SOCIAL_SWEEP_BACKLOG_MIN_REMAINING_MS);
  const pendingTikTokThumbnailReprocess = canRunTikTokBacklog
    ? await enrichPendingTikTokSourceThumbnailRows({
      db,
      dryRun,
      fetchImpl: sweepFetchImpl,
      limit: Math.min(cappedNumber(env.STAFF_TIKTOK_PENDING_REPROCESS_LIMIT, DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT, 1, DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT), SOCIAL_SWEEP_BACKLOG_REPROCESS_LIMIT),
      offset: normalizedSourceOffset,
      deadlineAt: sweepDeadlineAt,
      minRemainingMs: SOCIAL_SWEEP_MIN_REMAINING_MS,
    })
    : {
      ok: true,
      skipped: true,
      reason: requestedPlatforms.includes('tiktok') ? 'source_sweep_time_budget_reserved_for_partial_commit' : 'tiktok_not_requested',
      version: TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
      rows_considered: 0,
      oembed_fetch_count: 0,
      updated_properties: 0,
      unavailable_properties: 0,
      reports: [],
    };
  if (requestedPlatforms.includes('tiktok') && !canRunTikTokBacklog) partialResults = true;
  if (pendingTikTokThumbnailReprocess.partial_results === true || pendingTikTokThumbnailReprocess.timed_out === true) partialResults = true;
  const sweepElapsedMs = Date.now() - sweepStartedAt;
  const sweepRemaining = sweepRemainingMs(sweepDeadlineAt);

  return {
    ok: true,
    batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    import_batch_id: FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
    dry_run: dryRun,
    platforms: requestedPlatforms,
    platform_policy: {
      country_code: southAfricaSweep ? 'ZA' : String(env.COUNTRY_CODE || process.env.COUNTRY_CODE || 'UG').toUpperCase(),
      automated_platforms: southAfricaSweep ? ['youtube', 'x'] : requestedPlatforms,
      curated_platforms: southAfricaSweep ? ['tiktok'] : [],
      marketing_only_platforms: southAfricaSweep ? ['facebook'] : [],
      blocked_platform_reason: platformPolicyBlockReason,
    },
    focus: studentHousingFocus ? 'students' : normalizedFocus,
    partial_results: partialResults,
    time_budget_exhausted: sweepRemaining <= 0,
    performance: {
      elapsed_ms: sweepElapsedMs,
      time_budget_ms: sweepBudget,
      remaining_ms: Number.isFinite(sweepRemaining) ? sweepRemaining : null,
      partial_results: partialResults,
      time_budget_exhausted: sweepRemaining <= 0,
      caps: {
        source_limit: sourceLimit,
        max_results_per_source: resultLimit,
        max_pages_per_source: pageLimit,
        tiktok_data_source_limit: tiktokDataSourceLimit,
        backlog_reprocess_limit: SOCIAL_SWEEP_BACKLOG_REPROCESS_LIMIT,
        import_post_limit: importPostLimit,
      },
      observed_provider_request_count: observedProviderRequestCount,
      estimated_provider_cost_usd: estimatedProviderCostUsd,
    },
    registry_rotation: {
      requested_source_limit: sourceLimit,
      source_offset: normalizedSourceOffset,
      tiktok: sourceWindowSummary(tiktokSourceWindow),
      youtube: sourceWindowSummary(youtubeSourceWindow),
      x: sourceWindowSummary(xSourceWindow),
      facebook: sourceWindowSummary(facebookSourceWindow),
      instagram: sourceWindowSummary(instagramSourceWindow),
    },
    policy: {
      tiktok: southAfricaSweep
        ? 'South Africa TikTok intake is curated-only. Queue a property only from an operator-supplied exact /@handle/video/id URL verified by official oEmbed or another approved consented source. Never run broad TikTok search scraping.'
        : 'Hashtag/profile URLs are discovery tasks. Queue a property after the exact TikTok /@handle/video/id URL, location, source contact path, and source evidence are captured. Missing price becomes Price upon application. Location is non-negotiable before approval; other checks are King-review overrides.',
      youtube: 'YouTube source pages are scanned through channel upload playlists when a channel/handle is known; hashtags and search feeds use focused YouTube Data API search queries from 1 January 2026 onward for both Shorts and long-form videos. If YouTube Search quota is exhausted, the sweep falls back to stored YouTube source/contact channels and scans their upload playlists without broad hashtag search. Exact video URLs with snippet.publishedAt, title/description, channel contact path, location, and source evidence become Found Online review records. Missing price becomes Price upon application.',
      x: 'X/Twitter source lists become properties after X API/search returns exact post URLs with created_at, text, author/profile, media/source evidence, location, and contact path. Missing price becomes Price upon application. Location is non-negotiable before approval; other checks are King-review overrides.',
      student_housing_focus: southAfricaSweep
        ? 'South Africa student-housing automation is limited to YouTube Data API and X API results; Facebook is marketing-only and TikTok is exact-URL curated intake.'
        : 'Student housing sweeps prioritize campus, hostel, student accommodation, university, and student-room source signals and prepare manual Facebook/Instagram capture tasks when direct APIs are unavailable.',
      profile_creation_rule: 'The sweep does not automatically create or link public Makaug broker profiles from social discovery. Source owners must register or claim a Makaug broker profile before Makaug shows a public agent profile.',
    },
    api_readiness: apiReadiness,
    tiktok: {
      source_count: tiktokSources.length,
      selected_source_count: tiktokSourceWindow.selected_source_count,
      source_offset: tiktokSourceWindow.source_offset,
      next_source_offset: tiktokSourceWindow.next_source_offset,
      capture_task_count: tiktokCaptureTasks.length,
      api_configured: apiReadiness.tiktok.configured,
      api_mode: apiReadiness.tiktok.mode,
      api_note: apiReadiness.tiktok.note,
      exact_video_url_pattern: TIKTOK_EXACT_VIDEO_URL_PATTERN.source,
      capture_tasks: tiktokCaptureTasks,
      data_source_fetch: {
        api_configured: tiktokDataSourceFetch.api_configured,
        data_source_url_env: tiktokDataSourceFetch.data_source_url_env,
        skipped_reason: tiktokDataSourceFetch.skipped_reason || '',
        received_rows: tiktokDataSourceFetch.received_rows || 0,
        fetched_posts_count: (tiktokDataSourceFetch.posts || []).length,
        oembed_fetch_count: tiktokDataSourceFetch.oembed_fetch_count || 0,
        thumbnail_cached_count: tiktokDataSourceFetch.thumbnail_cached_count || 0,
        thumbnail_cache_skipped_count: tiktokDataSourceFetch.thumbnail_cache_skipped_count || 0,
        reports: (tiktokDataSourceFetch.reports || []).slice(0, 20),
      },
      pending_thumbnail_reprocess: pendingTikTokThumbnailReprocess,
    },
    youtube: {
      source_count: youtubeSources.length,
      selected_source_count: youtubeSourceWindow.selected_source_count,
      source_offset: normalizedSourceOffset,
      next_source_offset: youtubeSourceWindow.next_source_offset,
      job_mode: normalizedYoutubeJobMode,
      unfiltered_search_job_count: unfilteredYoutubeSearchJobs.length,
      primary_search_job_count: primaryYoutubeSearchJobs.length,
      registry_fill_search_job_count: youtubeRegistryFillSearchJobs.length,
      search_job_count: youtubeSearchJobs.length,
      api_configured: youtubeFetch.api_configured,
      api_key_env: youtubeFetch.api_key_env,
      published_after: youtubeFetch.published_after,
      max_pages_per_source: pageLimit,
      skipped_reason: youtubeFetch.skipped_reason,
      includes_shorts_and_long_form: true,
      search_jobs: youtubeSearchJobs,
      fetch_reports: youtubeFetch.reports,
      fetched_posts_count: youtubeFetch.posts.length,
      confidence_summary: summarizeYouTubeConfidence(youtubeFetch.posts),
      known_channel_fallback: youtubeKnownChannelFallback,
      pending_backlog_reprocess: pendingYouTubeBacklogReprocess,
      websub_channel_registry: youtubeChannelRegistry,
    },
    x: {
      source_count: xSources.length,
      selected_source_count: xSourceWindow.selected_source_count,
      source_offset: xSourceWindow.source_offset,
      next_source_offset: xSourceWindow.next_source_offset,
      search_job_count: xSearchJobs.length,
      api_configured: xFetch.api_configured,
      token_env: xFetch.token_env,
      search_mode: searchMode,
      published_after: xFetch.published_after,
      archive_start_time: xFetch.archive_start_time,
      skipped_reason: xFetch.skipped_reason,
      search_jobs: xSearchJobs,
      fetch_reports: xFetch.reports,
      author_expansion: xFetch.author_expansion || { posts: [], reports: [], hashtag_terms: [] },
      fetched_posts_count: xFetch.posts.length,
    },
    facebook: {
      source_count: facebookSources.length,
      selected_source_count: facebookSourceWindow.selected_source_count,
      source_offset: facebookSourceWindow.source_offset,
      next_source_offset: facebookSourceWindow.next_source_offset,
      capture_task_count: facebookCaptureTasks.length,
      api_configured: apiReadiness.facebook.configured,
      api_mode: apiReadiness.facebook.mode,
      skipped_reason: southAfricaSweep
        ? 'South Africa Facebook is marketing-only. No group or Marketplace harvesting is permitted.'
        : apiReadiness.facebook.configured
        ? 'Facebook Graph credentials are present; keep exact public post URLs in King review until the Graph post adapter is enabled for the approved pages.'
        : 'Set META_GRAPH_ACCESS_TOKEN plus FACEBOOK_PAGE_IDS/FACEBOOK_PAGE_ID in Render for approved Facebook Graph page/post review.',
      capture_tasks: facebookCaptureTasks,
    },
    instagram: {
      source_count: instagramSources.length,
      selected_source_count: instagramSourceWindow.selected_source_count,
      source_offset: instagramSourceWindow.source_offset,
      next_source_offset: instagramSourceWindow.next_source_offset,
      capture_task_count: instagramCaptureTasks.length,
      api_configured: apiReadiness.instagram.configured,
      api_mode: apiReadiness.instagram.mode,
      skipped_reason: southAfricaSweep
        ? 'Instagram is excluded from South Africa automated harvesting.'
        : apiReadiness.instagram.configured
        ? 'Instagram Graph credentials are present; keep exact post/reel URLs in King review until the hashtag/media adapter is enabled for the approved business account.'
        : 'Set META_GRAPH_ACCESS_TOKEN plus INSTAGRAM_BUSINESS_ACCOUNT_IDS/INSTAGRAM_BUSINESS_ACCOUNT_ID in Render for Instagram Graph hashtag/media review.',
      capture_tasks: instagramCaptureTasks,
    },
    discovered_posts_count: discoveredPosts.length,
    discovered_posts: discoveredPosts.slice(0, 50),
    import_result: importResult,
    harvest_event_log: harvestEventLog,
    pending_backlog_reprocess_result: pendingYouTubeBacklogReprocess,
  };
}

function requestedPlatformsForSweep({
  southAfricaSweep = false,
  normalizedPlatform = 'all',
  studentHousingFocus = false,
  southAfricaTikTokCuratedOnly = true,
} = {}) {
  if (southAfricaSweep) {
    if (studentHousingFocus || normalizedPlatform === 'all') return ['youtube', 'x'];
    if (['youtube', 'x'].includes(normalizedPlatform)) return [normalizedPlatform];
    if (normalizedPlatform === 'tiktok' && southAfricaTikTokCuratedOnly) return ['tiktok'];
    return [];
  }
  if (studentHousingFocus) return ['tiktok', 'youtube', 'x', 'facebook', 'instagram'];
  return normalizedPlatform === 'all' ? ['tiktok', 'youtube', 'x'] : [normalizedPlatform];
}

module.exports = {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  DEFAULT_MAX_SOURCES,
  MAX_PLATFORM_SWEEP_SOURCES,
  DEFAULT_X_RESULTS_PER_SOURCE,
  DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
  DEFAULT_YOUTUBE_PAGES_PER_SOURCE,
  YOUTUBE_SEARCH_URL,
  YOUTUBE_CHANNELS_URL,
  YOUTUBE_PLAYLIST_ITEMS_URL,
  YOUTUBE_VIDEOS_URL,
  YOUTUBE_COMMENT_THREADS_URL,
  YOUTUBE_OEMBED_URL,
  YOUTUBE_SOURCE_POST_WINDOW_START,
  DEFAULT_YOUTUBE_COMMENT_LOOKUP_LIMIT,
  DEFAULT_YOUTUBE_COMMENTS_PER_VIDEO,
  DEFAULT_YOUTUBE_PENDING_REPROCESS_LIMIT,
  YOUTUBE_SOURCE_TEXT_ENRICHMENT_VERSION,
  YOUTUBE_API_KEY_ENV_NAMES,
  X_BEARER_ENV_NAMES,
  X_TWEET_LOOKUP_URL,
  META_GRAPH_ACCESS_TOKEN_ENV_NAMES,
  FACEBOOK_PAGE_ID_ENV_NAMES,
  INSTAGRAM_BUSINESS_ACCOUNT_ID_ENV_NAMES,
  TIKTOK_ACCESS_TOKEN_ENV_NAMES,
  TIKTOK_CLIENT_KEY_ENV_NAMES,
  TIKTOK_CLIENT_SECRET_ENV_NAMES,
  TIKTOK_DATA_SOURCE_URL_ENV_NAMES,
  TIKTOK_OEMBED_THUMBNAIL_REPROCESS_VERSION,
  TIKTOK_OEMBED_THUMBNAIL_CACHE_VERSION,
  DEFAULT_TIKTOK_PENDING_REPROCESS_LIMIT,
  X_FULL_ARCHIVE_SEARCH_PACING_MS,
  socialDiscoveryApiReadiness,
  TIKTOK_OEMBED_URL,
  TIKTOK_EXACT_VIDEO_URL_PATTERN,
  extractExactSocialPostUrls,
  extractTikTokVideoUrls,
  fetchTikTokDataSourcePosts,
  buildExactSocialPostImportRows,
  enrichPendingYouTubeSourceRows,
  enrichPendingTikTokSourceThumbnailRows,
  buildTikTokCaptureTasks,
  buildManualSocialCaptureTasks,
  buildTikTokExactPostImportRows,
  buildKnownYouTubeChannelSourcesFromRows,
  buildYouTubeSearchJobs,
  filterYouTubeJobsByMode,
  normalizeYouTubeJobMode,
  buildXSearchJobs,
  fetchXAuthorExpansion,
  fetchXPostsForJobs,
  fetchXPostMetadata,
  importExactSocialSourcePosts,
  importTikTokExactVideoPosts,
  normalizeExactSocialPostUrl,
  normalizeYouTubeApiPost,
  normalizeXApiPost,
  extractArea,
  priceTextFromText,
  normalizeUgandanPhone,
  phoneFromText,
  youtubeSearchQuotaExceededFromReports,
  runSocialPlatformPostSweep,
  requestedPlatformsForSweep,
};
