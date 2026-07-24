-- Support canonical valuation area matching without scanning all property rows.
-- The route applies the same normalization expression before matching the
-- canonical registry aliases.

CREATE INDEX IF NOT EXISTS idx_properties_valuation_public_type_normalized_area_created
  ON properties (
    listing_type,
    REGEXP_REPLACE(
      LOWER(TRIM(SPLIT_PART(COALESCE(area, ''), ',', 1))),
      '[^a-z0-9]+',
      ' ',
      'g'
    ),
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND price IS NOT NULL
    AND price > 0
    AND price <= 100000000000;

ANALYZE properties;
