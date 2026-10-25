-- Namuseera stored type, 24 Oct 2026.
-- 178 is on main (97516b5b) and has been applied. Its Gayaza caption clear
-- ran. Its Namuseera block skipped ee920882 again: the type guard compared
-- the public label ('Commercial land' or 'Land') with the column. The column
-- stores the code. This file is the next migration. It does not re-run 178
-- and it does not touch the Gayaza photos.
--
-- Uganda only. Idempotent. The updated_at trigger is disabled around the
-- write so updated_at stays equal to the stamp's applied_at. A second run
-- finds the target state and does nothing.
-- Rollback: scripts/rollback-179-listing-corrections.sql. That file is not
-- a migration and does not run on deploy.
--
-- Public API, ee920882-bd61-4f1d-9156-75f45851edf9, checked 24 Oct 2026
-- after 178 was live. The values below are what the API returns. They are
-- not all what the columns store.
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
--
-- Display versus the column, for every field this guard reads:
--   id: the uuid. The API returns the same value.
--   country: app.country_code, not a properties column. UG only.
--   property_type: humanPropertyTypeLabel. commercial_land is shown as
--     Commercial land. land is shown as land. Land and Commercial land,
--     when stored with a space, are returned unchanged because they are
--     not enum keys. The vocabulary code for this listing is land.
--   area: canonicalDisplayLocationForRow. A district canonical blanks a
--     stored area that is empty, From, the district name, or a known
--     place. Namuseera is not in the registry, so a stored Namuseera is
--     kept. A public area of null does not mean the column is null.
--   city, neighborhood, resolved_location_label: copied out of
--     extra_fields with no label map. Wakiso Town is the stored city.
--   district: the canonical district name. For wakiso:wakiso that is
--     Wakiso, the same text as the column.
--   status, listing_type: copied through. listing_type land stays land.
--   title: cleanListingTitle leaves this mixed-case title as stored.
--   canonical: extra_fields.canonical_location_id. wakiso:wakiso stays.
--
-- The guard matches the id and UG, then the stored type after spaces and
-- hyphens are folded to underscores, case-insensitively:
-- commercial_land or land. It does not look at the area or the city to
-- decide whether to write. A deleted or purged row is left alone. Any
-- other skip raises a NOTICE with the property_type, area, city,
-- neighborhood, label, district, status, title, listing_type, and
-- canonical value actually on the row.
--
-- The write sets area and neighborhood to Namuseera, the resolved label
-- to Namuseera, Wakiso, and property_type to the code land. A city whose
-- folded text is wakiso town is removed. Any other city is left in place.
-- The title, listing type, district, address, canonical, status, price,
-- and description are not changed. No registry node is added.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_179_backup (
  id BIGSERIAL PRIMARY KEY,
  property_id UUID NOT NULL,
  action TEXT NOT NULL,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, row_kind, row_key)
);

CREATE OR REPLACE FUNCTION pg_temp.listing_179_guard_country()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_179_country$
BEGIN
  RETURN current_setting('app.country_code', true) IS NOT DISTINCT FROM 'UG';
END;
$fn_179_country$;

CREATE OR REPLACE FUNCTION pg_temp.listing_179_type_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_179_type$
  SELECT regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]-]+', '_', 'g');
$fn_179_type$;

CREATE OR REPLACE FUNCTION pg_temp.listing_179_city_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_179_city$
  SELECT regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', ' ', 'g');
$fn_179_city$;

