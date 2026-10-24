-- Manual rollback for db/migrations/170_correct_remaining_mislabelled_listings.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores the columns that migration changed, from listing_correction_170_backup,
-- and only while the row still carries extra_fields.listing_correction_170 and
-- updated_at is still the marker's applied_at. A later edit is left in place.
-- The backup table is kept.
-- Ntinda bfbc521d is not given a new price. Rolling that row back restores
-- the commercial-land title and category. It does not write UGX 17,100,000,000.

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
  bedrooms = (b.before_row->>'bedrooms')::integer,
  bathrooms = (b.before_row->>'bathrooms')::integer,
  price = (b.before_row->>'price')::numeric,
  price_original = (b.before_row->>'price_original')::numeric,
  price_currency = b.before_row->>'price_currency',
  price_original_currency = b.before_row->>'price_original_currency',
  price_period = b.before_row->>'price_period',
  price_fx_rate_ugx = (b.before_row->>'price_fx_rate_ugx')::numeric,
  price_fx_as_of = (b.before_row->>'price_fx_as_of')::timestamptz,
  price_on_application = COALESCE((b.before_row->>'price_on_application')::boolean, FALSE),
  area = b.before_row->>'area',
  district = b.before_row->>'district',
  latitude = (b.before_row->>'latitude')::numeric,
  longitude = (b.before_row->>'longitude')::numeric,
  land_size_value = (b.before_row->>'land_size_value')::numeric,
  land_size_unit = b.before_row->>'land_size_unit',
  status = b.before_row->>'status',
  moderation_stage = b.before_row->>'moderation_stage',
  extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
  updated_at = (b.before_row->>'updated_at')::timestamptz
FROM listing_correction_170_backup b
WHERE current_setting('app.country_code', true) = 'UG'
  AND p.id = b.property_id
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_170'
  AND p.updated_at = (p.extra_fields->'listing_correction_170'->>'applied_at')::timestamptz;
