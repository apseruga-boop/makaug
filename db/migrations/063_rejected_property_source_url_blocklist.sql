CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rejected_property_source_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  normalized_source_url TEXT NOT NULL UNIQUE,
  source_url_hash TEXT NOT NULL,
  source_listing_key TEXT,
  source_platform TEXT,
  rejected_property_id UUID,
  rejected_inquiry_reference TEXT,
  rejection_reason TEXT,
  rejection_action TEXT NOT NULL DEFAULT 'rejected',
  rejected_by TEXT,
  status TEXT NOT NULL DEFAULT 'blocked',
  blocked_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 years'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rejected_property_source_urls_status_check
    CHECK (status IN ('blocked', 'released'))
);

CREATE INDEX IF NOT EXISTS idx_rejected_property_source_urls_hash
  ON rejected_property_source_urls (source_url_hash);

CREATE INDEX IF NOT EXISTS idx_rejected_property_source_urls_key
  ON rejected_property_source_urls (source_listing_key)
  WHERE source_listing_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rejected_property_source_urls_blocked_until
  ON rejected_property_source_urls (blocked_until DESC)
  WHERE status = 'blocked';

CREATE INDEX IF NOT EXISTS idx_rejected_property_source_urls_platform
  ON rejected_property_source_urls (source_platform, status);

WITH rejected_properties AS (
  SELECT
    p.id,
    p.inquiry_reference,
    p.status,
    p.moderation_reason,
    p.extra_fields,
    COALESCE(p.extra_fields->>'source_listing_key', '') AS source_listing_key,
    COALESCE(p.extra_fields->>'source_platform', '') AS source_platform
  FROM properties p
  WHERE LOWER(COALESCE(p.status, '')) IN ('rejected', 'deleted')
),
source_urls AS (
  SELECT id, inquiry_reference, status, moderation_reason, extra_fields, source_listing_key, source_platform, NULLIF(extra_fields->>'source_url', '') AS source_url
  FROM rejected_properties
  UNION ALL
  SELECT id, inquiry_reference, status, moderation_reason, extra_fields, source_listing_key, source_platform, NULLIF(extra_fields->>'source_post_url', '') AS source_url
  FROM rejected_properties
  UNION ALL
  SELECT id, inquiry_reference, status, moderation_reason, extra_fields, source_listing_key, source_platform, NULLIF(extra_fields->>'video_url', '') AS source_url
  FROM rejected_properties
  UNION ALL
  SELECT id, inquiry_reference, status, moderation_reason, extra_fields, source_listing_key, source_platform, NULLIF(extra_fields->>'youtube_url', '') AS source_url
  FROM rejected_properties
  UNION ALL
  SELECT id, inquiry_reference, status, moderation_reason, extra_fields, source_listing_key, source_platform, NULLIF(extra_fields->>'tiktok_url', '') AS source_url
  FROM rejected_properties
  UNION ALL
  SELECT
    p.id,
    p.inquiry_reference,
    p.status,
    p.moderation_reason,
    p.extra_fields,
    p.source_listing_key,
    p.source_platform,
    NULLIF(source_url.value, '') AS source_url
  FROM rejected_properties p
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p.extra_fields->'source_urls') = 'array' THEN p.extra_fields->'source_urls'
      ELSE '[]'::jsonb
    END
  ) AS source_url(value)
),
normalized_source_urls AS (
  SELECT DISTINCT ON (LOWER(REGEXP_REPLACE(REGEXP_REPLACE(source_url, '#.*$', ''), '/+$', '')))
    source_url,
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(source_url, '#.*$', ''), '/+$', '')) AS normalized_source_url,
    source_listing_key,
    source_platform,
    id AS rejected_property_id,
    inquiry_reference,
    moderation_reason,
    status,
    extra_fields
  FROM source_urls
  WHERE COALESCE(source_url, '') <> ''
  ORDER BY LOWER(REGEXP_REPLACE(REGEXP_REPLACE(source_url, '#.*$', ''), '/+$', '')), id
)
INSERT INTO rejected_property_source_urls (
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
  metadata
)
SELECT
  source_url,
  normalized_source_url,
  md5(normalized_source_url),
  NULLIF(source_listing_key, ''),
  NULLIF(source_platform, ''),
  rejected_property_id,
  NULLIF(inquiry_reference, ''),
  NULLIF(moderation_reason, ''),
  status,
  'rejected_property_source_url_blocklist_20260609',
  jsonb_build_object(
    'source_batch', COALESCE(extra_fields->>'source_batch', ''),
    'source_name', COALESCE(extra_fields->>'source_name', ''),
    'source_platform', source_platform,
    'source_listing_key', source_listing_key,
    'backfilled_from_property_status', status
  )
FROM normalized_source_urls
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
  rejected_by = EXCLUDED.rejected_by,
  blocked_until = GREATEST(rejected_property_source_urls.blocked_until, EXCLUDED.blocked_until),
  metadata = COALESCE(rejected_property_source_urls.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  last_seen_at = NOW(),
  updated_at = NOW();

DELETE FROM properties
WHERE LOWER(COALESCE(status, '')) IN ('rejected', 'deleted');
