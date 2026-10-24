-- Manual rollback for db/migrations/171_fix_flagged_map_pins.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores latitude, longitude and extra_fields from map_pin_fix_171_backup
-- only while the row still carries map_pin_fix_171 and the coordinates are
-- still the ones that migration wrote (rounded to 6 decimal places).
-- A later edit is left in place. The backup table is kept.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

UPDATE properties p
SET
  latitude = b.old_latitude,
  longitude = b.old_longitude,
  extra_fields = COALESCE(b.extra_fields, '{}'::jsonb),
  updated_at = b.updated_at
FROM map_pin_fix_171_backup b
WHERE current_setting('app.country_code', true) = 'UG'
  AND p.id = b.property_id
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'map_pin_fix_171'
  AND round(p.latitude::numeric, 6) = round(b.new_latitude::numeric, 6)
  AND round(p.longitude::numeric, 6) = round(b.new_longitude::numeric, 6);
