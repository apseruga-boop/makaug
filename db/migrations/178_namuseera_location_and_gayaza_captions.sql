-- Namuseera location and Gayaza captions, 24 Oct 2026.
-- 177 is on main (cae6fec2) and has been applied. Its Namuseera block
-- skipped ee920882 because the stored area was already set and was not
-- Namuseera. The title, neighbourhood, label, and type were left as they
-- were. This file is the next migration. It does not depend on re-running
-- 177.
--
-- Uganda only. Idempotent. Each listing is checked against the value the
-- public API returned on 24 Oct 2026 and skipped, with one NOTICE, when
-- that value has moved. A second run finds the target state and does
-- nothing. The updated_at trigger is disabled around each update so
-- updated_at stays equal to the stamp's applied_at.
-- Rollback: scripts/rollback-178-listing-corrections.sql. That file is not
-- a migration and does not run on deploy.
--
-- Public API, ee920882-bd61-4f1d-9156-75f45851edf9, checked before this
-- file was written:
--   title: Land for sale in Namuseera, Wakiso
--   property_type: Commercial land
--   listing_type: land
--   transaction_type: sale
--   status: approved
--   district: Wakiso
--   address: Namuseera Estate, Namuseera, Wakiso
--   public area: null
--   canonical_location_id: wakiso:wakiso
--   canonical_location_level: district
--   city: Wakiso Town
--   neighborhood: Wakiso
--   resolved_location_label: From, Kampala, Central
--   region: Central
--   location_resolution_status: canonical_human_confirmed
-- The public area is the district canonical display, which blanks a stored
-- area that is empty, "From", the district name, or a place the registry
-- already knows. That is why the API area was null while 177 still saw a
-- non-Namuseera area and skipped. With the public area blank, the page
-- composes neighbourhood Wakiso and city Wakiso Town, and drops the
-- repeated district, so the location line reads Wakiso, Wakiso Town.
-- This migration does not require the pre-177 area (null) and does not
-- require any particular wrong area. It writes area Namuseera while the
-- live fields above still match.
-- Canonical stays wakiso:wakiso. There is no Namuseera node, and this
-- migration does not add one. The stored title is left as it is.
-- Neighbourhood becomes Namuseera, the Wakiso Town city is removed, and
-- the resolved label becomes Namuseera, Wakiso. property_type becomes the
-- existing value Land. The public location is then area plus district:
-- Namuseera, Wakiso. The type line is Land.
--
-- Public API, 36760196-c98d-41c9-b1e5-31e1417067c6 (Gayaza), same check:
--   title: Land for sale in Gayaza
--   property_type: Land
--   area: Gayaza
--   district: Wakiso
--   canonical_location_id: wakiso:gayaza
-- Four gallery rows are still captioned "Distinct video key image N of 5"
-- and the main photo is still "Primary property photo". Those captions are
-- cleared the same way 177 cleared them on Mbalwa: the image row is copied
-- first, then room_label is set to null. "Property photo 2" is left as it
-- is. Photo files are not removed. No properties row is deleted.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_178_backup (
  id BIGSERIAL PRIMARY KEY,
  property_id UUID NOT NULL,
  action TEXT NOT NULL,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, row_kind, row_key)
);

