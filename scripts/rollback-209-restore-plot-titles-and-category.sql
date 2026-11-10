-- Manual rollback for db/migrations/209_restore_plot_titles_and_category.sql.
-- Not run by scripts/migrate.js. Restores listing_type, transaction_type,
-- price_period, property_type, title, extra_fields and updated_at from
-- plot_title_restore_209_backup. A listing that staff edited after the
-- repair (updated_at no longer equals applied_at, or the marker is gone)
-- is left as staff left it. The backup table is kept.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $rollback$
DECLARE
  v_has_trigger boolean;
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'plot_title_209 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.plot_title_restore_209_backup') IS NULL THEN
    RAISE NOTICE 'plot_title_209 rollback skipped no_backup';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_properties_updated_at'
      AND tgrelid = 'properties'::regclass
      AND NOT tgisinternal
  ) INTO v_has_trigger;

  CREATE TEMP TABLE plot_title_209_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM plot_title_restore_209_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'category_title_restore_209';

  IF v_has_trigger THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  UPDATE properties p
  SET listing_type = b.before_row->>'listing_type',
      transaction_type = NULLIF(b.before_row->>'transaction_type', ''),
      price_period = b.before_row->>'price_period',
      property_type = b.before_row->>'property_type',
      title = b.before_row->>'title',
      extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
      updated_at = COALESCE((b.before_row->>'updated_at')::timestamptz, p.updated_at)
  FROM plot_title_restore_209_backup b
  JOIN plot_title_209_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE plot_title_restore_209_backup b
  SET rolled_back_at = clock_timestamp()
  FROM plot_title_209_rollback_ids r
  WHERE b.property_id = r.property_id;

  IF v_has_trigger THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;

  RAISE NOTICE 'plot_title_209 rolled_back %', v_restored;
END;
$rollback$;
