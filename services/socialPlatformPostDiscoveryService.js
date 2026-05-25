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
const TIKTOK_OEMBED_URL = 'https://www.tiktok.com/oembed';
const TIKTOK_EXACT_VIDEO_URL_PATTERN = /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i;
const TIKTOK_EXACT_VIDEO_URL_GLOBAL_PATTERN = /https?:\/\/(?:www\.)?tiktok\.com\/@[^/\s?#]+\/video\/\d+(?:[^\s]*)?/ig;

const CORE_PROPERTY_QUERY = [
  'property', 'house', 'home', 'apartment', 'land', 'plot', 'rent', 'rental',
  '"for sale"', '"to let"', 'hostel', '"student accommodation"', 'commercial', 'warehouse',
].join(' OR ');

const UGANDA_LOCATION_QUERY = [
  'Uganda', 'Kampala', 'Wakiso', 'Mukono', 'Entebbe', 'Jinja', 'Kira', 'Ntinda',
  'Naalya', 'Muyenga', 'Namugongo', 'Najjera', 'Makerere', 'Kyambogo',
].join(' OR ');

const AREA_HINTS = [
  'Kampala', 'Wakiso', 'Mukono', 'Entebbe', 'Jinja', 'Kira', 'Ntinda', 'Naalya',
  'Najjera', 'Namugongo', 'Muyenga', 'Bweyogerere', 'Bwebajja', 'Kyanja',
  'Komamboga', 'Kiwatule', 'Bukoto', 'Naguru', 'Kololo', 'Nakasero', 'Luzira',
  'Lubowa', 'Seguku', 'Kitende', 'Kajansi', 'Akright', 'Garuga', 'Kiwafu',
  'Munyonyo', 'Makindye', 'Kansanga', 'Mengo', 'Makerere', 'Kyambogo', 'MUBS',
  'Namanve', 'Katosi', 'Mpunge', 'Mpungwe', 'Lake Victoria', 'Luweero', 'Masaka',
  'Mbarara', 'Mbale', 'Gulu', 'Arua',
];

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function cappedNumber(value, fallback, min = 1, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
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
  const tagMatch = url.match(/tiktok\.com\/tag\/([^/?#]+)/i);
  if (tagMatch) return decodeURIComponent(tagMatch[1]);
  return cleanText(tags[0] || '').replace(/^#/, '');
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
    if (!extractTikTokVideoUrls(line).length) freeText.push(line);
  }
  if (freeText.length && !fields.caption && !fields.description) {
    fields.caption = freeText.join(' ');
  }
  return fields;
}

function normalizeParsedTikTokFields(fields = {}) {
  return {
    title: fields.title || fields.property || fields.listing || '',
    caption: fields.caption || fields.description || fields.notes || '',
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
    pre_approved: fields.pre_approved || fields.preapproved || fields.agent_preapproved || '',
    consent_confirmed: fields.consent_confirmed || fields.agent_authorised || fields.agent_authorized || '',
    image_rights_confirmed: fields.image_rights_confirmed || fields.authorised_images || fields.authorized_images || '',
    permission_status: fields.permission_status || '',
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

function normalizeTikTokOEmbed(payload = {}) {
  return {
    title: cleanText(payload.title || ''),
    author_name: cleanText(payload.author_name || ''),
    author_url: cleanText(payload.author_url || ''),
    thumbnail_url: cleanText(payload.thumbnail_url || ''),
    provider_name: cleanText(payload.provider_name || 'TikTok'),
  };
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
      const caption = cleanText(seed.caption || seed.description || oembed.title || seed.title || '');
      const title = cleanText(seed.title || oembed.title || caption || `TikTok property post ${index + 1}`);
      const combinedText = cleanText(`${title} ${caption}`);
      const area = cleanText(seed.area || seed.location || extractArea(combinedText));
      const district = cleanText(seed.district || districtForArea(area, combinedText));
      const priceText = cleanText(seed.price_text || seed.price || priceTextFromText(combinedText));
      const contactPhone = cleanText(seed.contact_phone || seed.phone || seed.whatsapp || phoneFromText(combinedText));
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
        description: caption || title,
        area,
        district,
        location: area || district,
        price_text: priceText,
        listing_type: seed.listing_type || listingTypeFromText(combinedText),
        bedrooms: seed.bedrooms || bedroomsFromText(combinedText),
        bathrooms: seed.bathrooms || '',
        first_posted_at: seed.first_posted_at || seed.posted_at || seed.published_at || seed.source_published_at || '',
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
    createProfilesForRepeatedSourcesOnly: true,
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
          'owner/agent pre-approval and image-rights confirmation are captured',
          'caption/overlay gives property title or description',
          'location or area is visible',
          'price or guide price is visible',
          'public source/profile/contact route is available',
          'screenshot/still/thumbnail evidence is captured or a labelled evidence card is used',
        ],
        next_action: `Open ${sourceUrl(source) || query}, collect every 2026+ property video URL, then import with inventory:import-source-posts.`,
      };
    });
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

function buildXSearchJobs({ sources = sourcesForPlatform('x'), limit = DEFAULT_MAX_SOURCES, searchMode = 'all' } = {}) {
  const endpoint = searchMode === 'recent' ? X_RECENT_SEARCH_URL : X_FULL_ARCHIVE_SEARCH_URL;
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
      start_time: searchMode === 'recent' ? null : LAUNCH_SOURCE_POST_WINDOW_START,
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
  if (DISTRICTS.includes(candidate)) return candidate;
  const haystack = cleanText(`${candidate} ${text}`);
  const district = DISTRICTS.find((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack));
  if (district) return district;
  if (/katosi|mpunge|mpungwe|mukono/i.test(haystack)) return 'Mukono';
  if (/kira|naalya|najjera|namugongo|bwebajja|kajansi|kitende|akright|wakiso/i.test(haystack)) return 'Wakiso';
  if (/kampala|ntinda|bukoto|naguru|kololo|namanve|muyenga|makindye|kansanga|makerere|kyambogo/i.test(haystack)) return 'Kampala';
  return 'Kampala';
}

function listingTypeFromText(text = '') {
  const raw = cleanText(text).toLowerCase();
  if (/\b(hostel|student|campus|makerere|kyambogo|mubs|ucu)\b/.test(raw)) return 'students';
  if (/\b(commercial|office|shop|retail|warehouse|factory|showroom|arcade)\b/.test(raw)) return 'commercial';
  if (/\b(land|plot|acre|acres|decimal|decimals|mailo)\b/.test(raw)) return 'land';
  if (/\b(rent|rental|to let|month|monthly)\b/.test(raw)) return 'rent';
  return 'sale';
}

function priceTextFromText(text = '') {
  const raw = cleanText(text);
  const negotiableMatch = raw.match(/\b(?:UGX|USh|Shs?)?\s*\d[\d,.]*(?:\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands))\s*(?:negotiable|asking|only)\b/i);
  if (negotiableMatch) return cleanText(negotiableMatch[0]);
  const patterns = [
    /\b(?:UGX|USh|Shs?)\s*\d[\d,.]*(?:\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands))?(?:\/month| per month| monthly)?/i,
    /\b\d+(?:\.\d+)?\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands)\b(?:\/month| per month| monthly)?/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[0];
  }
  return '';
}

