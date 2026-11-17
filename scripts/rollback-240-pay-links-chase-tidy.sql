-- Rollback for db/migrations/240_pay_links_chase_tidy.sql.
-- Puts back the before values of every row 240 touched. The is_test column is
-- left in place (harmless, defaults to FALSE); drop it only if no code reads it.
BEGIN;
UPDATE pay_links l SET is_test = b.before_is_test, updated_at = NOW()
  FROM pay_links_chase_240_backup b WHERE b.pay_link_id = l.id AND b.change = 'is_test';
UPDATE pay_links l SET sent_at = b.before_sent_at, sent_status = b.before_sent_status, updated_at = NOW()
  FROM pay_links_chase_240_backup b WHERE b.pay_link_id = l.id AND b.change LIKE 'sent_at:%';
COMMIT;
-- Optional, after reverting the code: ALTER TABLE pay_links DROP COLUMN IF EXISTS is_test;
