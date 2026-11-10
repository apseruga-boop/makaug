-- Manual rollback for the batched area-centre auto-pin (217).
-- Not run by scripts/migrate.js. Removes the pin only while the listing
-- still carries batch auto_pin_20261110 and still sits on the pin that
-- the runner wrote (rounded to 6 decimal places). Area and district go
-- back to the backed-up values (needed for the two title-only pins).
-- The extra_fields keys the runner wrote go back to their backed-up
-- values; keys added since are kept. updated_at is not changed. A
-- listing moved or edited since is left in place. The backup table
-- is kept.
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
    RAISE NOTICE 'auto_pin_217 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.auto_pin_217_backup') IS NULL THEN
    RAISE NOTICE 'auto_pin_217 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE auto_pin_217_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM auto_pin_217_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND COALESCE(p.extra_fields->'coords_fix'->>'batch', '') = 'auto_pin_20261110'
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND round(p.latitude::numeric, 6) = round(b.new_latitude::numeric, 6)
    AND round(p.longitude::numeric, 6) = round(b.new_longitude::numeric, 6);

  UPDATE properties p
  SET latitude = b.old_latitude,
      longitude = b.old_longitude,
      area = b.old_area,
      district = b.old_district,
      extra_fields = (COALESCE(p.extra_fields, '{}'::jsonb)
          - 'auto_pinned' - 'auto_pin_note' - 'location_precision'
          - 'location_confidence' - 'geocoding_provider' - 'coords_fix'
          - 'canonical_location_id')
        || jsonb_strip_nulls(jsonb_build_object(
          'auto_pinned', b.extra_fields->'auto_pinned',
          'auto_pin_note', b.extra_fields->'auto_pin_note',
          'location_precision', b.extra_fields->'location_precision',
          'location_confidence', b.extra_fields->'location_confidence',
          'geocoding_provider', b.extra_fields->'geocoding_provider',
          'coords_fix', b.extra_fields->'coords_fix',
          'canonical_location_id', b.extra_fields->'canonical_location_id'
        )),
      updated_at = p.updated_at
  FROM auto_pin_217_backup b
  JOIN auto_pin_217_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE auto_pin_217_backup b
  SET rolled_back_at = clock_timestamp()
  FROM auto_pin_217_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'auto_pin_217 rolled_back %', v_restored;
END;
$rollback$;