function phoneFromText(text = '') {
  const match = cleanText(text).match(/(?:\+?256|0)\s*[\d\s().-]{7,14}\d/);
  return match ? match[0].replace(/[^\d+]/g, '') : '';
}

function emailFromText(text = '') {
  const match = cleanText(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function bedroomsFromText(text = '') {
  const match = cleanText(text).match(/\b(\d{1,2})\s*(?:bed|bedroom|bdrm|br)\b/i);
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
  if (searchMode !== 'recent') url.searchParams.set('start_time', LAUNCH_SOURCE_POST_WINDOW_START);
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
  dryRun = true,
  maxSources = DEFAULT_MAX_SOURCES,
  maxResultsPerSource = DEFAULT_X_RESULTS_PER_SOURCE,
  searchMode = 'all',
  fetchX = true,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform || 'all');
  const requestedPlatforms = normalizedPlatform === 'all' ? ['tiktok', 'x'] : [normalizedPlatform];
  const sourceLimit = cappedNumber(maxSources, DEFAULT_MAX_SOURCES, 1, MAX_PLATFORM_SWEEP_SOURCES);
  const tiktokSources = requestedPlatforms.includes('tiktok') ? sourcesForPlatform('tiktok') : [];
  const xSources = requestedPlatforms.includes('x') ? sourcesForPlatform('x') : [];
  const tiktokCaptureTasks = requestedPlatforms.includes('tiktok')
    ? buildTikTokCaptureTasks({ sources: tiktokSources, limit: sourceLimit })
    : [];
  const xSearchJobs = requestedPlatforms.includes('x')
    ? buildXSearchJobs({ sources: xSources, limit: sourceLimit, searchMode })
    : [];
  const bearer = envBearerToken(env);
  let xFetch = {
    api_configured: Boolean(bearer.token),
    token_env: bearer.name || '',
    search_mode: searchMode,
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
    ...xFetch.posts,
  ]);
  const importResult = discoveredPosts.length
    ? await queueFoundOnlineSourcePostListings({
      db,
      posts: discoveredPosts,
      dryRun,
      createProfilesForRepeatedSourcesOnly: true,
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
    policy: {
      tiktok: 'Hashtag/profile URLs are discovery tasks. Queue a property only after the exact TikTok /@handle/video/id URL, price, location, source contact path, pre-approval, and source-image rights evidence are captured.',
      x: 'X/Twitter source lists become properties only after X API/search returns exact post URLs with created_at, text, author/profile, media/source evidence, price, location, contact path, and pre-approval.',
      profile_creation_rule: 'The sweep creates or links a profile only when a source contributes multiple eligible properties; one-off posts remain found-online listings without creating a new profile.',
    },
    tiktok: {
      source_count: tiktokSources.length,
      capture_task_count: tiktokCaptureTasks.length,
      exact_video_url_pattern: TIKTOK_EXACT_VIDEO_URL_PATTERN.source,
      capture_tasks: tiktokCaptureTasks,
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
  X_BEARER_ENV_NAMES,
  TIKTOK_OEMBED_URL,
  TIKTOK_EXACT_VIDEO_URL_PATTERN,
  extractTikTokVideoUrls,
  buildTikTokCaptureTasks,
  buildTikTokExactPostImportRows,
  buildXSearchJobs,
  importTikTokExactVideoPosts,
  normalizeXApiPost,
  runSocialPlatformPostSweep,
};
