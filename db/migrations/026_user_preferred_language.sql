ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en','lg','sw','ac','ny','rn','sm'));

CREATE INDEX IF NOT EXISTS idx_users_preferred_language
  ON users(preferred_language);
