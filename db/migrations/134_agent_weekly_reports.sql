-- Agent weekly performance reports: visitor country capture + stored, editable reports.

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_analytics_events_property_open_property
  ON analytics_events ((payload->>'property_id'), created_at)
  WHERE event_name = 'property_open';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS makaug_agent_number TEXT;

CREATE TABLE IF NOT EXISTS agent_weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  top_listings JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_countries JSONB NOT NULL DEFAULT '[]'::jsonb,
  insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  country_tracking_since TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  edited_by TEXT,
  sent_at TIMESTAMPTZ,
  sent_to TEXT,
  last_preview_to TEXT,
  last_preview_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_weekly_reports_status_check CHECK (status IN ('draft', 'approved', 'sent')),
  CONSTRAINT agent_weekly_reports_agent_week_unique UNIQUE (agent_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_agent_weekly_reports_week ON agent_weekly_reports (week_start DESC, status);
