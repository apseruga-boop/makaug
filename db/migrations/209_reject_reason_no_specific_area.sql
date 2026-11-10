-- Two found-online listings were rejected because the area was too vague,
-- but the only reason a moderator could pick stored "Not a property listing".
-- MK-20261109-A9F886 and MK-20261110-D126C0 keep status rejected. The stored
-- reason on the property, its extra_fields copy, and the latest moderation
-- event become "No specific area / location too vague".
-- Backup: reject_reason_209_backup. Rollback: scripts/rollback-209-reject-reason-no-specific-area.sql.
-- schema_migrations records the filename. Main already applied
-- 207_student_listing_type_and_free_hashtag_sources.sql, so this file is
-- 209 and runs once. Renaming it does not re-run 207.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS reject_reason_209_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  before_row jsonb NOT NULL,
  event_id uuid,
  before_event_reason text,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);

DO $reason$
DECLARE
  v_applied timestamptz := clock_timestamp();
  v_old text := 'Not a property listing';
  v_new text := 'No specific area / location too vague';
  v_has_trigger boolean;
  v_count int;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'reject_reason_209 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM reject_reason_209_backup) THEN
    RAISE NOTICE 'reject_reason_209 skipped already_recorded';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_properties_updated_at'
      AND tgrelid = 'properties'::regclass
      AND NOT tgisinternal
  ) INTO v_has_trigger;

  CREATE TEMP TABLE reject_reason_209_targets ON COMMIT DROP AS
  SELECT p.id
  FROM properties p
  WHERE p.inquiry_reference IN ('MK-20261109-A9F886', 'MK-20261110-D126C0')
    AND p.status = 'rejected'
    AND btrim(coalesce(p.moderation_reason, '')) = v_old
    AND btrim(coalesce(p.extra_fields->>'moderation_reason', p.moderation_reason, '')) = v_old
  FOR UPDATE OF p;

  SELECT count(*) INTO v_count FROM reject_reason_209_targets;
  IF v_count = 0 THEN
    RAISE NOTICE 'reject_reason_209 skipped no_matching_rows';
    RETURN;
  END IF;

  IF v_has_trigger THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  INSERT INTO reject_reason_209_backup (
    property_id, inquiry_reference, before_row, event_id, before_event_reason, applied_at
  )
  SELECT p.id, p.inquiry_reference, to_jsonb(p), latest.id, latest.reason, v_applied
  FROM reject_reason_209_targets t
  JOIN properties p ON p.id = t.id
  LEFT JOIN LATERAL (
    SELECT e.id, e.reason
    FROM property_moderation_events e
    WHERE e.property_id = p.id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ) latest ON TRUE;

  UPDATE properties p
  SET moderation_reason = v_new,
      extra_fields = jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(p.extra_fields, '{}'::jsonb),
            '{moderation_reason}',
            to_jsonb(v_new)
          ),
          '{structured_rejection_message}',
          to_jsonb(v_new)
        ),
        '{structured_rejection_reasons}',
        CASE
          WHEN p.extra_fields->'structured_rejection_reasons' = '["other"]'::jsonb
            THEN '["no_specific_area"]'::jsonb
          ELSE COALESCE(p.extra_fields->'structured_rejection_reasons', '["no_specific_area"]'::jsonb)
        END
      ),
      updated_at = v_applied
  FROM reject_reason_209_targets t
  WHERE p.id = t.id;

  UPDATE property_moderation_events e
  SET reason = v_new
  FROM reject_reason_209_backup b
  WHERE e.id = b.event_id
    AND btrim(coalesce(e.reason, '')) = v_old;

  IF v_has_trigger THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;

  RAISE NOTICE 'reject_reason_209 updated %', v_count;
END;
$reason$;
