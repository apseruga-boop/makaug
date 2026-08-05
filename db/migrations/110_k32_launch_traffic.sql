-- K32 launch traffic: make public price sorts and launch analytics index-backed.

CREATE INDEX IF NOT EXISTS idx_properties_public_price_desc_launch
  ON properties (
    listing_type,
    (CASE WHEN price IS NOT NULL AND price > 0 AND price <= 100000000000 THEN 0 ELSE 1 END),
    price DESC NULLS LAST,
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_price_asc_launch
  ON properties (
    listing_type,
    (CASE WHEN price IS NOT NULL AND price > 0 AND price <= 100000000000 THEN 0 ELSE 1 END),
    price ASC NULLS LAST,
    created_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_analytics_events_launch_visitors
  ON analytics_events (created_at DESC, client_id)
  WHERE event_name IN ('property_open', 'property_view', 'page_view', 'property_search', 'page_open');

COMMENT ON INDEX idx_properties_public_price_desc_launch IS
  'Supports K32 public category price-desc sorting without a full public-inventory sort.';
COMMENT ON INDEX idx_properties_public_price_asc_launch IS
  'Supports K32 public category price-asc sorting without a full public-inventory sort.';
COMMENT ON INDEX idx_analytics_events_launch_visitors IS
  'Supports K32 30-minute, daily, and 48-hour unique visitor metrics.';

ANALYZE properties;
ANALYZE analytics_events;
