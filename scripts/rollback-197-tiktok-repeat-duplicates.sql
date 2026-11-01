-- Run manually in a transaction with app.country_code='UG'. Not a deploy migration.
-- Puts the 197 repeats back to their pre-197 state, only where nobody has
-- touched them since (still rejected and still carrying the 197 marker).
SET LOCAL lock_timeout = '8s';
DO $rollback$
DECLARE
  backup record;
  b properties;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN RETURN; END IF;
  FOR backup IN SELECT k.* FROM listing_correction_197_backup k JOIN properties p ON p.id = k.property_id
      WHERE k.rolled_back_at IS NULL AND p.extra_fields ? 'listing_correction_197' AND p.status = 'rejected'
      FOR UPDATE OF p LOOP
    SELECT * INTO b FROM jsonb_populate_record(NULL::properties, backup.before_row);
    UPDATE properties SET status = b.status, moderation_stage = b.moderation_stage,
      moderation_reason = b.moderation_reason, reviewed_at = b.reviewed_at,
      extra_fields = b.extra_fields, updated_at = NOW()
     WHERE id = backup.property_id;
    INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
      VALUES (backup.property_id, 'rollback_197', 'restore', 'rejected', b.status, 'rollback', 'Rollback of migration 197', '{"migration":"197","rollback":true}'::jsonb);
    UPDATE listing_correction_197_backup SET rolled_back_at = NOW() WHERE property_id = backup.property_id;
    RAISE NOTICE 'listing_correction_197 rolled_back %', backup.inquiry_reference;
  END LOOP;
END;
$rollback$;
