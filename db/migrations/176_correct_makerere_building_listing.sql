-- Relabel Promise Ahimbisibwe's Makerere listing as a 55-room building.
--
-- 173 is db/migrations/173_listing_refs_price_unit_and_staff_indexes.sql on
-- PR 541. 175 is db/migrations/175_clear_seeta_bedrooms_and_kigo_pin.sql on
-- PR 544. 174 is already in this tree. 176 is the next free number.
--
-- Listing 3d8ba7e2-2081-484d-a79c-c8ad1342c30d, lister Promise Ahimbisibwe.
-- Migration 169 stored the title "Hotel / hostel (55 rooms) for sale in
-- Makerere", listing_type commercial, and property_type hospitality, because
-- the caption says "55 Rooms", a conference hall, a gym and gardens. The
-- public API on 24 Oct 2026 still returns that title. cleanListingTitle does
-- not invent the words "Hotel / hostel", so that string is the stored title.
-- The same API row has bedrooms null, land_size_value null, land_size_unit
-- null, price_period once, price 7600000000 UGX (price_original 2000000 USD),
-- area Makerere, district Kampala. Arthur and Ronald checked the property
-- and it is a 55-room building for sale, not land.
--
-- The title guard accepts either stored title this row is known to have:
--   "Land for sale in Makerere" (the title 169 replaced, and the title this
--   correction was asked to find)
--   "Hotel / hostel (55 rooms) for sale in Makerere" (the title the public
--   API returns now)
-- Titles are compared after lowercasing, trimming, and collapsing whitespace,
-- including nbsp. Any other title is left alone. A second run finds the
-- target title, category, empty plot fields and replaced description prefix,
-- and does nothing.
--
-- Category: listing_type commercial and property_type "Commercial building".
-- That is the stored pair migrations 169, 170 and 172 use for a building
-- that had been labelled land (Kyanja 8277cd47, Ntinda bfbc521d). The
-- commercial enum value hospitality is the caption guess 169 wrote. hostel
-- in the property-type vocabulary is a student room, and listing_type
-- student would file a USD 2,000,000 building sale under hostel rooms.
-- "House and rental units" and "Double rental units" are residential unit
-- sales, not this building. "Commercial building" is the closest existing
-- value.
--
-- Title: "Commercial building (55 rooms) for sale in Makerere".
-- It follows "Commercial building for sale in {area}" and keeps the room
-- count in parentheses, which is how this listing already shows "55 rooms".
-- The sentence is 51 characters, inside the 60-character public title cut.
-- "sale" stays lowercase.
--
-- properties has bedrooms, bathrooms, room_type and room_arrangement. It has
-- no rooms count. room_type and room_arrangement are student room kinds
-- (single, shared, dormitory), not a count of 55. bedrooms is a bedroom
-- count. Earlier corrections refused to copy a room or decimal count into
-- bedrooms (Seeta 496006a9, Kololo 950e10f7). This migration does not write
-- bedrooms, bathrooms, room_type or room_arrangement.
--
-- Plot size is cleared when this row is updated: land_size_value and
-- land_size_unit are set null. A per-acre, per-plot or per-decimal
-- price_period is set to once. The price amount, currency and fx columns
-- are not written. On the live row those plot fields are already empty and
-- price_period is already once, so those assignments change nothing there.
-- floor_area_sqm is a building size and is not written. The caption tail,
-- including "1.6 Acres of Mailo land", stays in the description.
--
-- The generated description prefix is replaced only when the description
-- still starts with the land prefix or the hotel/hostel prefix. The asking
-- figure in that prefix stays USD 2,000,000. Photos, video_url, the lister,
-- the agent, the area, the district and the map pin are not in the SET list.
--
-- Listing 950e10f7 (Kololo) was checked on the public API the same day and
-- is not in this payload. The public title is "15-Decimal plot for sale in
-- Kololo" because cleanListingTitle capitalises the first letter of the
-- stored title "15-decimal plot for sale in Kololo". "for sale" is already
-- lowercase. property_type is Commercial land, land size is 15 decimals,
-- bedrooms are null, and the description says "Size 15 decimals", "Freehold
-- Title" and "Future use: Tear down for new construction". The one public
-- photo is an empty fenced plot and carries no overlay text. That title is
-- the plot, so this migration does not change the row.
--
-- The other Promise Ahimbisibwe Makerere row, whose public title is
-- "55 - Room Commerical property on 1.6 Arces for sale", is a different id
-- and is not updated.
--
-- Idempotent. The applied row is stamped extra_fields.listing_correction_176.
-- The old properties row is copied to listing_correction_176_backup first.
-- The updated_at trigger would replace that stamp's timestamp, so the
-- trigger is disabled for this update when it exists and turned back on
-- before the block exits. Manual rollback:
-- scripts/rollback-176-listing-corrections.sql
-- That file is not a migration and does not run on deploy.
-- Uganda only (app.country_code = UG).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_176_backup (
  property_id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  flag TEXT,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION pg_temp.norm_listing_title_176(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_176$
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
$fn_176$;

CREATE OR REPLACE FUNCTION pg_temp.is_land_price_period_176(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn_176_period$
  SELECT regexp_replace(lower(btrim(coalesce(value, ''))), '[\s/-]+', '_', 'g') IN (
    'acre', 'per_acre', 'plot', 'per_plot',
    'acre_yr', 'acre_year', 'per_acre_per_year', 'per_acre_year',
    'decimal', 'decimals', 'per_decimal', 'per_decimals'
  );
$fn_176_period$;

DO $do_176$
DECLARE
  spec jsonb := $listing_correction_176$
{
  "id": "3d8ba7e2-2081-484d-a79c-c8ad1342c30d",
  "lister_name": "Promise Ahimbisibwe",
  "action": "relabel",
  "flag": "Ground check: this is a 55-room building for sale in Makerere, not land. The room count stays in the title. There is no rooms column, and bedrooms is not that count.",
  "source_titles": [
    "Land for sale in Makerere",
    "Hotel / hostel (55 rooms) for sale in Makerere"
  ],
  "description_prefixes_from": [
    "Land for sale in Makerere, Kampala, listed at USD 2,000,000. ",
    "Hotel / hostel (55 rooms) for sale in Makerere, Kampala, listed at USD 2,000,000. "
  ],
  "patch": {
    "title": "Commercial building (55 rooms) for sale in Makerere",
    "listing_type": "commercial",
    "property_type": "Commercial building",
    "transaction_type": "sale",
    "description_prefix_to": "Commercial building (55 rooms) for sale in Makerere, Kampala, listed at USD 2,000,000. ",
    "land_size_value": null,
    "land_size_unit": null
  }
}
$listing_correction_176$;
  patch jsonb := COALESCE(spec->'patch', '{}'::jsonb);
  p properties%ROWTYPE;
  v_now timestamptz;
  v_description text;
  v_prefix text;
  v_index integer;
  source_ok boolean;
  target_title boolean;
  prefix_pending boolean;
  already boolean;
  trigger_off boolean := FALSE;
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
    trigger_off := TRUE;
  END IF;

  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_176 skipped country_not_ug';
  ELSE
    SELECT * INTO p FROM properties WHERE id = (spec->>'id')::uuid;
    IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_176 % skipped deleted', spec->>'id';
    ELSE
      prefix_pending := FALSE;
      IF patch ? 'description_prefix_to' AND jsonb_typeof(spec->'description_prefixes_from') = 'array' THEN
        FOR v_index IN 0 .. jsonb_array_length(spec->'description_prefixes_from') - 1 LOOP
          v_prefix := spec->'description_prefixes_from'->>v_index;
          IF v_prefix <> '' AND starts_with(coalesce(p.description, ''), v_prefix) THEN
            prefix_pending := TRUE;
          END IF;
        END LOOP;
      END IF;

      already := pg_temp.norm_listing_title_176(p.title) = pg_temp.norm_listing_title_176(patch->>'title')
        AND lower(btrim(coalesce(p.listing_type, ''))) = lower(btrim(coalesce(patch->>'listing_type', '')))
        AND coalesce(p.property_type, '') = coalesce(patch->>'property_type', '')
        AND lower(btrim(coalesce(p.transaction_type, ''))) = lower(btrim(coalesce(patch->>'transaction_type', '')))
        AND p.land_size_value IS NULL
        AND coalesce(p.land_size_unit, '') = ''
        AND NOT pg_temp.is_land_price_period_176(p.price_period)
        AND NOT prefix_pending;

      IF already THEN
        RAISE NOTICE 'listing_correction_176 % skipped already_in_target_state', spec->>'id';
      ELSE
        source_ok := FALSE;
        IF jsonb_typeof(spec->'source_titles') = 'array' THEN
          FOR v_index IN 0 .. jsonb_array_length(spec->'source_titles') - 1 LOOP
            IF pg_temp.norm_listing_title_176(p.title)
              = pg_temp.norm_listing_title_176(spec->'source_titles'->>v_index) THEN
              source_ok := TRUE;
            END IF;
          END LOOP;
        END IF;
        target_title := pg_temp.norm_listing_title_176(p.title)
          = pg_temp.norm_listing_title_176(patch->>'title');

        IF NOT source_ok AND NOT target_title THEN
          RAISE NOTICE 'listing_correction_176 % skipped title_guard', spec->>'id';
        ELSIF pg_temp.norm_listing_title_176(p.lister_name)
          IS DISTINCT FROM pg_temp.norm_listing_title_176(spec->>'lister_name') THEN
          RAISE NOTICE 'listing_correction_176 % skipped lister_guard', spec->>'id';
        ELSE
          v_description := p.description;
          IF prefix_pending THEN
            FOR v_index IN 0 .. jsonb_array_length(spec->'description_prefixes_from') - 1 LOOP
              v_prefix := spec->'description_prefixes_from'->>v_index;
              IF v_prefix <> '' AND starts_with(coalesce(p.description, ''), v_prefix) THEN
                v_description := (patch->>'description_prefix_to')
                  || substring(p.description FROM char_length(v_prefix) + 1);
                EXIT;
              END IF;
            END LOOP;
          END IF;

          v_now := clock_timestamp();

          INSERT INTO listing_correction_176_backup (property_id, action, flag, before_row)
          VALUES (
            p.id,
            spec->>'action',
            spec->>'flag',
            to_jsonb(p)
          )
          ON CONFLICT (property_id) DO NOTHING;

          UPDATE properties AS target
          SET
            title = patch->>'title',
            description = v_description,
            listing_type = patch->>'listing_type',
            transaction_type = patch->>'transaction_type',
            property_type = patch->>'property_type',
            land_size_value = NULL,
            land_size_unit = NULL,
            price_period = CASE
              WHEN pg_temp.is_land_price_period_176(target.price_period) THEN 'once'
              ELSE target.price_period
            END,
            extra_fields = COALESCE(target.extra_fields, '{}'::jsonb) || jsonb_build_object(
              'listing_correction_176', jsonb_strip_nulls(jsonb_build_object(
                'action', spec->>'action',
                'flag', spec->>'flag',
                'applied_at', v_now
              ))
            ),
            updated_at = v_now
          WHERE target.id = p.id;

          RAISE NOTICE 'listing_correction_176 % applied %', spec->>'id', spec->>'action';
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
$do_176$;
