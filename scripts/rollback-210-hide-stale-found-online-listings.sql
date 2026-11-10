-- Manual rollback for db/migrations/210_hide_stale_found_online_listings.sql.
-- Not run by scripts/migrate.js. Restores status, moderation_reason,
-- extra_fields and updated_at from stale_source_unpublish_210_backup, and
-- deletes the moderation event this migration inserted. A listing that staff
-- edited after the hide (updated_at no longer equals applied_at, or status is
-- no longer hidden) is left as staff left it. The backup table is kept.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $rollback$
DECLARE
  v_has_trigger boolean;
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'stale_source_210 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.stale_source_unpublish_210_backup') IS NULL THEN
    RAISE NOTICE 'stale_source_210 rollback skipped no_backup';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_properties_updated_at'
      AND tgrelid = 'properties'::regclass
      AND NOT tgisinternal
  ) INTO v_has_trigger;

  CREATE TEMP TABLE stale_source_210_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM stale_source_unpublish_210_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.status = 'hidden'
    AND p.updated_at = b.applied_at
    AND COALESCE(p.extra_fields, '{}'::jsonb) ? 'stale_source_unpublish_210';

  IF v_has_trigger THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  DELETE FROM property_moderation_events e
  USING stale_source_unpublish_210_backup b
  JOIN stale_source_210_rollback_ids r ON r.property_id = b.property_id
  WHERE e.id = b.event_id
    AND e.property_id = b.property_id
    AND e.action = 'stale_source_unpublished';

  UPDATE properties p
  SET status = b.before_status,
      moderation_reason = b.before_row->>'moderation_reason',
      extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
      updated_at = COALESCE((b.before_row->>'updated_at')::timestamptz, p.updated_at)
  FROM stale_source_unpublish_210_backup b
  JOIN stale_source_210_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE stale_source_unpublish_210_backup b
  SET rolled_back_at = clock_timestamp()
  FROM stale_source_210_rollback_ids r
  WHERE b.property_id = r.property_id;

  IF v_has_trigger THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;

  RAISE NOTICE 'stale_source_210 rolled_back %', v_restored;
END;
$rollback$;
