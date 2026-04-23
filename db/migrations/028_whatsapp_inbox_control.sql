CREATE TABLE IF NOT EXISTS whatsapp_conversation_state (
  phone TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ai_active','awaiting_customer','needs_human','escalated','resolved','archived')),
  category TEXT NOT NULL DEFAULT 'uncategorized',
  category_source TEXT NOT NULL DEFAULT 'auto' CHECK (category_source IN ('auto','manual')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to TEXT,
  ai_mode TEXT NOT NULL DEFAULT 'autopilot' CHECK (ai_mode IN ('autopilot','copilot','off')),
  last_summary TEXT,
  admin_notes TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  last_ai_reply_at TIMESTAMPTZ,
  last_human_reply_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO whatsapp_conversation_state (
  phone,
  status,
  category,
  category_source,
  priority,
  ai_mode,
  metadata,
  last_message_at,
  last_inbound_at,
  last_outbound_at
)
SELECT
  m.user_phone,
  'open',
  'uncategorized',
  'auto',
  'normal',
  'autopilot',
  jsonb_build_object('backfilled', true),
  MAX(m.created_at) AS last_message_at,
  MAX(CASE WHEN m.direction = 'inbound' THEN m.created_at END) AS last_inbound_at,
  MAX(CASE WHEN m.direction = 'outbound' THEN m.created_at END) AS last_outbound_at
FROM whatsapp_messages m
GROUP BY m.user_phone
ON CONFLICT (phone) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_state_status
  ON whatsapp_conversation_state(status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_state_category
  ON whatsapp_conversation_state(category, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_state_ai_mode
  ON whatsapp_conversation_state(ai_mode, last_message_at DESC);

DROP TRIGGER IF EXISTS trg_whatsapp_conversation_state_updated_at ON whatsapp_conversation_state;
CREATE TRIGGER trg_whatsapp_conversation_state_updated_at
BEFORE UPDATE ON whatsapp_conversation_state
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
