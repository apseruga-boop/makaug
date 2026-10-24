-- Every new listing gets an MK reference, including WhatsApp intake, without
-- changing the WhatsApp bridge. Existing rows with a blank reference are
-- backfilled. price_unit is added and left NULL, so stored prices stay the
-- total they already are.
--
-- The indexes serve the staff editor list (updated_at order), Preview & edit
-- (same-phone previous listings), the Pending Review count, and the
-- my-moderation / My Approvals count (actor_id had no index, so that count
-- scanned property_moderation_events and timed out around 05:20 UK on 22 Oct).
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. This file is
-- applied statement by statement.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS price_unit TEXT;

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_price_unit_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_price_unit_check
  CHECK (price_unit IS NULL OR price_unit IN ('total', 'per_acre', 'per_decimal'));

CREATE OR REPLACE FUNCTION properties_assign_inquiry_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt integer := 0;
  candidate text;
  stamp text;
BEGIN
  IF NEW.inquiry_reference IS NOT NULL AND btrim(NEW.inquiry_reference) <> '' THEN
    RETURN NEW;
  END IF;
  stamp := to_char(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYYMMDD');
  LOOP
    attempt := attempt + 1;
    candidate := 'MK-' || stamp || '-' || upper(substr(md5(
      COALESCE(NEW.id::text, '') || clock_timestamp()::text || random()::text || attempt::text
    ), 1, 6));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM properties WHERE inquiry_reference = candidate
    );
    IF attempt >= 8 THEN
      EXIT;
    END IF;
  END LOOP;
  NEW.inquiry_reference := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_assign_inquiry_reference ON properties;

CREATE TRIGGER properties_assign_inquiry_reference
  BEFORE INSERT ON properties
  FOR EACH ROW
  EXECUTE FUNCTION properties_assign_inquiry_reference();

-- Deterministic first pass from the property id. A second pass moves any
-- suffix that collided with a reference already on another row.
UPDATE properties AS target
SET inquiry_reference = 'MK-'
  || to_char(COALESCE(target.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYYMMDD')
  || '-'
  || upper(substr(replace(target.id::text, '-', ''), 1, 6))
WHERE target.inquiry_reference IS NULL
   OR btrim(target.inquiry_reference) = '';

UPDATE properties AS target
SET inquiry_reference = 'MK-'
  || to_char(COALESCE(target.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYYMMDD')
  || '-'
  || upper(substr(replace(target.id::text, '-', ''), 7, 6))
WHERE target.id IN (
  SELECT id
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY inquiry_reference ORDER BY created_at NULLS LAST, id) AS ref_rank
    FROM properties
    WHERE inquiry_reference IS NOT NULL
      AND btrim(inquiry_reference) <> ''
  ) ranked
  WHERE ref_rank > 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_moderation_events_actor_created
  ON property_moderation_events (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_pending_review_created
  ON properties (created_at ASC, id ASC)
  WHERE lower(COALESCE(status, '')) IN (
    'pending',
    'pending_review',
    'test_pending_review',
    'pending_review_hidden',
    'draft',
    'submitted',
    'resubmitted',
    'in_review',
    'under_review',
    'needs_review',
    'awaiting_review',
    'queued',
    'source_review',
    'source_review_required',
    'pending_king_source_review',
    'king_review'
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_lister_phone_lookup
  ON properties (lister_phone)
  WHERE lister_phone IS NOT NULL AND lister_phone <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_lister_email_lookup
  ON properties (lower(lister_email))
  WHERE lister_email IS NOT NULL AND btrim(lister_email) <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_list_updated
  ON properties (updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC);
