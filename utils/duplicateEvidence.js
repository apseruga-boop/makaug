'use strict';

// Duplicate listings need strong evidence (C10, 10 Oct 2026, Fisher).
//
// "Possible duplicate listing found on makaug" flagged any listing with the same
// lister phone, the same title, the same source URL or the same area + price.
// Live, 17 phone groups covered 80 of the 160 pending listings (one agent's 13
// different listings), and template titles ("Property for sale in Kira")
// matched unrelated listings. A duplicate now needs one of:
//   - the same source post (same URL, or the same TikTok/YouTube/Facebook/
//     Instagram/X post id)                         -> "same TikTok post"
//   - the same photo (image URL hash)              -> "same photo"
//   - the same lister phone AND the same area AND the same listing type AND
//     the same bedrooms AND a price within ±5%     -> "same agent, same area and price"
// Same phone or same title on their own never count. Rejected, deleted and
// archived rows are never "possible duplicates". One helper for staff, admin
// and the properties automated review.

const EXCLUDED_DUPLICATE_STATUSES = ['deleted', 'rejected', 'declined', 'fraud', 'archived', 'removed', 'test_pending_review'];
const PRICE_TOLERANCE = 0.05;

function clean(value) {
  return String(value ?? '').trim();
}

function digits(value) {
  return clean(value).replace(/\D/g, '');
}

// Uganda numbers compare on the last 9 digits (0772…, +256772…, 256772…).
function phoneKey(value) {
  const d = digits(value);
  return d.length >= 9 ? d.slice(-9) : '';
}

function sourceUrlOf(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return clean(row.source_url || extra.source_url || extra.source_post_url || extra.tiktok_url || extra.youtube_url || extra.video_url);
}

// { key, label } for a source post: the platform post id when the URL has one,
// otherwise the URL without query string, fragment or trailing slash.
function sourcePostKey(url = '') {
  const raw = clean(url);
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const patterns = [
    [/tiktok\.com\/.*\/(?:video|photo)\/(\d{8,})/i, 'tiktok', 'same TikTok post'],
    [/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i, 'youtube', 'same YouTube video'],
    [/facebook\.com\/.*(?:posts|videos|reel|permalink)\/?(?:\?story_fbid=)?([\w.-]{6,})/i, 'facebook', 'same Facebook post'],
    [/instagram\.com\/(?:p|reel|tv)\/([\w-]{5,})/i, 'instagram', 'same Instagram post'],
    [/(?:twitter|x)\.com\/[^/]+\/status\/(\d{8,})/i, 'x', 'same X post']
  ];
  for (const [pattern, platform, label] of patterns) {
    const match = raw.match(pattern);
    if (match) return { key: `${platform}:${match[1]}`, label, platform };
  }
  const normalized = lower.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.|m\.)?/, '');
  return normalized ? { key: `url:${normalized}`, label: 'same source link', platform: 'url' } : null;
}

function bedroomsKey(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(Math.round(number)) : '';
}

function pricesWithin(a, b, tolerance = PRICE_TOLERANCE) {
  const left = Number(a);
  const right = Number(b);
  if (!(left > 0) || !(right > 0)) return false;
  return Math.abs(left - right) / Math.max(left, right) <= tolerance;
}

function isExcludedStatus(row = {}) {
  return EXCLUDED_DUPLICATE_STATUSES.includes(clean(row.status).toLowerCase())
    || EXCLUDED_DUPLICATE_STATUSES.includes(clean(row.moderation_stage).toLowerCase());
}

// The strong-evidence reason two listings are duplicates, or null.
function duplicateReason(listing = {}, candidate = {}) {
  if (!candidate || String(candidate.id) === String(listing.id) || isExcludedStatus(candidate)) return null;
  const listingPost = sourcePostKey(sourceUrlOf(listing));
  const candidatePost = sourcePostKey(sourceUrlOf(candidate));
  if (listingPost && candidatePost && listingPost.key === candidatePost.key) {
    return { code: 'same_source_post', label: listingPost.label };
  }
  if (candidate.same_photo === true || candidate.duplicate_evidence === 'same_photo') {
    return { code: 'same_photo', label: 'same photo' };
  }
  const listingPhone = phoneKey(listing.lister_phone);
  if (
    listingPhone
    && listingPhone === phoneKey(candidate.lister_phone)
    && clean(listing.area).toLowerCase()
    && clean(listing.area).toLowerCase() === clean(candidate.area).toLowerCase()
    && clean(listing.listing_type).toLowerCase() === clean(candidate.listing_type).toLowerCase()
    && bedroomsKey(listing.bedrooms) === bedroomsKey(candidate.bedrooms)
    && pricesWithin(listing.price, candidate.price)
  ) {
    return { code: 'same_agent_area_price', label: 'same agent, same area and price' };
  }
  return null;
}

