'use strict';

// Free public hashtag sources for the Students and Short stay sections.
// No paid APIs, no phone numbers, and found-online rows are never messaged.
// Lookback is two months (62 days), applied only to these sources.

const { deriveListingClassification } = require('../utils/listingDataIntegrity');

const FREE_CATEGORY_LOOKBACK_DAYS = 62;
const FREE_CATEGORY_BATCH = 'free_category_hashtags_20261110';
const FOUND_ONLINE_LABEL = 'Found online';
const FREE_CATEGORY_PLATFORMS = Object.freeze(['tiktok', 'instagram', 'facebook', 'youtube']);

const STUDENT_HOSTEL_HASHTAGS = Object.freeze([
  { tag: 'makererehostels', districts: ['Kampala'] },
  { tag: 'kikonihostels', districts: ['Kampala'] },
  { tag: 'wandegeyahostels', districts: ['Kampala'] },
  { tag: 'kyambogohostels', districts: ['Kampala'] },
  { tag: 'mukonohostels', districts: ['Mukono'] },
  { tag: 'studenthostelkampala', districts: ['Kampala'] },
]);

const SHORT_STAY_HASHTAGS = Object.freeze([
  { tag: 'airbnbkampala', districts: ['Kampala'] },
  { tag: 'kampalaairbnb', districts: ['Kampala'] },
  { tag: 'shortstayuganda', districts: ['Kampala', 'Wakiso', 'Entebbe', 'Jinja'] },
  { tag: 'entebbeairbnb', districts: ['Wakiso'] },
  { tag: 'jinjaairbnb', districts: ['Jinja'] },
]);

const NIGHTLY_TEXT = /\b(?:per\s+night|nightly|a\s+night|per\s+day|daily\s+rate)\b|\/\s*night\b/i;
const LONG_STAY_TEXT = /\b(?:per\s+month|a\s+month|monthly|per\s+semester|per\s+week|per\s+year)\b|\/\s*month\b/i;

function publicHashtagUrl(platform, tag) {
  if (platform === 'tiktok') return `https://www.tiktok.com/tag/${tag}`;
  if (platform === 'instagram') return `https://www.instagram.com/explore/tags/${tag}/`;
  if (platform === 'facebook') return `https://www.facebook.com/hashtag/${tag}`;
  if (platform === 'youtube') return `https://www.youtube.com/hashtag/${tag}`;
  return '';
}

function hashtagDescriptor(entry, destination) {
  return FREE_CATEGORY_PLATFORMS.map((platform) => ({
    key: `${platform}-hashtag-${entry.tag}`,
    name: `${platform[0].toUpperCase()}${platform.slice(1)} hashtag: #${entry.tag}`,
    platform,
    sourceType: 'hashtag_feed',
    url: publicHashtagUrl(platform, entry.tag),
    handle: `#${entry.tag}`,
    districts: entry.districts,
    listingTypes: destination === 'short_stay' ? ['short_stay'] : ['student'],
    hashtags: [entry.tag],
    destination,
    lookbackDays: FREE_CATEGORY_LOOKBACK_DAYS,
    tag: entry.tag,
  }));
}

function freeCategoryHashtagDescriptors() {
  return [
    ...STUDENT_HOSTEL_HASHTAGS.flatMap((entry) => hashtagDescriptor(entry, 'student')),
    ...SHORT_STAY_HASHTAGS.flatMap((entry) => hashtagDescriptor(entry, 'short_stay')),
  ];
}

const DESCRIPTOR_BY_KEY = new Map(freeCategoryHashtagDescriptors().map((item) => [item.key, item]));
const STUDENT_TAG_SET = new Set(STUDENT_HOSTEL_HASHTAGS.map((entry) => entry.tag));
const SHORT_STAY_TAG_SET = new Set(SHORT_STAY_HASHTAGS.map((entry) => entry.tag));

