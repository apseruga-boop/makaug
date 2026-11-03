-- Backfill the phone on pending found-online listings that were imported with
-- none. Uses only data already stored: a Ugandan number in the harvested
-- caption (harvest_caption_full / source_caption / source_text) wins, then
-- extra_fields.poster_bio_phone. No re-scraping. Only rows that are pending
-- AND have an empty lister_phone and contact_phone are touched; each is backed
-- up first. Preview: scripts/dry-run-201-found-online-phone-backfill.sql.
-- Rollback: scripts/rollback-201-found-online-phone-backfill.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS found_online_phone_201_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  before_row jsonb NOT NULL,
  new_phone text NOT NULL,
  phone_source text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $fix$
DECLARE
  r record;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'found_online_phone_201 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM found_online_phone_201_backup) THEN
    RAISE NOTICE 'found_online_phone_201 skipped already_recorded';
    RETURN;
  END IF;
  FOR r IN
    WITH scope AS (
      SELECT p.id, p.inquiry_reference,
             regexp_replace(concat_ws(' ', p.extra_fields->>'harvest_caption_full', p.extra_fields->>'source_caption', p.extra_fields->>'source_text'), '\s+', ' ', 'g') AS caption,
             p.extra_fields->>'poster_bio_phone' AS bio_phone
        FROM properties p
       WHERE p.status = 'pending'
         AND p.listed_via = 'found_online'
         AND COALESCE(NULLIF(btrim(p.lister_phone), ''), NULLIF(btrim(p.extra_fields->>'contact_phone'), '')) IS NULL
    ), cand AS (
      SELECT s.*,
             (SELECT regexp_replace(m[2], '\D', '', 'g')
                FROM regexp_matches(regexp_replace(s.caption, '\+(?!256)\d{1,3}(?:[\s().-]*\d){7,14}', ' ', 'g'),
                     '(^|[^\d+])((?:\+?256[\s().-]*(?:\(?0\)?[\s.-]*)?|0[\s().-]*)7(?:[\s().-]*\d){8}|7\d{2}[\s-]?\d{3}[\s-]?\d{3})(?=$|[^\d])', 'g') m
               LIMIT 1) AS cap_digits
        FROM scope s
    ), resolved AS (
      SELECT c.id, c.inquiry_reference,
             CASE
               WHEN c.cap_digits ~ '^2567\d{8}$' THEN '+' || c.cap_digits
               WHEN c.cap_digits ~ '^25607\d{8}$' THEN '+256' || substr(c.cap_digits, 5)
               WHEN c.cap_digits ~ '^07\d{8}$' THEN '+256' || substr(c.cap_digits, 2)
               WHEN c.cap_digits ~ '^7\d{8}$' THEN '+256' || c.cap_digits
             END AS caption_phone,
             CASE WHEN c.bio_phone ~ '^\+2567\d{8}$' THEN c.bio_phone END AS bio_phone
        FROM cand c
    )
    SELECT id, inquiry_reference, COALESCE(caption_phone, bio_phone) AS phone,
           CASE WHEN caption_phone IS NOT NULL THEN 'caption' ELSE 'poster_bio' END AS src
      FROM resolved
     WHERE COALESCE(caption_phone, bio_phone) IS NOT NULL
  LOOP
    INSERT INTO found_online_phone_201_backup (property_id, inquiry_reference, before_row, new_phone, phone_source)
      SELECT p.id, p.inquiry_reference, to_jsonb(p), r.phone, r.src FROM properties p WHERE p.id = r.id;
    UPDATE properties SET
      lister_phone = r.phone,
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'contact_phone', r.phone,
        'public_contact_phone', r.phone,
        'phone_backfill_201', jsonb_build_object('source', r.src, 'applied_at', NOW())),
      updated_at = NOW()
     WHERE id = r.id
       AND status = 'pending'
       AND COALESCE(NULLIF(btrim(lister_phone), ''), NULLIF(btrim(extra_fields->>'contact_phone'), '')) IS NULL;
  END LOOP;
END
$fix$;
