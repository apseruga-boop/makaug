-- Manual rollback for db/migrations/218_hide_amsterdam_listing.sql.
-- Not run by scripts/migrate.js. Restores status, moderation_reason,
-- extra_fields and updated_at from amsterdam_hide_218_backup, and
-- deletes the moderation event this migration inserted. If staff have
-- since changed the listing (it is no longer hidden, or the 218 marker
-- is gone), it is left as staff left it. The backup table is kept.
--
-- Triggers stay enabled. Nothing is deleted from properties.

SET lock_timeout = '3s';
SET statement_timeout = '15s';

DO $rollback$
DECLARE
  v_restored int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG'
     AND COALESCE(current_setting('app.country_code', true), '') <> '' THEN
    RAISE NOTICE 'amsterdam_hide_218 rollback skipped country_not_ug';
    RETURN;
  END IF;
  IF to_regclass('public.amsterdam_hide_218_backup') IS NULL THEN
    RAISE NOTICE 'amsterdam_hide_218 rollback skipped no_backup';
    RETURN;
  END IF;

  CREATE TEMP TABLE amsterdam_hide_218_rollback_ids ON COMMIT DROP AS
  SELECT b.property_id
  FROM amsterdam_hide_218_backup b
  JOIN properties p ON p.id = b.property_id
  WHERE b.rolled_back_at IS NULL
    AND p.status = 'hidden'
    AND COALESCE(p.extra_fields->'amsterdam_hide_218'->>'inquiry_reference', '') = 'MK-20261012-B3A4F7';

  DELETE FROM property_moderation_events e
  USING amsterdam_hide_218_backup b
  JOIN amsterdam_hide_218_rollback_ids r ON r.property_id = b.property_id
  WHERE e.id = b.event_id
    AND e.property_id = b.property_id
    AND e.action = 'amsterdam_listing_hidden';

  UPDATE properties p
  SET status = b.before_status,
      moderation_reason = b.before_row->>'moderation_reason',
      extra_fields = COALESCE(b.before_row->'extra_fields', '{}'::jsonb),
      updated_at = COALESCE((b.before_row->>'updated_at')::timestamptz, p.updated_at)
  FROM amsterdam_hide_218_backup b
  JOIN amsterdam_hide_218_rollback_ids r ON r.property_id = b.property_id
  WHERE p.id = b.property_id;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE amsterdam_hide_218_backup b
  SET rolled_back_at = clock_timestamp()
  FROM amsterdam_hide_218_rollback_ids r
  WHERE b.property_id = r.property_id;

  RAISE NOTICE 'amsterdam_hide_218 rolled_back %', v_restored;
END;
$rollback$;
