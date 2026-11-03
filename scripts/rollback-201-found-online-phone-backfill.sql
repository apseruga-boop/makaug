-- Rollback for db/migrations/201_found_online_phone_backfill.sql.
-- Restores lister_phone and extra_fields from the backup, only where the
-- phone is still the one the migration wrote.
BEGIN;
UPDATE properties p SET
  lister_phone = b.before_row->>'lister_phone',
  extra_fields = b.before_row->'extra_fields',
  updated_at = NOW()
FROM found_online_phone_201_backup b
WHERE p.id = b.property_id AND b.rolled_back_at IS NULL AND p.lister_phone = b.new_phone;
UPDATE found_online_phone_201_backup SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
COMMIT;
