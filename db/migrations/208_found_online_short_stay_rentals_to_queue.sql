-- 208_found_online_short_stay_rentals_to_queue.sql
-- Move the found-online rental rows that are really short stays into the
-- short-stay pending queue.
--
-- Read-only count on 10 Nov 2026: 75 found-online rentals matched a nightly,
-- daily, Airbnb, or short-stay signal. Two of them were already moved by
-- migration 205 and are not in the list below. This migration moves the
-- other 73.
--
-- Each new st_listing is pending, source imported, labelled Found online.
-- It keeps the original title and caption (phone-shaped numbers removed),
-- the photos, the area, district and map pin, and a nightly price when the
-- stored figure is a plausible nightly amount. It does not copy a phone
-- number into any new column. Nothing is messaged.
--
-- The original properties row is hidden, not deleted, and extra_fields
-- records moved_to_st_listing_id.
--
-- Backup: short_stay_found_online_208_backup. The backup stores the previous
-- status and moderation stage, plus the new st_listing id. It does not copy
-- phone numbers. Rollback removes the keys this migration adds to extra_fields.
-- Rollback: scripts/rollback-208-found-online-short-stay-rentals.sql
-- (that file is outside db/migrations, so deploy does not run it).
-- Safe to run twice: a property already in the backup, or already marked
-- migration_208, is skipped.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS short_stay_found_online_208_backup (
  property_id UUID PRIMARY KEY,
  inquiry_reference TEXT NOT NULL,
  st_listing_id UUID,
  before_status TEXT NOT NULL,
  before_moderation_stage TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ
);

