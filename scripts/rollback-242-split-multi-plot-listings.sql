-- Manual rollback for data fix 242 (split combined adverts and the
-- Namanve USD price). Not run by scripts/migrate.js.
--
-- Source rows still exactly as the fix left them (updated_at equals
-- applied_at and the marker is present) are restored from the backup.
-- A row staff edited afterwards is left as staff left it.
--
-- New listings created by the fix are deleted only if they are still
-- pending, still carry the marker, and have not been edited since.
-- Their images and moderation events cascade. Nothing is sent, and
-- the backup table is kept.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DO $rollback$
DECLARE
  v_restored int := 0;
  v_removed int := 0;
BEGIN
  IF to_regclass('public.split_multi_plot_listings_242_backup') IS NULL THEN
    RAISE NOTICE 'split_multi_plot_listings_242 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE split_242_restore_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM split_multi_plot_listings_242_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND b.action IN ('update_source', 'update_price')
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'split_listings_242';

  UPDATE properties p
  SET title = b.before_row->>'title',
      description = b.before_row->>'description',
      area = b.before_row->>'area',
      district = b.before_row->>'district',
      address = b.before_row->>'address',
      property_type = b.before_row->>'property_type',
      title_type = b.before_row->>'title_type',
      land_size_value = NULLIF(b.before_row->>'land_size_value', '')::numeric,
      land_size_unit = b.before_row->>'land_size_unit',
      price = NULLIF(b.before_row->>'price', '')::bigint,
      price_period = b.before_row->>'price_period',
      price_currency = COALESCE(b.before_row->>'price_currency', p.price_currency),
      price_original = NULLIF(b.before_row->>'price_original', '')::numeric,
      price_original_currency = b.before_row->>'price_original_currency',
      price_fx_rate_ugx = NULLIF(b.before_row->>'price_fx_rate_ugx', '')::numeric,
      price_fx_as_of = NULLIF(b.before_row->>'price_fx_as_of', '')::timestamptz,
      price_on_application = COALESCE((b.before_row->>'price_on_application')::boolean, p.price_on_application),
      latitude = NULLIF(b.before_row->>'latitude', '')::numeric,
      longitude = NULLIF(b.before_row->>'longitude', '')::numeric,
      moderation_notes = b.before_row->>'moderation_notes',
      extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
      updated_at = COALESCE(b.before_updated_at, p.updated_at)
  FROM split_multi_plot_listings_242_backup b
  JOIN split_242_restore_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  CREATE TEMP TABLE split_242_remove_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM split_multi_plot_listings_242_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND b.action = 'create_split'
    AND p.status = 'pending'
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'split_listings_242';

  DELETE FROM properties p
  USING split_242_remove_ids r
  WHERE p.id = r.property_id;

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE split_multi_plot_listings_242_backup b
  SET rolled_back_at = clock_timestamp()
  FROM (
    SELECT property_id FROM split_242_restore_ids
    UNION
    SELECT property_id FROM split_242_remove_ids
  ) x
  WHERE b.property_id = x.property_id
    AND b.rolled_back_at IS NULL;

  RAISE NOTICE 'split_multi_plot_listings_242 rolled_back restored=% removed=%', v_restored, v_removed;
END;
$rollback$;
