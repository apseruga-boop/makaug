-- Manual rollback for the batched moderation-notes restore (220).
-- Not run by scripts/migrate.js. Restores moderation_notes, the
-- extra_fields marker, and updated_at from
-- moderation_notes_restore_220_backup. A listing that staff edited
-- after the repair (updated_at no longer equals applied_at, or the
-- marker is gone) is left as staff left it. The backup table is kept.
--
-- Triggers stay enabled (disabling trg_properties_updated_at takes an
-- ACCESS EXCLUSIVE lock, which is what helped take the site down when
-- 211 ran). Nothing is deleted.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG'
     AND COALESCE(current_setting('app.country_code', true), '') <> '' THEN
    RAISE NOTICE 'moderation_notes_220 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.moderation_notes_restore_220_backup') IS NULL THEN
    RAISE NOTICE 'moderation_notes_220 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE moderation_notes_220_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM moderation_notes_restore_220_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'moderation_notes_restore_220';

  UPDATE properties p
  SET moderation_notes = b.before_notes,
      extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) - 'moderation_notes_restore_220',
      updated_at = COALESCE(b.before_updated_at, p.updated_at)
  FROM moderation_notes_restore_220_backup b
  JOIN moderation_notes_220_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE moderation_notes_restore_220_backup b
  SET rolled_back_at = clock_timestamp()
  FROM moderation_notes_220_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'moderation_notes_220 rolled_back %', v_restored;
END;
$rollback$;
