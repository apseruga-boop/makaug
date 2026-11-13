-- Manual rollback for data fix 224 (Benard Gaita's Mukono listing and
-- its duplicate). Not run by scripts/migrate.js. Puts the backed-up
-- columns back for rows still exactly as the fix left them (updated_at
-- equals applied_at and the marker is present). A row staff edited
-- afterwards is left as staff left it. The moderation events and the
-- backup table are kept. Nothing is deleted.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF to_regclass('public.benard_mukono_fix_224_backup') IS NULL THEN
    RAISE NOTICE 'benard_mukono_fix_224 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE benard_mukono_224_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM benard_mukono_fix_224_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'benard_mukono_fix_224';

  UPDATE properties p
  SET title = b.before_row->>'title',
      description = b.before_row->>'description',
      area = b.before_row->>'area',
      district = b.before_row->>'district',
      address = b.before_row->>'address',
      latitude = NULLIF(b.before_row->>'latitude', '')::numeric,
      longitude = NULLIF(b.before_row->>'longitude', '')::numeric,
      bedrooms = NULLIF(b.before_row->>'bedrooms', '')::int,
      bathrooms = NULLIF(b.before_row->>'bathrooms', '')::int,
      status = b.before_row->>'status',
      availability_status = b.before_row->>'availability_status',
      moderation_stage = b.before_row->>'moderation_stage',
      moderation_notes = b.before_row->>'moderation_notes',
      extra_fields = b.before_row->'extra_fields',
      updated_at = COALESCE(b.before_updated_at, p.updated_at)
  FROM benard_mukono_fix_224_backup b
  JOIN benard_mukono_224_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE benard_mukono_fix_224_backup b
  SET rolled_back_at = clock_timestamp()
  FROM benard_mukono_224_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'benard_mukono_fix_224 rolled_back %', v_restored;
END;
$rollback$;
