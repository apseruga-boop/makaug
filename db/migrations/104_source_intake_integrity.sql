-- K18e: make source fingerprint and canonical-location moderation lookups cheap.
-- Canonical provenance remains in extra_fields so this migration is additive.
CREATE INDEX IF NOT EXISTS idx_properties_source_content_fingerprint
  ON properties ((extra_fields->>'content_fingerprint'))
  WHERE COALESCE(status, '') <> 'deleted'
    AND COALESCE(extra_fields->>'content_fingerprint', '') <> '';

CREATE INDEX IF NOT EXISTS idx_properties_source_canonical_location
  ON properties ((extra_fields->>'canonical_location_id'), status, created_at DESC)
  WHERE COALESCE(extra_fields->>'canonical_location_id', '') <> '';

CREATE INDEX IF NOT EXISTS idx_properties_source_location_resolution
  ON properties ((extra_fields->>'location_resolution_status'), status, created_at DESC)
  WHERE COALESCE(source, '') = 'found_online_property_source_v1';
