-- Reject MK-20261031-14871A, approved by Arthur on 1 November 2026.
-- The "listing" is a YouTube advice video ("23 QUESTIONS EVERY APARTMENT BUYER
-- IN UGANDA SHOULD ASK!"), not a property: no location, no real price.
-- Guarded on its current state (pending, same source), so if staff have
-- already acted on it nothing changes. The before-row is kept for rollback:
-- scripts/rollback-196-reject-14871A.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS listing_correction_196_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  before_row jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $reject$
DECLARE
  p properties%ROWTYPE;
  reason_text text := 'Rejected: advice video, not a property listing (no location, no real price). Approved by Arthur 1 Nov 2026.';
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_196 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM listing_correction_196_backup) THEN
    RAISE NOTICE 'listing_correction_196 skipped already_recorded';
    RETURN;
  END IF;
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261031-14871A' FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'pending' OR p.source <> 'found_online_property_source_v1'
     OR COALESCE(p.extra_fields->>'source_url', '') <> 'https://www.youtube.com/watch?v=HV9cXfLn__c' THEN
    RAISE NOTICE 'listing_correction_196 skipped 14871A guard';
    RETURN;
  END IF;
  INSERT INTO listing_correction_196_backup (property_id, inquiry_reference, before_row)
    VALUES (p.id, p.inquiry_reference, to_jsonb(p));
  UPDATE properties SET status = 'rejected', moderation_stage = 'rejected',
    moderation_reason = reason_text, reviewed_at = NOW(),
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'moderation_reason', reason_text,
      'listing_correction_196', jsonb_build_object('applied_at', NOW(), 'fix', 'reject_not_a_listing')),
    updated_at = NOW()
   WHERE id = p.id;
  INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
    VALUES (p.id, 'migration_196_arthur_approved', 'reject', p.status, 'rejected', 'not_a_listing', reason_text, '{"migration":"196"}'::jsonb);
  RAISE NOTICE 'listing_correction_196 applied 14871A';
END;
$reject$;
