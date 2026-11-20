-- Manual rollback for data fix 241 (placeholder found-online titles and
-- pasted WhatsApp listing copy). Not run by scripts/migrate.js. Puts the
-- backed-up columns back for rows still exactly as the fix left them
-- (updated_at equals applied_at and the marker is present). A row staff
-- edited afterwards is left as staff left it. The moderation events and
-- the backup table are kept. Nothing is deleted.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF to_regclass('public.placeholder_titles_and_pasted_copy_241_backup') IS NULL THEN
    RAISE NOTICE 'placeholder_titles_and_pasted_copy_241 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE placeholder_titles_241_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM placeholder_titles_and_pasted_copy_241_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'placeholder_titles_and_pasted_copy_241';

  UPDATE properties p
  SET title = b.before_row->>'title',
      description = b.before_row->>'description',
      area = b.before_row->>'area',
      district = b.before_row->>'district',
      address = b.before_row->>'address',
      property_type = b.before_row->>'property_type',
      land_size_value = NULLIF(b.before_row->>'land_size_value', '')::numeric,
      land_size_unit = b.before_row->>'land_size_unit',
      moderation_notes = b.before_row->>'moderation_notes',
      extra_fields = b.before_row->'extra_fields',
      updated_at = COALESCE(b.before_updated_at, p.updated_at)
  FROM placeholder_titles_and_pasted_copy_241_backup b
  JOIN placeholder_titles_241_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE placeholder_titles_and_pasted_copy_241_backup b
  SET rolled_back_at = clock_timestamp()
  FROM placeholder_titles_241_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'placeholder_titles_and_pasted_copy_241 rolled_back %', v_restored;
END;
$rollback$;
