-- Rollback for migration 248: the logged missed calls are lost if you run this.
BEGIN;
DROP TABLE IF EXISTS call_missed;
DELETE FROM schema_migrations WHERE filename = '248_call_missed.sql';
COMMIT;