CREATE OR REPLACE FUNCTION pg_temp.norm_listing_title_178(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_178$
  SELECT regexp_replace(
    lower(btrim(
      regexp_replace(
        replace(replace(coalesce(value, ''), chr(160), ' '), chr(8239), ' '),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )),
    '^ +| +$',
    '',
    'g'
  );
$fn_178$;

CREATE OR REPLACE FUNCTION pg_temp.listing_178_guard_country()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_178_country$
BEGIN
  RETURN current_setting('app.country_code', true) IS NOT DISTINCT FROM 'UG';
END;
$fn_178_country$;

CREATE OR REPLACE FUNCTION pg_temp.listing_178_disable_updated_at()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_178_trigger$
BEGIN
  IF to_regclass('public.properties') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'trg_properties_updated_at'
         AND tgrelid = to_regclass('public.properties')
         AND NOT tgisinternal
     ) THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$fn_178_trigger$;

CREATE OR REPLACE FUNCTION pg_temp.listing_178_stamp(extra jsonb, action text, applied_at timestamptz)
RETURNS jsonb
LANGUAGE sql
AS $fn_178_stamp$
  SELECT COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
    'listing_correction_178',
    jsonb_strip_nulls(jsonb_build_object(
      'applied_at', applied_at,
      'actions',
      (
        SELECT COALESCE(jsonb_agg(item ORDER BY item), '[]'::jsonb)
        FROM (
          SELECT DISTINCT item
          FROM (
            SELECT jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(COALESCE(extra, '{}'::jsonb)->'listing_correction_178'->'actions') = 'array'
                  THEN COALESCE(extra, '{}'::jsonb)->'listing_correction_178'->'actions'
                ELSE '[]'::jsonb
              END
            ) AS item
            UNION ALL
            SELECT action
          ) raw
          WHERE item IS NOT NULL AND btrim(item) <> ''
        ) unique_actions
      )
    ))
  );
$fn_178_stamp$;

CREATE OR REPLACE FUNCTION pg_temp.listing_178_backup_property(p properties, action text)
RETURNS void
LANGUAGE plpgsql
AS $fn_178_backup_property$
BEGIN
  INSERT INTO listing_correction_178_backup (property_id, action, row_kind, row_key, before_row)
  VALUES (p.id, action, 'property', p.id::text, to_jsonb(p))
  ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
END;
$fn_178_backup_property$;

DO $do_178_country$
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_178 skipped country_not_ug';
  END IF;
END
$do_178_country$;

-- ee920882. Area becomes Namuseera even when a non-Namuseera area is set.
-- Canonical stays wakiso:wakiso. No registry row is inserted.
DO $do_178_namuseera$
DECLARE
  pid uuid := 'ee920882-bd61-4f1d-9156-75f45851edf9';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_extra jsonb;
  live_title text := 'Land for sale in Namuseera, Wakiso';
  live_address text := 'Namuseera Estate, Namuseera, Wakiso';
