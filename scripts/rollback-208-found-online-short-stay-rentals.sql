-- Rollback for 208_found_online_short_stay_rentals_to_queue.sql
-- Run by hand. This file is not in db/migrations, so deploy does not run it.
-- Deletes the short-stay rows this migration created (photos cascade) and
-- puts the rental rows back to the status and extra_fields they had before.
-- It does not send any message.

BEGIN;

DELETE FROM st_listing s
 USING short_stay_found_online_208_backup b
 WHERE s.id = b.st_listing_id
   AND b.rolled_back_at IS NULL
   AND COALESCE(s.extra_fields->>'migration_208', '') = 'true';

UPDATE properties p SET
  status = b.before_status,
  moderation_stage = b.before_moderation_stage,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
    - 'migration_208'
    - 'moved_to_st_listing_id'
    - 'moved_to_short_stay_reference'
    - 'hidden_reason',
  updated_at = NOW()
FROM short_stay_found_online_208_backup b
WHERE p.id = b.property_id
  AND b.rolled_back_at IS NULL;

UPDATE short_stay_found_online_208_backup
   SET rolled_back_at = NOW()
 WHERE rolled_back_at IS NULL;

COMMIT;
