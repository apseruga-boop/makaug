-- Manual rollback for db/migrations/188_people_master_contact_list.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- Run it inside one transaction (psql --single-transaction) with
-- app.country_code set to UG, e.g. SET app.country_code = 'UG'.
--
-- Deploy the previous application first: this build reads people and calls
-- people_reconcile() from its scheduler and the /api/people routes.
--
-- Migration 188 never wrote a source row (users, contacts, leads,
-- whatsapp_user_profiles, property_seeker_profiles). The people list is
-- derived, so rolling back means dropping it:
--   1. Compare each source table with the manifest taken before the backfill
--      and report it (a table may have grown since; a smaller count or a
--      missing id is reported, it was not caused by 188).
--   2. Drop people_links, people, people_reconcile_runs and the functions.
--   3. Stamp the manifest rows restored_at. The backup table is kept.
--   4. Drop the poll's change-probe indexes. idx_saved_properties_created is
--      kept: migration 185 creates the same index.
-- people_consent_records is kept: it is the record of who agreed in person.
-- The schema_migrations row is left, like every other rollback, so the
-- migration is not re-run on the next deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback_188$
DECLARE
  b RECORD;
  now_rows BIGINT;
  n_people BIGINT;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_188 skipped: app.country_code is not UG';
    RETURN;
  END IF;

  IF to_regclass('public.data_change_188_backup') IS NOT NULL THEN
    FOR b IN SELECT * FROM data_change_188_backup WHERE row_kind = 'source_manifest' AND restored_at IS NULL LOOP
      EXECUTE format('SELECT count(*) FROM %I', b.row_key) INTO now_rows;
      RAISE NOTICE 'rollback_188 source % rows: before=% now=%', b.row_key, b.before_row->>'rows', now_rows;
      IF now_rows < (b.before_row->>'rows')::bigint THEN
        RAISE NOTICE 'rollback_188 source % has fewer rows than before migration 188 (188 never deletes; check other changes)', b.row_key;
      END IF;
      UPDATE data_change_188_backup SET restored_at = NOW() WHERE id = b.id;
    END LOOP;
  ELSE
    RAISE NOTICE 'rollback_188: backup table missing, dropping the people list only';
  END IF;

  IF to_regclass('public.people') IS NOT NULL THEN
    SELECT count(*) INTO n_people FROM people;
    RAISE NOTICE 'rollback_188 dropping people list (% people)', n_people;
  END IF;
END
$rollback_188$;

DROP FUNCTION IF EXISTS people_reconcile(TEXT, TEXT);
DROP TABLE IF EXISTS people_links;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS people_reconcile_runs;
DROP FUNCTION IF EXISTS people_normalize_email(TEXT);
DROP FUNCTION IF EXISTS people_normalize_phone(TEXT, TEXT);
DROP FUNCTION IF EXISTS people_try_bool(TEXT);
DROP FUNCTION IF EXISTS people_try_ts(TEXT);
DROP INDEX IF EXISTS idx_users_people_change;
DROP INDEX IF EXISTS idx_contacts_people_change;
DROP INDEX IF EXISTS idx_leads_people_change;
DROP INDEX IF EXISTS idx_whatsapp_user_profiles_people_change;
DROP INDEX IF EXISTS idx_property_seeker_profiles_people_change;
DROP INDEX IF EXISTS idx_saved_searches_people_change;
