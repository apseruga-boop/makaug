-- Run manually in a transaction with app.country_code='UG'. Not a deploy migration.
-- Puts 14871A back to its pre-196 state, only if nobody has touched it since.
SET LOCAL lock_timeout = '8s';
DO $rollback$
DECLARE
  backup record;
  b properties;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN RETURN; END IF;
  FOR backup IN SELECT k.* FROM listing_correction_196_backup k JOIN properties p ON p.id = k.property_id
      WHERE k.rolled_back_at IS NULL AND p.extra_fields ? 'listing_correction_196' AND p.status = 'rejected'
      FOR UPDATE OF p LOOP
    SELECT * INTO b FROM jsonb_populate_record(NULL::properties, backup.before_row);
    UPDATE properties SET status = b.status, moderation_stage = b.moderation_stage,
      moderation_reason = b.moderation_reason, reviewed_at = b.reviewed_at,
      extra_fields = b.extra_fields, updated_at = NOW()
     WHERE id = backup.property_id;
    UPDATE listing_correction_196_backup SET rolled_back_at = NOW() WHERE property_id = backup.property_id;
    RAISE NOTICE 'listing_correction_196 rolled_back %', backup.inquiry_reference;
  END LOOP;
END;
$rollback$;