BEGIN
  IF NOT pg_temp.listing_178_guard_country() THEN
    RETURN;
  END IF;
  trigger_off := pg_temp.listing_178_disable_updated_at();
  SELECT * INTO p FROM properties WHERE id = pid;
  IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
    RAISE NOTICE 'listing_correction_178 % skipped deleted', pid;
  ELSIF btrim(coalesce(p.area, '')) = 'Namuseera'
    AND btrim(coalesce(p.property_type, '')) = 'Land'
    AND coalesce(p.extra_fields->>'canonical_location_id', '') = 'wakiso:wakiso'
    AND coalesce(p.extra_fields->>'neighborhood', '') = 'Namuseera'
    AND coalesce(p.extra_fields->>'resolved_location_label', '') = 'Namuseera, Wakiso'
    AND coalesce(p.extra_fields->>'city', '') IS DISTINCT FROM 'Wakiso Town'
    AND pg_temp.norm_listing_title_178(p.title) = pg_temp.norm_listing_title_178(live_title) THEN
    RAISE NOTICE 'listing_correction_178 % skipped already_in_target_state', pid;
  ELSIF pg_temp.norm_listing_title_178(p.title) IS DISTINCT FROM pg_temp.norm_listing_title_178(live_title) THEN
    RAISE NOTICE 'listing_correction_178 % skipped title_guard', pid;
  ELSIF lower(btrim(coalesce(p.status, ''))) IS DISTINCT FROM 'approved' THEN
    RAISE NOTICE 'listing_correction_178 % skipped status_guard', pid;
  ELSIF btrim(coalesce(p.property_type, '')) NOT IN ('Commercial land', 'Land') THEN
    RAISE NOTICE 'listing_correction_178 % skipped type_guard', pid;
  ELSIF lower(btrim(coalesce(p.listing_type, ''))) IS DISTINCT FROM 'land' THEN
    RAISE NOTICE 'listing_correction_178 % skipped listing_guard', pid;
  ELSIF lower(btrim(coalesce(p.transaction_type, ''))) IS DISTINCT FROM 'sale' THEN
    RAISE NOTICE 'listing_correction_178 % skipped transaction_guard', pid;
  ELSIF btrim(coalesce(p.district, '')) IS DISTINCT FROM 'Wakiso' THEN
    RAISE NOTICE 'listing_correction_178 % skipped district_guard', pid;
  ELSIF btrim(coalesce(p.address, '')) IS DISTINCT FROM live_address THEN
    RAISE NOTICE 'listing_correction_178 % skipped address_guard', pid;
  ELSIF coalesce(p.extra_fields->>'canonical_location_id', '') IS DISTINCT FROM 'wakiso:wakiso'
    OR coalesce(p.extra_fields->>'canonical_location_level', '') IS DISTINCT FROM 'district' THEN
    RAISE NOTICE 'listing_correction_178 % skipped canonical_guard', pid;
  ELSIF coalesce(p.extra_fields->>'location_resolution_status', '') IS DISTINCT FROM 'canonical_human_confirmed' THEN
    RAISE NOTICE 'listing_correction_178 % skipped resolution_guard', pid;
  ELSIF coalesce(p.extra_fields->>'region', '') IS DISTINCT FROM 'Central' THEN
    RAISE NOTICE 'listing_correction_178 % skipped region_guard', pid;
  ELSIF coalesce(p.extra_fields->>'city', '') NOT IN ('Wakiso Town', '') THEN
    RAISE NOTICE 'listing_correction_178 % skipped city_guard', pid;
  ELSIF coalesce(p.extra_fields->>'neighborhood', '') NOT IN ('Wakiso', 'Namuseera') THEN
    RAISE NOTICE 'listing_correction_178 % skipped neighborhood_guard', pid;
  ELSIF coalesce(p.extra_fields->>'resolved_location_label', '') NOT IN ('From, Kampala, Central', 'Namuseera, Wakiso') THEN
    RAISE NOTICE 'listing_correction_178 % skipped label_guard', pid;
  ELSE
    v_now := clock_timestamp();
    v_extra := COALESCE(p.extra_fields, '{}'::jsonb);
    v_extra := v_extra || jsonb_build_object(
      'neighborhood', 'Namuseera',
      'resolved_location_label', 'Namuseera, Wakiso'
    );
    IF btrim(coalesce(v_extra->>'city', '')) = 'Wakiso Town' THEN
      v_extra := v_extra - 'city';
    END IF;
    v_extra := pg_temp.listing_178_stamp(v_extra, 'namuseera_location', v_now);
    PERFORM pg_temp.listing_178_backup_property(p, 'namuseera_location');
    UPDATE properties AS target
    SET
      area = 'Namuseera',
      property_type = 'Land',
      extra_fields = v_extra,
      updated_at = v_now
    WHERE target.id = p.id;
    RAISE NOTICE 'listing_correction_178 % applied namuseera_location', pid;
  END IF;
  IF trigger_off THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
EXCEPTION WHEN OTHERS THEN
  IF trigger_off THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
  RAISE;
END
$do_178_namuseera$;

-- Gayaza captions left behind by 177. Same clear as Mbalwa: generated
-- "Distinct video key image …" and "Primary property photo" labels only.
DO $do_178_gayaza$
DECLARE
  pid uuid := '36760196-c98d-41c9-b1e5-31e1417067c6';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_extra jsonb;
  live_title text := 'Land for sale in Gayaza';
  url_mismatch integer := 0;
  bad_caption integer := 0;
  pending integer := 0;
