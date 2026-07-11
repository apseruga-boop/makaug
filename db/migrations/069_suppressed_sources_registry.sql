CREATE TABLE IF NOT EXISTS suppressed_sources (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
  source_url TEXT NOT NULL,
  reason TEXT NOT NULL,
  rejected_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressed_sources_source_url_unique
  ON suppressed_sources (source_url);

CREATE INDEX IF NOT EXISTS idx_suppressed_sources_reason_created
  ON suppressed_sources (reason, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suppressed_sources_rejected_property
  ON suppressed_sources (rejected_property_id);
