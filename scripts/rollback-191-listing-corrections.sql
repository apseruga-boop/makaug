-- Manual rollback for db/migrations/191_moderator_listing_corrections_27oct.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores the four listings from listing_correction_191_backup, but only
-- while a listing still carries extra_fields.listing_correction_191 and
-- updated_at still equals that marker's applied_at. A later edit is left in
-- place. The A64E8E video OCR row gets its stored parsed_facts back. The
-- backup table is kept. No photos or image rows are touched.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE listing_correction_191_rollback_ids (id uuid PRIMARY KEY);

INSERT INTO listing_correction_191_rollback_ids (id)
SELECT p.id
FROM properties p
WHERE current_setting('app.country_code', true) = 'UG'
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_191'
  AND p.updated_at = (p.extra_fields->'listing_correction_191'->>'applied_at')::timestamptz;

ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;

UPDATE property_video_ocr AS o
SET parsed_facts = b.before_row->'parsed_facts'
FROM listing_correction_191_backup b
JOIN listing_correction_191_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'video_ocr'
  AND o.property_id = b.property_id;

UPDATE properties AS p
SET
  title = b.before_row->>'title',
  latitude = (b.before_row->>'latitude')::numeric,
  longitude = (b.before_row->>'longitude')::numeric,
  price_unit = b.before_row->>'price_unit',
  extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
  updated_at = (b.before_row->>'updated_at')::timestamptz
FROM listing_correction_191_backup b
JOIN listing_correction_191_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'property'
  AND p.id = b.property_id;

ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;

DROP TABLE listing_correction_191_rollback_ids;
