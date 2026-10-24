-- Manual rollback for db/migrations/178_namuseera_location_and_gayaza_captions.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores the Namuseera property columns and the Gayaza photo captions
-- from listing_correction_178_backup, and only while the property still
-- carries extra_fields.listing_correction_178 and updated_at is still that
-- marker's applied_at. A later edit is left in place. The backup table is
-- kept. Photo files are not touched.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE listing_correction_178_rollback_ids (id uuid PRIMARY KEY);

INSERT INTO listing_correction_178_rollback_ids (id)
SELECT p.id
FROM properties p
WHERE current_setting('app.country_code', true) = 'UG'
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_178'
  AND p.updated_at = (p.extra_fields->'listing_correction_178'->>'applied_at')::timestamptz;

UPDATE property_images AS image
SET room_label = NULLIF(b.before_row->>'room_label', '')
FROM listing_correction_178_backup b
JOIN listing_correction_178_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'image_caption'
  AND b.action = 'clear_caption'
  AND image.id = (b.before_row->>'id')::uuid;

UPDATE properties AS p
SET
  title = b.before_row->>'title',
  description = b.before_row->>'description',
  listing_type = b.before_row->>'listing_type',
  transaction_type = b.before_row->>'transaction_type',
  property_type = b.before_row->>'property_type',
  status = COALESCE(b.before_row->>'status', p.status),
  area = b.before_row->>'area',
  district = b.before_row->>'district',
  address = b.before_row->>'address',
  price = (b.before_row->>'price')::numeric,
  price_unit = b.before_row->>'price_unit',
  price_period = b.before_row->>'price_period',
  price_on_application = COALESCE((b.before_row->>'price_on_application')::boolean, FALSE),
  land_size_value = (b.before_row->>'land_size_value')::numeric,
  land_size_unit = b.before_row->>'land_size_unit',
  extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
  updated_at = (b.before_row->>'updated_at')::timestamptz
FROM listing_correction_178_backup b
JOIN listing_correction_178_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'property'
  AND p.id = b.property_id;

DROP TABLE listing_correction_178_rollback_ids;
