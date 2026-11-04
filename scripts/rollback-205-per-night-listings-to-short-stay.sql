-- Rollback for migration 205: delete the short stays it created (media
-- cascades) and restore the archived properties rows' status and extra_fields.
-- Run manually in one transaction.
BEGIN;
DELETE FROM st_listing s
 USING per_night_short_stay_205_backup b
 WHERE s.id = b.st_listing_id AND b.rolled_back_at IS NULL;
UPDATE properties p SET
  status = b.before_row->>'status',
  extra_fields = b.before_row->'extra_fields',
  updated_at = NOW()
FROM per_night_short_stay_205_backup b
WHERE p.id = b.property_id AND b.rolled_back_at IS NULL;
UPDATE per_night_short_stay_205_backup SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
COMMIT;
