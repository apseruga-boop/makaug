CREATE TABLE IF NOT EXISTS property_harvest_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  source_key TEXT,
  source_url TEXT,
  source_platform_id TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT,
  property_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_harvest_events_platform_time
  ON property_harvest_events (platform, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_harvest_events_outcome_time
  ON property_harvest_events (outcome, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_harvest_events_source_platform_id
  ON property_harvest_events (source_platform_id)
  WHERE source_platform_id IS NOT NULL AND source_platform_id <> '';

CREATE TABLE IF NOT EXISTS property_harvest_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  canonical_source_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  submitter_name TEXT,
  submitter_contact TEXT,
  note TEXT,
  request_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  import_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_harvest_submissions_status_check
    CHECK (status IN ('pending_review','imported_to_review','duplicate','rejected','failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_harvest_submissions_canonical_open
  ON property_harvest_submissions (canonical_source_url)
  WHERE status IN ('pending_review','imported_to_review','duplicate');
CREATE INDEX IF NOT EXISTS idx_property_harvest_submissions_status_time
  ON property_harvest_submissions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS property_harvest_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  source_key TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  external_channel_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'tracked',
  lease_expires_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_ingested_at TIMESTAMPTZ,
  newest_post_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, source_key)
);

CREATE INDEX IF NOT EXISTS idx_property_harvest_channels_rotation
  ON property_harvest_channels (platform, last_checked_at NULLS FIRST, updated_at);
CREATE INDEX IF NOT EXISTS idx_property_harvest_channels_subscription
  ON property_harvest_channels (platform, subscription_status, lease_expires_at);

CREATE TABLE IF NOT EXISTS property_harvest_cursors (
  platform TEXT NOT NULL,
  source_key TEXT NOT NULL,
  since_id TEXT,
  published_after TIMESTAMPTZ,
  last_polled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, source_key)
);

CREATE INDEX IF NOT EXISTS idx_properties_harvest_source_platform_id
  ON properties ((extra_fields->>'source_platform_id'))
  WHERE COALESCE(extra_fields->>'source_platform_id', '') <> '';
CREATE INDEX IF NOT EXISTS idx_properties_harvest_caption_simhash
  ON properties ((extra_fields->>'caption_simhash'))
  WHERE COALESCE(extra_fields->>'caption_simhash', '') <> '';
CREATE INDEX IF NOT EXISTS idx_properties_harvest_primary_image_dhash
  ON properties ((extra_fields->>'primary_image_dhash'))
  WHERE COALESCE(extra_fields->>'primary_image_dhash', '') <> '';
CREATE INDEX IF NOT EXISTS idx_properties_harvest_primary_image_phash
  ON properties ((extra_fields->>'primary_image_phash'))
  WHERE COALESCE(extra_fields->>'primary_image_phash', '') <> '';
CREATE INDEX IF NOT EXISTS idx_properties_harvest_contact_cluster_key
  ON properties ((extra_fields->>'contact_cluster_key'))
  WHERE COALESCE(extra_fields->>'contact_cluster_key', '') <> '';
CREATE INDEX IF NOT EXISTS idx_properties_harvest_composite_listing_key
  ON properties ((extra_fields->>'composite_listing_key'))
  WHERE COALESCE(extra_fields->>'composite_listing_key', '') <> '';

ANALYZE property_harvest_events;
ANALYZE property_harvest_submissions;
ANALYZE property_harvest_channels;
