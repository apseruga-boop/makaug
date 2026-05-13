CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS whatsapp_call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'whatsapp',
  call_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  call_type TEXT NOT NULL DEFAULT 'voice',
  contact_name TEXT,
  related_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_call_events_call_id
  ON whatsapp_call_events(call_id)
  WHERE call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_call_events_phone_seen
  ON whatsapp_call_events(phone, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_call_events_related_lead
  ON whatsapp_call_events(related_lead_id)
  WHERE related_lead_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_whatsapp_call_events_updated_at ON whatsapp_call_events;
CREATE TRIGGER trg_whatsapp_call_events_updated_at
BEFORE UPDATE ON whatsapp_call_events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
