-- Rollback for migration 246: staff photos, ID details and emergency contacts are lost if you run this.
BEGIN;
DROP TABLE IF EXISTS staff_profiles;
DELETE FROM schema_migrations WHERE filename = '246_staff_profiles.sql';
COMMIT;
