-- Uganda source rotation (step 2 of the 30,000-listing plan).
-- Additive only: three new tables, no change to existing rows.
CREATE TABLE IF NOT EXISTS uganda_source_rotation_sources (
  source_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'youtube')),
  kind TEXT NOT NULL CHECK (kind IN ('hashtag', 'search', 'creator')),
  value TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  discovered_from TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_harvested_at TIMESTAMPTZ,
  last_result JSONB,
  harvest_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uganda_source_rotation_sources_due
  ON uganda_source_rotation_sources (last_harvested_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS uganda_source_rotation_daily (
  day DATE PRIMARY KEY,
  items_queued INTEGER NOT NULL DEFAULT 0,
  youtube_units INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uganda_source_rotation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_cap INTEGER NOT NULL DEFAULT 150,
  pending_pause_threshold INTEGER NOT NULL DEFAULT 50,
  youtube_daily_unit_budget INTEGER NOT NULL DEFAULT 4500,
  min_reharvest_hours INTEGER NOT NULL DEFAULT 24,
  sources_per_run INTEGER NOT NULL DEFAULT 12,
  timer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  run_lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO uganda_source_rotation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
