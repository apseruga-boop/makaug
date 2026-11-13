-- Benard Gaita's 6-acre warehouse listing (Arthur, 13 Nov 2026).
-- MK-20261111-9D6051 was saved by the WhatsApp intake as "Transformer,
-- Nakaseke" (from "3-Phase Power + Transformer Installed") with
-- bedrooms = 6 (from "6 Acres"/"6KM"). The post says Mukono twice and
-- Benard wrote "Area is Mukono not nkaaseke" on 12 Nov. That correction
-- was saved as a second listing, MK-20261112-004179.
--
-- This file only creates the backup table. The two row updates run
-- after the process is already serving, from
-- scripts/run-benard-mukono-fix-224.js (hooked from
-- scheduleStartupDataRepairs), matched by id AND reference AND the
-- state read on 13 Nov:
--   000f79c1 MK-20261111-9D6051  area/district Mukono, bedrooms NULL,
--            title "6 acres with warehouse for sale in Mukono", the
--            auto-added "Commercial property in Transformer, Nakaseke,
--            listed at UGX …" sentence removed; stays live.
--   ce81a13b MK-20261112-004179  taken down (status 'hidden', the same
--            as King → Agents → Manage → Take down); never deleted.
-- No message goes to anyone. Rollback:
-- scripts/rollback-224-benard-mukono-fix.sql. Re-running is a no-op.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS benard_mukono_fix_224_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  action text NOT NULL,
  before_row jsonb NOT NULL,
  before_updated_at timestamptz,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);
