-- Manual rollback for db/migrations/254_ronald_interested_call_list.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It deletes only the call_number_submissions rows this migration inserted
-- (how_known = migration_254_call_list, or the ids stored in the backup).
-- It does not send anything, and it keeps the backup table.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '30s';

DELETE FROM call_number_submissions s
 WHERE s.how_known = 'migration_254_call_list'
    OR s.id IN (
      SELECT inserted_submission_id
        FROM migration_254_ronald_call_list_backup
       WHERE inserted_submission_id IS NOT NULL
    );
