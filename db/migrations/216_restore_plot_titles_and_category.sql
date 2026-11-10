-- Plot and land sales were stored as student accommodation when the
-- caption said "hostel" or "student" inside an estate name or a
-- "suitable for" line. Opening Preview & edit then replaced the
-- creator's title with a generated one such as "Student accommodation
-- in Uganda".
--
-- Migration 211 tried to put those listings back in one transaction at
-- startup (db/migrations/211_restore_plot_titles_and_category.sql).
-- On 10 Nov 2026 it hit its 120s statement timeout, failed boot, and
-- took makaug.com down from 08:49 to 09:11 UK. #703 moved that file to
-- scripts/deferred-migrations so startup could finish. This file is the
-- safe replacement: it only creates the backup table. The row updates
-- run after the process is already serving, in small transactions, from
-- scripts/run-plot-title-restore-216.js (hooked from
-- scheduleStartupDataRepairs). Re-running this file is a no-op.
--
-- A production read on 10 Nov 2026 matched 9 student listings whose
-- own title is a plot or land sale (2 approved, including
-- MK-20261109-9F68D2) and 432 listings whose stored title is a
-- generated template while the source title is different (staff-saved
-- titles are left alone). 3 listings are in both sets, so 438 rows
-- change (337 of them approved).
--
-- Backup: plot_title_restore_216_backup.
-- Rollback: scripts/rollback-216-restore-plot-titles-and-category.sql.
-- Nothing is deleted.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS plot_title_restore_216_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  before_row jsonb NOT NULL,
  restored_category boolean NOT NULL,
  restored_title boolean NOT NULL,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);
