ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS weekly_tips_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (preferred_contact_channel IN ('whatsapp','phone','email')),
  ADD COLUMN IF NOT EXISTS oauth_provider TEXT,
  ADD COLUMN IF NOT EXISTS oauth_subject TEXT,
  ADD COLUMN IF NOT EXISTS oauth_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_weekly_tip_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_provider_subject
  ON users(oauth_provider, oauth_subject)
  WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_weekly_tips_opt_in
  ON users(weekly_tips_opt_in)
  WHERE weekly_tips_opt_in = TRUE;
