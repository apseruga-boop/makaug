-- Commission cut-off moves from the 20th to the 23rd (16 Nov 2026)
--
-- Arthur, 16 Nov 2026 13:37 UK: agents who clear the 7-day hold by the 23rd
-- are paid on that month's 25th (so the first payout can be 25 Nov 2026).
-- That leaves two days between the cut-off and payday for the admin review.
--
-- Changes one row (commission_settings key 'default') and the column default.
-- Only moves the cut-off if it is still the 20th, so a value King has since
-- changed in the tab is left alone. The old row is kept in a backup table.
--
-- Rollback:
--   UPDATE commission_settings s SET cutoff_day = b.cutoff_day, updated_by = b.updated_by, updated_at = b.updated_at
--     FROM commission_settings_backup_228 b WHERE s.key = b.key;
--   ALTER TABLE commission_settings ALTER COLUMN cutoff_day SET DEFAULT 20;
--   DROP TABLE commission_settings_backup_228;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS commission_settings_backup_228 AS
  SELECT *, NOW() AS backed_up_at FROM commission_settings WHERE key = 'default';

ALTER TABLE commission_settings ALTER COLUMN cutoff_day SET DEFAULT 23;

UPDATE commission_settings
   SET cutoff_day = 23, updated_by = 'migration 228 (Arthur, 16 Nov 2026 13:37)', updated_at = NOW()
 WHERE key = 'default' AND cutoff_day = 20;

INSERT INTO commission_audit (action, actor, details)
SELECT 'settings_saved', 'migration 228', jsonb_build_object('cutoff_day', 23, 'was', 20, 'approved_by', 'Arthur, 16 Nov 2026 13:37 UK')
 WHERE EXISTS (SELECT 1 FROM commission_settings WHERE key = 'default' AND cutoff_day = 23)
   AND NOT EXISTS (SELECT 1 FROM commission_audit WHERE actor = 'migration 228');
