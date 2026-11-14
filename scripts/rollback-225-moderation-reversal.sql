-- Manual rollback for data fix 225. Not run by scripts/migrate.js.
-- For rows still exactly as the fix left them (updated_at = applied_at and
-- the marker present), puts the backed-up columns back. For 003434 that
-- also takes the 3 restored photos off again: the backed-up extra_fields
-- still lists them under staff_removed_images (with their full records),
-- so the photo-remove state is exactly as before. The backup table and the
-- moderation events are kept.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF to_regclass('public.moderation_reversal_225_backup') IS NULL THEN
    RAISE NOTICE 'moderation_reversal_225 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE moderation_reversal_225_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id, b.restored_image_ids
  FROM moderation_reversal_225_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'moderation_reversal_225';

  -- Undo the photo restore (same as the staff photo-remove action).
  DELETE FROM property_images i
  USING moderation_reversal_225_rollback_ids r
  WHERE i.property_id = r.property_id AND i.id = ANY(r.restored_image_ids);

  UPDATE properties p
  SET status = b.before_row->>'status',
      moderation_stage = b.before_row->>'moderation_stage',
      moderation_reason = b.before_row->>'moderation_reason',
      moderation_notes = b.before_row->>'moderation_notes',
      rejected_at = NULLIF(b.before_row->>'rejected_at', '')::timestamptz,
      reviewed_at = NULLIF(b.before_row->>'reviewed_at', '')::timestamptz,
      approved_at = NULLIF(b.before_row->>'approved_at', '')::timestamptz,
      extra_fields = b.before_row->'extra_fields',
      updated_at = COALESCE(b.before_updated_at, p.updated_at)
  FROM moderation_reversal_225_backup b
  JOIN moderation_reversal_225_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE moderation_reversal_225_backup b
  SET rolled_back_at = clock_timestamp()
  FROM moderation_reversal_225_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'moderation_reversal_225 rolled_back %', v_restored;
END;
$rollback$;
