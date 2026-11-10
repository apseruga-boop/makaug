-- Manual rollback for db/migrations/215_st_listing_strip_contradictory_price_text.sql.
-- Not run by scripts/migrate.js. Restores description and removes the
-- description_price_cleanup_215 extra_fields key from
-- st_listing_desc_price_215_backup. A listing that staff edited after the
-- cleanup (description no longer equals after_description) is left as staff
-- left it. The backup table is kept.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_215 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.st_listing_desc_price_215_backup') IS NULL THEN
    RAISE NOTICE 'migration_215 rollback skipped no_backup';
    RETURN;
  END IF;

  UPDATE st_listing l
     SET description = b.before_description,
         extra_fields = COALESCE(l.extra_fields, '{}'::jsonb) - 'description_price_cleanup_215',
         updated_at = NOW()
    FROM st_listing_desc_price_215_backup b
   WHERE l.id = b.listing_id
     AND b.rolled_back_at IS NULL
     AND l.description IS NOT DISTINCT FROM b.after_description;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE st_listing_desc_price_215_backup b
     SET rolled_back_at = NOW()
    FROM st_listing l
   WHERE b.listing_id = l.id
     AND b.rolled_back_at IS NULL
     AND (
       l.description IS NOT DISTINCT FROM b.before_description
       OR NOT (COALESCE(l.extra_fields, '{}'::jsonb) ? 'description_price_cleanup_215')
     );

  RAISE NOTICE 'migration_215 rollback restored % short-stay descriptions', v_restored;
END
$rollback$;
