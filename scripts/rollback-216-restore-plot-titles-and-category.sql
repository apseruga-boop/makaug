-- Manual rollback for the batched plot title / category restore (216).
-- Not run by scripts/migrate.js. Restores listing_type, transaction_type,
-- price_period, property_type, title, extra_fields and updated_at from
-- plot_title_restore_216_backup. A listing that staff edited after the
-- repair (updated_at no longer equals applied_at, or the marker is gone)
-- is left as staff left it. The backup table is kept.
--
-- Triggers stay enabled (disabling trg_properties_updated_at takes an
-- ACCESS EXCLUSIVE lock, which is what helped take the site down when
-- 211 ran). Nothing is deleted.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG'
     AND COALESCE(current_setting('app.country_code', true), '') <> '' THEN
    RAISE NOTICE 'plot_title_216 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.plot_title_restore_216_backup') IS NULL THEN
    RAISE NOTICE 'plot_title_216 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE plot_title_216_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM plot_title_restore_216_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'category_title_restore_216';

  UPDATE properties p
  SET listing_type = b.before_row->>'listing_type',
      transaction_type = NULLIF(b.before_row->>'transaction_type', ''),
      price_period = b.before_row->>'price_period',
      property_type = b.before_row->>'property_type',
      title = b.before_row->>'title',
      extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
      updated_at = COALESCE((b.before_row->>'updated_at')::timestamptz, p.updated_at)
  FROM plot_title_restore_216_backup b
  JOIN plot_title_216_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE plot_title_restore_216_backup b
  SET rolled_back_at = clock_timestamp()
  FROM plot_title_216_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'plot_title_216 rolled_back %', v_restored;
END;
$rollback$;
