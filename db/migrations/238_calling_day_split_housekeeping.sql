-- 238: Calling screen v5 – day split (King sets the blocks) and housekeeping ticks.
-- Additive. The housekeeping list itself is read-only queries over agents,
-- properties and call_attempts; only the caller's "done" / note is stored here.
-- Rollback: DROP TABLE IF EXISTS call_housekeeping; DELETE FROM call_settings WHERE key = 'day_split';
CREATE TABLE IF NOT EXISTS call_housekeeping (
  id BIGSERIAL PRIMARY KEY,
  person_key TEXT NOT NULL,
  item_key TEXT NOT NULL,          -- e.g. id:<agent id>, listing:<property id>, promise:<phone key>
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'note')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS call_housekeeping_item_idx ON call_housekeeping (item_key, created_at DESC);
CREATE INDEX IF NOT EXISTS call_housekeeping_person_idx ON call_housekeeping (person_key, created_at DESC);
