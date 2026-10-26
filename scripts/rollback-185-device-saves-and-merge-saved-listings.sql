-- Manual rollback for db/migrations/185_device_saves_and_merge_saved_listings.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- Run it inside one transaction (psql --single-transaction) with
-- app.country_code set to UG, e.g. SET app.country_code = 'UG'.
--
-- Deploy the previous code first: the old code reads saved_listings and
-- expects saved_properties.user_id to be set.
--
-- 1. Rows the migration copied from saved_listings (source
--    'saved_listings_185') are deleted from saved_properties.
--    saved_listings was never changed, so nothing is restored there.
-- 2. saved_properties rows the migration merged into get their note and
--    list name back from the backup.
-- 3. Device-only saves (user_id IS NULL) cannot exist under the old schema.
--    They are copied into data_change_185_backup (row_kind 'device_save')
--    and then deleted, so NOT NULL can come back. Account saves stay.
-- 4. The new columns, constraints and indexes are dropped. saved_searches
--    rows created for devices stay (the old schema already allowed them);
--    only the alert_scope column is dropped.
-- Backup rows are stamped restored_at. The backup table is kept.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback_185$
DECLARE
  b RECORD;
  n INTEGER;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_185 skipped: app.country_code is not UG';
    RETURN;
  END IF;
  IF to_regclass('public.data_change_185_backup') IS NULL THEN
    RAISE NOTICE 'rollback_185 skipped: backup table missing';
    RETURN;
  END IF;

  DELETE FROM saved_properties WHERE source = 'saved_listings_185';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'rollback_185: % copied rows removed', n;

  FOR b IN SELECT * FROM data_change_185_backup WHERE row_kind = 'saved_property' AND restored_at IS NULL LOOP
    UPDATE saved_properties
    SET note = b.before_row->>'note',
        list_name = COALESCE(b.before_row->>'list_name', 'Saved')
    WHERE id = b.row_key::uuid;
    UPDATE data_change_185_backup SET restored_at = NOW() WHERE id = b.id;
  END LOOP;
  UPDATE data_change_185_backup SET restored_at = NOW() WHERE row_kind = 'saved_listing' AND restored_at IS NULL;

  INSERT INTO data_change_185_backup (row_kind, row_key, before_row)
  SELECT 'device_save', sp.id::text, to_jsonb(sp) FROM saved_properties sp WHERE sp.user_id IS NULL
  ON CONFLICT (row_kind, row_key) DO NOTHING;
  DELETE FROM saved_properties WHERE user_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'rollback_185: % device-only saves archived to the backup table and removed', n;
END
$rollback_185$;

DROP INDEX IF EXISTS idx_saved_properties_device_property_anon;
DROP INDEX IF EXISTS idx_saved_properties_device_created;
DROP INDEX IF EXISTS idx_saved_properties_created;
DROP INDEX IF EXISTS idx_saved_searches_guest_session;
ALTER TABLE saved_properties DROP CONSTRAINT IF EXISTS saved_properties_owner_present;
ALTER TABLE saved_properties DROP CONSTRAINT IF EXISTS saved_properties_device_id_shape;
ALTER TABLE saved_properties
  DROP COLUMN IF EXISTS device_id,
  DROP COLUMN IF EXISTS list_name,
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS source;
ALTER TABLE saved_properties ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE saved_searches DROP COLUMN IF EXISTS alert_scope;