CREATE OR REPLACE FUNCTION pg_temp.listing_179_describe(
  property_type text,
  area text,
  city text,
  neighborhood text,
  label text,
  district text,
  status text,
  title text,
  listing_type text,
  canonical text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_179_describe$
  SELECT format(
    'property_type=%L area=%L city=%L neighborhood=%L label=%L district=%L status=%L title=%L listing_type=%L canonical=%L',
    property_type,
    area,
    city,
    neighborhood,
    label,
    district,
    status,
    title,
    listing_type,
    canonical
  );
$fn_179_describe$;

CREATE OR REPLACE FUNCTION pg_temp.listing_179_disable_updated_at()
RETURNS boolean
LANGUAGE plpgsql
AS $fn_179_trigger$
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
$fn_179_trigger$;

CREATE OR REPLACE FUNCTION pg_temp.listing_179_stamp(extra jsonb, action text, applied_at timestamptz)
RETURNS jsonb
LANGUAGE sql
AS $fn_179_stamp$
  SELECT COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
    'listing_correction_179',
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
                WHEN jsonb_typeof(COALESCE(extra, '{}'::jsonb)->'listing_correction_179'->'actions') = 'array'
                  THEN COALESCE(extra, '{}'::jsonb)->'listing_correction_179'->'actions'
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
$fn_179_stamp$;

CREATE OR REPLACE FUNCTION pg_temp.listing_179_backup_property(p properties, action text)
RETURNS void
LANGUAGE plpgsql
AS $fn_179_backup_property$
BEGIN
  INSERT INTO listing_correction_179_backup (property_id, action, row_kind, row_key, before_row)
  VALUES (p.id, action, 'property', p.id::text, to_jsonb(p))
  ON CONFLICT (property_id, row_kind, row_key) DO NOTHING;
END;
$fn_179_backup_property$;

-- ee920882. Stored type commercial_land (shown as Commercial land) becomes
-- the code land. Area becomes Namuseera whatever the column holds today.
DO $do_179_namuseera$
DECLARE
  pid uuid := 'ee920882-bd61-4f1d-9156-75f45851edf9';
  trigger_off boolean := FALSE;
  p properties%ROWTYPE;
  v_now timestamptz;
  v_extra jsonb;
  detail text;
  row_present boolean := FALSE;
BEGIN
  SELECT * INTO p FROM properties WHERE id = pid;
  row_present := FOUND;
  detail := pg_temp.listing_179_describe(
    p.property_type,
    p.area,
    p.extra_fields->>'city',
    p.extra_fields->>'neighborhood',
    p.extra_fields->>'resolved_location_label',
    p.district,
    p.status,
    p.title,
    p.listing_type,
    p.extra_fields->>'canonical_location_id'
  );
  IF NOT pg_temp.listing_179_guard_country() THEN
    RAISE NOTICE 'listing_correction_179 % skipped country_not_ug %', pid, detail;
  ELSIF NOT row_present THEN
    RAISE NOTICE 'listing_correction_179 % skipped missing %', pid, detail;
  ELSIF lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
    RAISE NOTICE 'listing_correction_179 % skipped deleted %', pid, detail;
  ELSIF p.property_type IS NOT DISTINCT FROM 'land'
    AND btrim(coalesce(p.area, '')) = 'Namuseera'
    AND coalesce(p.extra_fields->>'neighborhood', '') = 'Namuseera'
    AND coalesce(p.extra_fields->>'resolved_location_label', '') = 'Namuseera, Wakiso'
    AND pg_temp.listing_179_city_key(p.extra_fields->>'city') IS DISTINCT FROM 'wakiso town' THEN
    RAISE NOTICE 'listing_correction_179 % skipped already_in_target_state %', pid, detail;
  ELSIF pg_temp.listing_179_type_key(p.property_type) NOT IN ('commercial_land', 'land') THEN
    RAISE NOTICE 'listing_correction_179 % skipped type_guard %', pid, detail;
  ELSE
    trigger_off := pg_temp.listing_179_disable_updated_at();
    v_now := clock_timestamp();
    v_extra := COALESCE(p.extra_fields, '{}'::jsonb);
    v_extra := v_extra || jsonb_build_object(
      'neighborhood', 'Namuseera',
      'resolved_location_label', 'Namuseera, Wakiso'
    );
    IF pg_temp.listing_179_city_key(v_extra->>'city') = 'wakiso town' THEN
      v_extra := v_extra - 'city';
    END IF;
    v_extra := pg_temp.listing_179_stamp(v_extra, 'namuseera_location', v_now);
    PERFORM pg_temp.listing_179_backup_property(p, 'namuseera_location');
    UPDATE properties AS target
    SET
      area = 'Namuseera',
      property_type = 'land',
      extra_fields = v_extra,
      updated_at = v_now
    WHERE target.id = p.id;
    RAISE NOTICE 'listing_correction_179 % applied namuseera_location %', pid, detail;
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
$do_179_namuseera$;
