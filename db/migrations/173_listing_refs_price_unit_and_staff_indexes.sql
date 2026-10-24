-- Every new listing gets an MK reference, including WhatsApp intake, without
-- changing the WhatsApp bridge. Only blank or NULL references are filled.
-- A reference that is already stored, including a duplicate such as one MK
-- code on two live listings, is left for staff. price_unit is added and left
-- NULL, so stored prices stay the total they already are.
--
-- SET lock_timeout (not SET LOCAL) because CREATE INDEX CONCURRENTLY runs
-- outside a transaction. 5s stops a DDL lock wait from sitting on the live
-- table. An INVALID index of the same name is dropped before each
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS, otherwise IF NOT EXISTS would
-- leave the broken index in place.

SET lock_timeout = '5s';
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
    IF attempt >= 16 THEN
      RAISE EXCEPTION 'Could not assign an unused inquiry reference';
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

-- Fill blank references only. Never rewrite a non-empty MK reference, even
-- when two rows share one (staff handle those). Each generated value is
-- skipped when it is already in use.
DO $$
DECLARE
  duplicate_ref text;
  duplicate_count integer;
  rec record;
  candidate text;
  stamp text;
  hex text;
  attempt integer;
BEGIN
  FOR duplicate_ref, duplicate_count IN
    SELECT inquiry_reference, COUNT(*)::integer
    FROM properties
    WHERE inquiry_reference IS NOT NULL
      AND btrim(inquiry_reference) <> ''
    GROUP BY inquiry_reference
    HAVING COUNT(*) > 1
    ORDER BY inquiry_reference
  LOOP
    RAISE NOTICE 'Duplicate inquiry reference left unchanged for staff: % (% listings)', duplicate_ref, duplicate_count;
  END LOOP;

  FOR rec IN
    SELECT id, created_at
    FROM properties
    WHERE inquiry_reference IS NULL
       OR btrim(inquiry_reference) = ''
    ORDER BY created_at NULLS LAST, id
  LOOP
    stamp := to_char(COALESCE(rec.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYYMMDD');
    hex := upper(replace(rec.id::text, '-', ''));
    attempt := 0;
    LOOP
      attempt := attempt + 1;
      IF attempt = 1 THEN
        candidate := 'MK-' || stamp || '-' || substr(hex, 1, 6);
      ELSIF attempt <= 6 THEN
        candidate := 'MK-' || stamp || '-' || substr(hex, attempt, 6);
      ELSE
        candidate := 'MK-' || stamp || '-' || upper(substr(md5(rec.id::text || attempt::text || clock_timestamp()::text), 1, 6));
      END IF;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM properties WHERE inquiry_reference = candidate
      );
      IF attempt >= 16 THEN
        RAISE EXCEPTION 'Could not assign an unused inquiry reference for %', rec.id;
      END IF;
    END LOOP;
    UPDATE properties
    SET inquiry_reference = candidate
    WHERE id = rec.id
      AND (inquiry_reference IS NULL OR btrim(inquiry_reference) = '');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION makaug_drop_invalid_index(index_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = index_name
      AND i.indisvalid IS NOT TRUE
  ) THEN
    EXECUTE format('DROP INDEX IF EXISTS %I', index_name);
  END IF;
END;
$$;

SELECT makaug_drop_invalid_index('idx_property_moderation_events_actor_created');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_moderation_events_actor_created
  ON property_moderation_events (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

SELECT makaug_drop_invalid_index('idx_properties_pending_review_created');

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

SELECT makaug_drop_invalid_index('idx_properties_lister_phone_lookup');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_lister_phone_lookup
  ON properties (lister_phone)
  WHERE lister_phone IS NOT NULL AND lister_phone <> '';

SELECT makaug_drop_invalid_index('idx_properties_lister_email_lookup');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_lister_email_lookup
  ON properties (lower(lister_email))
  WHERE lister_email IS NOT NULL AND btrim(lister_email) <> '';

SELECT makaug_drop_invalid_index('idx_properties_staff_list_updated');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_list_updated
  ON properties (updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC);

DROP FUNCTION IF EXISTS makaug_drop_invalid_index(text);
