CREATE TABLE IF NOT EXISTS whatsapp_web_bridge_clients (
  client_id TEXT PRIMARY KEY,
  operator_name TEXT,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','starting','waiting_for_login','online','degraded','error')),
  browser_name TEXT,
  profile_dir TEXT,
  current_url TEXT,
  active_chat_key TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_web_bridge_clients_seen
  ON whatsapp_web_bridge_clients(last_seen_at DESC);

DROP TRIGGER IF EXISTS trg_whatsapp_web_bridge_clients_updated_at ON whatsapp_web_bridge_clients;
CREATE TRIGGER trg_whatsapp_web_bridge_clients_updated_at
BEFORE UPDATE ON whatsapp_web_bridge_clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
