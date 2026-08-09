-- king-harvester-duplicate-lookup-20260809
-- Exact source and application fingerprint indexes for prompt King previews.
CREATE INDEX IF NOT EXISTS idx_properties_harvest_source_url_exact
  ON properties ((COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '')))
  WHERE COALESCE(status, '') <> 'deleted'
    AND COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '') <> '';

CREATE INDEX IF NOT EXISTS idx_properties_harvest_source_listing_key
  ON properties ((extra_fields->>'source_listing_key'))
  WHERE COALESCE(status, '') <> 'deleted'
    AND COALESCE(extra_fields->>'source_listing_key', '') <> '';

CREATE INDEX IF NOT EXISTS idx_properties_harvest_content_fingerprint_all
  ON properties ((extra_fields->>'content_fingerprint'))
  WHERE COALESCE(status, '') <> 'deleted'
    AND COALESCE(extra_fields->>'content_fingerprint', '') <> '';

ANALYZE properties;
