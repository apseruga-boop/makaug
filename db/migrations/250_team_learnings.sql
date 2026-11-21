-- Rejections & lessons (Arthur, 21 Nov 2026, ops 3c part 2): a store of lessons
-- the team learns from rejections. Staff suggest a lesson, optionally with a
-- script line ("If they say … / We say …" for one call type); King approves,
-- edits or declines. Approved script lines show on the calling screen as team
-- tips. New table only: nothing existing changes.
-- Rollback: scripts/rollback-250-team-learnings.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS team_learnings (
  id BIGSERIAL PRIMARY KEY,
  theme TEXT NOT NULL CHECK (theme ~ '^[a-z_]{2,30}$'),
  lesson TEXT NOT NULL,
  task_key TEXT CHECK (task_key IS NULL OR task_key IN ('new_agents', 'payments', 'retention')),
  if_they_say TEXT NOT NULL DEFAULT '',
  we_say TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'declined', 'retired')),
  proposed_by_user_id TEXT,
  proposed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  king_note TEXT NOT NULL DEFAULT '',
  CHECK ((if_they_say = '' AND we_say = '') OR (task_key IS NOT NULL AND if_they_say <> '' AND we_say <> ''))
);
CREATE INDEX IF NOT EXISTS team_learnings_status ON team_learnings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS team_learnings_by ON team_learnings (proposed_by_user_id, created_at DESC);
