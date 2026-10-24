-- Apply the 18 listing corrections migration 170 skipped.
--
-- Migration 170 (db/migrations/170_correct_remaining_mislabelled_listings.sql)
-- compared properties.title to the title in its expect JSON, after lowercasing,
-- trimming ASCII spaces, and collapsing whitespace. Those expect titles were
-- copied from the public API. routes/properties.js publicPropertyRow and
-- compactPublicCardRow do not return the stored title. They call
-- cleanListingTitle (services/publicListingCopy.js). cleanListingTitle returns
-- factualListingTitle when publicListingTitleContradictsFacts is true.
--
-- For every one of these 18 rows that check is true because the stored title
-- matches /property (for sale|for rent|in)/ and does not contain the stored
-- property_type (commercial_land, house, apartment, other, Apartment complex).
-- The API then builds a title from bedrooms + the human property-type label +
-- the stored area. That built string is what migration 170 required, so the
-- title guard failed closed and the UPDATE never ran. No notice was raised.
--
-- Every other 170 guard matched on production: status approved, listing type,
-- price period, bedrooms, price (Ntinda's 4500000 is inside price_one_of),
-- evidence in the description, a public keeper for each unpublish, no
-- listing_correction_169 or listing_correction_170 stamp, country UG.
--
-- Stored title -> API title that 170 required:
--   6927c520  Commercial property in Naalya          -> 4-bed commercial land for sale in Naalya
--   950e10f7  Commercial property in Kololo          -> 15-bed commercial land for sale in Kololo
--   8277cd47  Commercial property in Kyanja          -> Commercial land for sale in Kyanja
--   bfbc521d  Commercial property in Ntinda          -> Commercial land for sale in Ntinda
--   496006a9  Commercial property in Seeta           -> 3-bed commercial property for sale in Seeta
--   df969b6a  Commercial property in Kikyusa         -> Commercial land for sale in Luwero
--             (factual title uses area Luwero, not the place name inside the stored title)
--   6f7186ab  Commercial property in Kikyusa         -> Commercial land for sale in Luwero
--   84967db4  property for rent in Mutungo           -> Apartment for rent in Mutungo
--   72ee6627  property for rent in Mutungo           -> Apartment for rent in Mutungo
--   08f29aca  4-bed property for sale in Kitukutwe   -> 4-bed house for sale in Kitukutwe
--   f05f3a50  3-bed property for sale in Bwebajja    -> 3-bed house for sale in Bwebajja
--   c35a0d7e  property for sale in Nabusugwe         -> House for sale in Nabusugwe
--   7c066fe5  3-bed property for sale in Bulindo     -> 3-bed house for sale in Bulindo
--   15ca0488  3-bed property for sale in Naguru      -> Apartment complex for sale in Naguru
--             (stored bedrooms are null, so the API drops the stored "3-bed")
--   c7c9e859  3-bed property for sale in Naguru      -> Apartment complex for sale in Naguru
--   d1cf79a4  Commercial property in Naalya          -> Commercial land for sale in Naalya
--   c9ab858d  5-bed property for sale in Naalya      -> 5-bed house for sale in Naalya
--   42f256d4  Commercial property in Kikyusa         -> Commercial land for sale in Kikyusa
--
-- This migration updates those 18 ids only. It does not require the stored
-- title to equal the API title. It skips a row when it is already in the
-- target state (titles compared lowercased, trimmed, and with whitespace
-- collapsed), when the row is missing or deleted, or when updated_at is newer
-- than 2026-10-24 09:51 BST (08:51 UTC), the time migration 170 was applied.
-- An unpublish whose kept listing is no longer public is also skipped.
-- Target state is checked before the clock, so a second run is a no-op even
-- though the first run sets updated_at to now.
--
-- Ntinda bfbc521d stays at its stored price. The patch does not write a price,
-- a currency, or a description sentence. The public "Price on application" is
-- the read-time plausibility guard (UGX 4,500,000 is below the commercial sale
-- floor), not a stored null.
--
-- Map coordinates are not written. Migration 170 would only have replaced a
-- pin when the stored point was still the old Gayaza pin, and these rows do
-- not store that pin. The in-flight map-pin migration owns coordinates.
--
-- Idempotent. Each applied row is stamped extra_fields.listing_correction_172.
-- Old values go into listing_correction_172_backup.
-- Manual rollback: scripts/rollback-172-listing-corrections.sql
-- That file is not a migration and does not run on deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_172_backup (
  property_id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  kept_property_id UUID,
  flag TEXT,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION pg_temp.norm_listing_title(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn_172$
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
$fn_172$;

DO $do_172$
DECLARE
  rec record;
  spec jsonb;
  patch jsonb;
  p properties%ROWTYPE;
  already boolean;
  keeper_ok boolean;
  v_now timestamptz;
  cutoff timestamptz := TIMESTAMPTZ '2026-10-24 09:51:00+01';
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_172 skipped country_not_ug';
    RETURN;
  END IF;

  FOR rec IN
    SELECT value AS spec
    FROM jsonb_array_elements($listing_corrections_172$
[
  {
    "id": "6927c520-ca3f-4f45-8004-d562d119cac0",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "4 bedrooms 4 bathrooms house near Quality supermarket",
    "expect": {
      "title": "4-bed commercial land for sale in Naalya",
      "listing_type": "commercial",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 650000000,
      "bedrooms": 4
    },
    "patch": {
      "title": "4-bed house for sale in Naalya",
      "listing_type": "sale",
      "property_type": "House",
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Naalya, Wakiso, listed at UGX 650,000,000. ",
      "description_prefix_to": "4-bed house for sale in Naalya, Wakiso, listed at UGX 650,000,000. ",
      "bathrooms": 4,
      "area": "Naalya",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:naalya",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Naalya, Wakiso"
    }
  },
  {
    "id": "950e10f7-fc22-4ef6-9b88-d39dc825d2cb",
    "action": "relabel",
    "kept_id": null,
    "flag": "Kept as commercial land. The caption is a vacant 15-decimal freehold plot, not 15 bedrooms. Bedroom count is cleared and kept on land size.",
    "evidence": "Size 15 decimals",
    "expect": {
      "title": "15-bed commercial land for sale in Kololo",
      "listing_type": "commercial",
      "price_period": "once",
      "area": "Kololo",
      "district": "Kampala",
      "price": 1349000000,
      "bedrooms": 15
    },
    "patch": {
      "title": "15-decimal plot for sale in Kololo",
      "listing_type": "commercial",
      "property_type": "commercial_land",
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Kololo, Kampala, listed at USD 355,000. ",
      "description_prefix_to": "15-decimal plot for sale in Kololo, Kampala, listed at USD 355,000. ",
      "bedrooms": null,
      "land_size_value": 15,
      "land_size_unit": "decimals"
    }
  },
  {
    "id": "8277cd47-12fe-4702-8d03-89539766fadb",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "Price: UGX 2.4 BILLION",
    "expect": {
      "title": "Commercial land for sale in Kyanja",
      "listing_type": "commercial",
      "price_period": "once",
      "area": "Kyanja",
      "district": "Kampala",
      "price": 24000000
    },
    "patch": {
      "title": "Commercial building for sale in Kyanja",
      "listing_type": "commercial",
      "property_type": "Commercial building",
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Kyanja, Kampala, listed at UGX 24,000,000. ",
      "description_prefix_to": "Commercial building for sale in Kyanja, Kampala, listed at UGX 2,400,000,000. ",
      "price": 2400000000,
      "price_original": 2400000000,
      "price_currency": "UGX",
      "price_original_currency": "UGX",
      "price_on_application": false
    }
  },
  {
    "id": "bfbc521d-9f76-4caf-a30c-d8fedeb4cd78",
    "action": "relabel",
    "kept_id": null,
    "flag": "Owner decision: this listing stays Price on application. The caption mentions USD 4.5 million, and that figure is not written into the price, the currency, or the description. The title and category still change from commercial land to a commercial building, which was a separate label correction.",
    "evidence": "selling $4.5M usd",
    "expect": {
      "title": "Commercial land for sale in Ntinda",
      "listing_type": "commercial",
      "price_period": "once",
      "area": "Ntinda",
      "district": "Kampala",
      "price_optional": true,
      "price_one_of": [
        4500000
      ]
    },
    "patch": {
      "title": "Commercial building for sale in Ntinda",
      "listing_type": "commercial",
      "property_type": "Commercial building",
      "transaction_type": "sale"
    }
  },
  {
    "id": "496006a9-d203-437c-a722-d99fe7d8df03",
    "action": "relabel",
    "kept_id": null,
    "flag": "Kept live as the Seeta copy. Bedrooms stay 3 because the caption says each residential unit is a 3-bedroom, not that the building has 3 bedrooms. The other copy is unpublished.",
    "evidence": "2 floors are commercial",
    "expect": {
      "title": "3-bed commercial property for sale in Seeta",
      "listing_type": "commercial",
      "price_period": "once",
      "area": "Seeta",
      "district": "Mukono",
      "price": 2200000000
    },
    "patch": {
      "title": "Mixed-use building for sale in Seeta",
      "listing_type": "commercial",
      "property_type": "Mixed-use building",
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Seeta, Mukono, listed at UGX 2,200,000,000. ",
      "description_prefix_to": "Mixed-use building for sale in Seeta, Mukono, listed at UGX 2,200,000,000. "
    }
  },
  {
    "id": "df969b6a-ff97-4ba8-ab3c-c70c8b184465",
    "action": "relabel",
    "kept_id": null,
    "flag": "Not changed to a per-acre price. 200 acres times UGX 12 million is exactly the stored UGX 2.4 billion, so that figure is the total. The per-acre duplicate is unpublished. Kikyusa's only registry entry is in Nakaseke, while the caption says Luwero, so the area is set to Kamira.",
    "evidence": "200 acres",
    "expect": {
      "title": "Commercial land for sale in Luwero",
      "listing_type": "commercial",
      "price_period": "once",
      "area": null,
      "district": "Luwero",
      "price": 2400000000
    },
    "patch": {
      "title": "200 acres of commercial land for sale in Kamira",
      "listing_type": "commercial",
      "property_type": "commercial_land",
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Kikyusa, Luwero, listed at UGX 12,000,000. ",
      "description_prefix_to": "Commercial land for sale in Kamira, Luwero, listed at UGX 2,400,000,000 (UGX 12,000,000 per acre). ",
      "area": "Kamira",
      "district": "Luwero",
      "canonical_location_id": "luwero:kamira",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Kamira, Luwero"
    }
  },
  {
    "id": "6f7186ab-a57a-455f-83de-70ae756f24fb",
    "action": "relabel",
    "kept_id": null,
    "flag": "Separate 478-acre parcel, not a duplicate of the 200-acre listing. 478 times UGX 12 million is exactly the stored UGX 5.736 billion, so the total stays and the price period stays once.",
    "evidence": "478 acres",
    "expect": {
      "title": "Commercial land for sale in Luwero",
      "listing_type": "commercial",
      "price_period": "once",
      "area": null,
      "district": "Luwero",
      "price": 5736000000
    },
    "patch": {
      "title": "478 acres of commercial land for sale in Kamira",
      "listing_type": "commercial",
      "property_type": "commercial_land",
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Kikyusa, Luwero, listed at UGX 12,000,000. ",
      "description_prefix_to": "Commercial land for sale in Kamira, Luwero, listed at UGX 5,736,000,000 (UGX 12,000,000 per acre). ",
      "area": "Kamira",
      "district": "Luwero",
      "canonical_location_id": "luwero:kamira",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Kamira, Luwero"
    }
  },
  {
    "id": "84967db4-d0e7-473b-a064-01e8c47b7f3a",
    "action": "area",
    "kept_id": null,
    "flag": "Area was Cyanika, Kisoro. The sister listing's caption says Mutungo Hill, which is in Kampala. The generated description had said Wakiso. No Mutungo centroid is in the registry, so the pin stays empty.",
    "evidence": "1bh apartment mutungo",
    "expect": {
      "title": "Apartment for rent in Mutungo",
      "listing_type": "rent",
      "price_period": "month",
      "area": "Cyanika",
      "district": "Kisoro",
      "price": 500000
    },
    "patch": {
      "area": "Mutungo",
      "district": "Kampala",
      "canonical_location_id": "kampala:mutungo",
      "canonical_level": "parish",
      "region": "Central",
      "resolved_label": "Mutungo, Kampala",
      "description_prefix_from": "Rental property in Mutungo, Wakiso, listed at UGX 500,000. ",
      "description_prefix_to": "Apartment for rent in Mutungo, Kampala, listed at UGX 500,000. "
    }
  },
  {
    "id": "72ee6627-ba07-4f70-a596-c8c4edafdcec",
    "action": "area",
    "kept_id": null,
    "flag": "Caption says Mutungo Hill. Area was Cyanika, Kisoro. District is set to Kampala. No registry centroid, so the pin stays empty.",
    "evidence": "mutungo Hill",
    "expect": {
      "title": "Apartment for rent in Mutungo",
      "listing_type": "rent",
      "price_period": "month",
      "area": "Cyanika",
      "district": "Kisoro",
      "price": 600000
    },
    "patch": {
      "area": "Mutungo",
      "district": "Kampala",
      "canonical_location_id": "kampala:mutungo",
      "canonical_level": "parish",
      "region": "Central",
      "resolved_label": "Mutungo, Kampala",
      "description_prefix_from": "Rental property in Mutungo, Wakiso, listed at UGX 600,000. ",
      "description_prefix_to": "Apartment for rent in Mutungo, Kampala, listed at UGX 600,000. "
    }
  },
  {
    "id": "08f29aca-7e92-401f-ad90-f8636830e88c",
    "action": "area",
    "kept_id": null,
    "flag": "Kitukutwe has no centroid in the registry. The area label moves off Gayaza, but the map pin stays on the Gayaza centroid until a surveyed pin exists.",
    "evidence": "Kira Kitukutwe",
    "expect": {
      "title": "4-bed house for sale in Kitukutwe",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 285000000
    },
    "patch": {
      "area": "Kitukutwe",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:kitukutwe",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Kitukutwe, Wakiso"
    }
  },
  {
    "id": "f05f3a50-6786-43bd-a4d2-da6e8ba330b6",
    "action": "area",
    "kept_id": null,
    "flag": "Caption also names Wamala. The title and the first place in the caption are Bwebajja, which replaces Gayaza.",
    "evidence": "Bwebajja Akright",
    "expect": {
      "title": "3-bed house for sale in Bwebajja",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 340000000
    },
    "patch": {
      "area": "Bwebajja",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:bwebajja",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Bwebajja, Wakiso"
    }
  },
  {
    "id": "c35a0d7e-6f89-4c56-bee3-a498ae7f0f22",
    "action": "area",
    "kept_id": null,
    "flag": "The registry coordinate for Nabusugwe is the same point as Namugongo, so the map pin is left on the old Gayaza centroid rather than moved to that shared point.",
    "evidence": "NABUSUGWE JOMAYI",
    "expect": {
      "title": "House for sale in Nabusugwe",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 250000000
    },
    "patch": {
      "area": "Nabusugwe",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:nabusugwe",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Nabusugwe, Wakiso"
    }
  },
  {
    "id": "7c066fe5-af0d-476c-8648-829e2291525d",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Kira Bulindo",
    "expect": {
      "title": "3-bed house for sale in Bulindo",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 380000000
    },
    "patch": {
      "area": "Bulindo",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:bulindo",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Bulindo, Wakiso"
    }
  },
  {
    "id": "15ca0488-2702-4a93-8dd8-c30225d65c8d",
    "action": "unpublish",
    "kept_id": "250495cb-ddef-4499-a6d8-b977c2287193",
    "flag": null,
    "evidence": "12 fully furnished apartments",
    "expect": {
      "title": "Apartment complex for sale in Naguru",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Naguru",
      "district": "Kampala",
      "price": 7220000000
    },
    "patch": {}
  },
  {
    "id": "c7c9e859-2c2a-429a-b565-3a27c4cc3d55",
    "action": "unpublish",
    "kept_id": "250495cb-ddef-4499-a6d8-b977c2287193",
    "flag": null,
    "evidence": "12 fully furnished apartments",
    "expect": {
      "title": "Apartment complex for sale in Naguru",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Naguru",
      "district": "Kampala",
      "price": 7220000000
    },
    "patch": {}
  },
  {
    "id": "d1cf79a4-f7b7-4c86-b538-0e25423a5da2",
    "action": "unpublish",
    "kept_id": "46ba9de6-087d-4c38-bc85-b3f3e7155b5d",
    "flag": null,
    "evidence": "50 decimals commercial Naalya",
    "expect": {
      "title": "Commercial land for sale in Naalya",
      "listing_type": "commercial",
      "price_period": "once",
      "area": "Naalya",
      "district": "Wakiso",
      "price": 3500000000
    },
    "patch": {}
  },
  {
    "id": "c9ab858d-dcb5-4f05-bf62-86daa29b0721",
    "action": "unpublish",
    "kept_id": "a8931632-68e9-4b59-8238-c88695145847",
    "flag": null,
    "evidence": "5 bedrooms house with staff quarters",
    "expect": {
      "title": "5-bed house for sale in Naalya",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Naalya",
      "district": "Wakiso",
      "price": 1100000000
    },
    "patch": {}
  },
  {
    "id": "42f256d4-24f7-4adb-82a0-7875caef88fc",
    "action": "unpublish",
    "kept_id": "df969b6a-ff97-4ba8-ab3c-c70c8b184465",
    "flag": "Same 200-acre Kamira-Kikyusa caption. This copy is already priced per acre but its district is Nakaseke. The Luwero total-price copy is kept.",
    "evidence": "200 acres",
    "expect": {
      "title": "Commercial land for sale in Kikyusa",
      "listing_type": "commercial",
      "price_period": "acre",
      "area": "Kikyusa",
      "district": "Nakaseke",
      "price": 12000000
    },
    "patch": {}
  }
]
$listing_corrections_172$::jsonb)
  LOOP
    spec := rec.spec;
    patch := COALESCE(spec->'patch', '{}'::jsonb);

    SELECT * INTO p FROM properties WHERE id = (spec->>'id')::uuid;
    IF NOT FOUND THEN
      RAISE NOTICE 'listing_correction_172 % skipped deleted', spec->>'id';
      CONTINUE;
    END IF;

    IF lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
      RAISE NOTICE 'listing_correction_172 % skipped deleted', spec->>'id';
      CONTINUE;
    END IF;

    already := FALSE;
    IF spec->>'action' = 'unpublish' THEN
      already := lower(btrim(coalesce(p.status, ''))) = 'hidden'
        AND lower(btrim(coalesce(p.moderation_stage, ''))) = 'hidden';
    ELSE
      already := TRUE;
      IF patch ? 'title'
        AND pg_temp.norm_listing_title(p.title) IS DISTINCT FROM pg_temp.norm_listing_title(patch->>'title') THEN
        already := FALSE;
      END IF;
      IF patch ? 'listing_type'
        AND lower(btrim(coalesce(p.listing_type, ''))) IS DISTINCT FROM lower(btrim(coalesce(patch->>'listing_type', ''))) THEN
        already := FALSE;
      END IF;
      IF patch ? 'property_type'
        AND coalesce(p.property_type, '') IS DISTINCT FROM coalesce(patch->>'property_type', '') THEN
        already := FALSE;
      END IF;
      IF patch ? 'transaction_type'
        AND lower(btrim(coalesce(p.transaction_type, ''))) IS DISTINCT FROM lower(btrim(coalesce(patch->>'transaction_type', ''))) THEN
        already := FALSE;
      END IF;
      IF patch ? 'bedrooms'
        AND p.bedrooms IS DISTINCT FROM (patch->>'bedrooms')::integer THEN
        already := FALSE;
      END IF;
      IF patch ? 'bathrooms'
        AND p.bathrooms IS DISTINCT FROM (patch->>'bathrooms')::integer THEN
        already := FALSE;
      END IF;
      IF patch ? 'price'
        AND p.price IS DISTINCT FROM (patch->>'price')::numeric THEN
        already := FALSE;
      END IF;
      IF patch ? 'price_original'
        AND p.price_original IS DISTINCT FROM (patch->>'price_original')::numeric THEN
        already := FALSE;
      END IF;
      IF patch ? 'price_currency'
        AND coalesce(p.price_currency, '') IS DISTINCT FROM coalesce(patch->>'price_currency', '') THEN
        already := FALSE;
      END IF;
      IF patch ? 'price_original_currency'
        AND coalesce(p.price_original_currency, '') IS DISTINCT FROM coalesce(patch->>'price_original_currency', '') THEN
        already := FALSE;
      END IF;
      IF patch ? 'price_on_application'
        AND p.price_on_application IS DISTINCT FROM (patch->>'price_on_application')::boolean THEN
        already := FALSE;
      END IF;
      IF patch ? 'price_period'
        AND lower(btrim(coalesce(p.price_period, ''))) IS DISTINCT FROM lower(btrim(coalesce(patch->>'price_period', ''))) THEN
        already := FALSE;
      END IF;
      IF patch ? 'area'
        AND coalesce(p.area, '') IS DISTINCT FROM coalesce(patch->>'area', '') THEN
        already := FALSE;
      END IF;
      IF patch ? 'district'
        AND coalesce(p.district, '') IS DISTINCT FROM coalesce(patch->>'district', '') THEN
        already := FALSE;
      END IF;
      IF patch ? 'land_size_value'
        AND p.land_size_value IS DISTINCT FROM (patch->>'land_size_value')::numeric THEN
        already := FALSE;
      END IF;
      IF patch ? 'land_size_unit'
        AND coalesce(p.land_size_unit, '') IS DISTINCT FROM coalesce(patch->>'land_size_unit', '') THEN
        already := FALSE;
      END IF;
      IF patch ? 'canonical_location_id' THEN
        IF coalesce(p.extra_fields->>'canonical_location_id', '') IS DISTINCT FROM coalesce(patch->>'canonical_location_id', '')
          OR coalesce(p.extra_fields->>'canonical_location_level', '') IS DISTINCT FROM coalesce(patch->>'canonical_level', '')
          OR coalesce(p.extra_fields->>'neighborhood', '') IS DISTINCT FROM coalesce(patch->>'area', '')
          OR coalesce(p.extra_fields->>'city', '') IS DISTINCT FROM coalesce(patch->>'district', '')
          OR coalesce(p.extra_fields->>'resolved_location_label', '') IS DISTINCT FROM coalesce(patch->>'resolved_label', '')
          OR coalesce(p.extra_fields->>'region', '') IS DISTINCT FROM coalesce(patch->>'region', '') THEN
          already := FALSE;
        END IF;
      END IF;
      IF patch ? 'description_prefix_from'
        AND coalesce(p.description, '') LIKE (patch->>'description_prefix_from') || '%' THEN
        already := FALSE;
      END IF;
    END IF;

    IF already THEN
      RAISE NOTICE 'listing_correction_172 % skipped already_in_target_state', spec->>'id';
      CONTINUE;
    END IF;

    IF p.updated_at IS NOT NULL AND p.updated_at > cutoff THEN
      RAISE NOTICE 'listing_correction_172 % skipped edited_since_2026-10-24_09:51_BST', spec->>'id';
      CONTINUE;
    END IF;

    IF spec->>'action' = 'unpublish' THEN
      SELECT EXISTS (
        SELECT 1
        FROM properties keeper
        WHERE keeper.id = NULLIF(spec->>'kept_id', '')::uuid
          AND keeper.id <> p.id
          AND lower(btrim(coalesce(keeper.status, ''))) IN ('approved', 'live', 'published')
      ) INTO keeper_ok;
      IF NOT COALESCE(keeper_ok, FALSE) THEN
        RAISE NOTICE 'listing_correction_172 % skipped keeper_not_public', spec->>'id';
        CONTINUE;
      END IF;
    END IF;

    v_now := clock_timestamp();

    INSERT INTO listing_correction_172_backup (property_id, action, kept_property_id, flag, before_row)
    VALUES (
      p.id,
      spec->>'action',
      NULLIF(spec->>'kept_id', '')::uuid,
      spec->>'flag',
      to_jsonb(p)
    )
    ON CONFLICT (property_id) DO NOTHING;

    UPDATE properties AS target
    SET
      title = CASE WHEN patch ? 'title' THEN patch->>'title' ELSE target.title END,
      description = CASE
        WHEN patch ? 'description' THEN patch->>'description'
        WHEN patch ? 'description_prefix_from'
          AND target.description LIKE (patch->>'description_prefix_from') || '%'
        THEN (patch->>'description_prefix_to')
          || SUBSTRING(target.description FROM char_length(patch->>'description_prefix_from') + 1)
        ELSE target.description
      END,
      listing_type = CASE WHEN patch ? 'listing_type' THEN patch->>'listing_type' ELSE target.listing_type END,
      transaction_type = CASE WHEN patch ? 'transaction_type' THEN patch->>'transaction_type' ELSE target.transaction_type END,
      property_type = CASE WHEN patch ? 'property_type' THEN patch->>'property_type' ELSE target.property_type END,
      bedrooms = CASE WHEN patch ? 'bedrooms' THEN (patch->>'bedrooms')::integer ELSE target.bedrooms END,
      bathrooms = CASE WHEN patch ? 'bathrooms' THEN (patch->>'bathrooms')::integer ELSE target.bathrooms END,
      price = CASE WHEN patch ? 'price' THEN (patch->>'price')::numeric ELSE target.price END,
      price_original = CASE WHEN patch ? 'price_original' THEN (patch->>'price_original')::numeric ELSE target.price_original END,
      price_currency = CASE WHEN patch ? 'price_currency' THEN patch->>'price_currency' ELSE target.price_currency END,
      price_original_currency = CASE WHEN patch ? 'price_original_currency' THEN patch->>'price_original_currency' ELSE target.price_original_currency END,
      price_period = CASE WHEN patch ? 'price_period' THEN patch->>'price_period' ELSE target.price_period END,
      price_fx_rate_ugx = CASE WHEN patch ? 'price_fx_rate_ugx' THEN (patch->>'price_fx_rate_ugx')::numeric ELSE target.price_fx_rate_ugx END,
      price_fx_as_of = CASE WHEN patch ? 'price_fx_as_of' THEN (patch->>'price_fx_as_of')::date ELSE target.price_fx_as_of END,
      price_on_application = CASE WHEN patch ? 'price_on_application' THEN (patch->>'price_on_application')::boolean ELSE target.price_on_application END,
      area = CASE WHEN patch ? 'area' THEN patch->>'area' ELSE target.area END,
      district = CASE WHEN patch ? 'district' THEN patch->>'district' ELSE target.district END,
      land_size_value = CASE WHEN patch ? 'land_size_value' THEN (patch->>'land_size_value')::numeric ELSE target.land_size_value END,
      land_size_unit = CASE WHEN patch ? 'land_size_unit' THEN patch->>'land_size_unit' ELSE target.land_size_unit END,
      status = CASE WHEN spec->>'action' = 'unpublish' THEN 'hidden' ELSE target.status END,
      moderation_stage = CASE WHEN spec->>'action' = 'unpublish' THEN 'hidden' ELSE target.moderation_stage END,
      extra_fields = COALESCE(target.extra_fields, '{}'::jsonb)
        || CASE
          WHEN patch ? 'canonical_location_id' THEN jsonb_strip_nulls(jsonb_build_object(
            'canonical_location_id', patch->>'canonical_location_id',
            'canonical_location_level', patch->>'canonical_level',
            'neighborhood', patch->>'area',
            'city', patch->>'district',
            'resolved_location_label', patch->>'resolved_label',
            'region', patch->>'region',
            'location_resolution_status', 'listing_correction_172',
            'location_resolution_confidence', 1
          ))
          ELSE '{}'::jsonb
        END
        || CASE
          WHEN patch ? 'price' OR patch ? 'price_period' THEN jsonb_strip_nulls(jsonb_build_object(
            'price_currency', COALESCE(patch->>'price_currency', target.price_currency),
            'price_original_currency', COALESCE(patch->>'price_original_currency', target.price_original_currency),
            'price_original', COALESCE((patch->>'price_original')::numeric, target.price_original),
            'price_period', COALESCE(patch->>'price_period', target.price_period),
            'price_fx_rate_ugx', CASE WHEN patch ? 'price_fx_rate_ugx' THEN (patch->>'price_fx_rate_ugx')::numeric ELSE NULL END,
            'price_fx_as_of', CASE WHEN patch ? 'price_fx_as_of' THEN patch->>'price_fx_as_of' ELSE NULL END
          ))
          ELSE '{}'::jsonb
        END
        || jsonb_build_object(
          'listing_correction_172', jsonb_strip_nulls(jsonb_build_object(
            'action', spec->>'action',
            'kept_property_id', NULLIF(spec->>'kept_id', ''),
            'flag', spec->>'flag',
            'applied_at', v_now
          ))
        ),
      updated_at = v_now
    WHERE target.id = p.id;

    RAISE NOTICE 'listing_correction_172 % applied %', spec->>'id', spec->>'action';
  END LOOP;
END
$do_172$;
