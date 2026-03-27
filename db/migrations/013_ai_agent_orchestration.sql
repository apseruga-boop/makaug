CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  run_mode TEXT NOT NULL DEFAULT 'recommend'
    CHECK (run_mode IN ('observe', 'recommend', 'auto')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed')),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ai_agent_runs(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  finding_type TEXT NOT NULL,
  message TEXT NOT NULL,
  recommendation JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'dismissed', 'resolved')),
  notes TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID REFERENCES ai_agent_findings(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'executed', 'failed', 'cancelled')),
  approved_by TEXT,
  executed_by TEXT,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_enabled ON ai_agents(enabled, code);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_created ON ai_agent_runs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_status_created ON ai_agent_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_findings_status_created ON ai_agent_findings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_findings_entity ON ai_agent_findings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_status_created ON ai_agent_actions(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_ai_agents_updated_at ON ai_agents;
CREATE TRIGGER trg_ai_agents_updated_at
BEFORE UPDATE ON ai_agents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_agent_actions_updated_at ON ai_agent_actions;
CREATE TRIGGER trg_ai_agent_actions_updated_at
BEFORE UPDATE ON ai_agent_actions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO ai_agents (code, name, description, enabled, run_mode, config)
VALUES
  (
    'listing_quality_guard',
    'Listing Quality Guard',
    'Checks pending listings for weak descriptions, missing photos, and missing map coordinates.',
    TRUE,
    'recommend',
    '{"minDescriptionLength":80,"minPhotos":5}'::jsonb
  ),
  (
    'id_match_guard',
    'ID Verification Guard',
    'Checks pending listings for NIN format and required ID document metadata before approval.',
    TRUE,
    'recommend',
    '{"ninRegex":"^(CM|CF)[A-Z0-9]{8,12}$"}'::jsonb
  ),
  (
    'image_integrity_guard',
    'Image Integrity Guard',
    'Flags listings where image URLs are reused across multiple different properties.',
    TRUE,
    'recommend',
    '{"maxDuplicateListingsPerImage":1}'::jsonb
  ),
  (
    'support_triage_assistant',
    'Support Triage Assistant',
    'Drafts support response recommendations for unresolved listing reports.',
    TRUE,
    'observe',
    '{"maxReportsPerRun":30}'::jsonb
  )
ON CONFLICT (code) DO NOTHING;
