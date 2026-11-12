-- Outreach tracker fields, and who approved an agent (12 Nov 2026)
--
-- Boot only creates or adds columns. It does not backfill this week's
-- already-sent videos. That is scripts/backfill-outreach-week-2026-11-10.js,
-- which must be run by hand after boot, with a backup, in batches of 20.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE agent_prospects
  ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS do_not_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_contact_by TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_note TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_by TEXT,
  ADD COLUMN IF NOT EXISTS logged_manually BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_agent_prospects_do_not_contact
  ON agent_prospects (do_not_contact)
  WHERE do_not_contact IS TRUE;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
