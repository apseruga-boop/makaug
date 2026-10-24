-- Marketing recheck, 24 Oct 2026. Arthur approved this batch and reviews it
-- before merge. 173 (price_unit) is already on main. 176 is the Makerere
-- building correction and may land first; this file does not depend on it.
-- 177 is the next number either way.
--
-- Uganda only. Idempotent. Each listing is checked against the value it has
-- now and skipped, with one NOTICE, when that value has moved. A second run
-- finds the target state and does nothing. The updated_at trigger is disabled
-- around each update so updated_at stays equal to the stamp's applied_at.
-- Rollback: scripts/rollback-177-listing-corrections.sql. That file is not a
-- migration and does not run on deploy.
--
-- The Busika block ($do_177_busika$) is the only statement that writes that
-- listing. Delete that one DO block if Ronald has not confirmed Luwero.
--
-- No properties row is deleted. Photo and video rows that are removed are
-- copied first, including the image url. The media files in object storage
-- are left where they are. A listing left with zero photos gets no
-- placeholder image row. The public page shows a logo tile that says
-- "Photos coming soon". It does not invent a house photo.
--
-- Any property_images row whose url is the Unsplash model house
-- (photo-1560518883-ce09059eeffa) or any other unsplash.com file is backed
-- up and deleted. Advertising placement previews that still point at
-- Unsplash are pointed at the MakaUG logo when that table exists.
-- Generated captions "Distinct video key image …" and "Primary property
-- photo" are cleared on the Mbalwa and Namulanda rows that this migration
-- keeps.
--
-- ee920882 keeps canonical wakiso:wakiso. There is no Namuseera node, and
-- this migration does not add one. The stored area is Namuseera. The public
-- display keeps a stored area when the canonical location is only the
-- district and the registry does not know that area. The label
-- "From, Kampala, Central" is the distance phrase "14Km From Kampala CBD"
-- stored as a place. The intake strip for that phrase is already in place;
-- this migration rewrites the stored label on this one row.
--
-- 9b7058b6 is priced at UGX 13,000,000 per acre only while price is still
-- null, price on application is false, and the row still records 13,000,000
-- (extra_fields.price_original, or the description lead). Land size is not
-- written. 70 acres times 13,000,000 would publish a 910,000,000 total.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_177_backup (
  id BIGSERIAL PRIMARY KEY,
  property_id UUID NOT NULL,
  action TEXT NOT NULL,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, row_kind, row_key)
);