// Rows that share at least one strong signal with the listing; classified in JS.
const DUPLICATE_CANDIDATES_SQL = `
  SELECT p.id, p.title, p.listing_type, p.district, p.area, p.address, p.price, p.bedrooms,
         p.status, p.moderation_stage, p.lister_phone, p.inquiry_reference, p.created_at,
         COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') AS source_url
    FROM properties p
   WHERE p.id <> $1
     AND LOWER(COALESCE(p.status, '')) <> ALL($2::text[])
     AND LOWER(COALESCE(p.moderation_stage, '')) <> ALL($2::text[])
     -- Hidden source-quality rows (stored flag only, no regex scans).
     AND NOT (
       LOWER(COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
       OR LOWER(COALESCE(p.extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
     )
     AND (
       (COALESCE($3::text, '') <> '' AND COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') ILIKE '%' || $3 || '%')
       OR (
         COALESCE($4::text, '') <> ''
         AND RIGHT(regexp_replace(COALESCE(p.lister_phone, ''), '\\D', '', 'g'), 9) = $4
         AND LOWER(COALESCE(p.area, '')) = LOWER(COALESCE($5::text, ''))
       )
     )
   ORDER BY p.created_at DESC
   LIMIT 40`;

// The search term for the source post: its id when it has one, else the URL.
function sourceSearchTerm(url = '') {
  const post = sourcePostKey(url);
  if (!post) return '';
  return post.platform === 'url' ? post.key.slice(4) : post.key.split(':')[1];
}

function duplicateCandidateParams(listing = {}) {
  return [
    listing.id,
    EXCLUDED_DUPLICATE_STATUSES,
    sourceSearchTerm(sourceUrlOf(listing)),
    phoneKey(listing.lister_phone),
    clean(listing.area)
  ];
}

/**
 * Likely duplicates with their reason. `query(sql, params)` returns rows;
 * `reusedImages` are rows ({ id, title, status, url }) that share a photo.
 */
async function findLikelyDuplicates(query, listing = {}, { reusedImages = [] } = {}) {
  const candidates = await query(DUPLICATE_CANDIDATES_SQL, duplicateCandidateParams(listing));
  return classifyDuplicates(listing, candidates, reusedImages);
}

function classifyDuplicates(listing = {}, candidates = [], reusedImages = []) {
  const byId = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const reason = duplicateReason(listing, candidate);
    if (reason && !byId.has(String(candidate.id))) byId.set(String(candidate.id), { ...candidate, duplicate_reason: reason.label, duplicate_reason_code: reason.code });
  }
  for (const image of Array.isArray(reusedImages) ? reusedImages : []) {
    if (!image || String(image.id) === String(listing.id) || isExcludedStatus(image) || byId.has(String(image.id))) continue;
    byId.set(String(image.id), { ...image, duplicate_reason: 'same photo', duplicate_reason_code: 'same_photo' });
  }
  return [...byId.values()];
}

// Dashboard count: groups of pending listings with strong evidence.
function duplicateGroupsCountSql(pendingWhere) {
  return `WITH pending AS (
       SELECT p.id, p.listing_type, LOWER(COALESCE(p.area, '')) AS area_key, COALESCE(p.bedrooms, 0) AS bedrooms, p.price,
              NULLIF(RIGHT(regexp_replace(COALESCE(p.lister_phone, ''), '\\D', '', 'g'), 9), '') AS phone_key,
              NULLIF(LOWER(regexp_replace(COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', ''), '[?#].*$', '')), '') AS source_key
         FROM properties p
        WHERE ${pendingWhere}
     ),
     source_groups AS (
       SELECT source_key FROM pending WHERE source_key IS NOT NULL GROUP BY source_key HAVING COUNT(*) > 1
     ),
     agent_groups AS (
       SELECT DISTINCT a.phone_key, a.area_key, a.listing_type, a.bedrooms
         FROM pending a
         JOIN pending b ON b.id > a.id
          AND b.phone_key = a.phone_key AND b.area_key = a.area_key AND a.area_key <> ''
          AND b.listing_type = a.listing_type AND b.bedrooms = a.bedrooms
          AND a.price > 0 AND b.price > 0
          AND ABS(a.price - b.price)::numeric / GREATEST(a.price, b.price) <= ${PRICE_TOLERANCE}
        WHERE a.phone_key IS NOT NULL
     ),
     photo_groups AS (
       SELECT md5(i.url) AS url_hash
         FROM property_images i
         JOIN pending p ON p.id = i.property_id
        GROUP BY md5(i.url)
       HAVING COUNT(DISTINCT i.property_id) > 1
     )
     SELECT ((SELECT COUNT(*) FROM source_groups) + (SELECT COUNT(*) FROM agent_groups) + (SELECT COUNT(*) FROM photo_groups))::int AS possible_duplicates,
            (SELECT COUNT(*) FROM source_groups)::int AS same_source_groups,
            (SELECT COUNT(*) FROM agent_groups)::int AS same_agent_area_price_groups,
            (SELECT COUNT(*) FROM photo_groups)::int AS same_photo_groups`;
}

module.exports = {
  EXCLUDED_DUPLICATE_STATUSES,
  DUPLICATE_CANDIDATES_SQL,
  classifyDuplicates,
  duplicateCandidateParams,
  duplicateGroupsCountSql,
  duplicateReason,
  findLikelyDuplicates,
  phoneKey,
  pricesWithin,
  sourcePostKey
};
