CREATE TABLE IF NOT EXISTS whatsapp_user_profiles (
  phone TEXT PRIMARY KEY,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_opt_in_at TIMESTAMPTZ,
  marketing_opt_out_at TIMESTAMPTZ,
  opt_in_source TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_intent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT NOT NULL,
  wa_message_id TEXT,
  detected_intent TEXT NOT NULL,
  confidence NUMERIC(4,3),
  language TEXT,
  current_step TEXT,
  raw_text TEXT,
  transcript TEXT,
  entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','email')),
  objective TEXT,
  message_template TEXT NOT NULL,
  target_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','sent','cancelled')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

ALTER TABLE outbound_message_queue
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','email')),
  ADD COLUMN IF NOT EXISTS user_consent_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_user_profiles_optin ON whatsapp_user_profiles(marketing_opt_in, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_intent_logs_phone_created ON whatsapp_intent_logs(user_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_intent_logs_intent ON whatsapp_intent_logs(detected_intent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_queue_campaign ON outbound_message_queue(campaign_id, status, next_attempt_at ASC);
