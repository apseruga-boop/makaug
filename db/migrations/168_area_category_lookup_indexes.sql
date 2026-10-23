-- Area and category pages filter on LOWER(listing_type) and
-- LOWER(extra_fields->>'canonical_location_id'). Those expressions were not
-- indexed, so the page query and its count scanned the public inventory and
-- then joined images for every match. These indexes match those expressions.
-- CONCURRENTLY keeps reads and writes moving while they build. The migrator
-- runs this file outside a transaction because CREATE INDEX CONCURRENTLY cannot.
-- No row data is updated.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_area_type_canonical_updated
  ON properties (
    LOWER(COALESCE(listing_type, '')),
    LOWER(COALESCE(extra_fields->>'canonical_location_id', '')),
    updated_at DESC NULLS LAST,
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_area_canonical_prefix
  ON properties (
    LOWER(COALESCE(listing_type, '')),
    (LOWER(COALESCE(extra_fields->>'canonical_location_id', ''))) text_pattern_ops
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_area_uncanonical_district
  ON properties (
    LOWER(COALESCE(listing_type, '')),
    LOWER(TRIM(COALESCE(district, ''))),
    updated_at DESC NULLS LAST,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND COALESCE(extra_fields->>'canonical_location_id', '') = '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_commercial_transaction_location
  ON properties (
    LOWER(COALESCE(transaction_type, extra_fields->>'transaction_type', '')),
    LOWER(COALESCE(extra_fields->>'canonical_location_id', '')),
    updated_at DESC NULLS LAST,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND LOWER(COALESCE(listing_type, '')) = 'commercial';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_canonical_id_prefix
  ON properties ((COALESCE(extra_fields->>'canonical_location_id', '')) text_pattern_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

ANALYZE properties;
