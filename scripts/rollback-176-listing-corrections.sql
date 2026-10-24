-- Manual rollback for db/migrations/176_correct_makerere_building_listing.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores the columns that migration changed, from
-- listing_correction_176_backup, and only while the row still carries
-- extra_fields.listing_correction_176 and updated_at is still the marker's
-- applied_at. A later edit is left in place. The backup table is kept.
-- Price, photos, video, lister and location were not written by the
-- migration. This rollback does not write them either.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

UPDATE properties p
SET
  title = b.before_row->>'title',
  description = b.before_row->>'description',
  listing_type = b.before_row->>'listing_type',
  transaction_type = b.before_row->>'transaction_type',
  property_type = b.before_row->>'property_type',
  land_size_value = (b.before_row->>'land_size_value')::numeric,
  land_size_unit = b.before_row->>'land_size_unit',
  price_period = b.before_row->>'price_period',
  extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
  updated_at = (b.before_row->>'updated_at')::timestamptz
FROM listing_correction_176_backup b
WHERE current_setting('app.country_code', true) = 'UG'
  AND p.id = b.property_id
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_176'
  AND p.updated_at = (p.extra_fields->'listing_correction_176'->>'applied_at')::timestamptz;
