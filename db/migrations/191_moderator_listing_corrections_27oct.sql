-- Moderator listing corrections, 27 Oct 2026. Approved by Arthur on
-- 27 Oct 2026 at 07:20 UK time. Exactly four listings. Nothing else is touched.
--
-- Uganda only. Idempotent. Each listing is checked against the values read
-- from production on 27 Oct 2026. If a value has moved, the listing is
-- skipped with one NOTICE. A second run finds the target state and does
-- nothing. Every changed properties row and video OCR row is copied first into
-- listing_correction_191_backup. The updated_at trigger is disabled around
-- each update, so updated_at equals the stamp's applied_at, which is how the
-- rollback knows nobody has edited the listing since.
-- Rollback: scripts/rollback-191-listing-corrections.sql. That file is not
-- a migration and does not run on deploy.
--
-- 25cb20a5-1098-45f0-ba88-f52de03f8467 MK-20261026-3F73F8 (UGX 180,000,000)
-- 018b5d39-86f2-47aa-a876-d3faefa0e591 MK-20261026-B9466B (UGX 280,000,000)
--   Kisowera, Mukono. #606 added the canonical place mukono:kisowera
--   (Nama sub-county, town Mukono). Stored bedrooms are 3 and 5, property_type
--   is house, and both captions say "#3bedrooms" and "#5bedrooms", so
--   the titles use the stored bed counts. Town (extra_fields.city) is set to
--   Mukono, and the canonical id becomes mukono:kisowera. Neither listing has
--   a pin, so latitude/longitude become 0.4175, 32.7703. That is Kisowera
--   Primary School on the Kayunga road (OSM node 4057317851, looked up with
--   Nominatim on 27 Oct 2026). Both captions say Kayunga road. The point is
--   marked as area precision, not an exact plot.
--
-- a90d30c5-78eb-4896-ab34-b84b7e2d0da1 MK-20261026-A64E8E
--   The price is already UGX 1,400,000,000 and is not changed. The two video
--   stills made at 05:15 UTC exist and load (HTTP 200 image/jpeg, checked
--   with curl). The summary still said public_image_count 0, no
--   primary_image_url, and media_validation_status
--   blocked_no_usable_property_image. The summary is rewritten from the real
--   public image rows, and the flag becomes passed_repair_image_gate. The
--   stale video price of 4,000,000,000 (the OCR missed the decimal point) is
--   cleared from property_video_ocr.parsed_facts and from
--   extra_fields.video_caption_ocr.facts, so the next video check reads it
--   again. The listing's status (rejected) is not changed.
--
-- c75c3e0a-1156-482f-a37c-35afbabd8587 MK-20261026-99C69E
--   4 acres in Garuga at UGX 800,000,000 per acre. price_period is already
--   acre. price_unit is NULL, which hides the size and the total, so it
--   becomes per_acre (the value utils/listingLandPrice.js and the
--   migration 173 check expect).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_191_backup (
  id BIGSERIAL PRIMARY KEY,
  property_id UUID NOT NULL,
  action TEXT NOT NULL,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, row_kind, row_key)
);

CREATE OR REPLACE FUNCTION pg_temp.listing_191_disable_updated_at()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_191_trigger$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_properties_updated_at'
       AND tgrelid = to_regclass('public.properties')
       AND NOT tgisinternal
  ) THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$fn_191_trigger$;

CREATE OR REPLACE FUNCTION pg_temp.listing_191_stamp(extra jsonb, action text, applied_at timestamptz)
RETURNS jsonb
LANGUAGE sql
AS $fn_191_stamp$
  SELECT COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
    'listing_correction_191',
    jsonb_build_object('applied_at', applied_at, 'actions', jsonb_build_array(action))
  );
$fn_191_stamp$;

CREATE OR REPLACE FUNCTION pg_temp.listing_191_backup(p properties, action text)
RETURNS void
LANGUAGE plpgsql
AS $fn_191_backup$
BEGIN
  INSERT INTO listing_correction_191_backup (property_id, action, row_kind, row_key, before_row)
  VALUES (p.id, action, 'property', p.id::text, to_jsonb(p))
  ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
END;
$fn_191_backup$;

DO $do_191_country$
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_191 skipped country_not_ug';
  END IF;
END
$do_191_country$;

