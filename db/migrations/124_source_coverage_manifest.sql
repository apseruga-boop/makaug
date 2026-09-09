CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS source_coverage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_scope TEXT[] NOT NULL DEFAULT '{}'::text[],
  lookback_days INTEGER NOT NULL DEFAULT 30 CHECK (lookback_days BETWEEN 1 AND 366),
  section_size INTEGER NOT NULL DEFAULT 500 CHECK (section_size BETWEEN 25 AND 2000),
  status TEXT NOT NULL DEFAULT 'queued',
  source_record_count INTEGER NOT NULL DEFAULT 0,
  canonical_source_count INTEGER NOT NULL DEFAULT 0,
  section_count INTEGER NOT NULL DEFAULT 0,
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_coverage_runs_status_check
    CHECK (status IN ('queued','running','paused','completed','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_source_coverage_runs_status_time
  ON source_coverage_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS source_coverage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES source_coverage_runs(id) ON DELETE CASCADE,
  source_registry_id UUID,
  source_key TEXT NOT NULL,
  canonical_source_key TEXT NOT NULL,
  source_name TEXT,
  platform TEXT NOT NULL,
  source_type TEXT,
  source_url TEXT NOT NULL,
  source_offset INTEGER NOT NULL DEFAULT 0,
  sequence_number INTEGER NOT NULL,
  section_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  exact_url_count INTEGER NOT NULL DEFAULT 0,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  review_queued_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  last_error TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, sequence_number),
  CONSTRAINT source_coverage_items_status_check
    CHECK (status IN (
      'pending','processing','awaiting_capture','retry','completed',
      'checked_empty','blocked','duplicate_source'
    ))
);

CREATE INDEX IF NOT EXISTS idx_source_coverage_items_claim
  ON source_coverage_items (run_id, platform, status, next_attempt_at, sequence_number)
  WHERE status IN ('pending','retry');

CREATE INDEX IF NOT EXISTS idx_source_coverage_items_section
  ON source_coverage_items (run_id, section_number, sequence_number);

CREATE INDEX IF NOT EXISTS idx_source_coverage_items_lease
  ON source_coverage_items (lease_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_source_coverage_items_canonical
  ON source_coverage_items (run_id, canonical_source_key);

ANALYZE source_coverage_runs;
ANALYZE source_coverage_items;
