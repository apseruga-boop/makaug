CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS property_source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'creator_channel',
  source_url TEXT NOT NULL,
  handle TEXT,
  contact_phone TEXT,
  contact_phone_alt TEXT,
  contact_email TEXT,
  website_url TEXT,
  districts TEXT[] NOT NULL DEFAULT '{}'::text[],
  listing_types TEXT[] NOT NULL DEFAULT '{}'::text[],
  languages TEXT[] NOT NULL DEFAULT '{}'::text[],
  hashtags TEXT[] NOT NULL DEFAULT '{}'::text[],
  status TEXT NOT NULL DEFAULT 'active',
  trust_level TEXT NOT NULL DEFAULT 'review_needed',
  consent_status TEXT NOT NULL DEFAULT 'public_source_review_needed',
  scrape_policy TEXT NOT NULL DEFAULT 'manual_review_only',
  can_contact_directly BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_source_registry_status_check
    CHECK (status IN ('active', 'candidate', 'paused', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_property_source_registry_platform_status
  ON property_source_registry (platform, status, source_type);

CREATE INDEX IF NOT EXISTS idx_property_source_registry_last_seen
  ON property_source_registry (last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_property_source_registry_listing_types
  ON property_source_registry USING GIN (listing_types);

CREATE INDEX IF NOT EXISTS idx_property_source_registry_hashtags
  ON property_source_registry USING GIN (hashtags);

