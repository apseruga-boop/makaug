-- Two data changes, approved by Arthur at 06:06 UK on 26 Oct 2026. Nothing else.
--
-- 1. Hide listing MK-20261024-67E51F (BitEstate Africa, "Land in Kira-Nsasa",
--    UGX 100M, id 70fb505f-48e7-4132-92d1-393dbfc90a93). It duplicates
--    MK-20261024-400346 (id 2a4353f2-6bd9-4c59-bbd1-ad7ed797488f): same plot,
--    different YouTube video, and that caption says UGX 70M. Hidden, not
--    deleted: status and moderation_stage become 'hidden' (the 169 precedent),
--    it is taken out of featured (featured=false, featured_removed_at/by), and
--    a moderation note plus a moderation event record why. A hidden listing
--    fails publicVisibleInventoryWhere, so the featured rotation, homepage,
--    search and sitemap cannot pick it again. 400346 is not touched; the
--    migration skips if 400346 is no longer public.
--
-- 2. Cancel the stuck WhatsApp queue row 202c93a9-6dad-457f-84aa-0699142ebd6b
--    (agent_booking, created 23 Oct 2026 12:38 UTC, 0 attempts, number ending
--    232). The queue has no 'cancelled' status (CHECK allows pending, retry,
--    sent, failed), so it is cancelled the way admin cancels queue rows:
--    status 'failed', last_error 'cancelled_by_admin'. Senders only claim
--    'pending' and 'retry', so it can never be sent. attempts stays 0.
--
-- Backup before any write: data_change_184_backup holds the whole listing
-- row, the whole queue row and the two featured_rotation_runs rows (25 and
-- 26 Oct) that selected 67E51F. The run history itself is not changed.
-- Rollback: scripts/rollback-184-hide-duplicate-67e51f-and-cancel-agent-booking-row.sql
-- (manual; it restores the listing only, and the queue row only on request).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS data_change_184_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

