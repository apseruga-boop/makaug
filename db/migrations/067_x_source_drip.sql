CREATE TABLE IF NOT EXISTS source_drip_state (
  drip_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'x',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  cursor_offset INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  base_interval_minutes INTEGER NOT NULL DEFAULT 15,
  current_interval_minutes INTEGER NOT NULL DEFAULT 15,
  batch_size INTEGER NOT NULL DEFAULT 5,
  max_results INTEGER NOT NULL DEFAULT 10,
  search_mode TEXT NOT NULL DEFAULT 'all',
  published_after TIMESTAMPTZ NOT NULL DEFAULT '2026-01-01T00:00:00Z',
  target_reviewable INTEGER NOT NULL DEFAULT 3000,
  status TEXT NOT NULL DEFAULT 'paused',
  pause_reason TEXT,
  consecutive_rate_limited_runs INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_drip_platform_check CHECK (platform IN ('x')),
  CONSTRAINT source_drip_status_check CHECK (status IN ('paused','scheduled','running','completed','rate_limited','blocked','error')),
  CONSTRAINT source_drip_batch_size_check CHECK (batch_size BETWEEN 1 AND 5),
  CONSTRAINT source_drip_interval_check CHECK (base_interval_minutes BETWEEN 1 AND 1440 AND current_interval_minutes BETWEEN 1 AND 1440),
  CONSTRAINT source_drip_max_results_check CHECK (max_results BETWEEN 10 AND 100)
);

CREATE TABLE IF NOT EXISTS source_drip_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drip_key TEXT NOT NULL REFERENCES source_drip_state(drip_key) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  source_offset INTEGER NOT NULL DEFAULT 0,
  next_source_offset INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 5,
  max_results INTEGER NOT NULL DEFAULT 10,
  published_after TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'completed',
  fetched_posts_count INTEGER NOT NULL DEFAULT 0,
  discovered_posts_count INTEGER NOT NULL DEFAULT 0,
  created_properties INTEGER NOT NULL DEFAULT 0,
  review_queue_properties INTEGER NOT NULL DEFAULT 0,
  existing_properties INTEGER NOT NULL DEFAULT 0,
  duplicate_warning_count INTEGER NOT NULL DEFAULT 0,
  source_review_count INTEGER NOT NULL DEFAULT 0,
  suppressed_source_count INTEGER NOT NULL DEFAULT 0,
  low_signal_source_location_count INTEGER NOT NULL DEFAULT 0,
  rate_limited_count INTEGER NOT NULL DEFAULT 0,
  auth_error_count INTEGER NOT NULL DEFAULT 0,
  billing_error_count INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_drip_run_logs_drip_created
  ON source_drip_run_logs (drip_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_drip_run_logs_status_created
  ON source_drip_run_logs (status, created_at DESC);

ALTER TABLE source_drip_state
  ADD COLUMN IF NOT EXISTS published_after TIMESTAMPTZ NOT NULL DEFAULT '2026-01-01T00:00:00Z';

ALTER TABLE source_drip_run_logs
  ADD COLUMN IF NOT EXISTS published_after TIMESTAMPTZ;
