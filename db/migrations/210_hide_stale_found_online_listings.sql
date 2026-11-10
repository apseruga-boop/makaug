-- Take found-online listings off the public site when the original source
-- post is more than 180 days old. Status becomes hidden, the same
-- recoverable status the staff Unpublish button uses. Nothing is deleted.
-- Publish again restores the previous live status.
--
-- A signed-up paying agent (a user account, and a fee exemption, a paid-until
-- date, or a subscription receipt) is never touched, including when one of
-- their own listings also carries a found-online flag.
-- Short stays live in st_listing and are host listings, so this file does
-- not read that table.
--
-- A production read on 10 Nov 2026, after migrations 207 and 208 were
-- already live, matched 473 listings. Nothing is deleted.
-- sale 261, rent 95, land 108, commercial 8, student 1.
-- Examples: MK-20260719-70E467 (sale), MK-20260719-4D68D7 (rent),
-- MK-20260710-0C6F96 (land), MK-20260710-D0C742 (commercial),
-- MK-20260607-4DE500 (student).
-- Live status was 5,070 (5,069 with public media). After this hide:
-- 4,597 live, 4,596 with public media. All 473 already have public media.
-- The migration re-checks the same rule when it runs.
--
-- schema_migrations records the filename. Main already applied
-- 208_found_online_short_stay_rentals_to_queue.sql, so this file is 210
-- and runs once. Renaming it does not re-run 208.
--
-- Backup: stale_source_unpublish_210_backup.
-- Rollback: scripts/rollback-210-hide-stale-found-online-listings.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS stale_source_unpublish_210_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  listing_type text NOT NULL,
  before_status text NOT NULL,
  before_row jsonb NOT NULL,
  source_posted_at timestamptz,
  event_id uuid,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);

DO $hide$
DECLARE
  v_applied timestamptz := clock_timestamp();
  v_reason text := 'Original source post is more than 180 days old.';
  v_has_trigger boolean;
  v_live_before int;
  v_hide int;
  r record;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'stale_source_210 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM stale_source_unpublish_210_backup) THEN
    RAISE NOTICE 'stale_source_210 skipped already_recorded';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_properties_updated_at'
      AND tgrelid = 'properties'::regclass
      AND NOT tgisinternal
  ) INTO v_has_trigger;

  CREATE TEMP TABLE stale_source_210_targets ON COMMIT DROP AS
  SELECT
    p.id,
    p.inquiry_reference,
    p.listing_type,
    p.status AS before_status,
    posted.posted_at
  FROM properties p
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      CASE
        WHEN btrim(coalesce(p.extra_fields->>'source_published_at', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (p.extra_fields->>'source_published_at')::timestamptz
      END,
      CASE
        WHEN btrim(coalesce(p.extra_fields->>'first_posted_online_at', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (p.extra_fields->>'first_posted_online_at')::timestamptz
      END,
      CASE
        WHEN btrim(coalesce(p.extra_fields->>'video_published_at', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (p.extra_fields->>'video_published_at')::timestamptz
      END,
      CASE
        WHEN btrim(coalesce(p.extra_fields->>'youtube_source_published_at', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (p.extra_fields->>'youtube_source_published_at')::timestamptz
      END
    ) AS posted_at
  ) posted
  WHERE lower(coalesce(p.status, '')) IN ('approved', 'live', 'published')
    AND (
      lower(coalesce(p.source, '')) = 'found_online_property_source_v1'
      OR lower(coalesce(p.listed_via, '')) = 'found_online'
      OR lower(coalesce(p.extra_fields->>'found_online', 'false')) IN ('true', '1', 'yes')
      OR lower(coalesce(p.extra_fields->>'found_online_candidate', 'false')) IN ('true', '1', 'yes')
      OR lower(coalesce(p.extra_fields->>'social_search_candidate', 'false')) IN ('true', '1', 'yes')
      OR lower(coalesce(p.extra_fields->>'sourced_inventory_candidate', 'false')) IN ('true', '1', 'yes')
      OR lower(coalesce(p.extra_fields->>'source_badge', '')) IN ('found_online', 'found online', 'sourced_online', 'sourced online')
    )
    AND posted.posted_at IS NOT NULL
    AND posted.posted_at < (NOW() - INTERVAL '180 days')
    AND NOT EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = p.agent_id
        AND a.user_id IS NOT NULL
        AND a.removed_at IS NULL
        AND (
          COALESCE(a.fee_exempt, false)
          OR a.paid_until IS NOT NULL
          OR a.paid_awaiting_approval_at IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM revenue_entries rev
            WHERE rev.agent_id = a.id
              AND rev.voided_at IS NULL
              AND rev.kind = 'agent_subscription'
              AND rev.direction = 'in'
          )
        )
    )
  FOR UPDATE OF p;

  SELECT count(*) INTO v_live_before
  FROM properties
  WHERE lower(coalesce(status, '')) IN ('approved', 'live', 'published');
  SELECT count(*) INTO v_hide FROM stale_source_210_targets;

  IF v_hide = 0 THEN
    RAISE NOTICE 'stale_source_210 skipped no_matching_rows live_before %', v_live_before;
    RETURN;
  END IF;

  IF v_has_trigger THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  INSERT INTO stale_source_unpublish_210_backup (
    property_id, inquiry_reference, listing_type, before_status, before_row, source_posted_at, applied_at
  )
  SELECT t.id, t.inquiry_reference, t.listing_type, t.before_status, to_jsonb(p), t.posted_at, v_applied
  FROM stale_source_210_targets t
  JOIN properties p ON p.id = t.id;

  UPDATE properties p
  SET status = 'hidden',
      moderation_reason = v_reason,
      extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
        'unpublished_from_status', t.before_status,
        'unpublished_reason', v_reason,
        'unpublished_at', to_jsonb(v_applied),
        'unpublished_by', 'migration_210',
        'unpublished_previous_moderation_reason', to_jsonb(COALESCE(p.moderation_reason, '')),
        'unpublished_previous_moderation_stage', to_jsonb(COALESCE(p.moderation_stage, '')),
        'stale_source_unpublish_210', jsonb_build_object(
          'applied_at', v_applied,
          'source_posted_at', t.posted_at
        )
      ),
      updated_at = v_applied
  FROM stale_source_210_targets t
  WHERE p.id = t.id
    AND lower(coalesce(p.status, '')) IN ('approved', 'live', 'published');

  WITH inserted AS (
    INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    )
    SELECT
      t.id,
      NULL,
      'stale_source_unpublished',
      t.before_status,
      'hidden',
      '{}'::jsonb,
      v_reason,
      'Hidden by migration 210. The listing is not deleted. Publish again restores the previous live status.',
      '{}'::jsonb
    FROM stale_source_210_targets t
    RETURNING id, property_id
  )
  UPDATE stale_source_unpublish_210_backup b
  SET event_id = inserted.id
  FROM inserted
  WHERE b.property_id = inserted.property_id;

  IF v_has_trigger THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;

  FOR r IN
    SELECT listing_type, count(*)::int AS n
    FROM stale_source_210_targets
    GROUP BY listing_type
    ORDER BY listing_type
  LOOP
    RAISE NOTICE 'stale_source_210 category % %', r.listing_type, r.n;
  END LOOP;
  RAISE NOTICE 'stale_source_210 live_before % hide % live_after %', v_live_before, v_hide, v_live_before - v_hide;
END;
$hide$;
