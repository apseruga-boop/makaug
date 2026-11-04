-- Optional check-in / check-out dates on a short-stay listing, so a host can
-- say when the place is next free. Both columns are nullable and have no
-- default: existing rows stay exactly as they are (no backfill, no UPDATE).
-- The existing check_in_from / check_out_by columns keep the daily times.
-- Rollback: ALTER TABLE st_listing DROP COLUMN IF EXISTS check_in, DROP COLUMN IF EXISTS check_out;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE st_listing
  ADD COLUMN IF NOT EXISTS check_in DATE,
  ADD COLUMN IF NOT EXISTS check_out DATE;

COMMENT ON COLUMN st_listing.check_in IS 'Optional first available check-in date set by the host. NULL = not stated.';
COMMENT ON COLUMN st_listing.check_out IS 'Optional last check-out date for that window. NULL = not stated.';