DO $move_208$
DECLARE
  p properties%ROWTYPE;
  existing_stay UUID;
  ref TEXT;
  new_id UUID;
  new_slug TEXT;
  period TEXT;
  evidence TEXT;
  nightly_words BOOLEAN;
  raw_price BIGINT;
  nightly BIGINT;
  title_text TEXT;
  caption_text TEXT;
  moved_count INTEGER := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_208 skipped country_not_ug';
    RETURN;
  END IF;

  FOR p IN
    SELECT properties.*
      FROM properties
      JOIN (VALUES
      ('MK-20260620-CB4475'),
      ('MK-20260630-14468C'),
      ('MK-20260630-3E7717'),
      ('MK-20260630-6B3C44'),
      ('MK-20260630-75E303'),
      ('MK-20260630-78D934'),
      ('MK-20260630-89C50F'),
      ('MK-20260630-CA81DC'),
      ('MK-20260707-5771E7'),
      ('MK-20260710-5C03FB'),
      ('MK-20260710-60B21F'),
      ('MK-20260710-9C98C6'),
      ('MK-20260710-AC303E'),
      ('MK-20260710-EAF3B6'),
      ('MK-20260710-F672C1'),
      ('MK-20260717-3B1148'),
      ('MK-20260717-B2F1AE'),
      ('MK-20260718-6F3DE6'),
      ('MK-20260718-B55F6A'),
      ('MK-20260720-5A028E'),
      ('MK-20260721-BD9020'),
      ('MK-20260726-CF56F2'),
      ('MK-20260731-728957'),
      ('MK-20260802-1927DA'),
      ('MK-20260802-2A1D22'),
      ('MK-20260802-74C46B'),
      ('MK-20260802-8E8CC4'),
      ('MK-20260802-A80741'),
      ('MK-20260802-A8CD6F'),
      ('MK-20260804-6772A5'),
      ('MK-20260809-339588'),
      ('MK-20260809-36BCF3'),
      ('MK-20260809-39561A'),
      ('MK-20260809-46CDAF'),
      ('MK-20260809-4D8416'),
      ('MK-20260809-573159'),
      ('MK-20260809-5ECD14'),
      ('MK-20260809-86BA99'),
      ('MK-20260809-8EECD3'),
      ('MK-20260809-9BA23C'),
      ('MK-20260809-A230B3'),
      ('MK-20260809-B1AAEE'),
      ('MK-20260809-C24ED1'),
      ('MK-20260809-C4C4DC'),
      ('MK-20260809-E09789'),
      ('MK-20260809-ED4478'),
      ('MK-20260810-076168'),
      ('MK-20260810-095703'),
      ('MK-20260810-1404D0'),
      ('MK-20260810-1D853C'),
      ('MK-20260810-32DCBE'),
      ('MK-20260810-40DDBA'),
      ('MK-20260810-4712D0'),
      ('MK-20260810-5247AF'),
      ('MK-20260810-55AA8D'),
      ('MK-20260810-754137'),
      ('MK-20260810-8E85B3'),
      ('MK-20260810-9452CD'),
      ('MK-20260810-9AE7A9'),
      ('MK-20260810-9D95DB'),
      ('MK-20260810-A5AEA2'),
      ('MK-20260810-B46364'),
      ('MK-20260810-C50427'),
      ('MK-20260810-CBF2BD'),
      ('MK-20260810-D21987'),
      ('MK-20260810-D381F1'),
      ('MK-20260810-D5D5DB'),
      ('MK-20260810-D8353F'),
      ('MK-20260810-FA49CC'),
      ('MK-20260915-A491EF'),
      ('MK-20260925-39B525'),
      ('MK-20260927-F3399B'),
      ('MK-20261014-F8917D')
      ) AS approved(inquiry_reference)
        ON approved.inquiry_reference = properties.inquiry_reference
     WHERE LOWER(COALESCE(properties.listing_type, '')) = 'rent'
       AND COALESCE(properties.status, '') <> 'deleted'
       AND COALESCE(properties.extra_fields->>'migration_205', '') IS DISTINCT FROM 'true'
       AND NOT (properties.extra_fields ? 'moved_to_short_stay_slug')
       AND COALESCE(properties.extra_fields->>'migration_208', '') IS DISTINCT FROM 'true'
       AND NOT EXISTS (
         SELECT 1 FROM short_stay_found_online_208_backup b
          WHERE b.property_id = properties.id
            AND b.rolled_back_at IS NULL
       )
       AND (
         properties.source = 'found_online_property_source_v1'
         OR properties.listed_via = 'found_online'
         OR properties.source = 'sourced_inventory_candidate'
         OR COALESCE(properties.extra_fields->>'found_online_label', '') <> ''
       )
       AND (
         LOWER(COALESCE(properties.price_period, '')) IN ('night', 'nightly', 'day', 'daily')
         OR (
           COALESCE(properties.title, '') || ' ' || COALESCE(properties.description, '') || ' ' ||
           COALESCE(properties.extra_fields->>'source_text', '') || ' ' ||
           COALESCE(properties.extra_fields->>'source_caption', '') || ' ' ||
           COALESCE(properties.extra_fields->>'source_title', '')
         ) ~* '(per[[:space:]]+night|nightly|/[[:space:]]*night|per[[:space:]]+day|daily[[:space:]]+rate|air[[:space:]]*bnb|short[[:space:]-]*stay)'
       )
     ORDER BY properties.inquiry_reference
     FOR UPDATE OF properties
  LOOP
    SELECT s.id INTO existing_stay
      FROM st_listing s
     WHERE s.extra_fields->>'migration_208' = 'true'
       AND s.extra_fields->>'moved_from_property_id' = p.id::text
     LIMIT 1;

    IF existing_stay IS NOT NULL THEN
      INSERT INTO short_stay_found_online_208_backup (
        property_id, inquiry_reference, st_listing_id, before_status, before_moderation_stage
      ) VALUES (
        p.id, p.inquiry_reference, existing_stay, p.status, p.moderation_stage
      ) ON CONFLICT (property_id) DO NOTHING;
      UPDATE properties SET
        status = 'hidden',
        moderation_stage = 'hidden',
        extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
          'migration_208', true,
          'moved_to_st_listing_id', existing_stay::text,
          'hidden_reason', 'found_online_short_stay_pending_queue'
        ),
        updated_at = NOW()
       WHERE id = p.id
         AND COALESCE(extra_fields->>'migration_208', '') IS DISTINCT FROM 'true';
      CONTINUE;
    END IF;

    evidence := COALESCE(p.title, '') || ' ' || COALESCE(p.description, '') || ' ' ||
      COALESCE(p.extra_fields->>'source_text', '') || ' ' ||
      COALESCE(p.extra_fields->>'source_caption', '') || ' ' ||
      COALESCE(p.extra_fields->>'source_title', '');
    nightly_words := evidence ~* '(per[[:space:]]+night|nightly|/[[:space:]]*night|per[[:space:]]+day|daily[[:space:]]+rate)';
    period := LOWER(TRIM(COALESCE(p.price_period, '')));
    raw_price := CASE
      WHEN p.price IS NULL OR p.price <= 0 THEN 0
      ELSE p.price
    END;
    -- A night or day period is already a nightly figure. A monthly or one-off
    -- figure is used as the nightly price only when the caption says per night
    -- or per day and the amount is in a guest-night range. Anything else is
    -- kept for the moderator as POA, not guessed into a nightly rate.
    nightly := CASE
      WHEN period IN ('night', 'nightly', 'day', 'daily') AND raw_price BETWEEN 1 AND 5000000 THEN raw_price
      WHEN period IN ('month', 'mo', 'monthly', 'once') AND nightly_words AND raw_price BETWEEN 20000 AND 2000000 THEN raw_price
      ELSE 0
    END;

    title_text := btrim(regexp_replace(
      regexp_replace(COALESCE(p.title, ''), '(\+?\s*256[\s.\-]*[37]\d{8})|(\m0[37]\d{8}\M)', '', 'g'),
      '[[:space:]]{2,}', ' ', 'g'
    ));
    IF title_text IS NULL OR length(title_text) < 3 THEN
      title_text := 'Short stay found online';
    END IF;
    caption_text := btrim(regexp_replace(
      regexp_replace(
        COALESCE(NULLIF(btrim(p.description), ''), NULLIF(btrim(p.extra_fields->>'source_caption'), ''), NULLIF(btrim(p.extra_fields->>'source_text'), ''), p.title, ''),
        '(\+?\s*256[\s.\-]*[37]\d{8})|(\m0[37]\d{8}\M)', '', 'g'
      ),
      '[[:space:]]{2,}', ' ', 'g'
    ));
    IF caption_text IS NULL OR length(caption_text) < 3 THEN
      caption_text := title_text;
    END IF;

    ref := 'ST-' || lpad(nextval('st_listing_reference_seq')::text, 6, '0');
    new_slug := left(trim(both '-' FROM regexp_replace(lower(title_text), '[^a-z0-9]+', '-', 'g')), 60)
      || '-' || lower(ref);

    INSERT INTO st_listing (
      reference, slug, title, description, district, area, address, latitude, longitude,
      place_type, property_type, bedrooms, beds, bathrooms, max_guests,
      base_nightly_ugx, host_name, host_phone, host_type,
      status, moderation_stage, moderation_notes, acquisition_notes,
      king_facts_confirmed, listing_fee_ugx, listing_fee_status,
      source, listed_via, extra_fields
    ) VALUES (
      ref, new_slug, left(title_text, 300), left(caption_text, 6000),
      COALESCE(NULLIF(btrim(p.district), ''), ''),
      COALESCE(NULLIF(btrim(p.area), ''), ''),
      NULLIF(btrim(p.address), ''),
      p.latitude, p.longitude,
      'entire_place', NULLIF(btrim(p.property_type), ''),
      GREATEST(COALESCE(p.bedrooms, 1), 1),
      GREATEST(COALESCE(p.bedrooms, 1), 1),
      GREATEST(COALESCE(p.bathrooms, 1), 1),
      2,
      nightly,
      'Found online',
      '',
      'owner',
      'pending',
      'submitted',
      'Found online. Moved from a rental into the short-stay pending queue. Do not message this source.',
      'Found online. Do not message this source.',
      FALSE,
      0,
      'waived',
      'imported',
      'import',
      jsonb_strip_nulls(jsonb_build_object(
        'found_online_label', 'Found online',
        'source_labels', jsonb_build_array('Found online'),
        'do_not_message', true,
        'messaging_policy', 'found_online_never_message',
        'migration_208', true,
        'moved_from_property_id', p.id::text,
        'moved_from_reference', p.inquiry_reference,
        'source_url', NULLIF(COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', ''), ''),
        'source_platform', NULLIF(p.extra_fields->>'source_platform', ''),
        'price_on_application', (nightly = 0),
        'price_label', CASE WHEN nightly = 0 THEN 'POA' ELSE NULL END,
        'price_review', CASE WHEN raw_price > 0 AND nightly = 0 THEN 'needs_nightly_confirmation' ELSE NULL END,
        'source_price_ugx', CASE WHEN raw_price > 0 THEN raw_price ELSE NULL END,
        'source_price_period', NULLIF(period, '')
      ))
    ) RETURNING id INTO new_id;

    INSERT INTO st_listing_media (listing_id, url, is_primary, sort_order)
    SELECT new_id, photo.url, (photo.rn = 1), photo.rn - 1
      FROM (
        SELECT url, row_number() OVER (ORDER BY is_primary DESC, sort_order, url) AS rn
          FROM (
            SELECT DISTINCT ON (url) url, is_primary, sort_order
              FROM property_images
             WHERE property_id = p.id
               AND NULLIF(btrim(url), '') IS NOT NULL
             ORDER BY url, is_primary DESC, sort_order
          ) distinct_photos
      ) photo;

    INSERT INTO short_stay_found_online_208_backup (
      property_id, inquiry_reference, st_listing_id, before_status, before_moderation_stage
    ) VALUES (
      p.id, p.inquiry_reference, new_id, p.status, p.moderation_stage
    )
    ON CONFLICT (property_id) DO UPDATE SET
      inquiry_reference = EXCLUDED.inquiry_reference,
      st_listing_id = EXCLUDED.st_listing_id,
      before_status = EXCLUDED.before_status,
      before_moderation_stage = EXCLUDED.before_moderation_stage,
      applied_at = NOW(),
      rolled_back_at = NULL
    WHERE short_stay_found_online_208_backup.rolled_back_at IS NOT NULL;

    UPDATE properties SET
      status = 'hidden',
      moderation_stage = 'hidden',
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'migration_208', true,
        'moved_to_st_listing_id', new_id::text,
        'moved_to_short_stay_reference', ref,
        'hidden_reason', 'found_online_short_stay_pending_queue'
      ),
      updated_at = NOW()
     WHERE id = p.id;

    moved_count := moved_count + 1;
  END LOOP;

  RAISE NOTICE 'migration_208 moved % found-online rentals into the short-stay pending queue', moved_count;
END
$move_208$;
