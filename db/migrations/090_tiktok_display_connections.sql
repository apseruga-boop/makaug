CREATE TABLE IF NOT EXISTS tiktok_display_connections (
  id UUID PRIMARY KEY,
  open_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  profile_deep_link TEXT,
  scope TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_display_connections_updated_at
  ON tiktok_display_connections (updated_at DESC);

