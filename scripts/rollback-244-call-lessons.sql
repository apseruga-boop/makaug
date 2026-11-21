-- Rollback for migration 244: King's call notes are lost if you run this.
BEGIN;
DROP TABLE IF EXISTS call_lessons;
DELETE FROM schema_migrations WHERE filename = '244_call_lessons.sql';
COMMIT;
