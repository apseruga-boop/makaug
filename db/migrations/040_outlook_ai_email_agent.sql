CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS outlook_email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_message_id TEXT UNIQUE,
  internet_message_id TEXT,
  conversation_id TEXT,
  mailbox TEXT NOT NULL,
  from_email TEXT,
  from_name TEXT,
  subject TEXT,
  body_preview TEXT,
  category TEXT NOT NULL DEFAULT 'general_support',
  status TEXT NOT NULL DEFAULT 'new',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  received_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outlook_email_threads_mailbox_received
  ON outlook_email_threads (mailbox, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_outlook_email_threads_status
  ON outlook_email_threads (status);

CREATE INDEX IF NOT EXISTS idx_outlook_email_threads_category
  ON outlook_email_threads (category);

CREATE TABLE IF NOT EXISTS outlook_email_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES outlook_email_threads(id) ON DELETE SET NULL,
  graph_message_id TEXT,
  graph_draft_id TEXT,
  mailbox TEXT NOT NULL,
  from_email TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  category TEXT NOT NULL DEFAULT 'general_support',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft_pending_approval',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outlook_email_actions_status_created
  ON outlook_email_actions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outlook_email_actions_thread
  ON outlook_email_actions (thread_id);

CREATE INDEX IF NOT EXISTS idx_outlook_email_actions_category
  ON outlook_email_actions (category);

INSERT INTO ai_agents (code, name, description, enabled, run_mode, config)
VALUES (
  'outlook_ai_email_agent',
  'Outlook AI Email Agent',
  'Drafts and controls customer email replies from Microsoft Outlook through protected founder/admin approval workflows.',
  FALSE,
  'recommend',
  jsonb_build_object(
    'provider', 'microsoft_graph',
    'default_mode', 'draft_only',
    'requires_founder_approval', true,
    'allowed_without_review', jsonb_build_array(),
    'blocked_topics', jsonb_build_array('payments', 'fraud', 'legal', 'security', 'complaints'),
    'dashboard_route', '/admin/notifications'
  )
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config = COALESCE(ai_agents.config, '{}'::jsonb) || EXCLUDED.config,
  updated_at = NOW();
