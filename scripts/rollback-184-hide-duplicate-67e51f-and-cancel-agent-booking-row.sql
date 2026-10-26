-- Manual rollback for db/migrations/184_hide_duplicate_67e51f_and_cancel_agent_booking_row.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- Run it inside one transaction (psql --single-transaction) with
-- app.country_code set to UG, e.g. SET app.country_code = 'UG'.
--
-- 1. Listing 67E51F: status, moderation_stage, moderation_notes and
--    extra_fields (featured flags included) go back to the backup copy, and
--    the migration's 'hide_duplicate' moderation event is removed. Only while
--    the listing still carries the listing_hide_184 stamp, so a later staff
--    edit is never overwritten.
-- 2. Queue row 202c93a9 stays cancelled by default. Putting it back to
--    'pending' would let a sender pick it up, so it is restored only when you
--    ask for it on purpose:  SET app.rollback_184_requeue = 'yes';
-- 3. featured_rotation_runs was never changed; its backup is for reference.
-- Backup rows are stamped restored_at. The backup table is kept.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback_184$
DECLARE
  b RECORD;
  n_listing INTEGER := 0;
  n_events INTEGER := 0;
  n_queue INTEGER := 0;
  n INTEGER;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_184 skipped: app.country_code is not UG';
    RETURN;
  END IF;
  IF to_regclass('public.data_change_184_backup') IS NULL THEN
    RAISE NOTICE 'rollback_184 skipped: backup table missing';
    RETURN;
  END IF;

  FOR b IN SELECT * FROM data_change_184_backup WHERE row_kind = 'property' AND restored_at IS NULL LOOP
    UPDATE properties p
    SET status = b.before_row->>'status',
        moderation_stage = b.before_row->>'moderation_stage',
        moderation_notes = b.before_row->>'moderation_notes',
        extra_fields = b.before_row->'extra_fields'
    WHERE p.id = b.row_key::uuid
      AND p.extra_fields ? 'listing_hide_184';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE NOTICE 'rollback_184 listing % left alone: no longer in the migration 184 state', b.row_key;
      CONTINUE;
    END IF;
    n_listing := n_listing + n;
    DELETE FROM property_moderation_events
    WHERE property_id = b.row_key::uuid AND actor_id = 'migration_184' AND action = 'hide_duplicate';
    GET DIAGNOSTICS n = ROW_COUNT;
    n_events := n_events + n;
    UPDATE data_change_184_backup SET restored_at = NOW() WHERE id = b.id;
  END LOOP;

  IF current_setting('app.rollback_184_requeue', true) IS NOT DISTINCT FROM 'yes' THEN
    FOR b IN SELECT * FROM data_change_184_backup WHERE row_kind = 'outbound_message_queue' AND restored_at IS NULL LOOP
      UPDATE outbound_message_queue q
      SET status = b.before_row->>'status',
          last_error = b.before_row->>'last_error',
          metadata = b.before_row->'metadata',
          updated_at = NOW()
      WHERE q.id = b.row_key::uuid
        AND q.metadata ? 'cancelled_184'
        AND COALESCE(q.attempts, 0) = 0
        AND q.sent_at IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT;
      n_queue := n_queue + n;
      IF n > 0 THEN
        UPDATE data_change_184_backup SET restored_at = NOW() WHERE id = b.id;
      END IF;
    END LOOP;
  ELSE
    RAISE NOTICE 'rollback_184 queue row left cancelled (set app.rollback_184_requeue = yes to put it back to pending)';
  END IF;

  RAISE NOTICE 'rollback_184 listing_restored=% events_removed=% queue_restored=%', n_listing, n_events, n_queue;
END
$rollback_184$;
