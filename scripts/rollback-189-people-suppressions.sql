-- Manual rollback for db/migrations/189_people_suppressions.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- Run it inside one transaction (psql --single-transaction) with
-- app.country_code set to UG, e.g. SET app.country_code = 'UG'.
--
-- Deploy the previous application first: this build reads
-- people_suppressions from the /api/people routes.
--
-- What it does:
--   1. Drops the trigger and people_skip_suppressed(), so the reconcile adds
--      every source person again.
--   2. Keeps the suppressions (who was deleted, by whom, when) by renaming
--      people_suppressions to people_suppressions_rolled_back_189. Nothing is
--      lost; drop it by hand once nobody needs it.
--   3. Runs people_reconcile('rollback_189'), which re-adds the deleted
--      people from the untouched source rows.
--   4. Reports the people count against the manifest taken by 189 and stamps
--      the manifest row restored_at. The backup table is kept.
-- The schema_migrations row is left, like every other rollback, so the
-- migration is not re-run on the next deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '300s';
SET LOCAL TIME ZONE 'UTC';

DROP TRIGGER IF EXISTS trg_people_skip_suppressed ON people;
DROP FUNCTION IF EXISTS people_skip_suppressed();

DO $rollback_189$
DECLARE
  b RECORD;
  n_people BIGINT;
  stats JSONB;
BEGIN
  IF to_regclass('public.people_suppressions') IS NOT NULL THEN
    IF to_regclass('public.people_suppressions_rolled_back_189') IS NOT NULL THEN
      RAISE EXCEPTION 'rollback_189: people_suppressions_rolled_back_189 already exists; rename it first';
    END IF;
    ALTER TABLE people_suppressions RENAME TO people_suppressions_rolled_back_189;
  END IF;

  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_189: app.country_code is not UG; trigger dropped, reconcile and manifest check skipped';
    RETURN;
  END IF;

  stats := people_reconcile('rollback_189', '256');
  SELECT count(*) INTO n_people FROM people;
  RAISE NOTICE 'rollback_189: people now % (reconcile people=%, inserted=%)',
    n_people, stats->>'people', stats->'written'->>'people_inserted';

  IF to_regclass('public.data_change_189_backup') IS NOT NULL THEN
    FOR b IN SELECT * FROM data_change_189_backup WHERE restored_at IS NULL LOOP
      RAISE NOTICE 'rollback_189: people before 189 = %, now = %', b.before_row->>'rows', n_people;
      UPDATE data_change_189_backup SET restored_at = NOW() WHERE id = b.id;
    END LOOP;
  END IF;
END
$rollback_189$;
