-- Mortgage rate check, approved by Arthur at 07:06 UK on 4 Nov 2026.
--
-- Two new tables, no change to any existing row:
--   mortgage_rate_source_snapshots  the percentages last read from each
--                                   lender / Bank of Uganda page
--   mortgage_rate_proposals         a change the weekly check found, waiting
--                                   for staff to approve or reject in the admin
-- The check never publishes a rate. Only a proposal that staff approve (with
-- the rate they confirm) is read by GET /api/mortgage-rates.
--
-- No existing data is changed, so there is nothing to back up. The
-- data_change_203_backup table is created empty to keep the convention.
-- Rollback: scripts/rollback-203-mortgage-rate-proposals.sql (manual; drops
-- the two new tables, which removes every staff approval with them).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS data_change_203_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

CREATE TABLE IF NOT EXISTS mortgage_rate_source_snapshots (
  source_url TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  numbers_hash TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mortgage_rate_proposals (
  id BIGSERIAL PRIMARY KEY,
  provider_key TEXT NOT NULL,
  rate_field TEXT NOT NULL DEFAULT 'residentialRate'
    CHECK (rate_field IN ('residentialRate', 'commercialRate', 'primeRate', 'centralBankRate')),
  current_rate NUMERIC(5,2),
  proposed_rate NUMERIC(5,2),
  approved_rate NUMERIC(5,2),
  source_url TEXT NOT NULL,
  numbers_before JSONB NOT NULL DEFAULT '[]'::jsonb,
  numbers_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL DEFAULT 'weekly',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  staff_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mortgage_rate_proposals_status
  ON mortgage_rate_proposals (status, detected_at DESC);
