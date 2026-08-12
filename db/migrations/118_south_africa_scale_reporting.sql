-- Shared schema, country-scoped data. These expression indexes accelerate the
-- South Africa scale report without changing Uganda/Kenya/Rwanda records.
CREATE INDEX IF NOT EXISTS idx_property_harvest_events_country_wave
  ON property_harvest_events ((metadata->>'country_code'), occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_harvest_events_country_track_wave
  ON property_harvest_events (
    (metadata->>'country_code'),
    (metadata->>'source_track'),
    platform,
    occurred_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_properties_private_seller_public
  ON properties ((extra_fields->>'private_seller'), status, created_at DESC)
  WHERE LOWER(COALESCE(extra_fields->>'private_seller', 'false')) IN ('true', '1', 'yes');

ANALYZE property_harvest_events;
ANALYZE properties;
