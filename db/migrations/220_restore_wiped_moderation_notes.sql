-- Approving a listing from staff preview used to SET moderation_notes to
-- "Staff preview completed before approval" whenever the notes box was
-- empty. That wiped the moderator's evidence note (7C1D37 and others,
-- 4-11 Nov 2026). #739 stopped the overwrite on new approvals. This
-- file only creates the backup table. The row updates run after the
-- process is already serving, in batches of 20, from
-- scripts/run-moderation-notes-restore-220.js (hooked from
-- scheduleStartupDataRepairs). Re-running this file is a no-op.
--
-- A production read-only dry-run on 11 Nov 2026, covering approval
-- events with that exact boilerplate from 4 Nov 00:00 UK, found
-- 100 listings. 11 can be restored: 4 by stripping the boilerplate
-- prefix from a note that still has real staff text after it
-- (including MK-20261110-7C1D37), and 7 by copying the most recent
-- recoverable staff note from moderation events or listing_notes
-- from before the approval. 1 listing already has a real note
-- (no-op). 88 have no recoverable real staff note (only import
-- templates, system lines, or the default importer pin-confirmation
-- sentence) and are skipped.
--
-- Backup: moderation_notes_restore_220_backup.
-- Rollback: scripts/rollback-220-restore-wiped-moderation-notes.sql.
-- Nothing is deleted.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS moderation_notes_restore_220_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  before_notes text,
  before_updated_at timestamptz,
  restored_notes text NOT NULL,
  restore_mode text NOT NULL,
  approval_at timestamptz,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);
