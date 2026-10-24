-- Correct mislabelled listing facts and unpublish verified duplicates.
-- Prepared from the 24 Oct 2026 marketing list. Each row was checked against
-- that listing's own title, description, listing type, location, price and
-- source caption. Suggestions that contradict the caption are skipped and
-- recorded with a flag. Rows are never deleted.
--
-- Idempotent and keyed by property id. A second run matches nothing because
-- each applied row is stamped extra_fields.listing_correction_169.
-- Uganda only: app.country_code must be UG, which scripts/migrate.js sets.
-- Old values are copied into listing_correction_169_backup before the update.
-- Manual rollback: scripts/rollback-169-listing-corrections.sql
-- That file is not a migration and does not run on deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS listing_correction_169_backup (
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
  FROM jsonb_array_elements($listing_corrections$
[
  {
    "id": "2da4bffc-d685-480f-96ec-a071a64d3792",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "5 rental units monthly income 3.2 million",
    "expect": {
      "title": "Land for sale in Bweyogerere",
      "listing_type": "land",
      "price_period": "once",
      "area": "Bweyogerere",
      "district": "Wakiso",
      "price": 370000000
    },
    "patch": {
      "title": "5 rental units for sale in Bweyogerere",
      "listing_type": "sale",
      "property_type": "Rental units",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Bweyogerere, Wakiso, listed at UGX 370,000,000. ",
      "description_prefix_to": "5 rental units for sale in Bweyogerere, Wakiso, listed at UGX 370,000,000. "
    }
  },
  {
    "id": "becba0f9-0b02-4e64-974a-14e94278a8dc",
    "action": "relabel",
    "kept_id": null,
    "flag": "Stored area was Kyaliwajjala. The caption and title both say Bwebajja Entebbe road, so the area moves to Bwebajja. The map pin was empty and is set to the Bwebajja centroid.",
    "evidence": "7 bedrooms",
    "expect": {
      "title": "Land for sale in Bwebajja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kyaliwajjala",
      "district": "Wakiso",
      "price": 6080000000,
      "bedrooms": 7
    },
    "patch": {
      "title": "7-bed house for sale in Bwebajja",
      "listing_type": "sale",
      "property_type": "House",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Bwebajja, Wakiso, listed at USD 1,600,000. ",
      "description_prefix_to": "7-bed house for sale in Bwebajja, Wakiso, listed at USD 1,600,000. ",
      "bedrooms": 7,
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
    "id": "2db4ae00-4fbc-49c5-8c0e-d8426f6c209c",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "4 bedrooms 4 bathrooms",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 550000000,
      "bedrooms": 4
    },
    "patch": {
      "title": "4-bed house for sale in Kira",
      "listing_type": "sale",
      "property_type": "House",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Kira, Wakiso, listed at UGX 550,000,000. ",
      "description_prefix_to": "4-bed house for sale in Kira, Wakiso, listed at UGX 550,000,000. ",
      "bathrooms": 4
    }
  },
  {
    "id": "73fbf51d-58f9-47df-8080-ffee9abb9b2f",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "6 bedrooms 4 bathrooms",
    "expect": {
      "title": "Land for sale in Ntinda",
      "listing_type": "land",
      "price_period": "once",
      "area": "Ntinda",
      "district": "Kampala",
      "price": 700000000,
      "bedrooms": 6
    },
    "patch": {
      "title": "6-bed house for sale in Ntinda",
      "listing_type": "sale",
      "property_type": "House",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Ntinda, Kampala, listed at UGX 700,000,000. ",
      "description_prefix_to": "6-bed house for sale in Ntinda, Kampala, listed at UGX 700,000,000. ",
      "bathrooms": 4
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
    "flag": "Public price is hidden because UGX 4,500,000 is below the commercial-sale floor. The caption says selling $4.5M. UGX guide uses the published 1 USD = 3,800 rate dated 2026-10-01, not a new quote.",
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
      "transaction_type": "sale",
      "description_prefix_from": "Commercial property in Ntinda, Kampala, listed at UGX 4,500,000. ",
      "description_prefix_to": "Commercial building for sale in Ntinda, Kampala, listed at USD 4,500,000. ",
      "price": 17100000000,
      "price_original": 4500000,
      "price_currency": "UGX",
      "price_original_currency": "USD",
      "price_on_application": false,
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01"
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
    "id": "8e268168-b3b5-411a-9311-efbdc392fdfc",
    "action": "relabel",
    "kept_id": null,
    "flag": "Kisoro has no separate town centroid in the registry, so the public area chip follows the Kisoro district. The asking price stays UGX 500 million. The duplicate account is not merged.",
    "evidence": "Canvon Lodges in Kisoro",
    "expect": {
      "title": "Land for sale in Park",
      "listing_type": "land",
      "price_period": "once",
      "area": "Park",
      "district": "Ntungamo",
      "price": 500000000
    },
    "patch": {
      "title": "Lodge on 2.9 acres for sale in Kisoro",
      "listing_type": "commercial",
      "property_type": "hospitality",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Park, Ntungamo, listed at UGX 500,000,000. ",
      "description_prefix_to": "Lodge on 2.9 acres for sale in Kisoro, listed at UGX 500,000,000. ",
      "area": "Kisoro",
      "district": "Kisoro",
      "canonical_location_id": "kisoro:kisoro",
      "canonical_level": "district",
      "region": "Western",
      "resolved_label": "Kisoro, Kisoro"
    }
  },
  {
    "id": "dc719955-16a3-4a43-9d92-d7e1c0a90982",
    "action": "relabel",
    "kept_id": null,
    "flag": "Area Transformer came from the 3-phase transformer in the features, and 20 bedrooms came from 20,234 sqm. The caption says 10 cottages, not 20 bedrooms, so bedrooms are cleared. District is set to Kasese; the highway also borders Mbarara. The map pin is left empty because the Kasese district centroid is not the lodge. This copy is kept because it has 16 photos against 12 on the duplicate.",
    "evidence": "QUEEN ELIZABETH SAFARI LODGE",
    "expect": {
      "title": "Land for sale in Transformer",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Transformer",
      "district": "Nakaseke",
      "price": 1600000000,
      "bedrooms": 20
    },
    "patch": {
      "title": "Safari lodge for sale near Queen Elizabeth National Park",
      "listing_type": "commercial",
      "property_type": "hospitality",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Transformer, Nakaseke, listed at UGX 1,600,000,000. ",
      "description_prefix_to": "Safari lodge for sale near Queen Elizabeth National Park, listed at UGX 1,600,000,000. ",
      "bedrooms": null,
      "area": "Kasese",
      "district": "Kasese",
      "canonical_location_id": "kasese:kasese",
      "canonical_level": "district",
      "region": "Western",
      "resolved_label": "Kasese, Kasese"
    }
  },
  {
    "id": "3d8ba7e2-2081-484d-a79c-c8ad1342c30d",
    "action": "relabel",
    "kept_id": null,
    "flag": null,
    "evidence": "55 Rooms",
    "expect": {
      "title": "Land for sale in Makerere",
      "listing_type": "land",
      "price_period": "once",
      "area": "Makerere",
      "district": "Kampala",
      "price": 7600000000
    },
    "patch": {
      "title": "Hotel / hostel (55 rooms) for sale in Makerere",
      "listing_type": "commercial",
      "property_type": "hospitality",
      "transaction_type": "sale",
      "description_prefix_from": "Land for sale in Makerere, Kampala, listed at USD 2,000,000. ",
      "description_prefix_to": "Hotel / hostel (55 rooms) for sale in Makerere, Kampala, listed at USD 2,000,000. "
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
    "id": "01bf0f1d-9f8e-4cb8-8929-c8bb1e41aa2c",
    "action": "relabel",
    "kept_id": null,
    "flag": "Marketing suggested an apartment for rent at about UGX 400,000 a month. The source caption is a 25-decimal plot in Kyanja-Kungu at UGX 400 million, and the stored type, title and once-off price already say that. Only the contradictory description is rewritten. The price is not changed.",
    "evidence": "Apartment for rent around Kyanja",
    "expect": {
      "title": "Land for sale in Kyanja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kyanja",
      "district": "Kampala",
      "price": 400000000
    },
    "patch": {
      "description": "Land for sale in Kyanja, Kampala, listed at UGX 400,000,000. PRIME 25 DECIMALS IN KYANJA-KUNGU AT UGX 400M. A prime 25-decimal plot of land located in Kyanja-Kungu, about 100 metres off the main road connecting Kyanja Ring Road. Contact Sewa sewa to confirm current availability, full specifications and viewing arrangements."
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
    "id": "a834d55c-9a7e-4297-982d-fd6d8135077f",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "Location* : Kyanja",
    "expect": {
      "title": "Land for sale in Kyanja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Buwaate",
      "district": "Wakiso",
      "price": 150000000
    },
    "patch": {
      "area": "Kyanja",
      "district": "Kampala",
      "canonical_location_id": "kampala:kyanja",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Kyanja, Kampala",
      "latitude": 0.384,
      "longitude": 32.596
    }
  },
  {
    "id": "653f9482-3ebe-42dc-8584-e9136547ef92",
    "action": "area",
    "kept_id": null,
    "flag": null,
    "evidence": "20 decimals Nsambya",
    "expect": {
      "title": "Land for sale in Nsambya",
      "listing_type": "land",
      "price_period": "once",
      "area": "Ntinda",
      "district": "Kampala",
      "price": 550000000,
      "old_latitude": 0.357,
      "old_longitude": 32.612
    },
    "patch": {
      "area": "Nsambya",
      "district": "Kampala",
      "canonical_location_id": "kampala:nsambya",
      "canonical_level": "area",
      "region": "Central",
      "resolved_label": "Nsambya, Kampala",
      "latitude": 0.303,
      "longitude": 32.589
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
    "id": "120c9928-67dd-4b33-a0cd-9d3ff219d9bf",
    "action": "area",
    "kept_id": null,
    "flag": "Caption also says Kitukutwe. The title's place is Kira, which replaces Ntinda. Kitukutwe is more specific but has no separate pin, so the pin moves to the Kira centroid.",
    "evidence": "Kira Kitukutwe",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Ntinda",
      "district": "Kampala",
      "price": 120000000,
      "old_latitude": 0.357,
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
    "id": "c892830b-90b8-4bb0-89ce-0200c5df8841",
    "action": "skip",
    "kept_id": null,
    "flag": "Mbalwa Estate is on Namugongo Road. Area Namugongo is left as stored. Bedrooms are cleared in the plot fix.",
    "evidence": "",
    "note": "no area change",
    "expect": {
      "title": "50-By-100 plot in Mbalwa Estate",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "f7266be0-21ff-424a-9d33-2a5522afc541",
    "action": "skip",
    "kept_id": null,
    "flag": "Kira-Mulawa and Kira Mulawa differ only by a hyphen. Area is left as stored. Bedrooms are cleared in the plot fix.",
    "evidence": "",
    "note": "no area change",
    "expect": {
      "title": "100-By-100 plot in Kira Mulawa",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "e450366b-a4f0-42fe-8f7e-277ae00896ae",
    "action": "skip",
    "kept_id": null,
    "flag": "Kira-Mulawa and the title's Kira Mulawa differ only by a hyphen. No correction applied.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "5-Bedroom house on 17 decimals in Kira Mulawa",
      "listing_type": "sale"
    },
    "patch": {}
  },
  {
    "id": "4e195f24-55f8-4add-8e68-9428226ec939",
    "action": "skip",
    "kept_id": null,
    "flag": "Description says 2 acres at UGX 45 million each and also says the acre basis must be confirmed before publication. Price period is not changed.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "2 Acres of land in Nakifuma Bukasa",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "2f512140-62c1-4911-8cb3-bdda2e0603c6",
    "action": "skip",
    "kept_id": null,
    "flag": "Description says 2 acres at UGX 70 million each and also says the acre basis must be confirmed before publication. Price period is not changed.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "2 Acres of land in Namugongo Budugala",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "0df40bd8-98df-48ca-8855-a4b8cf186ef7",
    "action": "unpublish",
    "kept_id": "daf5a251-6370-4f0e-bdc0-5ecbbf62f751",
    "flag": null,
    "evidence": "Kira Mamerito road 3 bedroom",
    "expect": {
      "title": "House for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 330000000
    },
    "patch": {}
  },
  {
    "id": "701dddd0-dcea-40a6-9067-cd51a321fc2c",
    "action": "unpublish",
    "kept_id": "daf5a251-6370-4f0e-bdc0-5ecbbf62f751",
    "flag": null,
    "evidence": "Kira Mamerito road 3 bedroom",
    "expect": {
      "title": "House for sale in Kira",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 330000000
    },
    "patch": {}
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
    "id": "57344404-9f57-4030-8bb4-485e606da27e",
    "action": "unpublish",
    "kept_id": "723bb908-a360-47db-ae4a-b6e893693a6b",
    "flag": null,
    "evidence": "4 bedrooms bungalow with staff quarters",
    "expect": {
      "title": "Bungalow for sale in Kiwatule",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kiwatule",
      "district": "Kampala",
      "price": 1200000000
    },
    "patch": {}
  },
  {
    "id": "b2635f95-c6d1-427e-bade-3e7fdff32cc0",
    "action": "unpublish",
    "kept_id": "92ffad95-1877-4933-b4d1-265de1802898",
    "flag": null,
    "evidence": "8 units of 2 bedrooms",
    "expect": {
      "title": "Apartments for sale in Kyaliwajjala",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Kyaliwajjala",
      "district": "Wakiso",
      "price": 1000000000
    },
    "patch": {}
  },
  {
    "id": "3265908c-d4c3-40f6-aca8-4287b01431f4",
    "action": "unpublish",
    "kept_id": "24768f13-91f5-4e51-9a8c-2f0fb66826bf",
    "flag": null,
    "evidence": "Garuga Pearl Marina",
    "expect": {
      "title": "Land for sale in Garuga",
      "listing_type": "land",
      "price_period": "acre",
      "area": "Garuga",
      "district": "Wakiso",
      "price": 700000000
    },
    "patch": {}
  },
  {
    "id": "262c8c54-0ed5-4705-9b76-7fe7b0ee4d27",
    "action": "unpublish",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "flag": null,
    "evidence": "65 decimals",
    "expect": {
      "title": "Land for sale in Mengo",
      "listing_type": "land",
      "price_period": "once",
      "area": "Mengo",
      "district": "Kampala",
      "price": 2470000000
    },
    "patch": {}
  },
  {
    "id": "d843c96a-3e39-405b-bd93-a30df7a013ba",
    "action": "unpublish",
    "kept_id": "a5f779fa-1173-48fd-bd8d-02ce5db8eefc",
    "flag": null,
    "evidence": "Kira kasangati road",
    "expect": {
      "title": "Land for sale in Kasangati",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kasangati",
      "district": "Wakiso",
      "price": 380000000
    },
    "patch": {}
  },
  {
    "id": "927d17fb-df88-476a-a3c5-4bf787bcae38",
    "action": "unpublish",
    "kept_id": "dab6cbc2-eeef-4200-85b3-ae3e1873e2ec",
    "flag": null,
    "evidence": "100 by 100 plot Kira Mulawa",
    "expect": {
      "title": "Land for sale in Kira-Mulawa",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kira-Mulawa",
      "district": "Wakiso",
      "price": 230000000
    },
    "patch": {}
  },
  {
    "id": "6ce2039d-7048-42e0-812a-62eb1fd9da7b",
    "action": "unpublish",
    "kept_id": "d23dc139-1aa0-4a23-aa8a-bda63fbea3c5",
    "flag": "One caption says 16 units of 1- and 2-bed apartments and the other says 20 decimals. Income, price and Naalya match, so this copy is unpublished. Confirm they are one block if a buyer asks.",
    "evidence": "monthly income 18 million",
    "expect": {
      "title": "Apartments for sale in Naalya",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Naalya",
      "district": "Wakiso",
      "price": 2200000000
    },
    "patch": {}
  },
  {
    "id": "2ffcedfc-4c5f-4798-aa43-74bdc48cbbd2",
    "action": "unpublish",
    "kept_id": "33517389-9a12-41cd-82dc-95cd600c476a",
    "flag": null,
    "evidence": "27 decimals Kira Mulawa",
    "expect": {
      "title": "Land for sale in Kira-Mulawa",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kira-Mulawa",
      "district": "Wakiso",
      "price": 270000000
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
    "id": "a63c4ca6-ebf3-4203-8ca7-ddb6525f9bd2",
    "action": "unpublish",
    "kept_id": "9347ff9c-4409-49ab-871a-b029989c163a",
    "flag": null,
    "evidence": "Namugongo Sonde",
    "expect": {
      "title": "Land for sale in Namugongo",
      "listing_type": "land",
      "price_period": "plot",
      "area": "Namugongo",
      "district": "Wakiso",
      "price": 75000000
    },
    "patch": {}
  },
  {
    "id": "d3750ae4-8295-420d-b149-7506c71d46a3",
    "action": "unpublish",
    "kept_id": "a4f03d01-a05e-4131-afd6-9b312218bb12",
    "flag": null,
    "evidence": "12 decimals plot Kyanja",
    "expect": {
      "title": "Land for sale in Kyanja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kyanja",
      "district": "Kampala",
      "price": 230000000
    },
    "patch": {}
  },
  {
    "id": "29b7270b-fadf-4438-9031-29296a2430da",
    "action": "unpublish",
    "kept_id": "81607d0b-02d5-4280-a35e-454bffdc025f",
    "flag": null,
    "evidence": "15 decimals Kira ideal for apartments",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 150000000
    },
    "patch": {}
  },
  {
    "id": "e5090ae2-e30a-4dcc-bc34-7e55af84a2fb",
    "action": "unpublish",
    "kept_id": "6b778c5c-1dfc-4d87-a0bd-fb19cddbc5b3",
    "flag": null,
    "evidence": "50 acres Nakawuka",
    "expect": {
      "title": "Land for sale in Nakawuka",
      "listing_type": "land",
      "price_period": "acre",
      "area": "Nakawuka",
      "district": "Wakiso",
      "price": 110000000
    },
    "patch": {}
  },
  {
    "id": "54090374-ad9a-44d1-92d7-6d5f639b8392",
    "action": "unpublish",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "flag": "Shorter caption than the kept Kisingiri hill road copy, but the same 65 decimals at USD 650,000.",
    "evidence": "65 decimals",
    "expect": {
      "title": "Land for sale in Mengo",
      "listing_type": "land",
      "price_period": "once",
      "area": "Mengo",
      "district": "Kampala",
      "price": 2470000000
    },
    "patch": {}
  },
  {
    "id": "e6832dca-3d6b-4805-a31c-5832d7e79a90",
    "action": "unpublish",
    "kept_id": "c3c94a60-f3d4-4d10-8fb8-9b50d5c61cd0",
    "flag": null,
    "evidence": "Kira Shimoni 50 by 100",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kira",
      "district": "Wakiso",
      "price": 105000000
    },
    "patch": {}
  },
  {
    "id": "be596c36-d9ef-4127-bf52-6a7b05829a9c",
    "action": "unpublish",
    "kept_id": "a4f03d01-a05e-4131-afd6-9b312218bb12",
    "flag": null,
    "evidence": "12 decimals",
    "expect": {
      "title": "Land for sale in Kyanja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kyanja",
      "district": "Kampala",
      "price": 230000000
    },
    "patch": {}
  },
  {
    "id": "8c28abbd-42bb-4af7-a5a1-6a3142691337",
    "action": "unpublish",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "flag": "Caption says Mengo Hill rather than Kisingiri hill road. Same 65 decimals at USD 650,000, so it is treated as the same parcel.",
    "evidence": "65 decimals",
    "expect": {
      "title": "Land for sale in Mengo",
      "listing_type": "land",
      "price_period": "once",
      "area": "Mengo",
      "district": "Kampala",
      "price": 2470000000
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
    "id": "797fa062-d50d-4cd2-951c-11021438919a",
    "action": "unpublish",
    "kept_id": "febb7e47-dfa1-47a7-bb94-b6037d0dd931",
    "flag": null,
    "evidence": "34 decimals plot NAGURU",
    "expect": {
      "title": "Land for sale in Naguru",
      "listing_type": "land",
      "price_period": "once",
      "area": "Naguru",
      "district": "Kampala",
      "price": 1600000000
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
    "id": "f06aa4c9-4497-40bd-9690-4ff06123e660",
    "action": "unpublish",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "flag": null,
    "evidence": "65 decimals",
    "expect": {
      "title": "Land for sale in Mengo",
      "listing_type": "land",
      "price_period": "once",
      "area": "Mengo",
      "district": "Kampala",
      "price": 2470000000
    },
    "patch": {}
  },
  {
    "id": "484ddf79-7ea0-47a6-b32c-7207b8ada2cb",
    "action": "unpublish",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "flag": null,
    "evidence": "65 decimals",
    "expect": {
      "title": "Land for sale in Mengo",
      "listing_type": "land",
      "price_period": "once",
      "area": "Mengo",
      "district": "Kampala",
      "price": 2470000000
    },
    "patch": {}
  },
  {
    "id": "97b9ed7d-01a1-41bc-ae7e-8624111199e2",
    "action": "unpublish",
    "kept_id": "5a265b07-987a-4858-aff6-c6f81d63cfa4",
    "flag": null,
    "evidence": "13 decimals",
    "expect": {
      "title": "Land for sale in Kyaliwajjala",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kyaliwajjala",
      "district": "Wakiso",
      "price": 180000000
    },
    "patch": {}
  },
  {
    "id": "62e2050c-979c-4a2a-8b98-f148fdb61f51",
    "action": "unpublish",
    "kept_id": "c31a706f-9549-482d-bba4-6bea2c7128ce",
    "flag": null,
    "evidence": "12 decimals",
    "expect": {
      "title": "Land for sale in Buwaate",
      "listing_type": "land",
      "price_period": "once",
      "area": "Buwaate",
      "district": "Wakiso",
      "price": 95000000
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
    "id": "cbb0307b-2b82-4553-ab7e-65ab9d3d64fb",
    "action": "unpublish",
    "kept_id": "f1912049-31a0-4f95-92bf-071653dddb39",
    "flag": null,
    "evidence": "20 acres kayunga kitwe",
    "expect": {
      "title": "Land for sale in Kitwe",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kitwe",
      "district": "Kayunga",
      "price": 8500000
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
    "id": "2a7e026a-4584-487f-b925-9f498dd4618a",
    "action": "unpublish",
    "kept_id": "33b090bb-d4d0-49ca-8c55-3cee4c2c8a8f",
    "flag": null,
    "evidence": "28 decimals",
    "expect": {
      "title": "Land for sale in Kyanja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kyanja",
      "district": "Kampala",
      "price": 320000000
    },
    "patch": {}
  },
  {
    "id": "afeabc62-c609-4c81-9494-ae30f037af19",
    "action": "unpublish",
    "kept_id": "8e268168-b3b5-411a-9311-efbdc392fdfc",
    "flag": "Same Canvon Lodges caption posted by the Quick auctioneers account. The Quickway copy is kept because it has 12 photos. The two accounts are not merged.",
    "evidence": "Canvon Lodges in Kisoro",
    "expect": {
      "title": "Land for sale in Park",
      "listing_type": "land",
      "price_period": "once",
      "area": "Park",
      "district": "Ntungamo",
      "price": 500000000
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
    "id": "8870b5bc-529e-499e-97b2-fe501a47f5a3",
    "action": "unpublish",
    "kept_id": "55dbe736-6d19-4048-82c6-31ba499e1883",
    "flag": "Same Kitende 12-decimal plot at UGX 65 million. The later copy has 4 photos against 3, so it is kept.",
    "evidence": "12 decimals",
    "expect": {
      "title": "Land for sale in Kitende",
      "listing_type": "land",
      "price_period": "once",
      "area": "Kitende",
      "district": "Wakiso",
      "price": 65000000
    },
    "patch": {}
  },
  {
    "id": "a46791fb-1a8d-49bc-a618-8f2849594977",
    "action": "unpublish",
    "kept_id": "57ce2518-e72f-47f3-b141-0b17ea5bb8d2",
    "flag": "Same one-acre lake-view plot at Sissa Ngogolo. The copy with 6 photos is kept and this 2-photo copy is unpublished.",
    "evidence": "SISSA NGOGOLO",
    "expect": {
      "title": "Land for sale in Nakawuka",
      "listing_type": "land",
      "price_period": "once",
      "area": "Nakawuka",
      "district": "Wakiso",
      "price": 190000000
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
    "id": "0d36b15c-c22e-4e54-a2f6-59bd71faee4c",
    "action": "unpublish",
    "kept_id": "6baf0035-d2cd-4c97-9925-ba7765f2e382",
    "flag": "Same Nakwero 50-by-100 plot at UGX 72 million. The copy with a photo is kept.",
    "evidence": "50 by 100",
    "expect": {
      "title": "Land for sale in Nakwero",
      "listing_type": "land",
      "price_period": "once",
      "area": "Nakwero",
      "district": "Wakiso",
      "price": 72000000
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
    "id": "93aae4c0-a705-43e2-9032-63cd4b6d513a",
    "action": "unpublish",
    "kept_id": "e91eadcb-e927-47a1-9825-49882a8abf5c",
    "flag": "Same 15-decimal Naalya plot. The copy with 5 photos is kept.",
    "evidence": "15 decimals",
    "expect": {
      "title": "Land for sale in Naalya",
      "listing_type": "land",
      "price_period": "once",
      "area": "Naalya",
      "district": "Wakiso",
      "price": 230000000
    },
    "patch": {}
  },
  {
    "id": "6a230e07-3bc6-4afa-88e0-5e4e8f9e3d97",
    "action": "unpublish",
    "kept_id": "38a8f8f2-80f1-4929-9311-fcb70df13472",
    "flag": "Same two 50-by-100 Nakwero plots at UGX 55 million each. The copy with a photo is kept.",
    "evidence": "2 Plots",
    "expect": {
      "title": "Land for sale in Nakwero",
      "listing_type": "land",
      "price_period": "plot",
      "area": "Nakwero",
      "district": "Wakiso",
      "price": 55000000
    },
    "patch": {}
  },
  {
    "id": "7031c11d-a2c3-4a05-95af-6c833c1446c7",
    "action": "unpublish",
    "kept_id": "153e752f-6440-4674-8a91-d3b278706dcd",
    "flag": "Same five-square-mile Kafu parcel. The copy with 5 photos is kept.",
    "evidence": "Five square miles",
    "expect": {
      "title": "Land for sale in Kafu",
      "listing_type": "land",
      "price_period": "acre",
      "area": "Kafu",
      "district": "Masindi",
      "price": 12000000
    },
    "patch": {}
  },
  {
    "id": "6655cf6f-a918-4b5e-bd21-ef979c06a4e0",
    "action": "unpublish",
    "kept_id": "1938ad2b-7a81-4bd2-bc7f-e4359b1bf222",
    "flag": "Same Nakasajja plot by Orevine school at UGX 45 million. 50 by 100 feet is about 11 decimals, so the sizes describe one plot. The 3-photo copy is kept.",
    "evidence": "Orevine international school",
    "expect": {
      "title": "Land for sale in Nakasajja",
      "listing_type": "land",
      "price_period": "once",
      "area": "Nakasajja",
      "district": "Wakiso",
      "price": 45000000
    },
    "patch": {}
  },
  {
    "id": "943d3558-269a-4434-8ab5-0a7bbac46a2c",
    "action": "unpublish",
    "kept_id": "dc719955-16a3-4a43-9d92-d7e1c0a90982",
    "flag": "Same lodge. Section 3 said to keep this earlier copy. The later copy has 16 photos against 12 and is kept and relabelled.",
    "evidence": "QUEEN ELIZABETH SAFARI LODGE",
    "expect": {
      "title": "Land for sale in Transformer",
      "listing_type": "sale",
      "price_period": "once",
      "area": "Transformer",
      "district": "Nakaseke",
      "price": 1600000000
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
    "id": "69c7ccb6-15be-4c48-baca-e7566753181f",
    "action": "skip",
    "kept_id": "341aa7ef-7c20-4ba7-8d56-840c761796cb",
    "flag": "Both are UGX 35 million on Nakawuka-Natete road, but only one caption gives a 50-by-100 size. They are not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Land for sale in Nakawuka",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "c7d509e6-3afe-42d8-8a5c-ac2125621547",
    "action": "skip",
    "kept_id": "2caf044a-93bb-4fbf-b6e2-15e2a4a220d2",
    "flag": "One is a 50-by-100 plot in Kiwologoma and the other is 14 decimals in Kitukutwe. Same price, different land. Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "6fbc7f7a-d0ac-45b9-969d-21c9fbc6c0c4",
    "action": "skip",
    "kept_id": "c33f3880-45b3-4a2d-8700-5b89666216ab",
    "flag": "One is 7 double units on 16 decimals and the other is 29 decimals on Mamerito road. Not the same property.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "e203cce2-765a-4545-ab9f-9ab1af20780a",
    "action": "skip",
    "kept_id": "67917abe-136a-4f17-8150-3c7a574254d2",
    "flag": "One is 30 decimals in Kiwologoma and the other is 27 decimals in Kira. Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Land for sale in Kira",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "d9c448bd-38ce-45d1-b603-d2ca72e2d7fb",
    "action": "skip",
    "kept_id": "f7bd5710-b5d8-4c29-b769-38cf6ac72184",
    "flag": "One is a 12-unit block earning UGX 9.6 million and the other is 8 units earning UGX 8 million. Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Property for sale in Najjera",
      "listing_type": "sale"
    },
    "patch": {}
  },
  {
    "id": "dd86a861-ab34-4b70-8389-b805e3f0e8d0",
    "action": "skip",
    "kept_id": "af8da83b-6544-42ce-a29f-82c7c79e7252",
    "flag": "One is Namugongo Sonde and the other is Nsawo community estate. Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Land for sale in Namugongo",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "b02573a2-865a-4fb6-8453-e0b89c540d58",
    "action": "skip",
    "kept_id": "92ffad95-1877-4933-b4d1-265de1802898",
    "flag": "Income and plot size differ (UGX 8 million on 33 decimals versus UGX 7.2 million on 30 decimals). Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Apartments for sale in Kyaliwajjala",
      "listing_type": "sale"
    },
    "patch": {}
  },
  {
    "id": "ca3dc782-7c1d-443f-95a0-b4980e5be06d",
    "action": "skip",
    "kept_id": "6a230e07-3bc6-4afa-88e0-5e4e8f9e3d97",
    "flag": "This is one 50-by-100 plot at UGX 55 million once. The other listing is two plots at UGX 55 million each. Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "Land for sale in Nakwero",
      "listing_type": "land"
    },
    "patch": {}
  },
  {
    "id": "d78f6edb-db14-4e1c-ab06-ffe87a29b356",
    "action": "skip",
    "kept_id": "c7cca0e9-d3df-4bdb-9399-236d489ccc18",
    "flag": "Caption says only Kira, not Kitukutwe, so it is not treated as the same 4-bedroom house. Not unpublished.",
    "evidence": "",
    "note": "no change",
    "expect": {
      "title": "4-Bed property for sale in Kira",
      "listing_type": "sale"
    },
    "patch": {}
  }
]
$listing_corrections$::jsonb) AS value
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
    AND p.status = 'approved'
    AND p.title = s.expect->>'title'
    AND p.listing_type = s.expect->>'listing_type'
    AND COALESCE(p.price_period, '') = COALESCE(s.expect->>'price_period', '')
    AND COALESCE(p.area, '') = COALESCE(s.expect->>'area', '')
    AND COALESCE(p.district, '') = COALESCE(s.expect->>'district', '')
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
  INSERT INTO listing_correction_169_backup (property_id, action, kept_property_id, flag, before_row)
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
        'location_resolution_status', 'listing_correction_169',
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
      'listing_correction_169', jsonb_strip_nulls(jsonb_build_object(
        'action', e.action,
        'kept_property_id', e.kept_id,
        'flag', e.flag,
        'applied_at', NOW()
      ))
    ),
  updated_at = NOW()
FROM eligible e
WHERE p.id = e.id;
