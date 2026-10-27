-- Manual rollback for db/migrations/187_pending_whatsapp_alerts.sql.
-- Not in db/migrations, so scripts/migrate.js does not run it. Run inside one
-- transaction (psql --single-transaction) with SET app.country_code = 'UG'.
-- Deploy the previous code first (it does not use these tables).
-- Rows are archived into data_change_187_backup before the tables go.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback_187$
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_187 skipped: app.country_code is not UG';
    RETURN;
  END IF;
  IF to_regclass('public.pending_whatsapp_alerts') IS NOT NULL THEN
    INSERT INTO data_change_187_backup (row_kind, row_key, before_row)
    SELECT 'pending_whatsapp_alert', a.id::text, to_jsonb(a) FROM pending_whatsapp_alerts a
    ON CONFLICT (row_kind, row_key) DO NOTHING;
  END IF;
  DROP TABLE IF EXISTS pending_whatsapp_alert_listings;
  DROP TABLE IF EXISTS pending_whatsapp_alerts;
END
$rollback_187$;
