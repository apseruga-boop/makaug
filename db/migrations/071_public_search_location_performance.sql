-- Tighten and speed up public location search.
-- Public filters should resolve against location fields, not broad title/body text.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_area_lower
  ON properties (listing_type, LOWER(TRIM(COALESCE(area, ''))), created_at DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_district_lower
  ON properties (listing_type, LOWER(TRIM(COALESCE(district, ''))), created_at DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_price_created
  ON properties (listing_type, price, created_at DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND price IS NOT NULL
    AND price > 0
    AND price <= 100000000000;

CREATE INDEX IF NOT EXISTS idx_properties_public_live_area_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(area, ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_district_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(district, ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_city_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'city', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_neighborhood_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'neighborhood', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_street_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'street_name', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_region_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'region', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

UPDATE properties
SET
  status = 'rejected',
  moderation_reason = COALESCE(NULLIF(moderation_reason, ''), 'Public QA/test listing suppressed'),
  updated_at = NOW(),
  extra_fields = COALESCE(extra_fields, '{}'::jsonb)
    || jsonb_build_object(
      'public_search_suppressed', 'test_zone',
      'public_search_suppressed_at', NOW()::text
    )
WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
  AND (
    COALESCE(title, '')
    || ' '
    || COALESCE(area, '')
    || ' '
    || COALESCE(address, '')
    || ' '
    || COALESCE(description, '')
    || ' '
    || COALESCE(extra_fields::text, '')
  ) ~* '(test zone|qa test|soft_launch|launch_proof|non_public_test)';

ANALYZE properties;
