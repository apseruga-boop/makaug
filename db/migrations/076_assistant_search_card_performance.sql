-- Ask AI and public card-search performance.
-- Keep these partial indexes focused on approved/live public inventory; moderation
-- queries have their own queue indexes and should not pay for this path.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_area_beds_price_created
  ON properties (
    listing_type,
    LOWER(TRIM(COALESCE(area, ''))),
    bedrooms,
    price,
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_district_beds_price_created
  ON properties (
    listing_type,
    LOWER(TRIM(COALESCE(district, ''))),
    bedrooms,
    price,
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_area_district_created
  ON properties (
    LOWER(TRIM(COALESCE(area, ''))),
    LOWER(TRIM(COALESCE(district, ''))),
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_student_portal_created
  ON properties (listing_type, students_welcome, created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_property_type_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(property_type, ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_commercial_type_trgm
  ON properties USING GIN (LOWER(TRIM(COALESCE(extra_fields->>'commercial_type', ''))) gin_trgm_ops)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

ANALYZE properties;
