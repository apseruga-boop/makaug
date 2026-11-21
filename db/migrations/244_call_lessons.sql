-- Lessons learned per call (Arthur, 21 Nov 2026). King opens a call from the
-- staff day timeline and sees the transcript, summary, outcome, follow-up,
-- actions and drop-offs. Key points and themes are worked out from the call;
-- King adds a note. New table only: nothing existing changes.
-- Rollback: scripts/rollback-244-call-lessons.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS call_lessons (
  attempt_id uuid PRIMARY KEY,
  person_key text NOT NULL DEFAULT '',
  themes text[] NOT NULL DEFAULT '{}',
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  king_note text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS call_lessons_themes ON call_lessons USING gin (themes);
CREATE INDEX IF NOT EXISTS call_lessons_person ON call_lessons (person_key, updated_at DESC);
