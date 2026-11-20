-- Placeholder found-online titles and pasted WhatsApp listing copy
-- (Arthur, 20 Nov 2026).
--
-- Harvested TikTok rows arrived in review titled
-- "Found-online TikTok property post 55" even when beds, area, type and
-- price were already known. A manually entered land advert
-- (MK-20261120-P5T3F) and other same-lister rows kept raw WhatsApp
-- markup as the public title and description.
--
-- This file only creates the backup table. The row updates run after
-- the process is already serving, from
-- scripts/run-placeholder-titles-and-pasted-copy-241.js (hooked from
-- scheduleStartupDataRepairs):
--   * pending and approved placeholder titles are rewritten from the
--     listing facts (type, beds, area, sale/rent);
--   * descriptions that opened with the placeholder title are rewritten
--     to match;
--   * MK-20261120-P5T3F is cleaned, moved from "Wakiso Central" to
--     Kawuku, and flagged as two properties that should be split;
--   * other messy same-lister copy (including already-live rows) is
--     cleaned; status is not changed;
--   * MK-20261112-004179 is never touched (taken down on 13 Nov as a
--     duplicate of MK-20261111-9D6051).
-- Re-running is a no-op. Rollback:
-- scripts/rollback-241-placeholder-titles-and-pasted-copy.sql.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS placeholder_titles_and_pasted_copy_241_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  action text NOT NULL,
  before_row jsonb NOT NULL,
  before_updated_at timestamptz,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);