-- Kisowera, Mukono: 3F73F8 (3 beds) and B9466B (5 beds).
DO $do_191_kisowera$
DECLARE
  item record;
  p properties%ROWTYPE;
  trigger_off boolean := FALSE;
  v_now timestamptz;
  v_extra jsonb;
  v_title text;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RETURN;
  END IF;
  trigger_off := pg_temp.listing_191_disable_updated_at();
  FOR item IN
    SELECT * FROM (VALUES
      ('25cb20a5-1098-45f0-ba88-f52de03f8467'::uuid, 'MK-20261026-3F73F8', 3, 180000000::bigint, '3-bed property for sale in Kisowera'),
      ('018b5d39-86f2-47aa-a876-d3faefa0e591'::uuid, 'MK-20261026-B9466B', 5, 280000000::bigint, '5-bed property for sale in Kisowera')
    ) AS v(id, ref, beds, price, live_title)
  LOOP
    v_title := item.beds || '-bed house for sale in Kisowera, Mukono';
    SELECT * INTO p FROM properties WHERE id = item.id;
    IF NOT FOUND THEN
      RAISE NOTICE 'listing_correction_191 % skipped missing', item.id;
    ELSIF p.title = v_title
      AND COALESCE(p.extra_fields->>'city', '') = 'Mukono'
      AND COALESCE(p.extra_fields->>'canonical_location_id', '') = 'mukono:kisowera' THEN
      RAISE NOTICE 'listing_correction_191 % skipped already_in_target_state', item.id;
    ELSIF COALESCE(p.inquiry_reference, '') IS DISTINCT FROM item.ref
      OR p.title IS DISTINCT FROM item.live_title
      OR p.bedrooms IS DISTINCT FROM item.beds
      OR lower(COALESCE(p.property_type, '')) IS DISTINCT FROM 'house'
      OR p.price IS DISTINCT FROM item.price
      OR btrim(COALESCE(p.area, '')) IS DISTINCT FROM 'Kisowera'
      OR btrim(COALESCE(p.district, '')) IS DISTINCT FROM 'Mukono'
      OR COALESCE(p.extra_fields->>'neighborhood', '') IS DISTINCT FROM 'Kisowera'
      OR COALESCE(p.extra_fields->>'city', '') <> '' THEN
      RAISE NOTICE 'listing_correction_191 % skipped guard title=% beds=% type=% area=% district=% city=%',
        item.id, p.title, p.bedrooms, p.property_type, p.area, p.district, p.extra_fields->>'city';
    ELSE
      v_now := clock_timestamp();
      PERFORM pg_temp.listing_191_backup(p, 'kisowera_location_title');
      v_extra := COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
        'city', 'Mukono',
        'neighborhood', 'Kisowera',
        'canonical_location_id', 'mukono:kisowera',
        'canonical_location_level', 'area',
        'location_resolution_status', 'canonical_human_confirmed',
        'location_resolution_confidence', 1
      );
      IF p.latitude IS NULL AND p.longitude IS NULL THEN
        v_extra := v_extra || jsonb_build_object(
          'location_precision', 'area',
          'map_pin_source', 'listing_correction_191_osm_kisowera'
        );
      END IF;
      v_extra := pg_temp.listing_191_stamp(v_extra, 'kisowera_location_title', v_now);
      UPDATE properties AS target
         SET title = v_title,
             latitude = CASE WHEN p.latitude IS NULL AND p.longitude IS NULL THEN 0.4175 ELSE target.latitude END,
             longitude = CASE WHEN p.latitude IS NULL AND p.longitude IS NULL THEN 32.7703 ELSE target.longitude END,
             extra_fields = v_extra,
             updated_at = v_now
       WHERE target.id = p.id;
      RAISE NOTICE 'listing_correction_191 % applied kisowera_location_title', item.id;
    END IF;
  END LOOP;
  IF trigger_off THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
EXCEPTION WHEN OTHERS THEN
  IF trigger_off THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
  RAISE;
END
$do_191_kisowera$;

