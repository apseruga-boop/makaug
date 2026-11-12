-- Outreach closed-loop fields (12 Nov 2026)
--
-- Boot only adds columns. Sender names for already-tracked rows are resolved
-- at read time from the staff number (Arthur, Ronald, or a staff account
-- name). This migration does not backfill or rewrite prospect rows.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE agent_prospects
  ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS called_by TEXT,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registered_by TEXT,
  ADD COLUMN IF NOT EXISTS recontacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recontacted_by TEXT,
  ADD COLUMN IF NOT EXISTS recontact_note TEXT,
  ADD COLUMN IF NOT EXISTS recontact_count INTEGER NOT NULL DEFAULT 0;
