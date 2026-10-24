-- Finish the listing corrections migration 169 matched but did not update,
-- and relabel the Bweyogerere double-unit listing that 169 did not include.
--
-- Migration 169 required properties.area and properties.district to equal the
-- labels in its expect JSON. Those labels were copied from the public API.
-- The public property payload does not return those columns: it replaces them
-- with the canonical place (canonicalDisplayLocationForRow). A district-level
-- canonical blanks the public area. Rows whose stored area or district text
-- was the intake neighbourhood, a blank, or a different spelling failed that
-- equality even though title, listing type, price, price period, bedrooms and
-- the caption all matched. That is why relabel, area, clear-bedrooms and
-- unpublish each came up short together.
--
-- This migration keeps the id, approved status, title, listing type, price,
-- price period, bedrooms and caption checks. It does not require the stored
-- area or district to equal the public canonical label. It does not touch a
-- row already stamped listing_correction_169 (the rows 169 did update,
-- including 01bf0f1d, whose description changed and whose title did not).
-- Rows are never deleted. Uganda only.
--
-- Ntinda bfbc521d stays Price on application. Its title and category still
-- change from commercial land to a commercial building, which was a separate
-- label correction. This migration does not write a price, currency, FX rate,
-- or a description sentence that states USD 4,500,000 for that row.
--
-- Idempotent: each applied row is stamped extra_fields.listing_correction_170.
-- Old values go into listing_correction_170_backup.
-- Manual rollback: scripts/rollback-170-listing-corrections.sql
-- That file is not a migration and does not run on deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS listing_correction_170_backup (
  property_id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  kept_property_id UUID,
  flag TEXT,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH specs AS (
  SELECT
    (value->>'id')::uuid AS id,
    value->>'action' AS action,
    NULLIF(value->>'kept_id', '')::uuid AS kept_id,
    NULLIF(value->>'flag', '') AS flag,
    COALESCE(value->>'evidence', '') AS evidence,
    COALESCE(value->'expect', '{}'::jsonb) AS expect,
    COALESCE(value->'patch', '{}'::jsonb) AS patch
  FROM jsonb_array_elements($listing_corrections_170$
[
  {
    "id": "c25256a2-82e1-4668-8afc-48c4801d88d3",
    "action": "relabel",
    "kept_id": null,
    "flag": "The marketing title drops the word double. The caption says 8 double units on a 17-decimal plot, private mailo, on a quick sale at UGX 320 million. The UGX 3.4 million figure is monthly income, not the asking rent, so this stays a sale at UGX 320,000,000.",
    "evidence": "8 double units monthly income 3.4 million",
    "expect": {
      "title": "Land for sale in Bweyogerere",
      "listing_type": "land",
      "price_period": "once",
      "area": "Bweyogerere",
      "district": "Wakiso",
      "price": 320000000
    },
    "patch": {
      "title": "8 double rental units for sale in Bweyogerere",
      "listing_type": "sale",
      "property_type": "Rental units",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Bweyogerere, Wakiso, listed at UGX 320,000,000. ",
      "description_prefix_to": "8 double rental units for sale in Bweyogerere, Wakiso, listed at UGX 320,000,000. ",
      "land_size_value": 17,
      "land_size_unit": "decimals"
    }
  },
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
      "bedrooms": 4,
      "old_latitude": 0.452,
      "old_longitude": 32.606
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
      "resolved_label": "Naalya, Wakiso",
      "latitude": 0.37,
      "longitude": 32.64
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
    "id": "371eec61-47ca-4286-b7c3-2b0bf5768f42",
    "action": "relabel",
    "kept_id": null,
    "flag": "Caption says the 8 units are for sale at UGX 950 million and make 9 million a month. The monthly rent classification hid that sale price.",
    "evidence": "8 units in Kyanja center",
    "expect": {
      "title": "Property for rent in Kyanja",
      "listing_type": "rent",
      "price_period": "mo",
      "area": "Kyanja",
      "district": "Kampala",
      "price_optional": true,
      "price_one_of": [
        950000000
      ]
    },
    "patch": {
      "title": "8 rental units for sale in Kyanja",
      "listing_type": "sale",
      "property_type": "Rental units",
      "transaction_type": "sale",
      "description_prefix_from": "Rental property in Kyanja, Kampala, listed at UGX 950,000,000. ",
      "description_prefix_to": "8 rental units for sale in Kyanja, Kampala, listed at UGX 950,000,000. ",
      "price": 950000000,
      "price_original": 950000000,
      "price_currency": "UGX",
      "price_original_currency": "UGX",
      "price_on_application": false,
      "price_period": "once"
    }
  },
  {
    "id": "e8571cf2-c355-4d76-b377-a1941f0c7e55",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "five bedrooms on 13 decimals",
    "expect": {
      "title": "13-Bed property for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 270000000,
      "bedrooms": 13
    },
    "patch": {
      "title": "5-bed house for sale in Kira",
      "listing_type": "sale",
      "property_type": "House",
      "transaction_type": "sale",
      "description_prefix_from": "Property for sale in Kira, Wakiso, listed at UGX 270,000,000. ",
      "description_prefix_to": "5-bed house for sale in Kira, Wakiso, listed at UGX 270,000,000. ",
      "bedrooms": 5,
      "land_size_value": 13,
      "land_size_unit": "decimals"
    }
  },
  {
    "id": "28e43441-f002-49b3-a25b-e5ef8cfd2424",
    "action": "relabel",
    "kept_id": null,
    "flag": "Servant quarter is not counted as a fourth bedroom. Rent stays UGX 2,200,000 per month.",
    "evidence": "three bedrooms",
    "expect": {
      "title": "2-Bed property for rent in Mbalwa",
      "listing_type": "rent",
      "price_period": "mo",
      "area": "Mbalwa",
      "district": "Wakiso",
      "price": 2200000,
      "bedrooms": 2
    },
    "patch": {
      "title": "3-bed house for rent in Mbalwa",
      "listing_type": "rent",
      "property_type": "House",
      "transaction_type": "rent",
      "description_prefix_from": "Rental property in Mbalwa, Wakiso, listed at UGX 2,200,000. ",
      "description_prefix_to": "3-bed house for rent in Mbalwa, Wakiso, listed at UGX 2,200,000. ",
      "bedrooms": 3
    }
  },
  {
    "id": "490d074e-5baa-4c32-9e75-435b9538fa05",
    "action": "relabel",
    "kept_id": null,
    "flag": "23 was the decimal size, not the bedroom count. Luxurious was read from the word LUXURIOUS. The caption places the mansion on Ntinda-Kyambogo Road.",
    "evidence": "7-BEDROOM MANSION",
    "expect": {
      "title": "23-Bed property for sale in Luxurious",
      "listing_type": "sale",
      "price_period": "once",
      "area": null,
      "district": "Kampala",
      "price": 1710000000,
      "bedrooms": 23,
      "old_latitude": 0.3476,
      "old_longitude": 32.5825
    },
    "patch": {
      "title": "7-bed house for sale in Ntinda",
      "listing_type": "sale",
      "property_type": "Mansion",
      "transaction_type": "sale",
      "description_prefix_from": "Property for sale in Luxurious, Kampala, listed at USD 450,000. ",
      "description_prefix_to": "7-bed house for sale in Ntinda, Kampala, listed at USD 450,000. ",
      "bedrooms": 7,
      "area": "Ntinda",
      "district": "Kampala",
      "canonical_location_id": "kampala:ntinda",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Ntinda, Kampala",
      "latitude": 0.357,
      "longitude": 32.612,
      "land_size_value": 23,
      "land_size_unit": "decimals"
    }
  },
  {
    "id": "87543468-2976-49c0-9bbf-225432180011",
    "action": "relabel",
    "kept_id": null,
    "flag": "24 came from 24-hour security, not from a bedroom count.",
    "evidence": "5-BEDROOM TOWNHOUSES",
    "expect": {
      "title": "24-Bed property for sale in Kyanja",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kyanja",
      "district": "Kampala",
      "price": 800000000,
      "bedrooms": 24
    },
    "patch": {
      "title": "5-bed townhouses for sale in Kyanja",
      "listing_type": "sale",
      "property_type": "Townhouse",
      "transaction_type": "sale",
      "description_prefix_from": "Property for sale in Kyanja, Kampala, listed at UGX 800,000,000. ",
      "description_prefix_to": "5-bed townhouses for sale in Kyanja, Kampala, listed at UGX 800,000,000. ",
      "bedrooms": 5,
      "bathrooms": 5
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
    "id": "413be7b0-aa54-4bd2-9308-da70ee50e3ae",
    "action": "relabel",
    "kept_id": null,
    "flag": "Kept instead of 7ed73e15. Same 8,000-acre Nwoya caption, more photos, and no false 10-bedroom count. Price is the caption's per-acre rate. Pajengo is not in the location registry, so the area label is left as stored.",
    "evidence": "2,500,000 per acre",
    "expect": {
      "title": "Land for sale in Pajengo",
      "listing_type": "land",
      "price_period": "once",
      "area": null,
      "district": "Nwoya",
      "price_optional": true,
      "price_one_of": [
        2500000
      ]
    },
    "patch": {
      "title": "Land for sale in Pajengo",
      "listing_type": "land",
      "property_type": "Land",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Pajengo, Nwoya, listed at UGX 2,500,000. ",
      "description_prefix_to": "Land for sale in Pajengo, Nwoya, listed at UGX 2,500,000 per acre. ",
      "price": 2500000,
      "price_original": 2500000,
      "price_currency": "UGX",
      "price_original_currency": "UGX",
      "price_on_application": false,
      "price_period": "acre"
    }
  },
  {
    "id": "5c6d460a-4061-4c07-96e3-7dfc53839420",
    "action": "relabel",
    "kept_id": null,
    "flag": "Title and type stay the same. The stored UGX 270 million is the caption's per-acre rate, so the price period changes from once to per acre.",
    "evidence": "270m per acre",
    "expect": {
      "title": "10 Acres of land for sale in Matuga, Bombo Road",
      "listing_type": "land",
      "price_period": "once",
      "area": null,
      "district": "Wakiso",
      "price": 270000000
    },
    "patch": {
      "title": "10 Acres of land for sale in Matuga, Bombo Road",
      "listing_type": "land",
      "property_type": "Land",
      "transaction_type": "sale",
      "price_period": "acre"
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
    "id": "c3499df6-955d-468d-93fd-1624500edf48",
    "action": "clear_bedrooms",
    "kept_id": null,
    "flag": null,
    "evidence": "14 decimals plot",
    "expect": {
      "title": "14-Decimal plot on Namugongo Road in Mbalwa",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Mbalwa",
      "district": "Wakiso",
      "price": 160000000,
      "bedrooms": 1
    },
    "patch": {
      "bedrooms": null
    }
  },
  {
    "id": "c892830b-90b8-4bb0-89ce-0200c5df8841",
    "action": "clear_bedrooms",
    "kept_id": null,
    "flag": "Area left unchanged. Mbalwa Estate sits on Namugongo Road, and Kira-Mulawa differs from Kira Mulawa only by a hyphen.",
    "evidence": "50 by 100 plot in Mbalwa Estate",
    "expect": {
      "title": "50-By-100 plot in Mbalwa Estate",
      "listing_type": "land",
      "price_period": "once",
      "area": "Namugongo",
      "district": "Wakiso",
      "price": 135000000,
      "bedrooms": 1
    },
    "patch": {
      "bedrooms": null
    }
  },
  {
    "id": "df110660-9e03-4eeb-abc7-e40dafc14920",
    "action": "clear_bedrooms",
    "kept_id": null,
    "flag": null,
    "evidence": "50 by 100 plots",
    "expect": {
      "title": "50-By-100 plot near the tarmac on Shimoni Road, Kira Mulawa",
      "listing_type": "land",
      "price_period": "plot",
      "area": "Kira-Mulawa",
      "district": "Wakiso",
      "price": 145000000,
      "bedrooms": 1
    },
    "patch": {
      "bedrooms": null
    }
  },
  {
    "id": "f7266be0-21ff-424a-9d33-2a5522afc541",
    "action": "clear_bedrooms",
    "kept_id": null,
    "flag": "Area left unchanged. Kira-Mulawa and the title's Kira Mulawa differ only by a hyphen.",
    "evidence": "100 by 100 plot",
    "expect": {
      "title": "100-By-100 plot in Kira Mulawa",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kira-Mulawa",
      "district": "Wakiso",
      "price": 250000000,
      "bedrooms": 1
    },
    "patch": {
      "bedrooms": null
    }
  },
  {
    "id": "ac46726a-45c0-4afb-809b-5c37dc5c55cc",
    "action": "clear_bedrooms",
    "kept_id": null,
    "flag": null,
    "evidence": "50 by 100 plots each",
    "expect": {
      "title": "50-By-100 estate plot in Namugongo Sonde",
      "listing_type": "land",
      "price_period": "plot",
      "area": null,
      "district": "Wakiso",
      "price": 75000000,
      "bedrooms": 1
    },
    "patch": {
      "bedrooms": null
    }
  },
  {
    "id": "2b251b80-bd25-471e-bbd0-f52673fcfac2",
    "action": "clear_bedrooms",
    "kept_id": null,
    "flag": null,
    "evidence": "commercial plot 100 by 100",
    "expect": {
      "title": "100-By-100 commercial plot on Kamuli Lane in Kyambogo",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kyambogo",
      "district": "Kampala",
      "price": 750000000,
      "bedrooms": 1
    },
    "patch": {
      "bedrooms": null
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
    "id": "1f511792-551c-488d-bddf-461e86f13fd5",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Namugongo Sonde",
    "expect": {
      "title": "Land for sale in Namugongo",
      "listing_type": "land",
      "price_period": "once",
      "area": "Entebbe",
      "district": "Wakiso",
      "price": 49000000,
      "old_latitude": 0.0512,
      "old_longitude": 32.4637
    },
    "patch": {
      "area": "Namugongo",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:namugongo",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Namugongo, Wakiso",
      "latitude": 0.363,
      "longitude": 32.636
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
    "id": "c67ee38a-dfb3-4e55-82d5-2b449ee39686",
    "action": "area",
    "kept_id": null,
    "flag": "Mbalwa has no centroid in the registry. The area label moves off Gayaza, but the map pin stays on the Gayaza centroid.",
    "evidence": "13 decimals Mbalwa",
    "expect": {
      "title": "Land for sale in Mbalwa",
      "listing_type": "land",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 140000000
    },
    "patch": {
      "area": "Mbalwa",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:mbalwa",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Mbalwa, Wakiso"
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
      "price": 340000000,
      "old_latitude": 0.452,
      "old_longitude": 32.606
    },
    "patch": {
      "area": "Bwebajja",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:bwebajja",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Bwebajja, Wakiso",
      "latitude": 0.179,
      "longitude": 32.541
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
    "id": "cd8525b6-c962-48a2-8505-6f7b09d71fd0",
    "action": "area",
    "kept_id": null,
    "flag": "Kyaliwajjala has no centroid in the registry. The area label moves off Gayaza, but the map pin stays on the Gayaza centroid.",
    "evidence": "Kyaliwajjala Nabwojo",
    "expect": {
      "title": "Land for sale in Kyaliwajjala",
      "listing_type": "land",
      "price_period": "once",
      "area": "Gayaza",
      "district": "Wakiso",
      "price": 250000000
    },
    "patch": {
      "area": "Kyaliwajjala",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:kyaliwajjala",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Kyaliwajjala, Wakiso"
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
      "price": 380000000,
      "old_latitude": 0.452,
      "old_longitude": 32.606
    },
    "patch": {
      "area": "Bulindo",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:bulindo",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Bulindo, Wakiso",
      "latitude": 0.418,
      "longitude": 32.633
    }
  },
  {
    "id": "bdaa51d9-1d39-41b1-81ba-6452616e626a",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Bweyogerere 4 bedrooms",
    "expect": {
      "title": "4-Bed property for sale in Bweyogerere",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 250000000,
      "old_latitude": 0.3978,
      "old_longitude": 32.6414
    },
    "patch": {
      "area": "Bweyogerere",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:bweyogerere",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Bweyogerere, Wakiso",
      "latitude": 0.351,
      "longitude": 32.676
    }
  },
  {
    "id": "7ebdbf52-0ee2-4eb2-9491-0390dea64fc7",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Kira 8 unit apartment",
    "expect": {
      "title": "Property for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Nakwero",
      "district": "Wakiso",
      "price": 690000000
    },
    "patch": {
      "area": "Kira",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:kira",
      "canonical_level": "city",
      "region": "Central",
      "resolved_label": "Kira, Wakiso",
      "latitude": 0.3978,
      "longitude": 32.6414
    }
  },
  {
    "id": "25f945a9-b3f2-4f50-8240-23cde2391278",
    "action": "area",
    "kept_id": null,
    "flag": "Caption names both Kira and Bulindo. Bulindo is the specific place in the title and the caption, so the area moves from Kira to Bulindo.",
    "evidence": "Bulindo 200 meters",
    "expect": {
      "title": "Property for sale in Bulindo",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 450000000,
      "old_latitude": 0.3978,
      "old_longitude": 32.6414
    },
    "patch": {
      "area": "Bulindo",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:bulindo",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Bulindo, Wakiso",
      "latitude": 0.418,
      "longitude": 32.633
    }
  },
  {
    "id": "1a49d9b1-ce66-484c-ae32-5060edf3ada0",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Matugga kiryagonja",
    "expect": {
      "title": "3-Bed property for sale in Matugga",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Mbalwa",
      "district": "Wakiso",
      "price": 250000000
    },
    "patch": {
      "area": "Matugga",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:matugga",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Matugga, Wakiso",
      "latitude": 0.463,
      "longitude": 32.525
    }
  },
  {
    "id": "5fb82c8f-2a2f-4187-8882-39525aea62ac",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Kira 4 bedrooms house",
    "expect": {
      "title": "4-Bed property for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kololo",
      "district": "Kampala",
      "price": 330000000,
      "old_latitude": 0.356,
      "old_longitude": 32.612
    },
    "patch": {
      "area": "Kira",
      "district": "Wakiso",
      "canonical_location_id": "wakiso:kira",
      "canonical_level": "city",
      "region": "Central",
      "resolved_label": "Kira, Wakiso",
      "latitude": 0.3978,
      "longitude": 32.6414
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
    "id": "776cba37-0e45-49a4-b067-63819214ec7d",
    "action": "unpublish",
    "kept_id": "f3bb5de0-b2c9-4502-9a06-d46bbaef0fcd",
    "flag": null,
    "evidence": "8 double",
    "expect": {
      "title": "Property for sale in Kiwatule",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kiwatule",
      "district": "Kampala",
      "price": 1450000000
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
    "id": "a37eb75e-0ce0-458a-b6a0-09dd5927fc22",
    "action": "unpublish",
    "kept_id": "80d16eb6-6ae7-4a6a-9555-19a622b7b4bd",
    "flag": "This copy says Nsasa Nabusugwe and does not mention the pool. Beds, decimals and price match the kept copy.",
    "evidence": "6 bedrooms house on 15 decimals",
    "expect": {
      "title": "6-Bed property for sale in Nabusugwe",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Nabusugwe",
      "district": "Wakiso",
      "price": 750000000
    },
    "patch": {}
  },
  {
    "id": "ae6076d3-7a20-456f-9860-cd66c0118407",
    "action": "unpublish",
    "kept_id": "203ae750-b64e-4dac-995b-b977c4448a2c",
    "flag": null,
    "evidence": "4 bedrooms",
    "expect": {
      "title": "4-Bed property for sale in Kyaliwajjala",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kyaliwajjala",
      "district": "Wakiso",
      "price": 300000000
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
    "id": "18448dce-f5b9-4231-bbc2-117426aa327e",
    "action": "unpublish",
    "kept_id": "4ede4399-9ab9-41a3-a90d-18c75e294bf5",
    "flag": null,
    "evidence": "4 bedrooms, 3 bathrooms",
    "expect": {
      "title": "4-Bed property for sale in Naalya",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Naalya",
      "district": "Wakiso",
      "price": 950000000
    },
    "patch": {}
  },
  {
    "id": "50ce7080-6e74-454d-9deb-7686f08081af",
    "action": "unpublish",
    "kept_id": "496006a9-d203-437c-a722-d99fe7d8df03",
    "flag": "The description matches the Seeta mixed-use building, but the source hover on this row is the Queen Elizabeth lodge caption. It is unpublished so the mixed record is not left live. The Seeta copy is kept.",
    "evidence": "2 floors are commercial",
    "expect": {
      "title": "Commercial house for sale 2.2b.",
      "listing_type": "sale",
      "price_period": "once",
      "area": null,
      "district": "Mukono",
      "price_optional": true
    },
    "patch": {}
  },
  {
    "id": "7ed73e15-3da5-4211-94a9-a7b9d9b751e8",
    "action": "unpublish",
    "kept_id": "413be7b0-aa54-4bd2-9308-da70ee50e3ae",
    "flag": "Same Nwoya farmland. This copy stored 10 electricity poles as 10 bedrooms. The Pajengo copy is kept and priced per acre.",
    "evidence": "8000 acres",
    "expect": {
      "title": "Land for sale in Nwoya",
      "listing_type": "land",
      "price_period": "once",
      "area": null,
      "district": "Nwoya",
      "price": 2500000
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
  },
  {
    "id": "5649cd32-4d34-4fff-ba2a-d0c6d97c0e3b",
    "action": "unpublish",
    "kept_id": "8a94e5a2-9255-447e-97cd-9ec96f00a37a",
    "flag": "Same Kasangati Buwambo house. The copy with a photo is kept.",
    "evidence": "Kasangati Buwambo 4 bedrooms",
    "expect": {
      "title": "4-Bed property for sale in Kasangati",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kasangati",
      "district": "Wakiso",
      "price": 320000000
    },
    "patch": {}
  },
  {
    "id": "0e55db22-33bc-41fd-9374-ba8739a403c3",
    "action": "unpublish",
    "kept_id": "453483f5-c69f-4953-9085-38c49ab81123",
    "flag": "Same 37-decimal Kiwatule plot. The copy with a photo is kept.",
    "evidence": "37 decimals",
    "expect": {
      "title": "Property for sale in Kiwatule",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kiwatule",
      "district": "Kampala",
      "price": 960000000
    },
    "patch": {}
  },
  {
    "id": "c7cca0e9-d3df-4bdb-9399-236d489ccc18",
    "action": "unpublish",
    "kept_id": "6fcccfe1-cec3-412f-ab9a-3275c568cffd",
    "flag": "Same Kitukutwe 4-bedroom house on 15 decimals at UGX 330 million. This copy has the bathroom and staff-quarter detail but no photo. The photo copy is kept.",
    "evidence": "Kira Kitukutwe 4 bedrooms",
    "expect": {
      "title": "4-Bed property for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 330000000
    },
    "patch": {}
  },
  {
    "id": "ed7f1715-91f2-43ce-8384-11c8e3865490",
    "action": "unpublish",
    "kept_id": "6fcccfe1-cec3-412f-ab9a-3275c568cffd",
    "flag": "Same Kitukutwe house as the kept photo copy.",
    "evidence": "Kira Kitukutwe 4 bedrooms",
    "expect": {
      "title": "4-Bed property for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 330000000
    },
    "patch": {}
  },
  {
    "id": "31846e1b-167a-472b-b197-b16d48bed01b",
    "action": "skip",
    "kept_id": null,
    "flag": "Same primary photo of one yellow 5-bed house, recompressed rather than re-shot (both frames 810x1080; not byte-identical; pixel difference is compression, aligned at zero shift). Not safe to hide either copy. Kazi Honest (31846e1b) asks UGX 750,000,000 and the caption says 13 decimals with the title on the table. Kimuli Brian (7316f714) asks UGX 650,000,000 and does not mention 13 decimals. Two agents, UGX 100 million apart. Both stay live. Ask both which price is current.",
    "evidence": "13Decimals",
    "expect": {
      "title": "5-Bed property for sale in Najjera",
      "listing_type": "sale",
      "price": 750000000
    },
    "patch": {}
  },
  {
    "id": "7316f714-29eb-46fe-8bb2-2752108eed61",
    "action": "skip",
    "kept_id": null,
    "flag": "Same primary photo of one yellow 5-bed house, recompressed rather than re-shot (both frames 810x1080; not byte-identical; pixel difference is compression, aligned at zero shift). Not safe to hide either copy. Kazi Honest (31846e1b) asks UGX 750,000,000 and the caption says 13 decimals with the title on the table. Kimuli Brian (7316f714) asks UGX 650,000,000 and does not mention 13 decimals. Two agents, UGX 100 million apart. Both stay live. Ask both which price is current.",
    "evidence": "650 million",
    "expect": {
      "title": "House for sale in Najjera",
      "listing_type": "sale",
      "price": 650000000
    },
    "patch": {}
  }
]
$listing_corrections_170$::jsonb) AS value
  WHERE value->>'action' <> 'skip'
),
eligible AS (
  SELECT
    p.id,
    s.action,
    s.kept_id,
    s.flag,
    s.patch,
    s.expect,
    to_jsonb(p) AS before_row
  FROM properties p
  JOIN specs s ON s.id = p.id
  WHERE current_setting('app.country_code', true) = 'UG'
    AND NOT (COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_169')
    AND NOT (COALESCE(p.extra_fields, '{}'::jsonb) ? 'listing_correction_170')
    AND p.status = 'approved'
    AND regexp_replace(lower(btrim(p.title)), '\s+', ' ', 'g')
      = regexp_replace(lower(btrim(s.expect->>'title')), '\s+', ' ', 'g')
    AND lower(btrim(p.listing_type)) = lower(btrim(s.expect->>'listing_type'))
    AND (
      lower(btrim(COALESCE(p.price_period, ''))) = lower(btrim(COALESCE(s.expect->>'price_period', '')))
      OR (
        lower(btrim(COALESCE(s.expect->>'price_period', ''))) IN ('mo', 'month')
        AND lower(btrim(COALESCE(p.price_period, ''))) IN ('mo', 'month')
      )
    )
    AND (
      NOT (s.expect ? 'bedrooms')
      OR p.bedrooms IS NOT DISTINCT FROM (s.expect->>'bedrooms')::integer
    )
    AND (
      (
        COALESCE(s.expect->>'price_optional', '') <> 'true'
        AND p.price IS NOT DISTINCT FROM (s.expect->>'price')::numeric
      )
      OR (
        COALESCE(s.expect->>'price_optional', '') = 'true'
        AND (
          NOT (s.expect ? 'price_one_of')
          OR p.price IS NULL
          OR p.price IN (
            SELECT (jsonb_array_elements_text(s.expect->'price_one_of'))::numeric
          )
        )
      )
    )
    AND (
      s.evidence = ''
      OR COALESCE(p.description, '') ILIKE '%' || s.evidence || '%'
      OR COALESCE(p.extra_fields->>'source_caption', '') ILIKE '%' || s.evidence || '%'
      OR COALESCE(p.extra_fields->>'source_text', '') ILIKE '%' || s.evidence || '%'
      OR COALESCE(p.extra_fields->>'source_description', '') ILIKE '%' || s.evidence || '%'
      OR COALESCE(p.extra_fields->>'source_visual_text', '') ILIKE '%' || s.evidence || '%'
      OR COALESCE(p.extra_fields->>'source_title', '') ILIKE '%' || s.evidence || '%'
      OR COALESCE(p.extra_fields->>'source_hover_description', '') ILIKE '%' || s.evidence || '%'
    )
    AND (
      s.action <> 'unpublish'
      OR EXISTS (
        SELECT 1
        FROM properties keeper
        WHERE keeper.id = s.kept_id
          AND keeper.id <> p.id
          AND LOWER(COALESCE(keeper.status, '')) IN ('approved', 'live', 'published')
      )
    )
),
backed_up AS (
  INSERT INTO listing_correction_170_backup (property_id, action, kept_property_id, flag, before_row)
  SELECT id, action, kept_id, flag, before_row
  FROM eligible
  ON CONFLICT (property_id) DO NOTHING
  RETURNING property_id
)
UPDATE properties p
SET
  title = CASE WHEN e.patch ? 'title' THEN e.patch->>'title' ELSE p.title END,
  description = CASE
    WHEN e.patch ? 'description' THEN e.patch->>'description'
    WHEN e.patch ? 'description_prefix_from'
      AND p.description LIKE (e.patch->>'description_prefix_from') || '%'
    THEN (e.patch->>'description_prefix_to')
      || SUBSTRING(p.description FROM char_length(e.patch->>'description_prefix_from') + 1)
    ELSE p.description
  END,
  listing_type = CASE WHEN e.patch ? 'listing_type' THEN e.patch->>'listing_type' ELSE p.listing_type END,
  transaction_type = CASE WHEN e.patch ? 'transaction_type' THEN e.patch->>'transaction_type' ELSE p.transaction_type END,
  property_type = CASE WHEN e.patch ? 'property_type' THEN e.patch->>'property_type' ELSE p.property_type END,
  bedrooms = CASE WHEN e.patch ? 'bedrooms' THEN (e.patch->>'bedrooms')::integer ELSE p.bedrooms END,
  bathrooms = CASE WHEN e.patch ? 'bathrooms' THEN (e.patch->>'bathrooms')::integer ELSE p.bathrooms END,
  price = CASE WHEN e.patch ? 'price' THEN (e.patch->>'price')::numeric ELSE p.price END,
  price_original = CASE WHEN e.patch ? 'price_original' THEN (e.patch->>'price_original')::numeric ELSE p.price_original END,
  price_currency = CASE WHEN e.patch ? 'price_currency' THEN e.patch->>'price_currency' ELSE p.price_currency END,
  price_original_currency = CASE WHEN e.patch ? 'price_original_currency' THEN e.patch->>'price_original_currency' ELSE p.price_original_currency END,
  price_period = CASE WHEN e.patch ? 'price_period' THEN e.patch->>'price_period' ELSE p.price_period END,
  price_fx_rate_ugx = CASE WHEN e.patch ? 'price_fx_rate_ugx' THEN (e.patch->>'price_fx_rate_ugx')::numeric ELSE p.price_fx_rate_ugx END,
  price_fx_as_of = CASE WHEN e.patch ? 'price_fx_as_of' THEN (e.patch->>'price_fx_as_of')::date ELSE p.price_fx_as_of END,
  price_on_application = CASE WHEN e.patch ? 'price_on_application' THEN (e.patch->>'price_on_application')::boolean ELSE p.price_on_application END,
  area = CASE WHEN e.patch ? 'area' THEN e.patch->>'area' ELSE p.area END,
  district = CASE WHEN e.patch ? 'district' THEN e.patch->>'district' ELSE p.district END,
  latitude = CASE
    WHEN e.patch ? 'latitude'
      AND p.latitude IS NOT DISTINCT FROM (e.expect->>'old_latitude')::numeric
    THEN (e.patch->>'latitude')::numeric
    ELSE p.latitude
  END,
  longitude = CASE
    WHEN e.patch ? 'longitude'
      AND p.longitude IS NOT DISTINCT FROM (e.expect->>'old_longitude')::numeric
    THEN (e.patch->>'longitude')::numeric
    ELSE p.longitude
  END,
  land_size_value = CASE WHEN e.patch ? 'land_size_value' THEN (e.patch->>'land_size_value')::numeric ELSE p.land_size_value END,
  land_size_unit = CASE WHEN e.patch ? 'land_size_unit' THEN e.patch->>'land_size_unit' ELSE p.land_size_unit END,
  status = CASE WHEN e.action = 'unpublish' THEN 'hidden' ELSE p.status END,
  moderation_stage = CASE WHEN e.action = 'unpublish' THEN 'hidden' ELSE p.moderation_stage END,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
    || CASE
      WHEN e.patch ? 'canonical_location_id' THEN jsonb_strip_nulls(jsonb_build_object(
        'canonical_location_id', e.patch->>'canonical_location_id',
        'canonical_location_level', e.patch->>'canonical_level',
        'neighborhood', e.patch->>'area',
        'city', e.patch->>'district',
        'resolved_location_label', e.patch->>'resolved_label',
        'region', e.patch->>'region',
        'location_resolution_status', 'listing_correction_170',
        'location_resolution_confidence', 1
      ))
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN e.patch ? 'price' OR e.patch ? 'price_period' THEN jsonb_strip_nulls(jsonb_build_object(
        'price_currency', COALESCE(e.patch->>'price_currency', p.price_currency),
        'price_original_currency', COALESCE(e.patch->>'price_original_currency', p.price_original_currency),
        'price_original', COALESCE((e.patch->>'price_original')::numeric, p.price_original),
        'price_period', COALESCE(e.patch->>'price_period', p.price_period),
        'price_fx_rate_ugx', CASE WHEN e.patch ? 'price_fx_rate_ugx' THEN (e.patch->>'price_fx_rate_ugx')::numeric ELSE NULL END,
        'price_fx_as_of', CASE WHEN e.patch ? 'price_fx_as_of' THEN e.patch->>'price_fx_as_of' ELSE NULL END
      ))
      ELSE '{}'::jsonb
    END
    || jsonb_build_object(
      'listing_correction_170', jsonb_strip_nulls(jsonb_build_object(
        'action', e.action,
        'kept_property_id', e.kept_id,
        'flag', e.flag,
        'applied_at', NOW()
      ))
    ),
  updated_at = NOW()
FROM eligible e
WHERE p.id = e.id;