BEGIN
  IF NOT pg_temp.listing_178_guard_country() THEN
    RETURN;
  END IF;
  trigger_off := pg_temp.listing_178_disable_updated_at();
  SELECT * INTO p FROM properties WHERE id = pid;
  IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
    RAISE NOTICE 'listing_correction_178 % skipped deleted', pid;
  ELSIF pg_temp.norm_listing_title_178(p.title) IS DISTINCT FROM pg_temp.norm_listing_title_178(live_title) THEN
    RAISE NOTICE 'listing_correction_178 % skipped title_guard', pid;
  ELSIF lower(btrim(coalesce(p.status, ''))) IS DISTINCT FROM 'approved' THEN
    RAISE NOTICE 'listing_correction_178 % skipped status_guard', pid;
  ELSIF btrim(coalesce(p.property_type, '')) IS DISTINCT FROM 'Land' THEN
    RAISE NOTICE 'listing_correction_178 % skipped type_guard', pid;
  ELSIF lower(btrim(coalesce(p.listing_type, ''))) IS DISTINCT FROM 'land' THEN
    RAISE NOTICE 'listing_correction_178 % skipped listing_guard', pid;
  ELSIF btrim(coalesce(p.area, '')) IS DISTINCT FROM 'Gayaza' THEN
    RAISE NOTICE 'listing_correction_178 % skipped area_guard', pid;
  ELSIF btrim(coalesce(p.district, '')) IS DISTINCT FROM 'Wakiso' THEN
    RAISE NOTICE 'listing_correction_178 % skipped district_guard', pid;
  ELSIF btrim(coalesce(p.address, '')) IS DISTINCT FROM 'Gayaza, Wakiso' THEN
    RAISE NOTICE 'listing_correction_178 % skipped address_guard', pid;
  ELSIF coalesce(p.extra_fields->>'canonical_location_id', '') IS DISTINCT FROM 'wakiso:gayaza'
    OR coalesce(p.extra_fields->>'canonical_location_level', '') IS DISTINCT FROM 'area' THEN
    RAISE NOTICE 'listing_correction_178 % skipped canonical_guard', pid;
  ELSE
    SELECT COUNT(*) INTO url_mismatch
    FROM (
      VALUES
        ('1ac894fb-1fd4-4051-825e-985eb020862b'::uuid, 'https://media.makaug.com/whatsapp-employee-intake/image/1791469069110-69693ce0-4c80-48f0-bade-2f83aa187bc9-09402189-false_58248765960252-lid_A52ED8578561170968DF6A8862B5FA95-1.jpg'),
        ('9d993706-cec3-4f94-babe-9da1eed4b759'::uuid, 'https://media.makaug.com/whatsapp-employee-intake/image/1791469076303-9990269d-8932-4869-bdb9-81d3c881d612-09402189-false_58248765960252-lid_A5938867B99490044240E4C17FBD5279-1.jpg'),
        ('1deb664e-adb6-4d37-8dfb-68737945d5cc'::uuid, 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469753059-a48bc2cc-a7a9-4533-9dff-6f09d2fbbb53.jpg'),
        ('12cd9bd0-27a9-4ddd-b19e-4cbd4652c5cd'::uuid, 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469754056-340587ac-4481-49c8-a541-10d6ea1ec54f.jpg'),
        ('e874532d-6f31-4182-85ca-e1d4561a1452'::uuid, 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469755967-8e099cef-c55f-4b78-a1f2-f9405f83af48.jpg'),
        ('8832dfa5-ae70-47f0-81ab-16fbd612a60f'::uuid, 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469757651-067a1603-b10d-4df1-9258-2ed9f8f018c0.jpg')
    ) AS expected(id, url)
    WHERE NOT EXISTS (
      SELECT 1
      FROM property_images AS image
      WHERE image.id = expected.id
        AND image.property_id = pid
        AND image.url = expected.url
    );
    SELECT COUNT(*) INTO bad_caption
    FROM (
      VALUES
        ('1ac894fb-1fd4-4051-825e-985eb020862b'::uuid, 'Primary property photo'),
        ('1deb664e-adb6-4d37-8dfb-68737945d5cc'::uuid, 'Distinct video key image 2 of 5'),
        ('12cd9bd0-27a9-4ddd-b19e-4cbd4652c5cd'::uuid, 'Distinct video key image 3 of 5'),
        ('e874532d-6f31-4182-85ca-e1d4561a1452'::uuid, 'Distinct video key image 4 of 5'),
        ('8832dfa5-ae70-47f0-81ab-16fbd612a60f'::uuid, 'Distinct video key image 5 of 5')
    ) AS expected(id, label)
    JOIN property_images AS image
      ON image.id = expected.id
     AND image.property_id = pid
    WHERE image.room_label IS NOT NULL
      AND image.room_label IS DISTINCT FROM expected.label;
    SELECT COUNT(*) INTO pending
    FROM property_images AS image
    WHERE image.property_id = pid
      AND image.id IN (
        '1ac894fb-1fd4-4051-825e-985eb020862b'::uuid,
        '1deb664e-adb6-4d37-8dfb-68737945d5cc'::uuid,
        '12cd9bd0-27a9-4ddd-b19e-4cbd4652c5cd'::uuid,
        'e874532d-6f31-4182-85ca-e1d4561a1452'::uuid,
        '8832dfa5-ae70-47f0-81ab-16fbd612a60f'::uuid
      )
      AND COALESCE(image.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)';
    IF url_mismatch > 0 THEN
      RAISE NOTICE 'listing_correction_178 % skipped url_guard', pid;
    ELSIF bad_caption > 0 THEN
      RAISE NOTICE 'listing_correction_178 % skipped caption_guard', pid;
    ELSIF pending = 0 THEN
      RAISE NOTICE 'listing_correction_178 % skipped already_in_target_state', pid;
    ELSE
      v_now := clock_timestamp();
      INSERT INTO listing_correction_178_backup (property_id, action, row_kind, row_key, before_row)
      SELECT image.property_id, 'clear_caption', 'image_caption', image.id::text, to_jsonb(image)
      FROM property_images AS image
      WHERE image.property_id = pid
        AND image.id IN (
          '1ac894fb-1fd4-4051-825e-985eb020862b'::uuid,
          '1deb664e-adb6-4d37-8dfb-68737945d5cc'::uuid,
          '12cd9bd0-27a9-4ddd-b19e-4cbd4652c5cd'::uuid,
          'e874532d-6f31-4182-85ca-e1d4561a1452'::uuid,
          '8832dfa5-ae70-47f0-81ab-16fbd612a60f'::uuid
        )
        AND COALESCE(image.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)'
      ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
      UPDATE property_images AS image
      SET room_label = NULL
      WHERE image.property_id = pid
        AND image.id IN (
          '1ac894fb-1fd4-4051-825e-985eb020862b'::uuid,
          '1deb664e-adb6-4d37-8dfb-68737945d5cc'::uuid,
          '12cd9bd0-27a9-4ddd-b19e-4cbd4652c5cd'::uuid,
          'e874532d-6f31-4182-85ca-e1d4561a1452'::uuid,
          '8832dfa5-ae70-47f0-81ab-16fbd612a60f'::uuid
        )
        AND COALESCE(image.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)';
      v_extra := pg_temp.listing_178_stamp(COALESCE(p.extra_fields, '{}'::jsonb), 'gayaza_captions', v_now);
      PERFORM pg_temp.listing_178_backup_property(p, 'gayaza_captions');
      UPDATE properties AS target
      SET extra_fields = v_extra, updated_at = v_now
      WHERE target.id = p.id;
      RAISE NOTICE 'listing_correction_178 % applied gayaza_captions', pid;
    END IF;
  END IF;
  IF trigger_off THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
EXCEPTION WHEN OTHERS THEN
  IF trigger_off THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
  RAISE;
END
$do_178_gayaza$;
