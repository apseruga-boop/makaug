-- Manual rollback for db/migrations/181_marketplace_directory_cleanup.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- Run it inside one transaction (psql --single-transaction) with
-- app.country_code set to UG, e.g. SET app.country_code = 'UG'.
--
-- For every open row in marketplace_cleanup_181_backup it restores name,
-- category, status, moderation_notes and branch_group_key, each field only
-- while it still holds the value 181 wrote. A later edit by staff, the owner
-- or the Google refresh is left in place. Rows are never deleted. The backup
-- table and the branch_group_key column are kept (the application reads the
-- column); backup rows are stamped rolled_back_at so 181 can be re-applied.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

UPDATE marketplace_businesses b
   SET name = CASE WHEN b.name IS NOT DISTINCT FROM k.after_row->>'name' THEN k.before_row->>'name' ELSE b.name END,
       category = CASE WHEN b.category IS NOT DISTINCT FROM k.after_row->>'category' THEN k.before_row->>'category' ELSE b.category END,
       status = CASE WHEN b.status IS NOT DISTINCT FROM k.after_row->>'status' THEN k.before_row->>'status' ELSE b.status END,
       moderation_notes = CASE WHEN b.moderation_notes IS NOT DISTINCT FROM k.after_row->>'moderation_notes' THEN k.before_row->>'moderation_notes' ELSE b.moderation_notes END,
       branch_group_key = CASE WHEN b.branch_group_key IS NOT DISTINCT FROM k.after_row->>'branch_group_key' THEN k.before_row->>'branch_group_key' ELSE b.branch_group_key END
  FROM marketplace_cleanup_181_backup k
 WHERE k.business_id = b.id
   AND k.rolled_back_at IS NULL
   AND k.after_row IS NOT NULL
   AND current_setting('app.country_code', true) = 'UG';

UPDATE marketplace_cleanup_181_backup
   SET rolled_back_at = NOW()
 WHERE rolled_back_at IS NULL
   AND current_setting('app.country_code', true) = 'UG';
