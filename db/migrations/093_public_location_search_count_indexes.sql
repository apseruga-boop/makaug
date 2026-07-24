-- Keep exact public area and district count predicates index-backed. These
-- separate indexes avoid an OR predicate falling back to a table scan.
CREATE INDEX IF NOT EXISTS idx_properties_public_live_normalized_area_count
  ON properties (LOWER(TRIM(COALESCE(area, ''))))
  INCLUDE (listing_type, students_welcome, property_type, price_period)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_normalized_district_count
  ON properties (LOWER(TRIM(COALESCE(district, ''))))
  INCLUDE (listing_type, students_welcome, property_type, price_period)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

ANALYZE properties;
