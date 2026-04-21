CREATE TABLE IF NOT EXISTS ai_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'disabled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ai_tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'disabled')),
  ingest_api_key_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ai_tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ai_sites(id) ON DELETE CASCADE,
  external_session_id TEXT NOT NULL,
  external_user_id TEXT,
  channel TEXT NOT NULL DEFAULT 'web',
  language TEXT NOT NULL DEFAULT 'en',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, external_session_id)
);

CREATE TABLE IF NOT EXISTS ai_events_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ai_tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ai_sites(id) ON DELETE CASCADE,
  session_id UUID REFERENCES ai_sessions(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  channel TEXT NOT NULL DEFAULT 'web',
  event_name TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_ip TEXT,
  user_agent TEXT,
  dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'normalized', 'error')),
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_events_normalized (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id UUID NOT NULL UNIQUE REFERENCES ai_events_raw(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES ai_tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ai_sites(id) ON DELETE CASCADE,
  session_id UUID REFERENCES ai_sessions(id) ON DELETE SET NULL,
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel TEXT NOT NULL DEFAULT 'web',
  event_type TEXT NOT NULL DEFAULT 'unknown',
  intent TEXT,
  intent_confidence NUMERIC(4,3),
  language TEXT,
  input_text TEXT,
  response_text TEXT,
  entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome TEXT,
  label TEXT,
  is_training_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_event_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_event_id UUID NOT NULL REFERENCES ai_events_normalized(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  label TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_export_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES ai_tenants(id) ON DELETE SET NULL,
  site_id UUID REFERENCES ai_sites(id) ON DELETE SET NULL,
  format TEXT NOT NULL DEFAULT 'jsonl',
  days INTEGER NOT NULL DEFAULT 30,
  min_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  total_exported INTEGER NOT NULL DEFAULT 0,
  output_path TEXT,
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed')),
  error_message TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_sites_tenant_status
  ON ai_sites(tenant_id, status, code);

CREATE INDEX IF NOT EXISTS idx_ai_sites_ingest_key_hash
  ON ai_sites(ingest_api_key_hash);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_lookup
  ON ai_sessions(site_id, external_session_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_events_raw_site_ts
  ON ai_events_raw(site_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_events_raw_status
  ON ai_events_raw(processing_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_events_raw_site_dedupe
  ON ai_events_raw(site_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_events_normalized_site_ts
  ON ai_events_normalized(site_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_events_normalized_training
  ON ai_events_normalized(is_training_candidate, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_events_normalized_intent
  ON ai_events_normalized(intent, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_event_labels_event
  ON ai_event_labels(normalized_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_export_runs_created
  ON ai_export_runs(created_at DESC);

DROP TRIGGER IF EXISTS trg_ai_tenants_updated_at ON ai_tenants;
CREATE TRIGGER trg_ai_tenants_updated_at
BEFORE UPDATE ON ai_tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_sites_updated_at ON ai_sites;
CREATE TRIGGER trg_ai_sites_updated_at
BEFORE UPDATE ON ai_sites
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_sessions_updated_at ON ai_sessions;
CREATE TRIGGER trg_ai_sessions_updated_at
BEFORE UPDATE ON ai_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO ai_tenants (code, name, status, metadata)
VALUES (
  'makaug',
  'MakaUg',
  'active',
  '{"country":"UG","platform":"property"}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO ai_sites (tenant_id, code, name, domain, status, metadata)
SELECT t.id, 'makaug-main', 'MakaUg Main Site', 'makaug.com', 'active', '{"channel":"web+whatsapp"}'::jsonb
FROM ai_tenants t
WHERE t.code = 'makaug'
ON CONFLICT (tenant_id, code) DO NOTHING;
