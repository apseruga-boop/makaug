-- Missed calls (Arthur, 21 Nov 2026, staff desk 3b): calls staff missed on the
-- company phone, logged by hand now and by the phone app later. New table only.
-- Rollback: scripts/rollback-248-call-missed.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS call_missed (
  id BIGSERIAL PRIMARY KEY,
  person_key TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  missed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'phone_app')),
  note TEXT NOT NULL DEFAULT '',
  dismissed_at TIMESTAMPTZ,
  dismissed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS call_missed_person ON call_missed (person_key, missed_at DESC);
CREATE INDEX IF NOT EXISTS call_missed_phone ON call_missed (phone_key, missed_at DESC);
