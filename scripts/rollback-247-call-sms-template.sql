-- Rollback for db/migrations/247_call_sms_template.sql. Drops only the template column
-- (the SMS log rows stay). Run by hand: psql "$DATABASE_URL" -f scripts/rollback-247-call-sms-template.sql
BEGIN;
ALTER TABLE call_sms_log DROP COLUMN IF EXISTS template;
DELETE FROM schema_migrations WHERE filename = '247_call_sms_template.sql';
COMMIT;
