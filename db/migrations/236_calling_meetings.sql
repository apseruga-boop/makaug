-- Meeting mode on the calling screen.
--   call_settings       small King-set settings (key -> json), e.g. the daily
--                       meeting times and the Google Meet link.
--   call_meeting_notes  one row per caller per meeting: the report as built,
--                       the typed / speech-to-text notes (text only, no audio)
--                       and the action items saved from it.
-- Rollback:
--   DROP TABLE IF EXISTS call_meeting_notes; DROP TABLE IF EXISTS call_settings;
CREATE TABLE IF NOT EXISTS call_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day DATE NOT NULL,
  slot TEXT NOT NULL,
  person_key TEXT NOT NULL,
  joined_at TIMESTAMPTZ,
  report JSONB,
  notes TEXT,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  saved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_key, day, slot)
);
CREATE INDEX IF NOT EXISTS idx_call_meeting_notes_day ON call_meeting_notes (day DESC);
