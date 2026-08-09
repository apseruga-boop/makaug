-- Keep server-rendered SEO facet and university crawls off sequential scans.
-- Migration 071/076 already index location, property_type and commercial_type;
-- these indexes cover the remaining field-level predicates used by PR #155.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_properties_public_live_title_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(title, ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_room_type_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'room_type', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_nearest_university_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(nearest_university, ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_extra_university_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'nearest_university', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_student_university_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'student_university', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_student_campus_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'student_campus', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_title_type_trgm
  ON properties USING GIN (
    LOWER(TRIM(COALESCE(title_type, extra_fields->>'title_type', ''))) gin_trgm_ops
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_transaction_period
  ON properties (
    LOWER(COALESCE(transaction_type, extra_fields->>'transaction_type', '')),
    LOWER(COALESCE(price_period, '')),
    listing_type,
    updated_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_updated
  ON properties (listing_type, updated_at DESC NULLS LAST, created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

ANALYZE properties;
