'use strict';

const REJECTED_SOURCE_URL_BLOCK_YEARS = 10;

function safeObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function text(value = '') {
  return String(value || '').trim();
}

function compactArray(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function normalizeSourceUrlForBlocklist(value = '') {
  const raw = text(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    [
      'fbclid',
      'igsh',
      'si',
      'utm_campaign',
      'utm_content',
      'utm_medium',
      'utm_source',
      'utm_term'
    ].forEach((param) => parsed.searchParams.delete(param));
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch (_error) {
    return raw.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function rejectedListingSourceUrlCandidates(listing = {}) {
  const extra = safeObject(listing.extra_fields);
  return compactArray([
    listing.source_url,
    listing.sourceUrl,
    listing.source_post_url,
    listing.sourcePostUrl,
    listing.video_url,
    listing.youtube_url,
    listing.tiktok_url,
    extra.source_url,
    extra.sourceUrl,
    extra.source_post_url,
    extra.sourcePostUrl,
    extra.video_url,
    extra.youtube_url,
    extra.tiktok_url,
    extra.instagram_url,
    extra.facebook_url,
    extra.x_url,
    extra.twitter_url,
    ...(Array.isArray(extra.source_urls) ? extra.source_urls : []),
    ...(Array.isArray(extra.sourceUrls) ? extra.sourceUrls : [])
  ]);
}

function rejectedListingSourceKey(listing = {}) {
  const extra = safeObject(listing.extra_fields);
  return text(
    listing.source_listing_key
      || listing.sourceListingKey
      || extra.source_listing_key
      || extra.sourceListingKey
      || ''
  );
}

function rejectedListingSourceMetadata(listing = {}) {
  const extra = safeObject(listing.extra_fields);
  return {
    source: text(listing.source || ''),
    listed_via: text(listing.listed_via || ''),
    source_batch: text(extra.source_batch || ''),
    source_platform: text(extra.source_platform || ''),
    source_name: text(extra.source_name || ''),
    source_listing_key: rejectedListingSourceKey(listing)
  };
}

async function recordRejectedListingSourceUrls(client, {
  listing = {},
  reason = '',
  actorId = '',
  action = 'rejected',
  blockYears = REJECTED_SOURCE_URL_BLOCK_YEARS
} = {}) {
  const urls = rejectedListingSourceUrlCandidates(listing);
  if (!urls.length) return [];

  const metadata = rejectedListingSourceMetadata(listing);
  const rows = [];
  for (const sourceUrl of urls) {
    const normalized = normalizeSourceUrlForBlocklist(sourceUrl);
    if (!normalized) continue;
    const result = await client.query(
      `INSERT INTO rejected_property_source_urls (
         source_url,
         normalized_source_url,
         source_url_hash,
         source_listing_key,
         source_platform,
         rejected_property_id,
         rejected_inquiry_reference,
         rejection_reason,
         rejection_action,
         rejected_by,
         blocked_until,
         metadata,
         last_seen_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         md5($2),
         NULLIF($3, ''),
         NULLIF($4, ''),
         $5::uuid,
         NULLIF($6, ''),
         NULLIF($7, ''),
         $8,
         NULLIF($9, ''),
         NOW() + (($10::int || ' years')::interval),
         $11::jsonb,
         NOW(),
         NOW()
       )
       ON CONFLICT (normalized_source_url)
       DO UPDATE SET
         source_url = EXCLUDED.source_url,
         source_url_hash = EXCLUDED.source_url_hash,
         source_listing_key = COALESCE(EXCLUDED.source_listing_key, rejected_property_source_urls.source_listing_key),
         source_platform = COALESCE(EXCLUDED.source_platform, rejected_property_source_urls.source_platform),
         rejected_property_id = COALESCE(EXCLUDED.rejected_property_id, rejected_property_source_urls.rejected_property_id),
         rejected_inquiry_reference = COALESCE(EXCLUDED.rejected_inquiry_reference, rejected_property_source_urls.rejected_inquiry_reference),
         rejection_reason = COALESCE(EXCLUDED.rejection_reason, rejected_property_source_urls.rejection_reason),
         rejection_action = EXCLUDED.rejection_action,
         rejected_by = COALESCE(EXCLUDED.rejected_by, rejected_property_source_urls.rejected_by),
         blocked_until = GREATEST(rejected_property_source_urls.blocked_until, EXCLUDED.blocked_until),
         metadata = COALESCE(rejected_property_source_urls.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         last_seen_at = NOW(),
         updated_at = NOW()
       RETURNING id::text AS id, source_url, normalized_source_url, source_listing_key, blocked_until`,
      [
        sourceUrl,
        normalized,
        metadata.source_listing_key,
        metadata.source_platform,
        listing.id || null,
        listing.inquiry_reference || '',
        reason || '',
        action,
        actorId || '',
        Number(blockYears) || REJECTED_SOURCE_URL_BLOCK_YEARS,
        JSON.stringify(metadata)
      ]
    );
    rows.push(result.rows[0]);
  }
  return rows;
}

async function findRejectedListingSourceUrlBlocks(client, urls = []) {
  const normalizedUrls = compactArray(urls.map(normalizeSourceUrlForBlocklist));
  if (!normalizedUrls.length) return new Map();

  const tableExists = await client.query("SELECT to_regclass('public.rejected_property_source_urls') AS name");
  if (!tableExists.rows[0]?.name) return new Map();

  const result = await client.query(
    `SELECT id::text AS id, source_url, normalized_source_url, source_listing_key, source_platform, rejection_reason, blocked_until
     FROM rejected_property_source_urls
     WHERE normalized_source_url = ANY($1::text[])
       AND status = 'blocked'
       AND blocked_until > NOW()`,
    [normalizedUrls]
  );
  const blocks = new Map();
  for (const row of result.rows) {
    blocks.set(row.normalized_source_url, row);
  }
  return blocks;
}

module.exports = {
  REJECTED_SOURCE_URL_BLOCK_YEARS,
  normalizeSourceUrlForBlocklist,
  rejectedListingSourceUrlCandidates,
  recordRejectedListingSourceUrls,
  findRejectedListingSourceUrlBlocks
};