function compact(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function evidenceText(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' ? record.extra_fields : {};
  const tags = []
    .concat(record.hashtags || [])
    .concat(extra.hashtags || [])
    .concat(record.source_hashtags || []);
  return [
    record.title,
    record.sourceTitle,
    record.source_title,
    record.description,
    record.caption,
    record.sourceText,
    record.source_text,
    record.source_caption,
    extra.source_title,
    extra.source_caption,
    extra.source_text,
    record.source_key,
    record.sourceKey,
    record.source_registry_key,
    record.agentKey,
    tags.join(' '),
  ].map(compact).filter(Boolean).join(' ');
}

function normalizedTags(record = {}) {
  const text = evidenceText(record).toLowerCase().replace(/[#_\s-]+/g, '');
  const hits = { student: false, shortStay: false, tags: [] };
  for (const tag of STUDENT_TAG_SET) {
    if (text.includes(tag)) {
      hits.student = true;
      hits.tags.push(tag);
    }
  }
  for (const tag of SHORT_STAY_TAG_SET) {
    if (text.includes(tag)) {
      hits.shortStay = true;
      hits.tags.push(tag);
    }
  }
  return hits;
}

function matchedFreeSource(record = {}) {
  const keys = [
    record.source_key,
    record.sourceKey,
    record.source_registry_key,
    record.agentKey,
    record.key,
  ].map(compact).filter(Boolean);
  for (const key of keys) {
    if (DESCRIPTOR_BY_KEY.has(key)) return DESCRIPTOR_BY_KEY.get(key);
    for (const [descriptorKey, descriptor] of DESCRIPTOR_BY_KEY) {
      if (key.startsWith(`${descriptorKey}:`)) return descriptor;
    }
  }
  return null;
}

function canonicalStudentListingType(value = '') {
  const type = compact(value).toLowerCase();
  return type === 'students' ? 'student' : type;
}

function hasLongStayPrice(record = {}) {
  const period = compact(record.price_period || record.pricePeriod).toLowerCase();
  const longPeriod = ['month', 'monthly', 'week', 'weekly', 'year', 'yearly', 'semester', 'sem'].includes(period);
  return longPeriod && Number(record.price) > 0 && !NIGHTLY_TEXT.test(evidenceText(record));
}

function isShortStayImport(record = {}) {
  const source = matchedFreeSource(record);
  const tags = normalizedTags(record);
  const classification = deriveListingClassification({
    ...record,
    listing_type: canonicalStudentListingType(record.listing_type || record.listingType || record.category),
    title: record.title || record.sourceTitle || record.source_title,
    description: [record.description, record.caption, record.sourceText, record.source_text].filter(Boolean).join(' '),
    source_text: evidenceText(record),
  });
  if (classification.hospitality) return true;
  if (hasLongStayPrice(record) && !NIGHTLY_TEXT.test(evidenceText(record))) return false;
  if (source?.destination === 'short_stay' || tags.shortStay) return true;
  if (canonicalStudentListingType(record.listing_type || record.listingType) === 'short_stay') return true;
  return false;
}

function classifyFreeCategoryImport(record = {}) {
  const source = matchedFreeSource(record);
  const tags = normalizedTags(record);
  const shortStay = isShortStayImport(record);
  const studentSource = source?.destination === 'student' || tags.student;
  const storedType = canonicalStudentListingType(record.listing_type || record.listingType);
  const listingType = shortStay
    ? 'short_stay'
    : (studentSource || storedType === 'student' ? 'student' : (storedType || ''));
  return {
    destination: shortStay ? 'st_listing' : 'properties',
    listing_type: listingType === 'short_stay' ? 'short_stay' : (listingType === 'student' ? 'student' : ''),
    lookback_days: source ? FREE_CATEGORY_LOOKBACK_DAYS : 0,
    free_source: Boolean(source),
    found_online_label: FOUND_ONLINE_LABEL,
    do_not_message: true,
    matched_tags: tags.tags,
    source_key: source?.key || '',
  };
}

function sourceLookbackStartIso(source = {}, fallbackIso = '') {
  const days = Number(source?.metadata?.lookback_days || source?.lookbackDays || source?.lookback_days || 0);
  if (!Number.isFinite(days) || days <= 0) return fallbackIso || '';
  const iso = new Date(Date.now() - Math.round(days) * 86400000).toISOString();
  if (!fallbackIso) return iso;
  return iso > fallbackIso ? iso : fallbackIso;
}

function outsideFreeSourceLookback(record = {}, now = Date.now()) {
  const route = record.free_category_route || classifyFreeCategoryImport(record);
  const days = Number(record.source_lookback_days || route.lookback_days || 0);
  if (!days) return false;
  const rawDate = record.sourcePublishedAt || record.source_published_at || record.first_posted_at || record.published_at || '';
  const date = rawDate ? new Date(rawDate) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date.getTime() < now - days * 86400000;
}

module.exports = {
  FOUND_ONLINE_LABEL,
  FREE_CATEGORY_BATCH,
  FREE_CATEGORY_LOOKBACK_DAYS,
  FREE_CATEGORY_PLATFORMS,
  SHORT_STAY_HASHTAGS,
  STUDENT_HOSTEL_HASHTAGS,
  canonicalStudentListingType,
  classifyFreeCategoryImport,
  freeCategoryHashtagDescriptors,
  isShortStayImport,
  matchedFreeSource,
  outsideFreeSourceLookback,
  publicHashtagUrl,
  sourceLookbackStartIso,
};