DO $migration_184$
DECLARE
  listing_id CONSTANT UUID := '70fb505f-48e7-4132-92d1-393dbfc90a93';
  listing_ref CONSTANT TEXT := 'MK-20261024-67E51F';
  keeper_id CONSTANT UUID := '2a4353f2-6bd9-4c59-bbd1-ad7ed797488f';
  keeper_ref CONSTANT TEXT := 'MK-20261024-400346';
  queue_id CONSTANT UUID := '202c93a9-6dad-457f-84aa-0699142ebd6b';
  actor CONSTANT TEXT := 'migration_184';
  note CONSTANT TEXT := 'Duplicate of MK-20261024-400346 (same Kira-Nsasa plot, different YouTube video; that caption says UGX 70M). Hidden, not deleted, per Arthur 26 Oct 2026.';
  listing RECORD;
  q RECORD;
  n_listing INTEGER := 0;
  n_queue INTEGER := 0;
  n_runs INTEGER := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_184 skipped: app.country_code is not UG';
    RETURN;
  END IF;

  -- 1. Listing 67E51F.
  SELECT * INTO listing FROM properties WHERE id = listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE NOTICE 'migration_184 listing skipped: % not found', listing_ref;
  ELSIF listing.inquiry_reference IS DISTINCT FROM listing_ref THEN
    RAISE NOTICE 'migration_184 listing skipped: reference is %, expected %', listing.inquiry_reference, listing_ref;
  ELSIF listing.extra_fields ? 'listing_hide_184' OR listing.status = 'hidden' THEN
    RAISE NOTICE 'migration_184 listing skipped: % already hidden', listing_ref;
  ELSIF listing.status IS DISTINCT FROM 'approved' THEN
    RAISE NOTICE 'migration_184 listing skipped: status is %, expected approved', listing.status;
  ELSIF NOT EXISTS (
    SELECT 1 FROM properties k
    WHERE k.id = keeper_id AND k.inquiry_reference = keeper_ref AND k.status = 'approved'
  ) THEN
    RAISE NOTICE 'migration_184 listing skipped: keeper % is not approved, so 67E51F stays as it is', keeper_ref;
  ELSE
    INSERT INTO data_change_184_backup (row_kind, row_key, before_row)
    VALUES ('property', listing_id::text, to_jsonb(listing))
    ON CONFLICT (row_kind, row_key) DO UPDATE
      SET before_row = EXCLUDED.before_row, backed_up_at = NOW(), restored_at = NULL;

    INSERT INTO data_change_184_backup (row_kind, row_key, before_row)
    SELECT 'featured_rotation_runs', r.rotation_date::text, to_jsonb(r)
    FROM featured_rotation_runs r
    WHERE r.selected_ids ? listing_id::text
    ON CONFLICT (row_kind, row_key) DO NOTHING;
    GET DIAGNOSTICS n_runs = ROW_COUNT;

    UPDATE properties
    SET status = 'hidden',
        moderation_stage = 'hidden',
        moderation_notes = note,
        extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
          'featured', false,
          'featured_removed_at', NOW()::text,
          'featured_removed_by', actor,
          'listing_hide_184', jsonb_build_object(
            'action', 'hidden_duplicate',
            'duplicate_of_property_id', keeper_id::text,
            'duplicate_of_reference', keeper_ref,
            'note', note,
            'approved_by', 'Arthur',
            'previous_status', listing.status,
            'previous_moderation_stage', listing.moderation_stage,
            'previous_featured', COALESCE(listing.extra_fields->>'featured', 'false'),
            'applied_at', NOW()::text
          )
        )
    WHERE id = listing_id;
    GET DIAGNOSTICS n_listing = ROW_COUNT;

    INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
    VALUES (listing_id, actor, 'hide_duplicate', listing.status, 'hidden', 'duplicate_listing', note,
            jsonb_build_object('migration', '184', 'duplicate_of_property_id', keeper_id::text));
  END IF;

  -- 2. Queue row 202c93a9.
  SELECT * INTO q FROM outbound_message_queue WHERE id = queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE NOTICE 'migration_184 queue skipped: row not found';
  ELSIF q.metadata ? 'cancelled_184' THEN
    RAISE NOTICE 'migration_184 queue skipped: already cancelled';
  ELSIF q.status IS DISTINCT FROM 'pending'
     OR COALESCE(q.attempts, 0) <> 0
     OR q.sent_at IS NOT NULL
     OR q.channel IS DISTINCT FROM 'whatsapp'
     OR COALESCE(q.metadata->>'source', '') <> 'agent_booking'
     OR RIGHT(regexp_replace(COALESCE(q.user_phone, ''), '\D', '', 'g'), 3) <> '232' THEN
    RAISE NOTICE 'migration_184 queue skipped: row is no longer the stuck pending agent_booking row (status %, attempts %)', q.status, q.attempts;
  ELSE
    INSERT INTO data_change_184_backup (row_kind, row_key, before_row)
    VALUES ('outbound_message_queue', queue_id::text, to_jsonb(q))
    ON CONFLICT (row_kind, row_key) DO UPDATE
      SET before_row = EXCLUDED.before_row, backed_up_at = NOW(), restored_at = NULL;

    UPDATE outbound_message_queue
    SET status = 'failed',
        last_error = 'cancelled_by_admin',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'cancelled_184', jsonb_build_object(
            'reason', 'stuck agent_booking row cancelled so it can never be sent (Arthur, 26 Oct 2026)',
            'previous_status', q.status,
            'cancelled_at', NOW()::text,
            'cancelled_by', actor
          )
        ),
        updated_at = NOW()
    WHERE id = queue_id;
    GET DIAGNOSTICS n_queue = ROW_COUNT;
  END IF;

  RAISE NOTICE 'migration_184 listing_hidden=% queue_cancelled=% featured_runs_backed_up=%', n_listing, n_queue, n_runs;
END
$migration_184$;
