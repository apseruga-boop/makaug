-- Read-only dry run for db/migrations/201_found_online_phone_backfill.sql.
-- Lists the pending found-online rows with no phone and the number each would
-- get (masked to the last 3 digits). Caption number first, then poster bio.
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
  SELECT c.*,
         CASE
           WHEN c.cap_digits ~ '^2567\d{8}$' THEN '+' || c.cap_digits
           WHEN c.cap_digits ~ '^25607\d{8}$' THEN '+256' || substr(c.cap_digits, 5)
           WHEN c.cap_digits ~ '^07\d{8}$' THEN '+256' || substr(c.cap_digits, 2)
           WHEN c.cap_digits ~ '^7\d{8}$' THEN '+256' || c.cap_digits
         END AS caption_phone,
         CASE WHEN c.bio_phone ~ '^\+2567\d{8}$' THEN c.bio_phone END AS bio_phone_ok
    FROM cand c
)
SELECT right(inquiry_reference, 6) AS ref,
       CASE WHEN caption_phone IS NOT NULL THEN 'caption' WHEN bio_phone_ok IS NOT NULL THEN 'poster_bio' ELSE 'none' END AS phone_source,
       CASE WHEN COALESCE(caption_phone, bio_phone_ok) IS NOT NULL THEN '+256 *** **' || right(COALESCE(caption_phone, bio_phone_ok), 3) ELSE '' END AS masked_phone
  FROM resolved
 ORDER BY phone_source, ref;
