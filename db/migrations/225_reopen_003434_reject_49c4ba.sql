-- Two moderation reversals (Arthur, 14 Nov 2026).
--   a6662954 MK-20261112-003434  Kansanga rental, rejected 13 Nov 11:57:51 UK
--            ("No contacts"). Back to pending (in_review), rejected_at and
--            the "No contacts" reason cleared, notes kept plus a dated note.
--            The 3 photos removed 11:56:20-11:56:29 UK are put back from
--            extra_fields.staff_removed_images (the full property_images
--            records were kept there by the photo-remove action).
--   b9cbe819 MK-20261111-49C4BA  approved 13 Nov 08:48:03 UK with a human
--            override. Rejected, reason "No specific area", with a
--            listing_status_changed event like the normal reject.
-- Both are found-online listings: nothing is sent to anyone.
--
-- This file only creates the backup table. The row updates run after the
-- process is serving, from scripts/run-moderation-reversal-225.js
-- (scheduleStartupDataRepairs), matched by id AND reference AND the
-- 14 Nov state. Rollback: scripts/rollback-225-moderation-reversal.sql.
-- Re-running is a no-op.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS moderation_reversal_225_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  action text NOT NULL,
  before_row jsonb NOT NULL,
  restored_image_ids uuid[] NOT NULL DEFAULT '{}',
  before_updated_at timestamptz,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);
