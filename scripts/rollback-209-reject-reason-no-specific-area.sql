-- Manual rollback for db/migrations/209_reject_reason_no_specific_area.sql.
-- Not run by scripts/migrate.js. Restores moderation_reason, extra_fields and
-- updated_at from reject_reason_209_backup, and puts the latest moderation
-- event reason back. A listing edited after this change (updated_at no longer
-- equals applied_at) is left as staff left it. The backup table is kept.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

DO $rollback$
DECLARE
  v_has_trigger boolean;
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'reject_reason_209 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.reject_reason_209_backup') IS NULL THEN
    RAISE NOTICE 'reject_reason_209 rollback skipped no_backup';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_properties_updated_at'
      AND tgrelid = 'properties'::regclass
      AND NOT tgisinternal
  ) INTO v_has_trigger;

  CREATE TEMP TABLE reject_reason_209_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM reject_reason_209_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.updated_at = b.applied_at
    AND p.inquiry_reference = b.inquiry_reference;

  IF v_has_trigger THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  UPDATE property_moderation_events e
  SET reason = b.before_event_reason
  FROM reject_reason_209_backup b
  JOIN reject_reason_209_rollback_ids r ON r.property_id = b.property_id
  WHERE e.id = b.event_id;

  UPDATE properties p
  SET moderation_reason = b.before_row->>'moderation_reason',
      extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
      updated_at = COALESCE((b.before_row->>'updated_at')::timestamptz, p.updated_at)
  FROM reject_reason_209_backup b
  JOIN reject_reason_209_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE reject_reason_209_backup b
  SET rolled_back_at = clock_timestamp()
  FROM reject_reason_209_rollback_ids r
  WHERE b.property_id = r.property_id;

  IF v_has_trigger THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;

  RAISE NOTICE 'reject_reason_209 rolled_back %', v_restored;
END;
$rollback$;
