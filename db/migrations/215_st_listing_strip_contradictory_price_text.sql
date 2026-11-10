-- 215_st_listing_strip_contradictory_price_text.sql
-- Clean live short-stay descriptions that contradict the structured price.
--
-- Some found-online stays still say "price on application" or "/month"
-- (or "per month" / "monthly") in the description even when the row has a
-- nightly figure, or they state a monthly guide price while the stay is
-- POA. This only rewrites description text. It does not change the stored
-- price, the POA flag, phones, status or visibility.
--
-- Backup: st_listing_desc_price_215_backup. The backup stores the previous
-- and cleaned description. It does not copy phone numbers into a new
-- column; phones that already sat in the description stay in that backup
-- text so rollback can restore the exact previous string.
-- Rollback: scripts/rollback-215-st-listing-desc-price-text.sql
-- (that file is outside db/migrations, so deploy does not run it).
-- Safe to run twice: a listing already in the backup, or already marked
-- description_price_cleanup_215, is skipped.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS st_listing_desc_price_215_backup (
  listing_id UUID PRIMARY KEY,
  reference TEXT NOT NULL,
  before_description TEXT,
  after_description TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ
);

DO $clean_215$
DECLARE
  rec RECORD;
  cleaned TEXT;
  moved INTEGER := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_215 skipped country_not_ug';
    RETURN;
  END IF;

  FOR rec IN
    SELECT l.id, l.reference, l.description
      FROM st_listing l
      LEFT JOIN st_listing_desc_price_215_backup b
        ON b.listing_id = l.id AND b.rolled_back_at IS NULL
     WHERE l.status = 'approved'
       AND b.listing_id IS NULL
       AND NOT (COALESCE(l.extra_fields, '{}'::jsonb) ? 'description_price_cleanup_215')
       AND (
         (
           l.description ~* 'price[[:space:]]+(on|upon)[[:space:]]+application'
           AND l.base_nightly_ugx > 0
           AND COALESCE(l.extra_fields->>'price_on_application', '') IS DISTINCT FROM 'true'
         )
         OR l.description ~* '/month|\yper[[:space:]]+month\y|\ymonthly\y'
       )
  LOOP
    cleaned := rec.description;
    cleaned := regexp_replace(
      cleaned,
      '\s*The source did not publish a price, so [^.]*price[[:space:]]+(on|upon)[[:space:]]+application[^.]*\.',
      ' ',
      'gi'
    );
    cleaned := regexp_replace(cleaned, 'price[[:space:]]+(on|upon)[[:space:]]+application', ' ', 'gi');
    cleaned := regexp_replace(cleaned, '/month', ' ', 'gi');
    cleaned := regexp_replace(cleaned, '\yper[[:space:]]+month\y', ' ', 'gi');
    cleaned := regexp_replace(cleaned, '\ymonthly\y', ' ', 'gi');
    cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));
    cleaned := regexp_replace(cleaned, '\s+([,.;:!?])', '\1', 'g');

    IF cleaned = '' OR cleaned IS NOT DISTINCT FROM rec.description THEN
      CONTINUE;
    END IF;

    INSERT INTO st_listing_desc_price_215_backup (
      listing_id, reference, before_description, after_description
    ) VALUES (
      rec.id, rec.reference, rec.description, cleaned
    )
    ON CONFLICT (listing_id) DO UPDATE
      SET reference = EXCLUDED.reference,
          before_description = EXCLUDED.before_description,
          after_description = EXCLUDED.after_description,
          applied_at = NOW(),
          rolled_back_at = NULL
      WHERE st_listing_desc_price_215_backup.rolled_back_at IS NOT NULL;

    UPDATE st_listing
       SET description = cleaned,
           extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
             'description_price_cleanup_215', jsonb_build_object(
               'applied_at', NOW(),
               'reason', 'Removed price or period wording that contradicted the structured nightly price or POA flag'
             )
           ),
           updated_at = NOW()
     WHERE id = rec.id;

    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'migration_215 cleaned % short-stay descriptions', moved;
END
$clean_215$;
