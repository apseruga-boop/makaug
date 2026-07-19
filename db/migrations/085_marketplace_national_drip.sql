CREATE TABLE IF NOT EXISTS marketplace_source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  district TEXT NOT NULL,
  query_text TEXT NOT NULL,
  source_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  adapter_status TEXT NOT NULL DEFAULT 'configured',
  priority INTEGER NOT NULL DEFAULT 100,
  cursor_order INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source IN ('google_maps','mtn_directory','yellow_pages','ug_business_dir','linkedin','facebook','website','ursb')),
  CHECK (adapter_status IN ('active','configured','enrichment_only','unavailable','paused'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_source_registry_crawl
  ON marketplace_source_registry (enabled DESC, priority ASC, cursor_order ASC);

CREATE INDEX IF NOT EXISTS idx_marketplace_source_registry_coverage
  ON marketplace_source_registry (category, district, source);

DROP TRIGGER IF EXISTS trg_marketplace_source_registry_updated_at ON marketplace_source_registry;
CREATE TRIGGER trg_marketplace_source_registry_updated_at
BEFORE UPDATE ON marketplace_source_registry
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_drip_state (
  drip_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  cursor_offset INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  base_interval_minutes INTEGER NOT NULL DEFAULT 30,
  batch_size INTEGER NOT NULL DEFAULT 5,
  target_businesses INTEGER NOT NULL DEFAULT 5000,
  monthly_request_cap INTEGER NOT NULL DEFAULT 300,
  monthly_request_count INTEGER NOT NULL DEFAULT 0,
  request_month TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  status TEXT NOT NULL DEFAULT 'paused',
  pause_reason TEXT,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (batch_size BETWEEN 1 AND 25),
  CHECK (base_interval_minutes BETWEEN 1 AND 1440),
  CHECK (monthly_request_cap BETWEEN 1 AND 100000),
  CHECK (status IN ('paused','scheduled','running','completed','partial','blocked','error'))
);

DROP TRIGGER IF EXISTS trg_marketplace_drip_state_updated_at ON marketplace_drip_state;
CREATE TRIGGER trg_marketplace_drip_state_updated_at
BEFORE UPDATE ON marketplace_drip_state
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_drip_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drip_key TEXT NOT NULL REFERENCES marketplace_drip_state(drip_key) ON DELETE CASCADE,
  source_offset INTEGER NOT NULL DEFAULT 0,
  next_source_offset INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  existing INTEGER NOT NULL DEFAULT 0,
  hidden_enrichment INTEGER NOT NULL DEFAULT 0,
  rejected_missing_contact INTEGER NOT NULL DEFAULT 0,
  rejected_location INTEGER NOT NULL DEFAULT 0,
  rejected_competitor INTEGER NOT NULL DEFAULT 0,
  rejected_source INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  category_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  district_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_drip_runs_created
  ON marketplace_drip_run_logs (drip_key, created_at DESC);

COMMENT ON TABLE marketplace_source_registry IS
  'Auditable national Marketplace query registry. Enabled indicates a real implemented adapter, never merely a planned source.';

COMMENT ON TABLE marketplace_drip_state IS
  'Persistent, capped national Marketplace crawler state. It is paused by default until an administrator starts it.';
