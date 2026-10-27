-- Manual rollback for db/migrations/192_auto_pin_unpinned_listings.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It removes the pin only while the listing still carries batch
-- auto_pin_20261027 and still sits on the pin that migration wrote (rounded
-- to 6 decimal places). The extra_fields keys the migration wrote go back to
-- their backed-up values; keys added since are kept. updated_at is not
-- changed. A listing moved or edited since is left in place. The backup
-- table is kept.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;

UPDATE properties p
SET
  latitude = b.old_latitude,
  longitude = b.old_longitude,
  extra_fields = (COALESCE(p.extra_fields, '{}'::jsonb)
      - 'auto_pinned' - 'auto_pin_note' - 'location_precision'
      - 'location_confidence' - 'geocoding_provider' - 'coords_fix')
    || jsonb_strip_nulls(jsonb_build_object(
      'auto_pinned', b.extra_fields->'auto_pinned',
      'auto_pin_note', b.extra_fields->'auto_pin_note',
      'location_precision', b.extra_fields->'location_precision',
      'location_confidence', b.extra_fields->'location_confidence',
      'geocoding_provider', b.extra_fields->'geocoding_provider',
      'coords_fix', b.extra_fields->'coords_fix'
    )),
  updated_at = p.updated_at
FROM auto_pin_192_backup b
WHERE current_setting('app.country_code', true) = 'UG'
  AND p.id = b.property_id
  AND p.extra_fields->'coords_fix'->>'batch' = 'auto_pin_20261027'
  AND round(p.latitude::numeric, 6) = round(b.new_latitude::numeric, 6)
  AND round(p.longitude::numeric, 6) = round(b.new_longitude::numeric, 6);

ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