CREATE OR REPLACE FUNCTION pg_temp.norm_listing_title_177(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_177$
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
$fn_177$;

CREATE OR REPLACE FUNCTION pg_temp.listing_177_guard_country()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_177_country$
BEGIN
  RETURN current_setting('app.country_code', true) IS NOT DISTINCT FROM 'UG';
END;
$fn_177_country$;

CREATE OR REPLACE FUNCTION pg_temp.listing_177_disable_updated_at()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_177_trigger$
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
$fn_177_trigger$;

CREATE OR REPLACE FUNCTION pg_temp.listing_177_stamp(extra jsonb, action text, applied_at timestamptz)
RETURNS jsonb
LANGUAGE sql
AS $fn_177_stamp$
  SELECT COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
    'listing_correction_177',
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
                WHEN jsonb_typeof(COALESCE(extra, '{}'::jsonb)->'listing_correction_177'->'actions') = 'array'
                  THEN COALESCE(extra, '{}'::jsonb)->'listing_correction_177'->'actions'
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
$fn_177_stamp$;

CREATE OR REPLACE FUNCTION pg_temp.listing_177_backup_property(p properties, action text)
RETURNS void
LANGUAGE plpgsql
AS $fn_177_backup_property$
BEGIN
  INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
  VALUES (p.id, action, 'property', p.id::text, to_jsonb(p))
  ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
END;
$fn_177_backup_property$;

CREATE OR REPLACE FUNCTION pg_temp.listing_177_swap_prefix(description text, prefix_from text, prefix_to text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_177_prefix$
  SELECT CASE
    WHEN prefix_from <> '' AND starts_with(COALESCE(description, ''), prefix_from)
      THEN prefix_to || substring(description FROM char_length(prefix_from) + 1)
    ELSE description
  END;
$fn_177_prefix$;

CREATE OR REPLACE FUNCTION pg_temp.listing_177_without_video(list jsonb, bad_url text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn_177_video$
  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(list, '[]'::jsonb)) WITH ORDINALITY AS item(elem, ord)
  WHERE COALESCE(elem->>'url', elem #>> '{}') IS DISTINCT FROM bad_url;
$fn_177_video$;

DO $do_177_country$
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_177 skipped country_not_ug';
  END IF;
END
$do_177_country$;

-- House listings whose caption is land. property_type becomes the existing
-- value "Land" only while it is still house and listing_type is still land.
DO $do_177_house$
DECLARE
  trigger_off boolean := FALSE;
  ids uuid[] := ARRAY[
    'd8c78ccd-81ec-4e92-9126-8e603d7c5071'::uuid,
    '36760196-c98d-41c9-b1e5-31e1417067c6'::uuid,
    '673e383b-3480-423a-acce-74fb6f192ba7'::uuid
  ];
  pid uuid;
  p properties%ROWTYPE;
  v_now timestamptz;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    FOREACH pid IN ARRAY ids LOOP
      SELECT * INTO p FROM properties WHERE id = pid;
      IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
        RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
      ELSIF lower(btrim(coalesce(p.listing_type, ''))) = 'land'
        AND btrim(coalesce(p.property_type, '')) = 'Land' THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF lower(btrim(coalesce(p.listing_type, ''))) = 'land'
        AND lower(btrim(coalesce(p.property_type, ''))) = 'house' THEN
        v_now := clock_timestamp();
        PERFORM pg_temp.listing_177_backup_property(p, 'property_type_land');
        UPDATE properties AS target
        SET
          property_type = 'Land',
          extra_fields = pg_temp.listing_177_stamp(target.extra_fields, 'property_type_land', v_now),
          updated_at = v_now
        WHERE target.id = p.id;
        RAISE NOTICE 'listing_correction_177 % applied property_type_land', pid;
      ELSE
        RAISE NOTICE 'listing_correction_177 % skipped type_guard', pid;
      END IF;
    END LOOP;
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
$do_177_house$;

-- DROP THIS BLOCK if Ronald has not confirmed that Busika is in Luwero.
-- It is the only statement that writes db4d4516-5008-4c25-a677-04c0459427c6.
-- Other Busika listings use canonical luwero:busika. The Kyankwanzi Busika
-- node is a different place and is not written here. The map pin is not moved.
DO $do_177_busika$
DECLARE
  pid uuid := 'db4d4516-5008-4c25-a677-04c0459427c6';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_description text;
  v_extra jsonb;
  source_title text := 'Property for sale in Busika';
  target_title text := 'Land for sale in Busika';
  prefix_from text := 'Property for sale in Busika, Wakiso, listed at UGX 40,000,000. ';
  prefix_to text := 'Land for sale in Busika, Luwero, listed at UGX 40,000,000. ';
  title_known boolean;
  already boolean;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      title_known := pg_temp.norm_listing_title_177(p.title) IN (
        pg_temp.norm_listing_title_177(source_title),
        pg_temp.norm_listing_title_177(target_title)
      );
      already := pg_temp.norm_listing_title_177(p.title) = pg_temp.norm_listing_title_177(target_title)
        AND lower(btrim(coalesce(p.listing_type, ''))) = 'land'
        AND btrim(coalesce(p.property_type, '')) = 'Land'
        AND btrim(coalesce(p.area, '')) = 'Busika'
        AND btrim(coalesce(p.district, '')) = 'Luwero'
        AND COALESCE(p.extra_fields->>'canonical_location_id', '') = 'luwero:busika'
        AND NOT starts_with(coalesce(p.description, ''), prefix_from);
      IF already THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF NOT title_known THEN
        RAISE NOTICE 'listing_correction_177 % skipped title_guard', pid;
      ELSIF lower(btrim(coalesce(p.listing_type, ''))) NOT IN ('sale', 'land') THEN
        RAISE NOTICE 'listing_correction_177 % skipped type_guard', pid;
      ELSE
        v_now := clock_timestamp();
        v_description := pg_temp.listing_177_swap_prefix(p.description, prefix_from, prefix_to);
        v_extra := COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
          'canonical_location_id', 'luwero:busika',
          'canonical_location_level', 'area',
          'city', 'Luwero',
          'neighborhood', 'Busika',
          'region', 'Central',
          'resolved_location_label', 'Busika, Luwero'
        );
        v_extra := pg_temp.listing_177_stamp(v_extra, 'busika_luwero', v_now);
        PERFORM pg_temp.listing_177_backup_property(p, 'busika_luwero');
        UPDATE properties AS target
        SET
          title = target_title,
          description = v_description,
          listing_type = 'land',
          property_type = 'Land',
          area = 'Busika',
          district = 'Luwero',
          extra_fields = v_extra,
          updated_at = v_now
        WHERE target.id = p.id;
        RAISE NOTICE 'listing_correction_177 % applied busika_luwero', pid;
      END IF;
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
$do_177_busika$;

DO $do_177_kakiri$
DECLARE
  pid uuid := '82ac1527-9193-4318-ac0f-02ebeb0a7012';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_description text;
  source_title text := 'Property for sale in Kakiri';
  target_title text := 'Land for sale in Kakiri';
  prefix_from text := 'Property for sale in Kakiri, Wakiso, listed at UGX 45,000,000. ';
  prefix_to text := 'Land for sale in Kakiri, Wakiso, listed at UGX 45,000,000. ';
  title_known boolean;
  already boolean;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      title_known := pg_temp.norm_listing_title_177(p.title) IN (
        pg_temp.norm_listing_title_177(source_title),
        pg_temp.norm_listing_title_177(target_title)
      );
      already := pg_temp.norm_listing_title_177(p.title) = pg_temp.norm_listing_title_177(target_title)
        AND lower(btrim(coalesce(p.listing_type, ''))) = 'land'
        AND btrim(coalesce(p.property_type, '')) = 'Land'
        AND NOT starts_with(coalesce(p.description, ''), prefix_from);
      IF already THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF NOT title_known THEN
        RAISE NOTICE 'listing_correction_177 % skipped title_guard', pid;
      ELSIF lower(btrim(coalesce(p.listing_type, ''))) NOT IN ('sale', 'land') THEN
        RAISE NOTICE 'listing_correction_177 % skipped type_guard', pid;
      ELSE
        v_now := clock_timestamp();
        v_description := pg_temp.listing_177_swap_prefix(p.description, prefix_from, prefix_to);
        PERFORM pg_temp.listing_177_backup_property(p, 'kakiri_land');
        UPDATE properties AS target
        SET
          title = target_title,
          description = v_description,
          listing_type = 'land',
          property_type = 'Land',
          extra_fields = pg_temp.listing_177_stamp(target.extra_fields, 'kakiri_land', v_now),
          updated_at = v_now
        WHERE target.id = p.id;
        RAISE NOTICE 'listing_correction_177 % applied kakiri_land', pid;
      END IF;
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
$do_177_kakiri$;

-- Area Namuseera. Canonical stays wakiso:wakiso. No registry row is inserted.
DO $do_177_namuseera$
DECLARE
  pid uuid := 'ee920882-bd61-4f1d-9156-75f45851edf9';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_extra jsonb;
  source_title text := 'Land for sale in Namuseera, Wakiso';
  target_title text := 'Land for sale in Namuseera';
  title_known boolean;
  already boolean;
  label text;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      title_known := pg_temp.norm_listing_title_177(p.title) IN (
        pg_temp.norm_listing_title_177(source_title),
        pg_temp.norm_listing_title_177(target_title)
      );
      already := pg_temp.norm_listing_title_177(p.title) = pg_temp.norm_listing_title_177(target_title)
        AND btrim(coalesce(p.area, '')) = 'Namuseera'
        AND COALESCE(p.extra_fields->>'canonical_location_id', '') = 'wakiso:wakiso'
        AND COALESCE(p.extra_fields->>'neighborhood', '') = 'Namuseera'
        AND COALESCE(p.extra_fields->>'resolved_location_label', '') IS DISTINCT FROM 'From, Kampala, Central'
        AND COALESCE(p.extra_fields->>'city', '') IS DISTINCT FROM 'Wakiso Town';
      IF already THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF NOT title_known THEN
        RAISE NOTICE 'listing_correction_177 % skipped title_guard', pid;
      ELSIF p.area IS NOT NULL AND btrim(p.area) <> '' AND btrim(p.area) <> 'Namuseera' THEN
        RAISE NOTICE 'listing_correction_177 % skipped area_guard', pid;
      ELSE
        v_now := clock_timestamp();
        v_extra := COALESCE(p.extra_fields, '{}'::jsonb);
        IF lower(btrim(coalesce(v_extra->>'neighborhood', ''))) IN ('', 'wakiso', 'namuseera') THEN
          v_extra := v_extra || jsonb_build_object('neighborhood', 'Namuseera');
        END IF;
        IF btrim(coalesce(v_extra->>'city', '')) = 'Wakiso Town' THEN
          v_extra := v_extra - 'city';
        END IF;
        label := btrim(coalesce(v_extra->>'resolved_location_label', ''));
        IF label IN ('', 'From, Kampala, Central', 'Namuseera, Wakiso') THEN
          v_extra := v_extra || jsonb_build_object('resolved_location_label', 'Namuseera, Wakiso');
        END IF;
        v_extra := pg_temp.listing_177_stamp(v_extra, 'namuseera_area', v_now);
        PERFORM pg_temp.listing_177_backup_property(p, 'namuseera_area');
        UPDATE properties AS target
        SET
          title = target_title,
          area = 'Namuseera',
          extra_fields = v_extra,
          updated_at = v_now
        WHERE target.id = p.id;
        RAISE NOTICE 'listing_correction_177 % applied namuseera_area', pid;
      END IF;
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
$do_177_namuseera$;

-- 13,000,000 per acre. Only while the price column is null. Land size stays.
DO $do_177_kikyusa$
DECLARE
  pid uuid := '9b7058b6-5790-4759-851e-f86d7a47351f';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_description text;
  prefix_from text := 'Land for sale in Kikyusa, Nakaseke, listed at UGX 13,000,000. ';
  prefix_to text := 'Land for sale in Kikyusa, Nakaseke, listed at UGX 13,000,000 per acre. ';
  evidence boolean;
  already boolean;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      evidence := btrim(coalesce(p.extra_fields->>'price_original', '')) IN ('13000000', '13000000.0', '13000000.00')
        OR starts_with(coalesce(p.description, ''), 'Land for sale in Kikyusa, Nakaseke, listed at UGX 13,000,000');
      already := p.price = 13000000
        AND btrim(coalesce(p.price_unit, '')) = 'per_acre'
        AND lower(btrim(coalesce(p.price_period, ''))) = 'acre'
        AND NOT starts_with(coalesce(p.description, ''), prefix_from);
      IF already THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF p.price_on_application IS TRUE THEN
        RAISE NOTICE 'listing_correction_177 % skipped poa_guard', pid;
      ELSIF p.price IS NOT NULL THEN
        RAISE NOTICE 'listing_correction_177 % skipped price_guard', pid;
      ELSIF NOT evidence THEN
        RAISE NOTICE 'listing_correction_177 % skipped price_guard', pid;
      ELSE
        v_now := clock_timestamp();
        v_description := pg_temp.listing_177_swap_prefix(p.description, prefix_from, prefix_to);
        PERFORM pg_temp.listing_177_backup_property(p, 'kikyusa_per_acre');
        UPDATE properties AS target
        SET
          price = 13000000,
          price_unit = 'per_acre',
          price_period = 'acre',
          description = v_description,
          extra_fields = pg_temp.listing_177_stamp(target.extra_fields, 'kikyusa_per_acre', v_now),
          updated_at = v_now
        WHERE target.id = p.id
          AND target.price IS NULL;
        RAISE NOTICE 'listing_correction_177 % applied kikyusa_per_acre', pid;
      END IF;
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
$do_177_kikyusa$;

-- Copied Gayaza photos on the Kasanje-Nakawuka listing. The Gayaza listing
-- keeps its own photos. No replacement image is inserted.
DO $do_177_kasanje_photos$
DECLARE
  pid uuid := 'd8c78ccd-81ec-4e92-9126-8e603d7c5071';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  expected_count integer;
  present_count integer;
  mismatch_count integer;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      CREATE TEMP TABLE listing_177_kasanje_expected (
        id uuid PRIMARY KEY,
        url text NOT NULL
      ) ON COMMIT DROP;
      INSERT INTO listing_177_kasanje_expected (id, url) VALUES
        ('bfd2d7fe-db42-4229-9bd5-762d9504b986', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474722663-8a17ee3c-e443-4568-92f2-53bffc174795-plot-photo.jpg'),
        ('388d01c0-3652-4629-8ea1-932889c01b5f', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474723650-37cfdf88-d88b-4461-977c-d149bbb72000-plot-photo-2.jpg'),
        ('f6b80177-a95c-452b-aae7-ed40c2292688', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474724636-2b0b1ab3-c36f-4cb2-b3e5-b5200ed675b8-plot-photo-3.jpg'),
        ('17598569-617d-47b3-971e-487207c3755f', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474725429-e7bd2413-600e-43e7-b37b-b7ab68c38abc-plot-photo-4.jpg');
      SELECT COUNT(*) INTO expected_count FROM listing_177_kasanje_expected;
      SELECT COUNT(*) INTO present_count
      FROM property_images i
      JOIN listing_177_kasanje_expected e ON e.id = i.id
      WHERE i.property_id = pid;
      SELECT COUNT(*) INTO mismatch_count
      FROM property_images i
      JOIN listing_177_kasanje_expected e ON e.id = i.id
      WHERE i.property_id = pid
        AND i.url IS DISTINCT FROM e.url;
      IF mismatch_count > 0 THEN
        RAISE NOTICE 'listing_correction_177 % skipped url_guard', pid;
      ELSIF present_count = 0 THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF present_count <> expected_count THEN
        RAISE NOTICE 'listing_correction_177 % skipped photo_guard', pid;
      ELSE
        v_now := clock_timestamp();
        INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
        SELECT i.property_id, 'delete_image', 'property_image', i.id::text, to_jsonb(i)
        FROM property_images i
        JOIN listing_177_kasanje_expected e ON e.id = i.id
        WHERE i.property_id = pid
        ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
        PERFORM pg_temp.listing_177_backup_property(p, 'remove_copied_photos');
        DELETE FROM property_images i
        USING listing_177_kasanje_expected e
        WHERE i.id = e.id
          AND i.property_id = pid
          AND i.url = e.url;
        UPDATE properties AS target
        SET
          extra_fields = pg_temp.listing_177_stamp(target.extra_fields, 'remove_copied_photos', v_now),
          updated_at = v_now
        WHERE target.id = pid;
        RAISE NOTICE 'listing_correction_177 % applied remove_copied_photos', pid;
      END IF;
      DROP TABLE listing_177_kasanje_expected;
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
$do_177_kasanje_photos$;

-- Mbalwa: drop the bungalow and the two frames that are not this plot, make
-- the plot frame the main photo, and drop video 2. Video 1 stays.
DO $do_177_mbalwa$
DECLARE
  pid uuid := 'c8bebd69-2006-4796-a591-65e97be82e37';
  primary_id uuid := 'a18c7a45-8c4e-433b-8c50-becee8f53e71';
  keep_id uuid := '9aabcdde-3d49-4df5-9dbf-41992ddb4c5f';
  bad_video text := 'https://media.makaug.com/whatsapp-employee-intake/video/1791548942015-d720afea-9ba7-42f3-b270-5db2f8d634d7-57773202-false_95365487423704-lid_3A4A54B8E62E2CFC1166-1.mp4';
  old_copy text := 'Watch the 2 attached video tours and browse 5 extracted key images before enquiring.';
  new_copy text := 'Watch the attached video tour and browse the 3 plot photos before enquiring.';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_extra jsonb;
  v_description text;
  primary_row property_images%ROWTYPE;
  keep_row property_images%ROWTYPE;
  other_bad integer;
  bad_present boolean;
  videos_left integer;
  already boolean;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      SELECT * INTO keep_row FROM property_images WHERE id = keep_id AND property_id = pid;
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p.extra_fields->'video_tours', '[]'::jsonb)) elem
        WHERE COALESCE(elem->>'url', '') = bad_video
        UNION ALL
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p.extra_fields->'video_urls', '[]'::jsonb)) elem
        WHERE COALESCE(elem->>'url', elem #>> '{}') = bad_video
      ) INTO bad_present;
      SELECT COUNT(*) INTO other_bad
      FROM jsonb_array_elements(COALESCE(p.extra_fields->'video_tours', '[]'::jsonb)) WITH ORDINALITY AS item(elem, ord)
      WHERE ord > 1
        AND COALESCE(elem->>'url', '') IS DISTINCT FROM bad_video;
      SELECT COUNT(*) INTO videos_left
      FROM jsonb_array_elements(COALESCE(p.extra_fields->'video_tours', '[]'::jsonb)) elem
      WHERE COALESCE(elem->>'url', '') IS DISTINCT FROM bad_video;
      already := NOT EXISTS (
          SELECT 1 FROM property_images
          WHERE property_id = pid
            AND id IN (
              primary_id,
              '5e4bf216-980e-4472-9a3a-649ead4643f6'::uuid,
              '7890d2d9-d325-4784-b142-b3525f07462c'::uuid
            )
        )
        AND keep_row.id IS NOT NULL
        AND keep_row.is_primary IS TRUE
        AND keep_row.sort_order = 0
        AND NOT bad_present
        AND position(old_copy in COALESCE(p.description, '')) = 0
        AND NOT EXISTS (
          SELECT 1 FROM property_images caption
          WHERE caption.property_id = pid
            AND COALESCE(caption.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)'
        );
      IF already THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF keep_row.id IS NULL THEN
        RAISE NOTICE 'listing_correction_177 % skipped photo_guard', pid;
      ELSIF other_bad > 0 THEN
        RAISE NOTICE 'listing_correction_177 % skipped video_guard', pid;
      ELSE
        SELECT * INTO primary_row FROM property_images WHERE id = primary_id AND property_id = pid;
        IF primary_row.id IS NOT NULL AND primary_row.is_primary IS NOT TRUE THEN
          RAISE NOTICE 'listing_correction_177 % skipped primary_guard', pid;
        ELSIF primary_row.id IS NOT NULL AND primary_row.url IS DISTINCT FROM 'https://media.makaug.com/whatsapp-employee-intake/image/1791548952370-ed03e6be-5268-471c-b17c-dfdb80e98045-57773202-false_95365487423704-lid_3A138919FC8A463C8315-1.jpg' THEN
          RAISE NOTICE 'listing_correction_177 % skipped url_guard', pid;
        ELSIF EXISTS (
          SELECT 1 FROM property_images
          WHERE property_id = pid
            AND (
              (id = '5e4bf216-980e-4472-9a3a-649ead4643f6'::uuid AND url IS DISTINCT FROM 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/c8bebd69-2006-4796-a591-65e97be82e37/1791549688621-7ac8b128-8489-4d98-b004-6ffba7f9f070.jpg')
              OR (id = '7890d2d9-d325-4784-b142-b3525f07462c'::uuid AND url IS DISTINCT FROM 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/c8bebd69-2006-4796-a591-65e97be82e37/1791549689421-d515da14-fa4f-4ffa-ae92-881d5031e946.jpg')
            )
        ) THEN
          RAISE NOTICE 'listing_correction_177 % skipped url_guard', pid;
        ELSIF videos_left < 1 AND COALESCE(p.extra_fields->>'video_url', '') = bad_video THEN
          RAISE NOTICE 'listing_correction_177 % skipped video_guard', pid;
        ELSE
          v_now := clock_timestamp();
          INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
          SELECT i.property_id, 'delete_image', 'property_image', i.id::text, to_jsonb(i)
          FROM property_images i
          WHERE i.property_id = pid
            AND i.id IN (
              primary_id,
              '5e4bf216-980e-4472-9a3a-649ead4643f6'::uuid,
              '7890d2d9-d325-4784-b142-b3525f07462c'::uuid
            )
          ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
          INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
          VALUES (pid, 'reorder_image', 'property_image', keep_id::text, to_jsonb(keep_row))
          ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
          IF bad_present THEN
            INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
            SELECT pid, 'delete_video', 'video_tour', bad_video, COALESCE(
              (
                SELECT elem
                FROM jsonb_array_elements(COALESCE(p.extra_fields->'video_tours', '[]'::jsonb)) elem
                WHERE COALESCE(elem->>'url', '') = bad_video
                LIMIT 1
              ),
              jsonb_build_object('url', bad_video)
            )
            ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
          END IF;
          PERFORM pg_temp.listing_177_backup_property(p, 'mbalwa_media');
          DELETE FROM property_images
          WHERE property_id = pid
            AND id IN (
              primary_id,
              '5e4bf216-980e-4472-9a3a-649ead4643f6'::uuid,
              '7890d2d9-d325-4784-b142-b3525f07462c'::uuid
            );
          UPDATE property_images
          SET is_primary = TRUE, sort_order = 0
          WHERE id = keep_id AND property_id = pid;
          INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
          SELECT i.property_id, 'clear_caption', 'image_caption', i.id::text, to_jsonb(i)
          FROM property_images i
          WHERE i.property_id = pid
            AND COALESCE(i.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)'
          ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
          UPDATE property_images
          SET room_label = NULL
          WHERE property_id = pid
            AND COALESCE(room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)';
          v_extra := COALESCE(p.extra_fields, '{}'::jsonb);
          v_extra := jsonb_set(v_extra, '{video_tours}', pg_temp.listing_177_without_video(v_extra->'video_tours', bad_video), TRUE);
          v_extra := jsonb_set(v_extra, '{video_urls}', pg_temp.listing_177_without_video(v_extra->'video_urls', bad_video), TRUE);
          IF COALESCE(v_extra->>'video_url', '') = bad_video THEN
            v_extra := v_extra - 'video_url';
          END IF;
          v_description := replace(COALESCE(p.description, ''), old_copy, new_copy);
          v_extra := pg_temp.listing_177_stamp(v_extra, 'mbalwa_media', v_now);
          UPDATE properties AS target
          SET description = v_description, extra_fields = v_extra, updated_at = v_now
          WHERE target.id = pid;
          RAISE NOTICE 'listing_correction_177 % applied mbalwa_media', pid;
        END IF;
      END IF;
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
$do_177_mbalwa$;

-- Namulanda commercial land: the plot photo becomes the main photo.
-- The Mercedes frame stays in the gallery, no longer first.
DO $do_177_namulanda$
DECLARE
  pid uuid := 'e2085b5b-95e2-4359-aea4-6c3de6b4b4fd';
  plot_id uuid := 'd5a58fa6-04b1-4501-b9d6-f0b4e0d5142d';
  middle_id uuid := '3f92067d-2354-4ece-bf18-6ffecaf7c856';
  car_id uuid := 'e07d9155-226c-4921-9086-bd6e66abc454';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  car property_images%ROWTYPE;
  plot property_images%ROWTYPE;
  middle property_images%ROWTYPE;
  already boolean;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    SELECT * INTO p FROM properties WHERE id = pid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_177 % skipped deleted', pid;
    ELSE
      SELECT * INTO car FROM property_images WHERE id = car_id AND property_id = pid;
      SELECT * INTO plot FROM property_images WHERE id = plot_id AND property_id = pid;
      SELECT * INTO middle FROM property_images WHERE id = middle_id AND property_id = pid;
      already := plot.id IS NOT NULL AND plot.is_primary IS TRUE AND plot.sort_order = 0
        AND middle.id IS NOT NULL AND middle.is_primary IS NOT TRUE AND middle.sort_order = 1
        AND car.id IS NOT NULL AND car.is_primary IS NOT TRUE AND car.sort_order = 2
        AND NOT EXISTS (
          SELECT 1 FROM property_images caption
          WHERE caption.property_id = pid
            AND COALESCE(caption.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)'
        );
      IF already THEN
        RAISE NOTICE 'listing_correction_177 % skipped already_in_target_state', pid;
      ELSIF plot.id IS NULL OR middle.id IS NULL OR car.id IS NULL THEN
        RAISE NOTICE 'listing_correction_177 % skipped photo_guard', pid;
      ELSIF car.is_primary IS NOT TRUE THEN
        RAISE NOTICE 'listing_correction_177 % skipped primary_guard', pid;
      ELSE
        v_now := clock_timestamp();
        INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
        SELECT i.property_id, 'reorder_image', 'property_image', i.id::text, to_jsonb(i)
        FROM property_images i
        WHERE i.property_id = pid AND i.id IN (plot_id, middle_id, car_id)
        ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
        PERFORM pg_temp.listing_177_backup_property(p, 'namulanda_primary');
        UPDATE property_images SET is_primary = TRUE, sort_order = 0 WHERE id = plot_id AND property_id = pid;
        UPDATE property_images SET is_primary = FALSE, sort_order = 1 WHERE id = middle_id AND property_id = pid;
        UPDATE property_images SET is_primary = FALSE, sort_order = 2 WHERE id = car_id AND property_id = pid;
        INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
        SELECT i.property_id, 'clear_caption', 'image_caption', i.id::text, to_jsonb(i)
        FROM property_images i
        WHERE i.property_id = pid
          AND COALESCE(i.room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)'
        ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
        UPDATE property_images
        SET room_label = NULL
        WHERE property_id = pid
          AND COALESCE(room_label, '') ~* '^(distinct video key image|primary property photo)([[:space:]]|$)';
        UPDATE properties AS target
        SET
          extra_fields = pg_temp.listing_177_stamp(target.extra_fields, 'namulanda_primary', v_now),
          updated_at = v_now
        WHERE target.id = pid;
        RAISE NOTICE 'listing_correction_177 % applied namulanda_primary', pid;
      END IF;
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
$do_177_namulanda$;

-- Drop stored stock and Unsplash files. A listing photo has to be a photo of
-- that listing. The public page no longer substitutes a house picture.
DO $do_177_stock_photos$
DECLARE
  trigger_off boolean := FALSE;
  pid uuid;
  p properties%ROWTYPE;
  v_now timestamptz;
  removed int := 0;
  row_count int := 0;
BEGIN
  trigger_off := pg_temp.listing_177_disable_updated_at();
  IF pg_temp.listing_177_guard_country() THEN
    FOR pid IN
      SELECT DISTINCT i.property_id
      FROM property_images i
      JOIN properties prop ON prop.id = i.property_id
      WHERE lower(btrim(coalesce(prop.status, ''))) NOT IN ('deleted', 'purged')
        AND (
          i.url ~* 'photo-1560518883-ce09059eeffa'
          OR i.url ~* 'unsplash\.com'
        )
    LOOP
      SELECT * INTO p FROM properties WHERE id = pid;
      v_now := clock_timestamp();
      INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
      SELECT i.property_id, 'delete_image', 'property_image', i.id::text, to_jsonb(i)
      FROM property_images i
      WHERE i.property_id = pid
        AND (
          i.url ~* 'photo-1560518883-ce09059eeffa'
          OR i.url ~* 'unsplash\.com'
        )
      ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
      DELETE FROM property_images
      WHERE property_id = pid
        AND (
          url ~* 'photo-1560518883-ce09059eeffa'
          OR url ~* 'unsplash\.com'
        );
      GET DIAGNOSTICS row_count = ROW_COUNT;
      removed := removed + row_count;
      PERFORM pg_temp.listing_177_backup_property(p, 'remove_stock_photo');
      UPDATE properties AS target
      SET
        extra_fields = pg_temp.listing_177_stamp(target.extra_fields, 'remove_stock_photo', v_now),
        updated_at = v_now
      WHERE target.id = pid;
      RAISE NOTICE 'listing_correction_177 % applied remove_stock_photo', pid;
    END LOOP;
    IF removed = 0 THEN
      RAISE NOTICE 'listing_correction_177 00000000-0000-4000-8000-0000000000aa skipped already_in_target_state';
    END IF;
    IF to_regclass('public.advertising_placements') IS NOT NULL THEN
      INSERT INTO listing_correction_177_backup (property_id, action, row_kind, row_key, before_row)
      SELECT
        '00000000-0000-4000-8000-0000000000ad'::uuid,
        'retarget_preview',
        'advertising_placement',
        ap.key,
        to_jsonb(ap)
      FROM advertising_placements ap
      WHERE COALESCE(ap.preview_image_url, '') ~* 'unsplash\.com|photo-1560518883-ce09059eeffa'
      ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
      UPDATE advertising_placements
      SET preview_image_url = '/assets/icons/makaug-icon-512.png'
      WHERE COALESCE(preview_image_url, '') ~* 'unsplash\.com|photo-1560518883-ce09059eeffa';
      GET DIAGNOSTICS row_count = ROW_COUNT;
      IF row_count > 0 THEN
        RAISE NOTICE 'listing_correction_177 00000000-0000-4000-8000-0000000000ad applied remove_stock_ad_preview';
      END IF;
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
$do_177_stock_photos$;
