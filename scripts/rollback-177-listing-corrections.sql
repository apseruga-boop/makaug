-- Manual rollback for db/migrations/177_marketing_recheck_fixes.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- It restores property columns, deleted property_images rows, and reordered
-- photo flags from listing_correction_177_backup, and only while the property
-- still carries extra_fields.listing_correction_177 and updated_at is still
-- that marker's applied_at. A later edit is left in place. The backup table
-- is kept. Removed video objects come back with the property extra_fields
-- snapshot, which was taken before the video was removed.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE listing_correction_177_rollback_ids (id uuid PRIMARY KEY);

INSERT INTO listing_correction_177_rollback_ids (id)
SELECT p.id
FROM properties p
WHERE current_setting('app.country_code', true) = 'UG'
  AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_177'
  AND p.updated_at = (p.extra_fields->'listing_correction_177'->>'applied_at')::timestamptz;

INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key, room_label, created_at)
SELECT
  (b.before_row->>'id')::uuid,
  (b.before_row->>'property_id')::uuid,
  b.before_row->>'url',
  COALESCE((b.before_row->>'is_primary')::boolean, FALSE),
  COALESCE((b.before_row->>'sort_order')::integer, 0),
  NULLIF(b.before_row->>'slot_key', ''),
  NULLIF(b.before_row->>'room_label', ''),
  COALESCE((b.before_row->>'created_at')::timestamptz, NOW())
FROM listing_correction_177_backup b
JOIN listing_correction_177_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'property_image'
  AND b.action = 'delete_image'
  AND NOT EXISTS (
    SELECT 1 FROM property_images i WHERE i.id = (b.before_row->>'id')::uuid
  );

UPDATE property_images AS image
SET
  is_primary = COALESCE((b.before_row->>'is_primary')::boolean, FALSE),
  sort_order = COALESCE((b.before_row->>'sort_order')::integer, 0),
  room_label = NULLIF(b.before_row->>'room_label', '')
FROM listing_correction_177_backup b
JOIN listing_correction_177_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'property_image'
  AND b.action = 'reorder_image'
  AND image.id = (b.before_row->>'id')::uuid;

UPDATE property_images AS image
SET room_label = NULLIF(b.before_row->>'room_label', '')
FROM listing_correction_177_backup b
JOIN listing_correction_177_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'image_caption'
  AND b.action = 'clear_caption'
  AND image.id = (b.before_row->>'id')::uuid;

DO $rollback_177_ad_previews$
BEGIN
  IF to_regclass('public.advertising_placements') IS NULL THEN
    RETURN;
  END IF;
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RETURN;
  END IF;
  UPDATE advertising_placements AS placement
  SET preview_image_url = b.before_row->>'preview_image_url'
  FROM listing_correction_177_backup b
  WHERE b.row_kind = 'advertising_placement'
    AND b.action = 'retarget_preview'
    AND placement.key = b.row_key;
END
$rollback_177_ad_previews$;

UPDATE properties AS p
SET
  title = b.before_row->>'title',
  description = b.before_row->>'description',
  listing_type = b.before_row->>'listing_type',
  transaction_type = b.before_row->>'transaction_type',
  property_type = b.before_row->>'property_type',
  area = b.before_row->>'area',
  district = b.before_row->>'district',
  price = (b.before_row->>'price')::numeric,
  price_unit = b.before_row->>'price_unit',
  price_period = b.before_row->>'price_period',
  price_on_application = COALESCE((b.before_row->>'price_on_application')::boolean, FALSE),
  land_size_value = (b.before_row->>'land_size_value')::numeric,
  land_size_unit = b.before_row->>'land_size_unit',
  extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
  updated_at = (b.before_row->>'updated_at')::timestamptz
FROM listing_correction_177_backup b
JOIN listing_correction_177_rollback_ids r ON r.id = b.property_id
WHERE b.row_kind = 'property'
  AND p.id = b.property_id;

DROP TABLE listing_correction_177_rollback_ids;
