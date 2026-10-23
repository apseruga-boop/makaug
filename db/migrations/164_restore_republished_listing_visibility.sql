-- Publish again (live 08:26 BST / 07:26 UTC on 23 Oct 2026) put the
-- pre-unpublish status back, but the public property page kept a cached
-- 404. This migration does not invent a new status. It re-asserts the
-- status from the republish event only when the row is no longer on that
-- status and nobody has changed it since. Rows already on that status are
-- logged and left untouched, so updated_at on a live listing does not move.
--
-- Only listings with a staff_listing_republished event at or after
-- 08:26 BST on 23 Oct 2026 (2026-10-23 07:26:00+00).

DO $$
DECLARE
  rec record;
  restored integer := 0;
  already_public integer := 0;
  note text;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (e.property_id)
      e.property_id,
      p.inquiry_reference,
      lower(p.status) AS current_status,
      lower(e.status_to) AS restore_status,
      e.created_at AS republished_at
    FROM property_moderation_events e
    JOIN properties p ON p.id = e.property_id
    WHERE e.action = 'staff_listing_republished'
      AND e.created_at >= TIMESTAMPTZ '2026-10-23 07:26:00+00'
      AND lower(COALESCE(e.status_to, '')) IN ('approved', 'live', 'published', 'sold')
      AND NOT EXISTS (
        SELECT 1
        FROM property_moderation_events later
        WHERE later.property_id = e.property_id
          AND later.created_at > e.created_at
          AND later.action IN (
            'staff_listing_unpublished',
            'listing_status_changed',
            'staff_returned_to_review'
          )
      )
    ORDER BY e.property_id, e.created_at DESC
  LOOP
    IF rec.current_status IS DISTINCT FROM rec.restore_status THEN
      UPDATE properties
         SET status = rec.restore_status,
             updated_at = NOW()
       WHERE id = rec.property_id
         AND lower(status) IS DISTINCT FROM rec.restore_status;
      note := 'Restored public status from the editor republish. Was ' || COALESCE(rec.current_status, '') || '.';
      restored := restored + 1;
      RAISE NOTICE 'republish visibility repair % % % -> %',
        rec.property_id, rec.inquiry_reference, rec.current_status, rec.restore_status;
    ELSE
      note := 'Already on the republished public status. Logged only; listing columns were not changed.';
      already_public := already_public + 1;
      RAISE NOTICE 'republish visibility already public % % status %',
        rec.property_id, rec.inquiry_reference, rec.current_status;
    END IF;

    INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, reason
    ) VALUES (
      rec.property_id,
      'migration-164',
      'staff_republish_visibility_repair',
      rec.current_status,
      rec.restore_status,
      note
    );
  END LOOP;

  RAISE NOTICE 'republish visibility repair done restored=% already_public=%', restored, already_public;
END $$;
