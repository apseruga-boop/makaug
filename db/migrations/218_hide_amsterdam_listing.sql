-- Hide (do not delete) MK-20261012-B3A4F7, the Amsterdam listing
-- https://makaug.com/property/ae2a86c6-e26b-4674-b74a-897d895451bd
-- Title: Amsteldijk 38 H 1074 HV AMSTERDAM - Luxury home for sale.
--
-- Uses the same recoverable hide as staff Unpublish and migration 210:
-- status becomes hidden, unpublished_* keys are stored, and a moderation
-- event is written. Nothing is deleted. Publish again restores the
-- previous live status.
--
-- This file updates one known row only. Triggers stay enabled (disabling
-- trg_properties_updated_at takes an ACCESS EXCLUSIVE lock, which helped
-- take the site down when 211 ran). Timeouts stay short.
--
-- Backup: amsterdam_hide_218_backup.
-- Rollback: scripts/rollback-218-hide-amsterdam-listing.sql.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS amsterdam_hide_218_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  before_status text NOT NULL,
  before_row jsonb NOT NULL,
  event_id uuid,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);

DO $hide$
DECLARE
  v_applied timestamptz := clock_timestamp();
  v_reason text := 'Hidden: this listing is in Amsterdam, not Uganda.';
  v_id uuid := 'ae2a86c6-e26b-4674-b74a-897d895451bd';
  v_ref text := 'MK-20261012-B3A4F7';
  v_before text;
  v_event uuid;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG'
     AND COALESCE(current_setting('app.country_code', true), '') <> '' THEN
    RAISE NOTICE 'amsterdam_hide_218 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM amsterdam_hide_218_backup WHERE property_id = v_id) THEN
    RAISE NOTICE 'amsterdam_hide_218 skipped already_recorded';
    RETURN;
  END IF;

  SELECT p.status INTO v_before
  FROM properties p
  WHERE p.id = v_id
    AND p.inquiry_reference = v_ref
    AND lower(coalesce(p.status, '')) IN ('approved', 'live', 'published')
  FOR UPDATE;

  IF v_before IS NULL THEN
    RAISE NOTICE 'amsterdam_hide_218 skipped no_matching_row';
    RETURN;
  END IF;

  INSERT INTO amsterdam_hide_218_backup (
    property_id, inquiry_reference, before_status, before_row, applied_at
  )
  SELECT p.id, p.inquiry_reference, p.status, to_jsonb(p), v_applied
  FROM properties p
  WHERE p.id = v_id;

  UPDATE properties p
  SET status = 'hidden',
      moderation_reason = v_reason,
      extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
        'unpublished_from_status', v_before,
        'unpublished_reason', v_reason,
        'unpublished_at', to_jsonb(v_applied),
        'unpublished_by', 'migration_218',
        'unpublished_previous_moderation_reason', to_jsonb(COALESCE(p.moderation_reason, '')),
        'unpublished_previous_moderation_stage', to_jsonb(COALESCE(p.moderation_stage, '')),
        'amsterdam_hide_218', jsonb_build_object(
          'applied_at', v_applied,
          'inquiry_reference', v_ref
        )
      ),
      updated_at = v_applied
  WHERE p.id = v_id
    AND lower(coalesce(p.status, '')) IN ('approved', 'live', 'published');

  INSERT INTO property_moderation_events (
    property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
  )
  VALUES (
    v_id,
    NULL,
    'amsterdam_listing_hidden',
    v_before,
    'hidden',
    '{}'::jsonb,
    v_reason,
    'Hidden by migration 218. The listing is not deleted. Publish again restores the previous live status.',
    '{}'::jsonb
  )
  RETURNING id INTO v_event;

  UPDATE amsterdam_hide_218_backup
  SET event_id = v_event
  WHERE property_id = v_id;

  RAISE NOTICE 'amsterdam_hide_218 hid % from %', v_ref, v_before;
END;
$hide$;
