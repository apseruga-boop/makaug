-- Manual rollback for db/migrations/175_clear_seeta_bedrooms_and_kigo_pin.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores bedrooms, area, district, coordinates, extra_fields and
-- updated_at from listing_correction_175_backup, and only while the row still
-- carries extra_fields.listing_correction_175 and updated_at is still the
-- marker's applied_at. That puts the Hoima listing's Wakiso/Kigo labels back
-- and leaves its pin untouched when the backup pin is the Hoima centroid.
-- A later edit is left in place. The backup table is kept.
-- Titles, prices and status are not written.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

UPDATE properties p
SET
  bedrooms = CASE
    WHEN b.before_row->>'bedrooms' IS NULL OR b.before_row->>'bedrooms' = '' THEN NULL
    ELSE (b.before_row->>'bedrooms')::integer
  END,
  area = b.before_row->>'area',
  district = b.before_row->>'district',
  latitude = CASE
    WHEN b.before_row->>'latitude' IS NULL OR b.before_row->>'latitude' = '' THEN NULL
    ELSE (b.before_row->>'latitude')::numeric
  END,
  longitude = CASE
    WHEN b.before_row->>'longitude' IS NULL OR b.before_row->>'longitude' = '' THEN NULL
    ELSE (b.before_row->>'longitude')::numeric
  END,
  extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
  updated_at = (b.before_row->>'updated_at')::timestamptz
FROM listing_correction_175_backup b
WHERE current_setting('app.country_code', true) = 'UG'
  AND p.id = b.property_id
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_175'
  AND p.updated_at = (p.extra_fields->'listing_correction_175'->>'applied_at')::timestamptz;
