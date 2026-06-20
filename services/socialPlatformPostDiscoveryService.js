'use strict';

const {
  getPropertySourceRegistry,
  sourceRecordKind,
} = require('./propertySourceRegistryService');
const {
  FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
  LAUNCH_SOURCE_POST_WINDOW_START,
  queueFoundOnlineSourcePostListings,
} = require('./socialSearchSourcedListingsService');
const { DISTRICTS } = require('../utils/constants');

const SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID = 'social_platform_post_discovery_20260525';
const DEFAULT_MAX_SOURCES = 40;
const MAX_PLATFORM_SWEEP_SOURCES = 30000;
const DEFAULT_X_RESULTS_PER_SOURCE = 25;
const X_RECENT_SEARCH_URL = 'https://api.x.com/2/tweets/search/recent';
const X_FULL_ARCHIVE_SEARCH_URL = 'https://api.x.com/2/tweets/search/all';
const X_BEARER_ENV_NAMES = ['X_BEARER_TOKEN', 'TWITTER_BEARER_TOKEN', 'X_API_BEARER_TOKEN'];
const DEFAULT_YOUTUBE_RESULTS_PER_SOURCE = 25;
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed';
const YOUTUBE_SOURCE_POST_WINDOW_START = '2026-01-01T00:00:00.000Z';
const YOUTUBE_API_KEY_ENV_NAMES = ['YOUTUBE_API_KEY', 'GOOGLE_YOUTUBE_API_KEY', 'GOOGLE_API_KEY'];
const TIKTOK_OEMBED_URL = 'https://www.tiktok.com/oembed';
const TIKTOK_EXACT_VIDEO_URL_PATTERN = /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i;
const TIKTOK_EXACT_VIDEO_URL_GLOBAL_PATTERN = /https?:\/\/(?:www\.)?tiktok\.com\/@[^/\s?#]+\/video\/\d+(?:[^\s]*)?/ig;
const SOCIAL_URL_GLOBAL_PATTERN = /https?:\/\/[^\s<>"']+/ig;

const CORE_PROPERTY_QUERY = [
  'property', 'house', 'home', 'apartment', 'land', 'plot', 'rent', 'rental',
  '"for sale"', '"to let"', 'hostel', '"student accommodation"', 'commercial', 'warehouse',
].join(' OR ');

const UGANDA_LOCATION_QUERY = [
  'Uganda', 'Kampala', 'Wakiso', 'Mukono', 'Entebbe', 'Jinja', 'Kira', 'Ntinda',
  'Naalya', 'Muyenga', 'Namugongo', 'Najjera', 'Makerere', 'Kyambogo',
  'MUBS', 'UCU', 'Ndejje', 'Nakawa', 'Banda', 'Kikoni', 'Namanve', 'Kikuubo',
].join(' OR ');

const AREA_HINTS = [
  'Kampala', 'Wakiso', 'Mukono', 'Entebbe', 'Jinja', 'Kira', 'Ntinda', 'Naalya',
  'Najjera', 'Namugongo', 'Muyenga', 'Bweyogerere', 'Bwebajja', 'Kyanja',
  'Komamboga', 'Kiwatule', 'Bukoto', 'Naguru', 'Kololo', 'Nakasero', 'Luzira',
  'Lubowa', 'Seguku', 'Kitende', 'Kajansi', 'Akright', 'Garuga', 'Kiwafu',
  'Munyonyo', 'Makindye', 'Kansanga', 'Mengo', 'Makerere', 'Kyambogo', 'MUBS',
  'Namanve', 'Katosi', 'Mpunge', 'Mpungwe', 'Lake Victoria', 'Luweero', 'Masaka',
  'Mbarara', 'Mbale', 'Gulu', 'Arua',
  'Bujjuko', 'Bujuuko', 'Namayumba', 'Kakiri', 'Masulita', 'Hoima Road',
  'Mityana Road', 'Entebbe Road', 'Jinja Road', 'Kigo', 'Kawuku', 'Kisubi',
  'Nkumba', 'Kyaliwajjala', 'Kireka', 'Sonde', 'Kungu', 'Bulindo', 'Gayaza',
  'Matugga', 'Nansana', 'Nabweru', 'Kyebando', 'Kawempe', 'Kikoni', 'Nakawa',
  'Banda', 'UCU Mukono', 'Ndejje', 'Ndeeba', 'Kikuubo', 'Industrial Area',
  'Lugogo', 'Nateete', 'Buloba', 'Kyengera', 'Busega', 'Mpererwe', 'Katosi Road',
];

const AREA_PIN_OVERRIDES = [
  { name: 'Ndejje', district: 'Wakiso', lat: 0.244, lng: 32.553, aliases: ['Ndejje', 'Ndejje Lubugumu'] },
  { name: 'Bujjuko Akright Estate', district: 'Wakiso', lat: 0.374, lng: 32.389, aliases: ['Bujjuko Akright', 'Bujuuko Akright', 'Akright', 'Bujjuko', 'Bujuuko'] },
  { name: 'Kakiri', district: 'Wakiso', lat: 0.409, lng: 32.38, aliases: ['Kakiri', 'Kakiri Masulita', 'Kakiri Masulita Hoima Road', 'Hoima Road'] },
  { name: 'Masulita', district: 'Wakiso', lat: 0.51, lng: 32.46, aliases: ['Masulita'] },
  { name: 'Kira', district: 'Wakiso', lat: 0.3978, lng: 32.6414, aliases: ['Kira', 'Kira Town'] },
  { name: 'Kira-Mulawa', district: 'Wakiso', lat: 0.412, lng: 32.65, aliases: ['Kira-Mulawa', 'Kira Mulawa', 'Mulawa'] },
  { name: 'Kira-Nsasa', district: 'Wakiso', lat: 0.428, lng: 32.665, aliases: ['Kira-Nsasa', 'Kira Nsasa', 'Nsasa'] },
  { name: 'Katosi', district: 'Mukono', lat: 0.181, lng: 32.797, aliases: ['Katosi', 'Mpunge', 'Mpungwe', 'Katosi Mpunge'] },
  { name: 'Kololo', district: 'Kampala', lat: 0.356, lng: 32.612, aliases: ['Kololo'] }
];

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

function areaAliasPattern(alias = '') {
  return cleanText(alias)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
    .replace(/-/g, '[-\\s]+');
}

function areaPinFromText(value = '') {
  const haystack = cleanText(value);
  if (!haystack) return null;
  const sorted = AREA_PIN_OVERRIDES
    .flatMap((point) => (point.aliases || [point.name]).map((alias) => ({ ...point, alias })))
    .sort((a, b) => String(b.alias || '').length - String(a.alias || '').length);
  for (const point of sorted) {
    const pattern = areaAliasPattern(point.alias);
    if (!pattern) continue;
    if (new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(haystack)) return point;
  }
  return null;
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

function cappedNumber(value, fallback, min = 1, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
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
    provider_name: cleanText(payload.provider_name || 'TikTok'),
  };
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

function buildTikTokExactPostImportRows({
  posts = [],
  urls = [],
  rawText = '',
  oembedByUrl = {},
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
      const sourceUrl = seed.post_url;
      const profileUrl = seed.source_page_url || seed.source_contact_url || oembed.author_url || tiktokProfileUrlFromVideoUrl(sourceUrl);
      const handle = tiktokHandleFromUrl(sourceUrl);
      const sourceName = cleanText(seed.source_name || oembed.author_name || (handle ? `@${handle}` : 'TikTok property source'));
      const commentEvidence = cleanText(seed.comments || seed.comment || seed.owner_comment || seed.owner_comments || seed.owner_response || seed.poster_reply || seed.poster_response || seed.reply || seed.replies || '');
      const visualText = sourceVisualTextFromObject(seed);
      const caption = cleanText(seed.caption || seed.description || oembed.title || seed.title || '');
      const title = cleanText(seed.title || oembed.title || caption || `TikTok property post ${index + 1}`);
      const combinedText = cleanText(`${title} ${caption} ${visualText} ${commentEvidence}`);
      const rawArea = cleanText(seed.area || seed.location || '');
      const extractedRawArea = extractArea(rawArea);
      const areaPin = areaPinFromText(`${rawArea} ${combinedText}`);
      const area = areaPin && (!rawArea || rawArea.includes(',') || /^(kampala|wakiso|hoima|greater kampala|uganda)$/i.test(rawArea))
        ? areaPin.name
        : cleanText(extractedRawArea || rawArea || extractArea(combinedText));
      const district = cleanText(areaPin?.district || seed.district || districtForArea(area, combinedText));
      const priceText = cleanText(seed.price_text || seed.price || priceTextFromText(combinedText));
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
        source_key: seed.source_key || handle || sourceUrl,
        source_name: sourceName,
        platform: 'TikTok',
        tiktok_url: sourceUrl,
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
        latitude: seed.latitude || seed.lat || areaPin?.lat || '',
        longitude: seed.longitude || seed.lng || areaPin?.lng || '',
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
  const oembedReports = [];
  if (fetchOembed) {
    for (const seed of seeds) {
      if (oembedByUrl[seed.post_url]) continue;
      const report = await fetchTikTokOEmbed(seed.post_url, { fetchImpl }).catch((error) => ({
        ok: false,
        reason: error.message || 'tiktok_oembed_failed',
      }));
      oembedReports.push({
        post_url: seed.post_url,
        ok: report.ok === true,
        status: report.status || null,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
      });
      if (report.ok && report.payload) oembedByUrl[seed.post_url] = report.payload;
    }
  }
  const importRows = buildTikTokExactPostImportRows({
    posts: seeds,
    oembedByUrl,
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
    oembed_reports: oembedReports,
    import_result: importResult,
    ...importResult,
  };
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
      const oembed = metadata.oembed || {};
      const page = metadata.page || {};
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
      const title = cleanText(seed.title || page.title || oembed.title || `Found-online ${platform} property post ${index + 1}`);
      const commentEvidence = cleanText(seed.comments || seed.comment || seed.owner_comment || seed.owner_comments || seed.owner_response || seed.poster_reply || seed.poster_response || seed.reply || seed.replies || '');
      const visualText = sourceVisualTextFromObject(seed);
      const caption = cleanText(seed.caption || seed.description || page.description || oembed.title || title);
      const combinedText = cleanText(`${title} ${caption} ${visualText} ${commentEvidence}`);
      const rawArea = cleanText(seed.area || seed.location || '');
      const extractedRawArea = extractArea(rawArea);
      const areaPin = areaPinFromText(`${rawArea} ${combinedText}`);
      const area = areaPin && (!rawArea || rawArea.includes(',') || /^(kampala|wakiso|hoima|greater kampala|uganda)$/i.test(rawArea))
        ? areaPin.name
        : cleanText(extractedRawArea || rawArea || extractArea(combinedText));
      const district = cleanText(areaPin?.district || seed.district || districtForArea(area, combinedText));
      const priceText = cleanText(seed.price_text || seed.price || priceTextFromText(combinedText));
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
        latitude: seed.latitude || seed.lat || areaPin?.lat || '',
        longitude: seed.longitude || seed.lng || areaPin?.lng || '',
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
  fetchImpl = fetch,
} = {}) {
  const seeds = socialSeedsFromInputs({ posts, urls, rawText });
  const metadataByUrl = {};
  const metadataReports = [];
  for (const seed of seeds) {
    const url = seed.post_url;
    if (!url || metadataByUrl[url]) continue;
    const platform = platformForExactSocialPostUrl(url);
    const metadata = {};
    if (fetchOembed && platform === 'TikTok') {
      const report = await fetchTikTokOEmbed(url, { fetchImpl }).catch((error) => ({
        ok: false,
        reason: error.message || 'tiktok_oembed_failed',
      }));
      metadataReports.push({
        post_url: url,
        platform,
        method: 'tiktok_oembed',
        ok: report.ok === true,
        status: report.status || null,
        reason: report.ok ? '' : (report.reason || 'tiktok_oembed_failed'),
      });
      if (report.ok && report.payload) metadata.oembed = report.payload;
    }
    if (fetchOembed && platform === 'YouTube') {
      const report = await fetchYouTubeOEmbed(url, { fetchImpl }).catch((error) => ({
        ok: false,
        reason: error.message || 'youtube_oembed_failed',
      }));
      metadataReports.push({
        post_url: url,
        platform,
        method: 'youtube_oembed',
        ok: report.ok === true,
        status: report.status || null,
        reason: report.ok ? '' : (report.reason || 'youtube_oembed_failed'),
      });
      if (report.ok && report.payload) metadata.oembed = report.payload;
    }
    if (fetchPublicMetadata && platform === 'YouTube') {
      const report = await fetchPublicPageMetadata(url, { fetchImpl }).catch((error) => ({
        ok: false,
        reason: error.message || 'public_page_metadata_failed',
      }));
      metadataReports.push({
        post_url: url,
        platform,
        method: 'public_page_metadata',
        ok: report.ok === true,
        status: report.status || null,
        reason: report.ok ? '' : (report.reason || 'public_page_metadata_failed'),
      });
      if (report.ok && report.payload) metadata.page = report.payload;
    }
    metadataByUrl[url] = metadata;
  }
  const importRows = buildExactSocialPostImportRows({
    posts: seeds,
    metadataByUrl,
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
    exact_social_url_count: importRows.length,
    exact_social_import_rows: importRows,
    metadata_fetch_count: metadataReports.length,
    metadata_reports: metadataReports,
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

function buildYouTubeQueryForSource(source = {}) {
  const url = sourceUrl(source);
  const existingQuery = urlParam(url, 'search_query') || urlParam(url, 'q');
  if (existingQuery) return cleanText(existingQuery);
  const hashtag = sourceHashtag(source);
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
  return cleanText(`${discoveryTerms || 'Uganda property'} Uganda property house land rent hostel student accommodation commercial`);
}

function youtubeDiscoveryPriority(source = {}) {
  const type = cleanText(source.source_type || source.sourceType || '').toLowerCase();
  const url = sourceUrl(source);
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  let score = 50;
  if (type.includes('public_video_search_feed')) score = 0;
  else if (type.includes('search_feed')) score = 10;
  else if (type.includes('hashtag')) score = 20;
  else if (/youtube\.com\/results\?/i.test(url)) score = 30;
  else if (isDiscoveryFeed(source)) score = 40;
  if (metadata.generated_source_discovery || metadata.generated_hashtag_discovery) score -= 5;
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

function buildYouTubeSearchJobs({
  sources = sourcesForPlatform('youtube'),
  limit = DEFAULT_MAX_SOURCES,
  offset = 0,
  publishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START,
} = {}) {
  const start = cleanText(publishedAfter) || YOUTUBE_SOURCE_POST_WINDOW_START;
  const sortedSources = sortYouTubeSourcesForDiscovery(sources
    .filter((source) => normalizePlatform(source.platform) === 'youtube')
  );
  const startOffset = sortedSources.length ? cappedOffset(offset) % sortedSources.length : 0;
  return sortedSources
    .slice(startOffset, startOffset + cappedNumber(limit, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES))
    .map((source) => ({
      platform: 'youtube',
      source_key: sourceKey(source),
      source_name: sourceName(source),
      source_type: source.source_type || source.sourceType || '',
      source_record_kind: isDiscoveryFeed(source) ? 'discovery_feed' : 'source_page',
      source_url: sourceUrl(source),
      discovery_priority: youtubeDiscoveryPriority(source),
      query: buildYouTubeQueryForSource(source).slice(0, 500),
      endpoint: YOUTUBE_SEARCH_URL,
      published_after: start,
      max_results: DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
      includes_shorts_and_long_form: true,
    }));
}

function youtubeThumbnailUrls(thumbnails = {}) {
  return ['maxres', 'standard', 'high', 'medium', 'default']
    .map((key) => thumbnails?.[key]?.url)
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 5);
}

function normalizeYouTubeApiPost(item = {}, job = {}) {
  const videoId = normalizeYouTubeVideoId(item.id?.videoId || item.id || '');
  if (!videoId) return null;
  const snippet = item.snippet || {};
  const title = cleanText(snippet.title || `YouTube property video ${videoId}`);
  const description = cleanText(snippet.description || '');
  const combinedText = cleanText(`${title} ${description}`);
  const area = extractArea(combinedText);
  const district = districtForArea(area, combinedText);
  const priceText = priceTextFromText(combinedText);
  const channelUrl = youtubeChannelUrl(snippet.channelId) || job.source_url || '';
  const sourceUrl = youtubeWatchUrl(videoId);
  const publishedAt = snippet.publishedAt || '';
  return {
    post_id: videoId,
    source_key: snippet.channelId || job.source_key || videoId,
    source_registry_key: job.source_key || '',
    source_name: cleanText(snippet.channelTitle || job.source_name || 'YouTube property source'),
    platform: 'YouTube',
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
    first_posted_at: publishedAt,
    published_at: publishedAt,
    platform_posted_at: publishedAt,
    youtube_published_at: publishedAt,
    youtube_source_published_at: publishedAt,
    area,
    district,
    location: area || district,
    price_text: priceText,
    listing_type: listingTypeFromText(combinedText),
    bedrooms: bedroomsFromText(combinedText),
    image_urls: youtubeThumbnailUrls(snippet.thumbnails),
    source_batch: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    source_urls: [job.source_url, channelUrl, sourceUrl].filter(Boolean),
    raw_source_post: {
      youtube_search_item: item,
      source_job: job,
      import_method: 'youtube_data_api_search',
      published_after: job.published_after || YOUTUBE_SOURCE_POST_WINDOW_START,
      includes_shorts_and_long_form: true,
    },
  };
}

async function fetchYouTubeSearchJob(job = {}, {
  apiKey = '',
  maxResults = DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
  fetchImpl = fetch,
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
  url.searchParams.set('maxResults', String(cappedNumber(maxResults, DEFAULT_YOUTUBE_RESULTS_PER_SOURCE, 1, 50)));
  url.searchParams.set('safeSearch', 'none');
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
  return {
    ok: true,
    result_count: rows.length,
    posts: rows.map((row) => normalizeYouTubeApiPost(row, job)).filter(Boolean),
    next_page_token: payload.nextPageToken || '',
    page_info: payload.pageInfo || {},
  };
}

async function fetchYouTubePostsForJobs(jobs = [], options = {}) {
  const posts = [];
  const reports = [];
  for (const job of jobs) {
    const report = await fetchYouTubeSearchJob(job, options);
    reports.push({
      ...job,
      ok: report.ok,
      skipped: report.skipped,
      status: report.status,
      reason: report.reason,
      error_reason: report.error_reason,
      result_count: report.result_count || 0,
      next_page_token: report.next_page_token || '',
    });
    posts.push(...(report.posts || []));
  }
  return { posts, reports };
}

function buildXQueryForSource(source = {}) {
  const url = sourceUrl(source);
  const existingQuery = urlParam(url, 'q');
  if (existingQuery) {
    const decoded = cleanText(existingQuery);
    return decoded.includes('has:media')
      ? `${decoded} -is:retweet`
      : `(${decoded}) has:media -is:retweet`;
  }
  const handle = sourceHandle(source);
  if (handle) {
    return `from:${handle} (${CORE_PROPERTY_QUERY}) has:media -is:retweet`;
  }
  const tags = Array.isArray(source.hashtags) ? source.hashtags.filter(Boolean).slice(0, 4).map((tag) => `#${String(tag).replace(/^#/, '')}`) : [];
  const sourceWords = cleanText(sourceName(source)).split(/\s+/).filter((word) => word.length > 3).slice(0, 4);
  const discoveryTerms = [...tags, ...sourceWords].join(' OR ') || CORE_PROPERTY_QUERY;
  return `(${discoveryTerms}) (${UGANDA_LOCATION_QUERY}) (${CORE_PROPERTY_QUERY}) has:media -is:retweet`;
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
      source_url: sourceUrl(source),
      query: buildXQueryForSource(source).slice(0, searchMode === 'recent' ? 1024 : 4096),
      endpoint,
      start_time: searchMode === 'recent' ? null : archiveStartTime,
      max_results: DEFAULT_X_RESULTS_PER_SOURCE,
    }));
}

function extractArea(text = '') {
  const haystack = cleanText(text);
  const orderedHints = [
    ...AREA_HINTS.filter((name) => !DISTRICTS.includes(name)),
    ...AREA_HINTS.filter((name) => DISTRICTS.includes(name)),
  ];
  const area = orderedHints.find((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack));
  return area || '';
}

function districtForArea(area = '', text = '') {
  const candidate = cleanText(area) || extractArea(text);
  const haystack = cleanText(`${candidate} ${text}`);
  const areaPin = areaPinFromText(haystack);
  if (areaPin?.district) return areaPin.district;
  if (DISTRICTS.includes(candidate)) return candidate;
  const district = DISTRICTS.find((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack));
  if (district) return district;
  if (/katosi|mpunge|mpungwe|mukono|ucu|goma|nakisunga/i.test(haystack)) return 'Mukono';
  if (/kira|naalya|najjera|namugongo|bwebajja|kajansi|kitende|akright|wakiso|bujjuko|bujuuko|namayumba|kakiri|masulita|hoima road|kigo|kawuku|kisubi|nkumba|ndejje|lubugumu|kyaliwajjala|kireka|sonde|kungu|bulindo|gayaza|matugga|nansana|nabweru|buloba|kyengera|busega|mpererwe/i.test(haystack)) return 'Wakiso';
  if (/kampala|ntinda|bukoto|naguru|kololo|namanve|muyenga|makindye|kansanga|makerere|kyambogo|kikoni|nakawa|banda|ndeeba|kikuubo|industrial area|lugogo|nateete|kawempe|kyebando/i.test(haystack)) return 'Kampala';
  return 'Kampala';
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
  const raw = cleanText(text);
  const localPriceMatch = raw.match(/\b(?:bei|omuwendo|price|ugx|ush|shs?)?\s*\d+(?:\.\d+)?\s*(?:obukadde|akakadde|bukadde|emitwalo|mitwalo|laki|lakhs?)\b(?:\s*(?:negotiable|asking|only|za mwezi|per month|monthly))?/i);
  if (localPriceMatch) return cleanText(localPriceMatch[0]);
  const negotiableMatch = raw.match(/\b(?:UGX|USh|Shs?)?\s*\d[\d,.]*(?:\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands))\s*(?:negotiable|asking|only)\b/i);
  if (negotiableMatch) return cleanText(negotiableMatch[0]);
  const usdMatch = raw.match(/(?:\$|US\$|USD)\s*\d[\d,.]*(?:\/month| per month| monthly|\/mo)?/i);
  if (usdMatch) return cleanText(usdMatch[0]);
  const patterns = [
    /\b(?:UGX|USh|Shs?)\s*\d[\d,.]*(?:\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands))?(?:\/month| per month| monthly| kwa mwezi| za mwezi)?/i,
    /\b\d+(?:\.\d+)?\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands)\b(?:\/month| per month| monthly)?/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[0];
  }
  return '';
}

function normalizeUgandanPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^2567\d{8}$/.test(digits)) return `+${digits}`;
  if (/^07\d{8}$/.test(digits)) return `+256${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `+256${digits}`;
  return '';
}

function phoneFromText(text = '') {
  const candidates = cleanText(text).match(/(?:\+?256|0|7)\s*[\d\s().-]{7,14}\d/g) || [];
  for (const candidate of candidates) {
    const normalized = normalizeUgandanPhone(candidate);
    if (normalized) return normalized;
  }
  return '';
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
  for (const job of jobs) {
    const report = await fetchXSearchJob(job, options);
    reports.push({
      ...job,
      ok: report.ok,
      skipped: report.skipped,
      status: report.status,
      reason: report.reason,
      result_count: report.result_count || 0,
      error_count: Array.isArray(report.errors) ? report.errors.length : 0,
    });
    posts.push(...(report.posts || []));
  }
  return { posts, reports };
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

async function runSocialPlatformPostSweep({
  db,
  platform = 'all',
  focus = '',
  dryRun = true,
  maxSources = DEFAULT_MAX_SOURCES,
  sourceOffset = 0,
  maxResultsPerSource = DEFAULT_X_RESULTS_PER_SOURCE,
  searchMode = 'all',
  lookbackDays = 0,
  fetchX = true,
  fetchYouTube = true,
  youtubePublishedAfter = YOUTUBE_SOURCE_POST_WINDOW_START,
  publishedAfter = '',
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform || 'all');
  const normalizedFocus = cleanText(focus).toLowerCase();
  const studentHousingFocus = normalizedFocus === 'students'
    || normalizedFocus === 'student'
    || normalizedFocus === 'student_housing'
    || normalizedPlatform === 'student'
    || normalizedPlatform === 'students'
    || normalizedPlatform === 'student_housing';
  const requestedPlatforms = studentHousingFocus
    ? ['tiktok', 'youtube', 'x', 'facebook', 'instagram']
    : normalizedPlatform === 'all'
      ? ['tiktok', 'youtube', 'x']
      : [normalizedPlatform];
  const sourceLimit = cappedNumber(maxSources, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES);
  const normalizedSourceOffset = cappedOffset(sourceOffset);
  const tiktokSources = requestedPlatforms.includes('tiktok') ? sourcesForPlatform('tiktok') : [];
  const youtubeSources = requestedPlatforms.includes('youtube') ? sourcesForPlatform('youtube') : [];
  const xSources = requestedPlatforms.includes('x') ? sourcesForPlatform('x') : [];
  const facebookSources = requestedPlatforms.includes('facebook') ? sourcesForPlatform('facebook') : [];
  const instagramSources = requestedPlatforms.includes('instagram') ? sourcesForPlatform('instagram') : [];
  const archiveStartTime = isoStartTimeForLookbackDays(lookbackDays);
  const youtubeStartTime = cleanText(publishedAfter || youtubePublishedAfter) || YOUTUBE_SOURCE_POST_WINDOW_START;
  const tiktokCaptureTasks = requestedPlatforms.includes('tiktok')
    ? buildTikTokCaptureTasks({ sources: tiktokSources, limit: sourceLimit })
    : [];
  const youtubeSearchJobs = requestedPlatforms.includes('youtube')
    ? buildYouTubeSearchJobs({ sources: youtubeSources, limit: sourceLimit, offset: normalizedSourceOffset, publishedAfter: youtubeStartTime })
    : [];
  const xSearchJobs = requestedPlatforms.includes('x')
    ? buildXSearchJobs({ sources: xSources, limit: sourceLimit, searchMode, startTime: archiveStartTime })
    : [];
  const facebookCaptureTasks = requestedPlatforms.includes('facebook')
    ? buildManualSocialCaptureTasks({ sources: facebookSources, platform: 'facebook', limit: sourceLimit })
    : [];
  const instagramCaptureTasks = requestedPlatforms.includes('instagram')
    ? buildManualSocialCaptureTasks({ sources: instagramSources, platform: 'instagram', limit: sourceLimit })
    : [];
  const youtubeApi = envYouTubeApiKey(env);
  let youtubeFetch = {
    api_configured: Boolean(youtubeApi.apiKey),
    api_key_env: youtubeApi.name || '',
    published_after: youtubeStartTime,
    skipped_reason: youtubeApi.apiKey ? '' : 'Set YOUTUBE_API_KEY, GOOGLE_YOUTUBE_API_KEY, or GOOGLE_API_KEY to convert YouTube source feeds into exact video imports with snippet.publishedAt.',
    posts: [],
    reports: [],
  };
  if (requestedPlatforms.includes('youtube') && fetchYouTube && youtubeApi.apiKey && youtubeSearchJobs.length) {
    const fetched = await fetchYouTubePostsForJobs(youtubeSearchJobs, {
      apiKey: youtubeApi.apiKey,
      maxResults: maxResultsPerSource,
      fetchImpl,
    });
    youtubeFetch = {
      ...youtubeFetch,
      posts: uniquePosts(fetched.posts),
      reports: fetched.reports,
      skipped_reason: '',
    };
  }
  const bearer = envBearerToken(env);
  let xFetch = {
    api_configured: Boolean(bearer.token),
    token_env: bearer.name || '',
    search_mode: searchMode,
    lookback_days: Number(lookbackDays) || 0,
    archive_start_time: archiveStartTime || LAUNCH_SOURCE_POST_WINDOW_START,
    skipped_reason: bearer.token ? '' : 'Set X_BEARER_TOKEN, TWITTER_BEARER_TOKEN, or X_API_BEARER_TOKEN to convert X source feeds into exact post imports.',
    posts: [],
    reports: [],
  };
  if (requestedPlatforms.includes('x') && fetchX && bearer.token && xSearchJobs.length) {
    const fetched = await fetchXPostsForJobs(xSearchJobs, {
      bearerToken: bearer.token,
      maxResults: maxResultsPerSource,
      searchMode,
      fetchImpl,
    });
    xFetch = {
      ...xFetch,
      posts: uniquePosts(fetched.posts),
      reports: fetched.reports,
      skipped_reason: '',
    };
  }
  const discoveredPosts = uniquePosts([
    ...youtubeFetch.posts,
    ...xFetch.posts,
  ]);
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

  return {
    ok: true,
    batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
    import_batch_id: FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
    dry_run: dryRun,
    platforms: requestedPlatforms,
    focus: studentHousingFocus ? 'students' : normalizedFocus,
    policy: {
      tiktok: 'Hashtag/profile URLs are discovery tasks. Queue a property after the exact TikTok /@handle/video/id URL, location, source contact path, and source evidence are captured. Missing price becomes Price upon application. Location is non-negotiable before approval; other checks are King-review overrides.',
      youtube: 'YouTube source pages, hashtags, and search feeds are searched with the YouTube Data API from 1 January 2026 onward for both Shorts and long-form videos. Exact video URLs with snippet.publishedAt, title/description, channel contact path, location, and source evidence become Found Online review records. Missing price becomes Price upon application.',
      x: 'X/Twitter source lists become properties after X API/search returns exact post URLs with created_at, text, author/profile, media/source evidence, location, and contact path. Missing price becomes Price upon application. Location is non-negotiable before approval; other checks are King-review overrides.',
      student_housing_focus: 'Student housing sweeps prioritize campus, hostel, student accommodation, university, and student-room source signals and prepare manual Facebook/Instagram capture tasks when direct APIs are unavailable.',
      profile_creation_rule: 'The sweep does not automatically create or link public Makaug broker profiles from social discovery. Source owners must register or claim a Makaug broker profile before Makaug shows a public agent profile.',
    },
    tiktok: {
      source_count: tiktokSources.length,
      capture_task_count: tiktokCaptureTasks.length,
      exact_video_url_pattern: TIKTOK_EXACT_VIDEO_URL_PATTERN.source,
      capture_tasks: tiktokCaptureTasks,
    },
    youtube: {
      source_count: youtubeSources.length,
      source_offset: normalizedSourceOffset,
      search_job_count: youtubeSearchJobs.length,
      api_configured: youtubeFetch.api_configured,
      api_key_env: youtubeFetch.api_key_env,
      published_after: youtubeFetch.published_after,
      skipped_reason: youtubeFetch.skipped_reason,
      includes_shorts_and_long_form: true,
      search_jobs: youtubeSearchJobs,
      fetch_reports: youtubeFetch.reports,
      fetched_posts_count: youtubeFetch.posts.length,
    },
    x: {
      source_count: xSources.length,
      search_job_count: xSearchJobs.length,
      api_configured: xFetch.api_configured,
      token_env: xFetch.token_env,
      search_mode: searchMode,
      skipped_reason: xFetch.skipped_reason,
      search_jobs: xSearchJobs,
      fetch_reports: xFetch.reports,
      fetched_posts_count: xFetch.posts.length,
    },
    facebook: {
      source_count: facebookSources.length,
      capture_task_count: facebookCaptureTasks.length,
      capture_tasks: facebookCaptureTasks,
    },
    instagram: {
      source_count: instagramSources.length,
      capture_task_count: instagramCaptureTasks.length,
      capture_tasks: instagramCaptureTasks,
    },
    discovered_posts_count: discoveredPosts.length,
    discovered_posts: discoveredPosts.slice(0, 50),
    import_result: importResult,
  };
}

module.exports = {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  DEFAULT_MAX_SOURCES,
  MAX_PLATFORM_SWEEP_SOURCES,
  DEFAULT_X_RESULTS_PER_SOURCE,
  DEFAULT_YOUTUBE_RESULTS_PER_SOURCE,
  YOUTUBE_SEARCH_URL,
  YOUTUBE_OEMBED_URL,
  YOUTUBE_SOURCE_POST_WINDOW_START,
  YOUTUBE_API_KEY_ENV_NAMES,
  X_BEARER_ENV_NAMES,
  TIKTOK_OEMBED_URL,
  TIKTOK_EXACT_VIDEO_URL_PATTERN,
  extractExactSocialPostUrls,
  extractTikTokVideoUrls,
  buildExactSocialPostImportRows,
  buildTikTokCaptureTasks,
  buildManualSocialCaptureTasks,
  buildTikTokExactPostImportRows,
  buildYouTubeSearchJobs,
  buildXSearchJobs,
  importExactSocialSourcePosts,
  importTikTokExactVideoPosts,
  normalizeExactSocialPostUrl,
  normalizeYouTubeApiPost,
  normalizeXApiPost,
  runSocialPlatformPostSweep,
};