-- A64E8E: photo summary from the real public image rows, stale video price.
DO $do_191_a64e8e$
DECLARE
  pid uuid := 'a90d30c5-78eb-4896-ab34-b84b7e2d0da1';
  still_1 text := 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/a90d30c5-78eb-4896-ab34-b84b7e2d0da1/1793078133960-32e174d6-8a31-4228-9ce6-ef297b6545d4.jpg';
  still_2 text := 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/a90d30c5-78eb-4896-ab34-b84b7e2d0da1/1793078134831-aebfa086-93b6-468f-a728-3655fafa806f.jpg';
  p properties%ROWTYPE;
  trigger_off boolean := FALSE;
  v_now timestamptz;
  v_extra jsonb;
  v_count integer;
  v_primary text;
  v_stills integer;
  v_ocr record;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RETURN;
  END IF;
  trigger_off := pg_temp.listing_191_disable_updated_at();
  SELECT * INTO p FROM properties WHERE id = pid;
  SELECT COUNT(*) INTO v_count
    FROM property_images
   WHERE property_id = pid
     AND COALESCE(slot_key, '') NOT IN ('source_evidence_original', 'quarantined_source_evidence');
  SELECT url INTO v_primary
    FROM property_images
   WHERE property_id = pid
     AND COALESCE(slot_key, '') NOT IN ('source_evidence_original', 'quarantined_source_evidence')
   ORDER BY is_primary DESC, sort_order ASC NULLS LAST, created_at ASC, id ASC
   LIMIT 1;
  SELECT COUNT(*) INTO v_stills
    FROM property_images
   WHERE property_id = pid
     AND url IN (still_1, still_2)
     AND slot_key IN ('video_key_frame_1', 'video_key_frame_2');
  IF p.id IS NULL THEN
    RAISE NOTICE 'listing_correction_191 % skipped missing', pid;
  ELSIF COALESCE(p.inquiry_reference, '') IS DISTINCT FROM 'MK-20261026-A64E8E'
    OR p.price IS DISTINCT FROM 1400000000
    OR COALESCE(p.price_currency, 'UGX') IS DISTINCT FROM 'UGX' THEN
    RAISE NOTICE 'listing_correction_191 % skipped guard ref=% price=% currency=%', pid, p.inquiry_reference, p.price, p.price_currency;
  ELSIF v_stills <> 2 OR v_primary IS DISTINCT FROM still_1 THEN
    RAISE NOTICE 'listing_correction_191 % skipped stills_guard stills=% primary=%', pid, v_stills, v_primary;
  ELSIF COALESCE(p.extra_fields->>'public_image_count', '') = v_count::text
    AND COALESCE(p.extra_fields->>'primary_image_url', '') = v_primary
    AND COALESCE(p.extra_fields->>'media_validation_status', '') IS DISTINCT FROM 'blocked_no_usable_property_image'
    AND COALESCE(p.extra_fields->'video_caption_ocr'->'facts'->>'price', '') = '' THEN
    RAISE NOTICE 'listing_correction_191 % skipped already_in_target_state', pid;
  ELSIF COALESCE(p.extra_fields->>'media_validation_status', '') NOT IN ('blocked_no_usable_property_image', 'passed_repair_image_gate')
    OR COALESCE(p.extra_fields->'video_caption_ocr'->'facts'->>'price', '') NOT IN ('4000000000', '') THEN
    RAISE NOTICE 'listing_correction_191 % skipped media_guard status=% video_price=%', pid,
      p.extra_fields->>'media_validation_status', p.extra_fields->'video_caption_ocr'->'facts'->>'price';
  ELSE
    v_now := clock_timestamp();
    PERFORM pg_temp.listing_191_backup(p, 'a64e8e_photo_summary_video_price');
    v_extra := COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'public_image_count', v_count,
      'image_count', v_count,
      'primary_image_url', v_primary,
      'media_validation_status', 'passed_repair_image_gate'
    );
    IF jsonb_typeof(v_extra->'video_caption_ocr'->'facts') = 'object' THEN
      v_extra := jsonb_set(v_extra, '{video_caption_ocr,facts,price}', 'null'::jsonb, false);
    END IF;
    v_extra := pg_temp.listing_191_stamp(v_extra, 'a64e8e_photo_summary_video_price', v_now);
    UPDATE properties AS target
       SET extra_fields = v_extra,
           updated_at = v_now
     WHERE target.id = p.id;
    IF to_regclass('public.property_video_ocr') IS NOT NULL THEN
      FOR v_ocr IN SELECT * FROM property_video_ocr WHERE property_id = pid AND parsed_facts->>'price' = '4000000000' LOOP
        INSERT INTO listing_correction_191_backup (property_id, action, row_kind, row_key, before_row)
        VALUES (pid, 'a64e8e_photo_summary_video_price', 'video_ocr', pid::text, to_jsonb(v_ocr))
        ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
        UPDATE property_video_ocr
           SET parsed_facts = jsonb_set(parsed_facts, '{price}', 'null'::jsonb, false)
         WHERE property_id = pid AND parsed_facts->>'price' = '4000000000';
      END LOOP;
    END IF;
    RAISE NOTICE 'listing_correction_191 % applied a64e8e_photo_summary_video_price count=% primary=%', pid, v_count, v_primary;
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
$do_191_a64e8e$;

-- 99C69E: price is per acre.
DO $do_191_99c69e$
DECLARE
  pid uuid := 'c75c3e0a-1156-482f-a37c-35afbabd8587';
  p properties%ROWTYPE;
  trigger_off boolean := FALSE;
  v_now timestamptz;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RETURN;
  END IF;
  trigger_off := pg_temp.listing_191_disable_updated_at();
  SELECT * INTO p FROM properties WHERE id = pid;
  IF NOT FOUND THEN
    RAISE NOTICE 'listing_correction_191 % skipped missing', pid;
  ELSIF p.price_unit = 'per_acre' THEN
    RAISE NOTICE 'listing_correction_191 % skipped already_in_target_state', pid;
  ELSIF COALESCE(p.inquiry_reference, '') IS DISTINCT FROM 'MK-20261026-99C69E'
    OR p.price IS DISTINCT FROM 800000000
    OR p.price_period IS DISTINCT FROM 'acre'
    OR p.price_unit IS NOT NULL
    OR p.land_size_value IS DISTINCT FROM 4
    OR p.land_size_unit IS DISTINCT FROM 'acres' THEN
    RAISE NOTICE 'listing_correction_191 % skipped guard price=% period=% unit=% size=% %', pid,
      p.price, p.price_period, p.price_unit, p.land_size_value, p.land_size_unit;
  ELSE
    v_now := clock_timestamp();
    PERFORM pg_temp.listing_191_backup(p, 'garuga_price_per_acre');
    UPDATE properties AS target
       SET price_unit = 'per_acre',
           extra_fields = pg_temp.listing_191_stamp(p.extra_fields, 'garuga_price_per_acre', v_now),
           updated_at = v_now
     WHERE target.id = p.id;
    RAISE NOTICE 'listing_correction_191 % applied garuga_price_per_acre', pid;
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
$do_191_99c69e$;
