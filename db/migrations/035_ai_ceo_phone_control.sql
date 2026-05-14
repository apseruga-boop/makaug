ALTER TABLE ai_agent_actions
  ADD COLUMN IF NOT EXISTS requires_founder_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approval_reason TEXT,
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_agent_actions_risk_level_check'
  ) THEN
    ALTER TABLE ai_agent_actions
      ADD CONSTRAINT ai_agent_actions_risk_level_check
      CHECK (risk_level IN ('low','medium','high','critical'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_ceo_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  report_type TEXT NOT NULL DEFAULT 'morning'
    CHECK (report_type IN ('morning','command','health','incident','weekly','phone')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent_to_founder','acknowledged','archived')),
  summary TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  approvals_required JSONB NOT NULL DEFAULT '[]'::jsonb,
  kill_switches JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'ai_ceo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_ceo_reports_type_created
  ON ai_ceo_reports(report_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_ceo_reports_status_created
  ON ai_ceo_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_ceo_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (channel IN ('dashboard','whatsapp_owner','telegram_owner','email','api','scheduler','system')),
  requested_by TEXT NOT NULL DEFAULT 'founder',
  requester_phone TEXT,
  requester_chat_id TEXT,
  command_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'answered'
    CHECK (status IN ('received','answered','needs_approval','blocked','failed')),
  intent TEXT NOT NULL DEFAULT 'general',
  response_summary TEXT NOT NULL DEFAULT '',
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_founder_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_ceo_commands_channel_created
  ON ai_ceo_commands(channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_ceo_commands_status_created
  ON ai_ceo_commands(status, created_at DESC);

INSERT INTO ai_agents (code, name, description, enabled, run_mode, config)
VALUES (
  'managing_director_ceo',
  'MakaUg AI CEO',
  'Founder-controlled AI assistant for reports, phone commands, communications, leads, site health, WhatsApp health, and approval-only operational recommendations.',
  TRUE,
  'recommend',
  '{
    "persona": "AI CEO and personal assistant for makaug.com",
    "morningReportTime": "06:30 Africa/Kampala",
    "ownerNotificationEmail": "info@makaug.com",
    "ownerCommandChannels": ["dashboard", "whatsapp_owner", "telegram_owner"],
    "deliveryChannels": ["dashboard", "email_founder", "whatsapp_owner", "telegram_owner"],
    "killSwitches": {
      "autonomous_listing_approval": false,
      "autonomous_public_posting": false,
      "autonomous_payment_spend": false,
      "autonomous_bulk_outreach": false,
      "autonomous_password_or_access_changes": false,
      "autonomous_data_deletion": false,
      "email_direct_send_without_founder_command": false,
      "founder_approval_required_for_external_actions": true
    },
    "guardrails": [
      "Phone commands are accepted only from configured founder phone numbers or Telegram chat IDs.",
      "Never approve listings, brokers, ads, spend, data deletion, password/access changes, or social posts without founder approval.",
      "Email replies are drafted by default; direct send requires AI_CEO_EMAIL_SEND_MODE=direct and a founder command.",
      "Keep a log trail for reports, commands, recommendations, and action decisions."
    ]
  }'::jsonb
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  enabled = TRUE,
  run_mode = 'recommend',
  config = ai_agents.config || EXCLUDED.config,
  updated_at = NOW();
