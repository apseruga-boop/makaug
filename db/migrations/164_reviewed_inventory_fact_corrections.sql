-- Reviewed correction of 341 existing public Uganda listing records.
-- Source captions, media, location, moderation and contact fields are preserved.
-- Exact old facts, copy hashes, complete extra metadata hash and timestamps
-- prevent stale source evidence from overwriting intervening staff edits.
-- Each changed row retains its prior fields/metadata for guarded rollback.
-- USD guide conversions preserve source currency and use the published
-- approximate application display rate dated 2026-10-01, not a new market quote.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';
SET LOCAL TIME ZONE 'UTC';

WITH repairs AS (
  SELECT value AS spec FROM jsonb_array_elements($reviewed_inventory$
[
  {
    "id": "001c0063-b61a-427a-86fb-93d4cfd2b6d2",
    "expected": {
      "area": "Bukoto",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "755b890a9bf4cb4a8938e05171991fd8",
      "district": "Kampala",
      "extra_md5": "df882be5c415eab86e1d8c64fbc72ac2",
      "listing_type": "sale",
      "price": "3300000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "30000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7081632e7da603580feddfb61bf7fb28",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 3300000000
    },
    "extraPatch": {
      "price_original": 3300000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e6e00b08a8c33b206dfe41b17955df074a83967e8e1ff5803349667be903a9ca"
      }
    ]
  },
  {
    "id": "00ba9ef6-ab34-4f15-ab90-14de52a46eed",
    "expected": {
      "area": "Luwero",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "e7a38f4e2b813ab13ead060c21caea0f",
      "district": "Luwero",
      "extra_md5": "3033befba23d73efa76c6619c7e57959",
      "listing_type": "land",
      "price": "9000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "9000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "aea8ec1e5ba20e7925751400888b591c",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ceacee48b1eaf25e687fd988021b7ec0416ffd1a7b32a3c4364e6ccde0da1808"
      }
    ]
  },
  {
    "id": "0194b26b-b101-4d1a-8ad2-9b7db965a371",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "1805179e0e43ef31b94f0e3b779c65b5",
      "district": "Wakiso",
      "extra_md5": "9bbe248935df89d8fd928a296c49e4bb",
      "listing_type": "land",
      "price": "120000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "120000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Namugongo, Wakiso, listed at UGX 120,000,000/plot. 50 by 100 plots Namugongo near protestant shrine each UGX 120 million. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "762deb089e58b483ffc8765f3fe25dce7828f83b855f062b3afbe96a3e77a63a"
      }
    ]
  },
  {
    "id": "02292ccb-287e-419a-9c71-62e7d091463d",
    "expected": {
      "area": "Bweyogerere",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "b316e7f32d74272a183cba7d64e29281",
      "district": "Wakiso",
      "extra_md5": "df9b985f78c15c79d7a534516bd5afdd",
      "listing_type": "land",
      "price": "820000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "820000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d017d1513d5ea134c5465fd8de30add7",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5480f6ab024209524f3b4a1c96f0f5dbbabed8f7f301e7581e4fedd3dd99f3da"
      }
    ]
  },
  {
    "id": "02a2ff24-a3d1-4e0f-af6e-3f679f2dab26",
    "expected": {
      "area": "Katabi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "7aadfdfdeeff8d8906f88031f95587c3",
      "district": "Wakiso",
      "extra_md5": "9724b29961c2cd7995f840fd1179ebf9",
      "listing_type": "land",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "dcfffa1812043428a328eb3797d6c8c0",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a3311b93d8872a7a2e51fdf90b212fef682708211c2c937c3ee1c8ac99a317a3"
      }
    ]
  },
  {
    "id": "03f0f172-43aa-4c27-a715-37bc8d68f1f3",
    "expected": {
      "area": "Ntungamo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "3ee50fecadd3c42f14a97c15a17c5d55",
      "district": "Ntungamo",
      "extra_md5": "4784d29d163e95154cba8b0b23dfafde",
      "listing_type": "land",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ee7f3541e43f0ffeba3b258b82ae2e89",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0ae8e3e54c10eeb21a4c6ac132d208351b20ad642f6910327a131c39cf2bd1e1"
      }
    ]
  },
  {
    "id": "0430e2b8-14cd-45d8-9899-33e8ebca6b63",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e05051aea00efc496866ca9583673176",
      "district": "Kampala",
      "extra_md5": "b5eabc7b6afdac0bf82ff0ba1aec7b5a",
      "listing_type": "sale",
      "price": "30000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "30000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "eb141e6324410dbfb520fa6e0d079391",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 3300000000,
      "price_original": 3300000000
    },
    "extraPatch": {
      "price_original": 3300000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f0955bb7aaf6e2f6940c90f519781ad64a41ce01e984f66727a5c37d2b1e7339"
      }
    ]
  },
  {
    "id": "045f194c-4f7f-4436-bbcf-42db11871135",
    "expected": {
      "area": "Namayumba",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "48f919dab6d338880d1a4bc61d56fbfe",
      "district": "Wakiso",
      "extra_md5": "b79f79b29b1fbe9c4cdb9b741f3f382e",
      "listing_type": "land",
      "price": "15000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "15000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fb478ae1a39a5a10e30abce53bfd3be2",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House and plot"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "7c893e9826f9ba4f65f99442edb43dfe50d82c52747b9fe510c97b564d7493b2"
      }
    ]
  },
  {
    "id": "05c1ea8b-8fcb-4dae-8518-a5147369ddf9",
    "expected": {
      "area": "Naguru",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "562de027c1f9a2d74445cfcd94e5bc62",
      "district": "Kampala",
      "extra_md5": "f4112d393b640fd45b326be8d2888039",
      "listing_type": "sale",
      "price": "2345730722",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2345730722",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "445fcbc63e03829d3658553ad3ca10e6",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 2276200000,
      "price_original": 599000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800
    },
    "extraPatch": {
      "price_original": 599000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6bdeb251de8df57f0b0887801995a4b2518050e2a09cdc78f32bc6e2653b35a2"
      }
    ]
  },
  {
    "id": "072dba89-f7f9-48e6-b6f6-b8aefbfb4370",
    "expected": {
      "area": "Kitende",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "faf096ae95aed20431d5c2b355f29402",
      "district": "Wakiso",
      "extra_md5": "94747c5c016b0436a357b51e5aaf6311",
      "listing_type": "land",
      "price": "65000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "65000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "69fb065498808e5c27958b92260e20a6",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "bf3abe0a687e5a900d8fc4c5d2f95ea19337d70eda42526f830ff74aec83f1c2"
      }
    ]
  },
  {
    "id": "07aef2ff-cbd2-4c93-a7aa-eebbd2ecd63b",
    "expected": {
      "area": "Kira",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "2b7a5d6bb48ec2f92eedb9d63713b65c",
      "district": "Wakiso",
      "extra_md5": "8de1734abbb9acd4139fa3b05fef519e",
      "listing_type": "sale",
      "price": "240000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2100000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "075226afb8e1d8e3801831db7467c711",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 240000000
    },
    "extraPatch": {
      "price_original": 240000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "df7dd09c2ded847c663fa5396013ecf5b3388b8e01eb8a063dca090cac2713f6"
      }
    ]
  },
  {
    "id": "07d77ca1-1a6d-4fc3-a0e3-5abba9290bd4",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "e11b923346e44180389af681638bdc8c",
      "district": "Wakiso",
      "extra_md5": "cef75acc221b2c252370494ac8b6b61f",
      "listing_type": "sale",
      "price": "1100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1100000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d7061b090b88f31d38f74e6605cc2237",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block",
      "title": "Apartment block for sale in Naalya",
      "description": "Apartment block for sale in Naalya, Wakiso, listed at UGX 1,100,000,000. NALYA 4 RENTAL UNITS APARTMENT BLOCK OF 3 BEDROOMS EACH MAKING 10MILLION MONTHLY SELLING UGX 1.1BILLION Wakiso. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "83d7b06857d9cffd7d0411b23332358cb44eb6b6faf1e1d7624b3ad7a52ce614"
      }
    ]
  },
  {
    "id": "0968358f-0d78-4f56-bbe2-40430656f8c9",
    "expected": {
      "area": "Nkoma",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "4dabf14f860ed9566b4715cc4804be3c",
      "district": "Mbale",
      "extra_md5": "e88e4a98a2b07ea9a7c21d9162f3d85d",
      "listing_type": "land",
      "price": "18000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "18000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "98b2d67c550c732c5cd863495bb96973",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2d40b74120f41066a9212a65082e5fe237d06ca84fe274269717f853ddd8e4f6"
      }
    ]
  },
  {
    "id": "09791beb-5966-49b5-953f-2081b7ebd159",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "46a1269e7d5dcbfea94df19a44bca4cb",
      "district": "Kampala",
      "extra_md5": "9f81a03d5b5eb163e43ae3d3f6299a99",
      "listing_type": "rent",
      "price": "54000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "54000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "776af9c14bc706acbbd41d10c6948df7",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "transaction_type": "sale",
      "price_period": "once",
      "price": 5500000000,
      "price_original": 5500000000,
      "description": "Property for sale in Kyanja, Kampala, listed at UGX 5,500,000,000. APARTMENT FOR SALE – KYANJA Prime apartment investment opportunity in Kyanja Sitting on 40 decimals Monthly rental income: UGX 54M Asking price: UGX 5.5 Billion Price negotiable. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 5500000000,
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions",
      "prices"
    ],
    "reasons": [
      "Explicit apartment asset sale. UGX 54 million is monthly income; the asking price is UGX 5.5 billion.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ddc133ef1f97687c97246e807a4a53617e94122fc3c6a8e81b9647994c1ad176"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "ddc133ef1f97687c97246e807a4a53617e94122fc3c6a8e81b9647994c1ad176"
      }
    ]
  },
  {
    "id": "0a335cb5-207b-483e-a532-fb7555879908",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a10c1d06bb358a8fb6d7eb1e18abd0eb",
      "district": "Wakiso",
      "extra_md5": "bcf9e01efae5501046e142ee1cad2c0e",
      "listing_type": "land",
      "price": "25000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "25000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "92576ee5a4c3ee55a02bc420ae5ae0fd",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e07a1d99e979ee825590a2c5b893122c46e87ff3e503f910d7ba039b07edbdfd"
      }
    ]
  },
  {
    "id": "0d660dbe-e17e-43b1-b7c4-e21305f9b8d1",
    "expected": {
      "area": "Kitende",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "6dfae4bd40eb5a6ab9e5d4f5413b28a3",
      "district": "Wakiso",
      "extra_md5": "8e3427aa7370c1daaf2187ed3125820c",
      "listing_type": "land",
      "price": "350000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "332a91546ebcf92aad8ad47c482eefbf",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "bdb644269ee8c00639a98511a33331b550cf3ac53e704d94b03c47bc6a9d7abe"
      }
    ]
  },
  {
    "id": "0df40bd8-98df-48ca-8855-a4b8cf186ef7",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "67e61f5d3281672d3cd3d27acd5d3484",
      "district": "Wakiso",
      "extra_md5": "6590f492d80fc15ec8db9abc924d0c70",
      "listing_type": "sale",
      "price": "330000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "330000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "House",
      "title": "House for sale in Kira"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land, while raw source explicitly identifies an existing house/bungalow. Canonical sale category and price remain unchanged."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "ff88dbc30bcab38daba7152fb2c8da6e4c7db581be181381fe416b3738e020b6"
      }
    ]
  },
  {
    "id": "0ed81042-8b80-4ee9-a87a-74856e3b1bce",
    "expected": {
      "area": "Kyanja",
      "bathrooms": "0",
      "bedrooms": "2",
      "description_md5": "c7842153a827cb76f75712d8ea2511c6",
      "district": "Kampala",
      "extra_md5": "147b3801c1986646717127aa3d649f40",
      "listing_type": "sale",
      "price": "3800000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-08-05 06:12:08.359+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "1000000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3741df30b6741b6d03a1883ee5461149",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a4d398582f1a6f55f1875e978253994a15e29d8fcabeb6240794f96889ad3b80"
      }
    ]
  },
  {
    "id": "0f5b5fdb-4791-4ccf-92eb-d93067223ce5",
    "expected": {
      "area": "Kikyusa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "81d56483bab047a129ef63f1a503ae34",
      "district": "Nakaseke",
      "extra_md5": "49fc2d785c0d7fdee341472620a32175",
      "listing_type": "land",
      "price": "13000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "13000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a959468abc3cfae3c6e7d7153c99d345",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Kikyusa, Nakaseke, listed at UGX 13,000,000/acre. 🔥 *Most Affordable land in Kikyusa 50 ACRES OF MAILO LAND FOR SALE! 🔥* 📍 Kayonza, Kikyuusa – Luweero District 📜 Titled Mailo land 📏 Selling from 10 acres 💰 UGX 13M per acre ✅ 🌿 Ideal for farming, settlement & real estate development, investment and more 📞 Serious buyers only — contact us for viewing. Watch the attached video tour before enquiring. Contact Tuyisengye Innocent to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8ed03903182197c91207610da8f49abd6248b6deab045af45761879406d18d7f"
      }
    ]
  },
  {
    "id": "0f7551db-329d-48c2-9940-53c8d6127d3a",
    "expected": {
      "area": "Lubowa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "dc2892bbda584436b45fb8d8e9c8ba18",
      "district": "Wakiso",
      "extra_md5": "6a91648c743729adcac638b21277c1e3",
      "listing_type": "sale",
      "price": "699000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "699000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d7ef0ecc8ebaa3fd6bec7e3d8ebe4e1f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fac2c7d5859eecd6df65bb66b8bce7f2ccfb86c908598e967da640c66b0cedb0"
      }
    ]
  },
  {
    "id": "1060fd8e-fec9-467f-9ed7-f852fa209fdf",
    "expected": {
      "area": "Kira",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "bdbac75449dea292d6d22f07146d6777",
      "district": "Wakiso",
      "extra_md5": "8bccb88cffb265ec070be658e55c298d",
      "listing_type": "sale",
      "price": "1368000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "360000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1e0f83fda0af846fb0bc226bfff64663",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800
    },
    "extraPatch": {
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6cda8f4181bd4580007469bafce42b0621611963c85a7960b2258332c61de18f"
      }
    ]
  },
  {
    "id": "11a41981-ed56-4809-8dfe-0efd8e8ca79b",
    "expected": {
      "area": "Bujjuko",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "e30e3098e663533fbe94688589ec596f",
      "district": "Wakiso",
      "extra_md5": "1e683f0387b2b6f92de22c247f30cb70",
      "listing_type": "sale",
      "price": "370000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "370000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "098a75f022b812eafae7e42a7bda046b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 165000000,
      "price_original": 165000000
    },
    "extraPatch": {
      "price_original": 165000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "271d19b9af70bccbd8b20eb5686fba1537e936f08f81bc7a9bd343fb7c66cb97"
      }
    ]
  },
  {
    "id": "1358393d-e961-4818-9351-e7eed0d88e8b",
    "expected": {
      "area": "Bwebajja",
      "bathrooms": null,
      "bedrooms": "6",
      "description_md5": "1b09f1133abcec1959a71cc63cca83ff",
      "district": "Wakiso",
      "extra_md5": "e1162d87acd5d4e7c92e53867187f61c",
      "listing_type": "sale",
      "price": "600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c78d78feb8b0a1105f7ff4d04e98e355",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 2280000000,
      "price_original": 600000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "description": "6-bedroom property for sale in Bwebajja, Wakiso, listed at USD 600,000. Selling, alright-bwebajja, 6 bedrooms, 25 decimals @$600k negotiable. Watch the attached video tour before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 600000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b304da9f00dd29c1b87cbcb10f0d140859aa84fd9b09b89bd223c8ac18703fa7"
      }
    ]
  },
  {
    "id": "13690cc8-e91a-4ee3-bc1b-d343aa90be24",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "bcc05d8d72dd90c6f170c6e388166e83",
      "district": "Wakiso",
      "extra_md5": "2f1f448e8dc8d808f5f79220d795a4e9",
      "listing_type": "land",
      "price": "90000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5d29dbdc6963e4c7fb96481cbd3b9456",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "4f3ff4e438ecc4336e41befd83f70914edd1f3007bc7946057dc8cc9e50fc851"
      }
    ]
  },
  {
    "id": "1437befb-895e-4d30-b8d9-9776c21a6b8e",
    "expected": {
      "area": "Mutungo",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "6347efe0fc987a4bd54956451b4492bb",
      "district": "Kampala",
      "extra_md5": "ae513ef32c6c9894766623810071a438",
      "listing_type": "rent",
      "price": "180000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "180000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "5179e0450a92d5a2f9d44e5656cea1fd",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "night"
    },
    "extraPatch": {
      "price_period": "night",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes a nightly/daily amount; monthly suffix is wrong."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b9d66ec39c810d6c3848dc601537bf38c06b7d4c545e89fd6547b1680ed19da5"
      }
    ]
  },
  {
    "id": "14583339-5f2c-492d-929d-655ab56f9930",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "f22e1f98f18b6d43b57a323bdc09bfa7",
      "district": "Wakiso",
      "extra_md5": "41996a1d4bd59a26664948973619a68e",
      "listing_type": "sale",
      "price": "1200000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "082cf4517fae753a81286f733a0905f2",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Rental units",
      "price": 120000000,
      "price_original": 120000000
    },
    "extraPatch": {
      "price_original": 120000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "947ba470380ec602c858a41c1cdb9f34b39d4710175575ca5d469f2d5b725c49"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "947ba470380ec602c858a41c1cdb9f34b39d4710175575ca5d469f2d5b725c49"
      }
    ]
  },
  {
    "id": "14920628-0f69-4f33-9919-294ba09e47f1",
    "expected": {
      "area": "Mpigi",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "1e07ad981472cbf7b5817a7195e8651e",
      "district": "Mpigi",
      "extra_md5": "496f4593c32abbf6f6cc19b2a77218a8",
      "listing_type": "land",
      "price": "25000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "25000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "eaa0944c531c5e48010767d5ed8a5596",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6629e2b16a5df6410ae4bf70a81c7350f69671209157b2b9a3f77248d8bc7dd4"
      }
    ]
  },
  {
    "id": "1498f041-acd5-453e-b65d-ca87ce013f7e",
    "expected": {
      "area": "Kajjansi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "84994bf0ae9da98605d2c3530fe5d1dd",
      "district": "Wakiso",
      "extra_md5": "4b6118772a966fd89335acbe6510ade4",
      "listing_type": "rent",
      "price": "2500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2500000",
      "price_original_currency": "UGX",
      "price_period": "month",
      "property_type": null,
      "status": "approved",
      "title_md5": "195638866d5e95d368da70d754a5d5db",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "transaction_type": "sale",
      "price_period": "once",
      "price": 250000000,
      "price_original": 250000000
    },
    "extraPatch": {
      "price_original": 250000000,
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions",
      "prices"
    ],
    "reasons": [
      "Three-unit Kajjansi investment is offered to buyers for UGX 250 million. UGX 2.4 million is monthly income; stored UGX 2.5 million matches neither.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "15ed9651752df1be6ea674ae3017bf821bafcd9ee29cc863209537ab144146d7"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "15ed9651752df1be6ea674ae3017bf821bafcd9ee29cc863209537ab144146d7"
      }
    ]
  },
  {
    "id": "153e752f-6440-4674-8a91-d3b278706dcd",
    "expected": {
      "area": "Kafu",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a64ef0a7401153ad66ed8f4a213cf3b0",
      "district": "Masindi",
      "extra_md5": "45d90ffece359f55c05bc71f2e237153",
      "listing_type": "land",
      "price": "12000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b8563b169537b7b08dcb21eb30c6c541",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Kafu, Masindi, listed at UGX 12,000,000/acre. 5 Square miles of Good land For Sale, Location; Masindi - Kaffu Near Tarmac. The land Starts from tarmac. This land is Virgin and fertile Suitable for any agricultural investment. Best Use; Factory Set Up , Farming , Sugar Cane Plantation. e.t.c Freehold land title on table. Squartter free Asking Price; 12m Ugx Per Acre Slightly Negotiable. Watch the attached video tour and browse 4 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2512580c6a9c2efb3a885888c16a4e8ac42ae47d9ad4c8b8839679164a2878ae"
      }
    ]
  },
  {
    "id": "157a2ea3-47c0-4886-90dd-0e8b4b311367",
    "expected": {
      "area": "Mbalwa",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "619d2e3c85e9214056ed20d7acf65094",
      "district": "Wakiso",
      "extra_md5": "78645fac9ab16f153dede5e8a6c53618",
      "listing_type": "sale",
      "price": "2200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "90c9899f1f4ac693e25f7447c2a0e67e",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Mbalwa"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "ff74bacd1454c892b561f534d5f4494f99336df3e382d647cba66927d04c82ef"
      }
    ]
  },
  {
    "id": "164f8d4d-aa3d-4360-9237-0a46f4cdae14",
    "expected": {
      "area": "Garuga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "ed37cb1f769e4c853efcc49fd1ee5e55",
      "district": "Wakiso",
      "extra_md5": "1c86b4c0fcbe8d9f403edc011c660bf1",
      "listing_type": "land",
      "price": "85000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "85000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fc62816d36ba74c66db3b866124c16aa",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0d9827c0e8cefbaf3863d43e73603df1221e9d52ff53c4b8c710a58e51f7112f"
      }
    ]
  },
  {
    "id": "168655a5-4e71-464a-9d96-50fe6f95750a",
    "expected": {
      "area": "Seguku",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "9932d9bcf7d45cc34a315d1a29d2e797",
      "district": "Wakiso",
      "extra_md5": "af5a9bc2556e9a493b3833e1ccd6def9",
      "listing_type": "sale",
      "price": "750000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "750000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b6a369aeaa6b1c8c8e838b9054122f67",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Seguku"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3724412d7f18fc8ba21e3ce0417898d0f5db13902e9f6b499189550783c9811a"
      }
    ]
  },
  {
    "id": "179970ec-fab4-4328-89ee-93158c056f52",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "1896ffd2a0a9c28f6bbe3e0f597e97f0",
      "district": "Kampala",
      "extra_md5": "8644bebf595a3c566bafb64793750f0d",
      "listing_type": "sale",
      "price": "1200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "84cf4d18caeb0bf62c3630ff94444dbf",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block",
      "title": "Apartment block for sale in Kyanja",
      "description": "Apartment block for sale in Kyanja, Kampala, listed at UGX 1,200,000,000. Brand new 1 bedroom apartment at 1m per month. 📍Kyanja.. Block has 12 units and it's available for sale at 1.2bn. Watch the attached video tour before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "43322c170fbaec4776496b53d41ef139f1434181329f1e657af38bf98954dfb0"
      }
    ]
  },
  {
    "id": "17bc1766-1286-40f4-aacf-a892efa22236",
    "expected": {
      "area": "Kayunga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "35cc4a1c72afc035c8f99e62d273ecb0",
      "district": "Kayunga",
      "extra_md5": "70be420a40eef9ce128d33abb2383d8f",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0650815f0092dde53fb5304de7be6f06",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "df65d629d0c916dd5b31e109b68478843d6516b87852fdfa79109765e4838b88"
      }
    ]
  },
  {
    "id": "17cc2818-34e3-480c-b2fe-0553d1b6ef9a",
    "expected": {
      "area": "Gayaza",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "71a1d996be9a4fc00f63d117120c26bb",
      "district": "Wakiso",
      "extra_md5": "4f2284dc53ac4a62ec5d33e79113a2f8",
      "listing_type": "land",
      "price": "65000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "65000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ba2d2da16657e6ed92a693762825402f",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "dc2fe87082a350b9a35d70b27eb121dde166f74e4634c85fcfd799abb79faf8a"
      }
    ]
  },
  {
    "id": "19623c1a-ff1f-4f77-9024-8aed53a51c05",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "0cc4905d1a269b3a87b4383b90e00810",
      "district": "Wakiso",
      "extra_md5": "a88264192507fbe44803cf0d4b06d253",
      "listing_type": "sale",
      "price": "160000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "160000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b3482b59153f17100668265e4aef1c85",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3725d9ff09ad85e9946c3dcb780499270faee15803de66869ba53eb590525dc2"
      }
    ]
  },
  {
    "id": "1b173688-745c-4965-bf9c-269bd94fba7b",
    "expected": {
      "area": "Mbalwa",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "4d67568a0f7571fb2dead98040d120ff",
      "district": "Wakiso",
      "extra_md5": "ddffb655b582f42b6d14d82062fb3e9d",
      "listing_type": "sale",
      "price": "340000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "340000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ffda6719330cc6d6478f5e3edb65dfdf",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Rental units",
      "title": "Rental units for sale in Mbalwa"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3df763c2479464e9ebf98807b6e8933ae411e8ed4c8a69c982578ff0f741bb5e"
      }
    ]
  },
  {
    "id": "1b27d8d8-deb2-4ce5-b32f-f07d19023507",
    "expected": {
      "area": "Katosi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "48d53772680eaab65dc32d9a99673a49",
      "district": "Mukono",
      "extra_md5": "8226a7b0fdeeaaeb216e70678f314f3d",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4340a7c1dfbe00c3fcf3dca2eb1c23d6",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "366cae65b93706de747adfb51ce160b9149f5150eaf217c6b639d49aed7dfc3b"
      }
    ]
  },
  {
    "id": "1bc50907-e083-451e-b992-ece84b03f108",
    "expected": {
      "area": "Mpigi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8476e73c6fe2d7e290e508d4e24d86a4",
      "district": "Mpigi",
      "extra_md5": "504973787fb06b9d9bb71314cc260199",
      "listing_type": "land",
      "price": "120000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "120000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1e766971e349c908716d7d787557d25a",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "3482a0fe26e0941628336439faaa34f8c1e96e564c8348a556658d1423f0e60b"
      }
    ]
  },
  {
    "id": "1c18293f-5483-4846-893b-c6c1daf9b643",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "43e16c8f4c2081d2bb7f45997e1bd032",
      "district": "Wakiso",
      "extra_md5": "dd2ef5d78114cb1cb11c5b225d4b7473",
      "listing_type": "land",
      "price": "370000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "370000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "House for sale in Namugongo"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "ffbceecf4bfa5c4c56d54ab39e1709f97b771e59430f5c1739526fef997fff7f"
      }
    ]
  },
  {
    "id": "1c445bb6-8087-41fa-b63f-121b3f9d32be",
    "expected": {
      "area": "Buziga",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "44d7103609deceec777ea2e7ce9437d8",
      "district": "Kampala",
      "extra_md5": "49e7a12a1a5f9dfbe95b969c9c439ea8",
      "listing_type": "sale",
      "price": "1500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "05a706171cbc0f844a114b913b754cfa",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block and house",
      "title": "Apartment block and house for sale in Buziga",
      "description": "Apartment block and house for sale in Buziga, Kampala, listed at UGX 1,500,000,000. Money urgently needed!! Apartment block for sale in Buziga - kampala Uganda!! * 22 units , each of two bedrooms , + a residential house of 3 bedrooms, sitted on 40 decimals plot size, kabaka land title!! Price is ugx. 1.5bn last. Watch the attached video tour before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "dd2531ef739e4f0d2b4aaee5a93af6819802cdc641ac971328e1de4fb4abf4e7"
      }
    ]
  },
  {
    "id": "1e16b50f-3c09-49a4-8846-3fabc3cf4a6a",
    "expected": {
      "area": "Gulu",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "53a15126b19ecf367ac1ad82016d3039",
      "district": "Gulu",
      "extra_md5": "6aad3c870cefc900a6326fb7bf584d24",
      "listing_type": "land",
      "price": "2000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "76c8b47f4c3632205fc4127b96fea6c8",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ef48b3595a28d46fb9882cc97102e8acb33ebce130dbbddc2eb6ea70a7c76a04"
      }
    ]
  },
  {
    "id": "1fe0fb7d-5594-4fdd-ab23-dcb5e502ef39",
    "expected": {
      "area": "Bunga",
      "bathrooms": null,
      "bedrooms": "7",
      "description_md5": "23c8b68d8cec33263b5e3bf2c1b9beae",
      "district": "Kampala",
      "extra_md5": "364621966a0d2e5521a2d9ab0be6f9c7",
      "listing_type": "sale",
      "price": "2500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae83e837120c83f1abd5c20b60445d08",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 9500000000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "description": "7-bedroom property for sale in Bunga, Kampala, listed at USD 2,500,000. BUNGA KALUNGU 7 BEDROOMS SWIMMING 🏊‍♀️ POOL 35 DECIMALS SELLING 2.5M USD. Watch the attached video tour before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "74193c11a00132d692e0f369cd8696a5651b2c2411c3da82110a62a0b901bbf0"
      }
    ]
  },
  {
    "id": "203b6ce5-0b7f-44ba-bab1-e062bde8d96d",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "16039ee4891b6370c4f4aed03a1a5330",
      "district": "Wakiso",
      "extra_md5": "028c2d0b9b7d68d319f7bbba658d2940",
      "listing_type": "land",
      "price": "300000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "773d598fc58ce4bbad8df3dab3042b83",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a3cb33f00b7411a5c81706dcb1299fd2b46b28f2de0e6112c4ad079853dc8452"
      }
    ]
  },
  {
    "id": "20c8dde5-20cf-4c34-8931-9196dc220459",
    "expected": {
      "area": "Seeta",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "5d26f0092bc6c762f042be4a0e3149af",
      "district": "Mukono",
      "extra_md5": "bd99caf67687bd8b2b3dc49a065d8d7c",
      "listing_type": "sale",
      "price": "60000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "06e707346f12e5d28ff1b270b8b6eb8f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 600000000,
      "price_original": 600000000
    },
    "extraPatch": {
      "price_original": 600000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "44805845e54d72a763c5bffb88848bc94a650ee9ce29bd5c8affe38cf69d86e7"
      }
    ]
  },
  {
    "id": "22b166dc-4253-4cb6-a92b-d0f996ea5878",
    "expected": {
      "area": "Kiwenda",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c063f4d52cdfa0985c9ed54e64b1e87c",
      "district": "Wakiso",
      "extra_md5": "08b72beee02e0d632a51a6730fbe53df",
      "listing_type": "sale",
      "price": "27000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "27000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1e59e001d18b5046062bceb88ca3ca31",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Property for sale in Kiwenda, Wakiso, listed at UGX 27,000,000/plot. Gayaza Kiwenda 2 plots of 50 by 100 private mailo title 1km off main tarmac each UGX 27 million. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "34d3353dee9599bb7a06ad0d07bc6f7043aab8c77a97fc00873d47126144af87"
      }
    ]
  },
  {
    "id": "232ba99e-8197-4528-9b6d-3d66a536660f",
    "expected": {
      "area": "Kajjansi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "77b3ff10fa205fef3b53acc713132861",
      "district": "Wakiso",
      "extra_md5": "32c79519e0fdd56363b67f943712bc2f",
      "listing_type": "land",
      "price": "450000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "de4216ca684c179105d7181a94741e43",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f6982ee743a06b16a2ae0cc4e2644cb93fbcc1ab8c081a3ccb9f17881296803d"
      }
    ]
  },
  {
    "id": "24768f13-91f5-4e51-9a8c-2f0fb66826bf",
    "expected": {
      "area": "Garuga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "1f64f63b50395689384d26af93a9b52b",
      "district": "Wakiso",
      "extra_md5": "c6f760e660d3036bf34433a0d1e7dd9f",
      "listing_type": "land",
      "price": "700000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "700000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a9aa2b9f250eabefb13608342d0d9253",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Garuga, Wakiso, listed at UGX 700,000,000/acre. 3 acres Garuga Pearl Marina touching lake private mailo each UGX 700 million. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6b73f09de315fa7177c98a09f4ee6c74c6b9d30f9420049035f2ea10f8868d80"
      }
    ]
  },
  {
    "id": "24a96e31-26da-4a88-9ea7-f990871a2c5c",
    "expected": {
      "area": "Kira",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "dbfce9b13b6949c1384025bff19091f5",
      "district": "Wakiso",
      "extra_md5": "acee4f84520bb8417e533b1f9e067339",
      "listing_type": "sale",
      "price": "173000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "173000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7d64649e8525516a8bfcb44972babd5b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 650000000,
      "price_original": 650000000,
      "title": "Property for sale in Kira, Wakiso"
    },
    "extraPatch": {
      "price_original": 650000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ac7c568c35c3afa4b2f7a58ada3c9606b98c5a7d64b50f4bae9145e3e5db07fd"
      }
    ]
  },
  {
    "id": "24cfc52a-069a-4d8f-8d48-98379cdd1a27",
    "expected": {
      "area": "Gayaza",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "938b6f0282cc9dffb82b099de3ff68c9",
      "district": "Wakiso",
      "extra_md5": "e991a3da99b5f56fe20a98ec4bdc733c",
      "listing_type": "land",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "488656295e9218fb14092ff89c868e27",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "81ce2275624c74fc9afd6cc2ecabeffe6ff624083a867eaffd4aceb760abba50"
      }
    ]
  },
  {
    "id": "24e7c872-5b92-4009-a1c1-5c508f9cd490",
    "expected": {
      "area": "Kyanja",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "19094f6fc35ad99e5c2f8871c2623307",
      "district": "Kampala",
      "extra_md5": "de5e6304e6e4cc2304cf7f43ca148015",
      "listing_type": "sale",
      "price": "950000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "950000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3dba91571b301645218c13dc11aeca59",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1150abfb2c0342e3baf769ec006047a77af3108a7a86f0426d4037b195cfc06a"
      }
    ]
  },
  {
    "id": "253e036f-4bd7-43f3-85ea-a719934fe6cc",
    "expected": {
      "area": "Naalya",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "b5c09a5dd371fe117ea32829bc9f95db",
      "district": "Wakiso",
      "extra_md5": "882b2e67103a746365d6eaebc047592d",
      "listing_type": "sale",
      "price": "1200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fcb8eec2d98799dab00279b3a6e869f5",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 1200000000
    },
    "extraPatch": {
      "price_original": 1200000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f5585a416009f864260cf302a1f033e869c3d522859cda55ba63423a08df5fdf"
      }
    ]
  },
  {
    "id": "25a1372c-8d5f-4bb4-bde2-e0756a3d8acb",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "0e22f14b595ed4eabd53daed45759796",
      "district": "Wakiso",
      "extra_md5": "20f4b54599c659f655345d62ff9e1682",
      "listing_type": "land",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Kira, Wakiso, listed at UGX 45,000,000/plot. Kira Kijjabijo 4 plots of 50 by 100 on sale each UGX 45 million. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1cc0a24cbeb80e9b37090f8231c17e1fe25b1481998da3ad4b8bbf952a50bc5f"
      }
    ]
  },
  {
    "id": "263e06e5-e659-4d8f-a81d-59e77d4a5956",
    "expected": {
      "area": "Kakiri",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e8eaa69dbd30fd37a9c50c6e8285cd06",
      "district": "Wakiso",
      "extra_md5": "aec387a84155e02e5fb98078ac1a212a",
      "listing_type": "land",
      "price": "23000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "36f75b08594e0876b392ac85a26e1770",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c72d8648e735c683cc664401ffdcfb970c0ed93929e1d8c8677feb212279533a"
      }
    ]
  },
  {
    "id": "26627582-13e9-49b6-9bfa-af7086e8001d",
    "expected": {
      "area": "Nakwero",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "b492bc27202ad437fad190b8a0642ed7",
      "district": "Wakiso",
      "extra_md5": "aa2d5c1976e52d973118fc6b06f79532",
      "listing_type": "sale",
      "price": "470000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "470000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "35da9f7897dde1e779bf769a4aa02ed1",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Residential property",
      "title": "Residential property for sale in Nakwero",
      "description": "4-bedroom residential property for sale in Nakwero, Wakiso, listed at UGX 470,000,000. Kira Nakwero town 4 bedrooms 3 bathrooms 27 decimals plot UGX 470 million negotiable. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land but source gives existing bedrooms/bathrooms. Specific house versus apartment form is unknown, so use the broad supported residential property label."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b32f49dfa23fd01345db37a9f94b596a0cf43456bc892dfff451bdfe94556abd"
      }
    ]
  },
  {
    "id": "26a58f9f-8322-40d2-a0fe-d390c850bc25",
    "expected": {
      "area": "Kulambiro",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "b807636f801f9768ccc9b451296aa5a5",
      "district": "Kampala",
      "extra_md5": "cb79406a00bd05cfa74b5b21093fe68b",
      "listing_type": "sale",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "apartment",
      "status": "approved",
      "title_md5": "fd8f3ddd2a53d75d69c890f27430e9cc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block",
      "title": "Apartment block for sale in Kulambiro",
      "description": "Apartment block for sale in Kulambiro, Kampala, listed at UGX 1,000,000,000. Bank pressure sale!! Shell apartment block for sale in kisasi Kulambiro!! * 12 units, each unit has 2 bedrooms, 2 bathrooms, sitted on 30 decimals plot size, with a private milo land title on table! Expected rent after completion is ugx. 30m per month.. Price is ugx. 1bn negotiatble slightly. Watch the attached video tour before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b0524444aed3972b86dd23afd7332ca9dc547b92c5e358f3795673beb7b2a6b4"
      }
    ]
  },
  {
    "id": "29008fab-ec52-4960-a8fd-eb6e377656a4",
    "expected": {
      "area": "Namusera",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "1b34cd4f096136bf35aea00880f7b97a",
      "district": "Wakiso",
      "extra_md5": "f0acfc7fd76935cd853aaf8b09ac7ad4",
      "listing_type": "land",
      "price": "200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "262a01cf3757fce98c807d685b2f3d26",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 55000000,
      "price_original": 55000000,
      "title": "Land for sale in Namusera, Wakiso"
    },
    "extraPatch": {
      "price_original": 55000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e95e44c815d40458d607151baf1ebadbf6c0cf6c6d3199c3f5ad4e9edc1e8d7e"
      }
    ]
  },
  {
    "id": "294c6bb7-25e6-4c93-ac07-ffca7369aeef",
    "expected": {
      "area": "Kololo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "64d07c6c9a05aeb26c65d267bd68a7c7",
      "district": "Kampala",
      "extra_md5": "cab67f2cce169328fd2a207ba2564215",
      "listing_type": "rent",
      "price": "4467372",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "4467372",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "a66422ece4e7c84890a25a9ad74455c1",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 4560000,
      "price_original": 1200,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "title": "Property for rent in Kololo, Kampala"
    },
    "extraPatch": {
      "price_original": 1200,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "548cf3d8c12557fc28fbe674f9213f401e31cacda9ec8559f62a3e9248be7218"
      }
    ]
  },
  {
    "id": "296c5ec9-db28-40e1-abc2-844e82c939ec",
    "expected": {
      "area": "Kakiri",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "ccb054b14659726ebe65eac0980c71fa",
      "district": "Wakiso",
      "extra_md5": "f33bb77de17b2828ffd2546a574b32cd",
      "listing_type": "sale",
      "price": "15000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "15000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9210206c76349f3e3a95999286bde375",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "773d2ccf9b8194b9581deb8a604dc20e70babdd7fd29ff49f94a5305cfe17fba"
      }
    ]
  },
  {
    "id": "29898bf0-9245-4bb7-8776-c3f00d061719",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "bfb6e846c71c2dc884be74df92efc1b5",
      "district": "Wakiso",
      "extra_md5": "feee3c637cf6e53461b4c7a967b4b856",
      "listing_type": "land",
      "price": "320000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "320000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "House for sale in Kira"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "d524b64e16a0174faf68d3214aa0d382945a4ed0597c6f659d1541a0da2ece9c"
      }
    ]
  },
  {
    "id": "29b6fb5c-578e-436a-b1d1-d61f9fbb569a",
    "expected": {
      "area": "Kakiri",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "36642adaa8f587df29e9f3d29965310d",
      "district": "Wakiso",
      "extra_md5": "ef1d086c4e153223e01d21ea9e54a2a2",
      "listing_type": "land",
      "price": "800000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "800000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5da7cd6c6215a4487abd161fe3d3523d",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 65000000,
      "price_original": 65000000,
      "title": "Land for sale in Kakiri, Wakiso"
    },
    "extraPatch": {
      "price_original": 65000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "29f5ccfc85848f09d08add9335c0f7c6d598faf394fc409786f0eec7847756e3"
      }
    ]
  },
  {
    "id": "2b42191e-3532-40dd-8eae-897af0083ff8",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "9bdd007553893186dcd0e3cd4160a09e",
      "district": "Wakiso",
      "extra_md5": "de53c8b2fce13854551ef8da2a23e220",
      "listing_type": "land",
      "price": "110000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "110000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0c5dbef5201b2db8bccab88fa5e3f9ac",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4ce311b8955398c4473eaeff0791278b620f0fe0904d107ed998b99fd1a051d2"
      }
    ]
  },
  {
    "id": "2c444be2-590b-4b1b-b2a5-c3235e909f63",
    "expected": {
      "area": "Kakindu",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "07066fcbe17f59c8119d3de2c8f98b21",
      "district": "Kyankwanzi",
      "extra_md5": "d3c53b5cf793b94c856ccabfc1b317ab",
      "listing_type": "land",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7c94b88b056f414b69f60fd3daf2f255",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1554d03a4e61392745d1f1fd3c06816b47f22d3b9e8752e76d9201186194ccf3"
      }
    ]
  },
  {
    "id": "2c97721d-4a5e-47b7-b368-77cc858263df",
    "expected": {
      "area": "Mutungo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "8b36499eb5ab8bfe8dcf9778ef20f582",
      "district": "Wakiso",
      "extra_md5": "e4afd05f40cfe4a68ca1d6259a8b17a3",
      "listing_type": "rent",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "58c54c8094f18638a9def49974575fd9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "transaction_type": "sale",
      "price_period": "once"
    },
    "extraPatch": {
      "price_period": "once",
      "price_label": null,
      "price_status": "price_upon_application"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "The source and stored title explicitly offer Mutungo condominium apartments for sale. Preserve the existing price on application."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f74e343e5ae6e044ff267a74c6ba07740aad302f6f847da946888ec7d269edbc"
      }
    ]
  },
  {
    "id": "2cbc030c-20ea-466b-9b4c-cfbab4a14d5d",
    "expected": {
      "area": "Kira",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "7322dccab476683435a92d261db417a9",
      "district": "Wakiso",
      "extra_md5": "0e4a54fe3370dd89955182f1fbd0f909",
      "listing_type": "land",
      "price": "47000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "47000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "dc59c5060ae10e513c1a24bebcc9aa69",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b7f0833a64b2246afb44d90110d0b3da2996f619a39eab80cf03a0965e1db3b8"
      }
    ]
  },
  {
    "id": "2dcab115-81b0-40d1-8ae9-ca9ddd1e5060",
    "expected": {
      "area": "Kakooge",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "88e28fe18b06598bd47df0c1629f3bbe",
      "district": "Buyende",
      "extra_md5": "3822161f0a76ee24ad31a95cd64de25a",
      "listing_type": "land",
      "price": "10000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "10000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "83cf636ff7aa4ab5d7291b4fb606a1e6",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9b5a416e693833070a3108636bf501ed07469508024384c0e17963f6687579c5"
      }
    ]
  },
  {
    "id": "2e22d994-431a-4dba-85a8-596042a8b84c",
    "expected": {
      "area": "Jinja",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "9e07916b9c63ceef4344f98f6a5c7b18",
      "district": "Jinja",
      "extra_md5": "d29f496579555231050b449203af21f4",
      "listing_type": "land",
      "price": "18000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "18000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "421ea47cfebfcad8b7baa1bf161b8d71",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ea0685f00840c8aed7fe53899023adfad6ff04ac402dfc227443baec63653c8e"
      }
    ]
  },
  {
    "id": "300ad89f-aa44-4777-a115-e5a7d470c07d",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a58caf76fa092060ea4dbf9b2cc54bd5",
      "district": "Kampala",
      "extra_md5": "a1a04fc067bb251695b5e297570c3c84",
      "listing_type": "land",
      "price": "65000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4427ec12d6deb3573d3dc8e2eff8f83f",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cc42d169fd5ae7a59028a8fd46b53d99621ce12c4cbec77c148033840002cd8b"
      }
    ]
  },
  {
    "id": "3106586a-7a91-4af9-b8c2-2c5de8126469",
    "expected": {
      "area": "Nazigo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4d008a1f4f2fc6ca8bf56e21a7e6e10e",
      "district": "Kayunga",
      "extra_md5": "85c1e3aacaa2f0a7ea5f9138938d8bba",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e8baf839fae4afa48c3427c79158f6ee",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1ad9b5281789ff91d275e77ee00faeded914a3230e5bff273ebca7b51bc3e881"
      }
    ]
  },
  {
    "id": "3265908c-d4c3-40f6-aca8-4287b01431f4",
    "expected": {
      "area": "Garuga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "1f64f63b50395689384d26af93a9b52b",
      "district": "Wakiso",
      "extra_md5": "a113e3a8701a8d51aebc097c3f0995a9",
      "listing_type": "land",
      "price": "700000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "700000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a9aa2b9f250eabefb13608342d0d9253",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Garuga, Wakiso, listed at UGX 700,000,000/acre. 3 acres Garuga Pearl Marina touching lake private mailo each UGX 700 million. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ff1eb931c60cc160d3f853135b70f0a1a9c4c0a01c6b7b4f77f5512c48cff5b9"
      }
    ]
  },
  {
    "id": "330e349b-62b7-44ab-af4c-85a127589320",
    "expected": {
      "area": "Kasana",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2c80aee3419212c19619a981efe3954b",
      "district": "Kayunga",
      "extra_md5": "0d480ee819ca0d8e58c2a94da092aa6b",
      "listing_type": "land",
      "price": "23000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "23000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7bbbe8299d287c6259fb290a4d277446",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d201988e75963a8090a57a1e146f26c92cdb0bd51debd4c0d755f02a85359277"
      }
    ]
  },
  {
    "id": "34d74623-d662-4002-b525-5a83de7d9ec3",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8f5201345d318cbfc50e7006c0db2c9a",
      "district": "Wakiso",
      "extra_md5": "dfb6157bbd9fa44951dc47b677408bd4",
      "listing_type": "land",
      "price": "3500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "3500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 35000000,
      "price_original": 35000000,
      "price_period": "plot",
      "description": "Land for sale in Namugongo, Wakiso, listed at UGX 35,000,000/plot. 50 by 100 plots Namugongo Bukerere each UGX 35 million. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 35000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2a33bfe076ecbb7a458ff4e26c0be3f020518a7a0ced1a096d2e3aaced442e0a"
      }
    ]
  },
  {
    "id": "34e50c94-010a-4f70-8b3d-5d28740871e7",
    "expected": {
      "area": "Wakiso",
      "bathrooms": "0",
      "bedrooms": "7",
      "description_md5": "13da573653a1b079e3117dcd63f406d3",
      "district": "Wakiso",
      "extra_md5": "57a24d08cca818ed1194fda5d0b97230",
      "listing_type": "sale",
      "price": "1520000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-08-02 07:28:59.472+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "400",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1e3e332a5c7883e568f5a948fe629a55",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1520000000,
      "price_original": 400000,
      "title": "7-bedroom property for sale in Wakiso"
    },
    "extraPatch": {
      "price_original": 400000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "eaa7af944a9fb145492f33eb9c7c1cc0778e3132184bd049f80e1e58106460a2"
      }
    ]
  },
  {
    "id": "353541d9-7ab3-4ff9-8a4e-f081078ba99d",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "472e9555f185e04b6c0fdfbc0f7f8d1c",
      "district": "Kampala",
      "extra_md5": "7682db1bc987a22991ad3de5141ae860",
      "listing_type": "land",
      "price": "1100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1100000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f6177ea273101365adeb089dc0efe922",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyanja",
      "description": "Apartments for sale in Kyanja, Kampala, listed at UGX 1,100,000,000. Kyanja Kungu 12 unit apartment monthly income 12 million fully occupied on 15 decimals plot UGX 1.1 billion. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9e57d274c55685ddea69c0094576e5c2e87807122eeb9941d61c9569bb9ea538"
      }
    ]
  },
  {
    "id": "3588ed58-a68a-405b-8e3e-723f1903d5e4",
    "expected": {
      "area": "Kyegegwa",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "238087a25e846d63412e22b3b86506a5",
      "district": "Kyegegwa",
      "extra_md5": "3689f5dd6cdf7bbe0b15dc23066b43c8",
      "listing_type": "land",
      "price": "9000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "9000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "716bd341ca96a45028a240117d837fd6",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3384a3271994c83a16c95e83e2b26f39be20896125d9dff19bfec98cc5d25d86"
      }
    ]
  },
  {
    "id": "35ec5811-d477-48c6-92aa-6b3f2900a507",
    "expected": {
      "area": "Nwoya",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "911a9f4287c1d1221fe7a71e28da4d7c",
      "district": "Nwoya",
      "extra_md5": "e721f8e4569e6cd53b9ce30e6cd38cbb",
      "listing_type": "land",
      "price": "11134191000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "11134191000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d0bb4f1a53f342e553690f9562b8b143",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 3000000,
      "price_original": 3000000,
      "price_period": "acre",
      "title": "Land for sale in Nwoya"
    },
    "extraPatch": {
      "price_original": 3000000,
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "349e524f5583c12d4a4cff5cb6f02f4a3d9360de1fcb06551d8c999ac041c5b1"
      }
    ]
  },
  {
    "id": "371eaeba-3134-4a47-8a1b-55ccae8de0f7",
    "expected": {
      "area": "Gombe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "3824dd8c82f382112b3b4a148988f113",
      "district": "Butambala",
      "extra_md5": "ca776db22006530f9d17bd258c828cb9",
      "listing_type": "land",
      "price": "18000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "18000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9cace1521377d0465370875f2ff7df37",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Gombe, Butambala, listed at UGX 18,000,000/acre. Good Deal 172 acres Gombe touching tarmac private mailo title on sale each UGX 18 million. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "161f967ed536d3ff0a0d73c8ca2480d984dc9f91f9526522c0cefaff1ae593d6"
      }
    ]
  },
  {
    "id": "3787896a-4dc0-4bfe-bf3a-f18d5bd2ad46",
    "expected": {
      "area": "Kololo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "105dc0dbe5ff9db45681d070d1d35ec4",
      "district": "Kampala",
      "extra_md5": "2e3f0b0922a68f1734bda2cde4d2e89e",
      "listing_type": "land",
      "price": "3000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "3000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9a06528d48b18f3b5182e003a049ae93",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartment"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8eae674ebeb9993b9107e3bfa59d3dfde56768a10599dc3fc09856a2b9b4b902"
      }
    ]
  },
  {
    "id": "38a8f8f2-80f1-4929-9311-fcb70df13472",
    "expected": {
      "area": "Nakwero",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "1fab0be3c9d6adb25ebd25098186ec01",
      "district": "Wakiso",
      "extra_md5": "e11d10b380d3175ac47fe46b02708606",
      "listing_type": "land",
      "price": "110000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "110000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "35da9f7897dde1e779bf769a4aa02ed1",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 55000000,
      "price_original": 55000000,
      "price_period": "plot",
      "description": "Land for sale in Nakwero, Wakiso, listed at UGX 55,000,000/plot. Good Deal 2 plots of 50 by 100 Kira Nakwero on quick sale each UGX 55 million. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 55000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "92aab5d9982f944140eb85f696676187784984ef874218e5fae56498b2d1be77"
      }
    ]
  },
  {
    "id": "3995019b-765e-44b3-a503-073e0e11e7ad",
    "expected": {
      "area": "Kakiri",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "0928db7631470d17e7250581c5adb6a0",
      "district": "Wakiso",
      "extra_md5": "8afcad202b3da7d1f5bf0fb9eb356401",
      "listing_type": "land",
      "price": "250000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "250000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b89d97e6061bd8190a5c1a02a8e0eda3",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ee5fedea14ed289e7302d8330a895f6c09ebf5b864cdba520c8496196a125037"
      }
    ]
  },
  {
    "id": "3c74d882-3d47-4258-9c06-81fc8847ca8f",
    "expected": {
      "area": "Najjera",
      "bathrooms": "0",
      "bedrooms": "2",
      "description_md5": "968456c638b9dfca7df99c96293db207",
      "district": "Wakiso",
      "extra_md5": "f45c9d96b63b8b7e23a1bd8a8a98c369",
      "listing_type": "rent",
      "price": "779000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-08-09 14:16:32.489+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "205",
      "price_original_currency": "USD",
      "price_period": "month",
      "property_type": "warehouse_industrial",
      "status": "approved",
      "title_md5": "32f8b44700654bf01a75367d989ba6f0",
      "transaction_type": "rent",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Apartment"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source explicitly offers a two-bedroom apartment, not a warehouse/industrial asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ab5262bc9e41daa9767a4f0e5a5c5039aef8ff5760332cafde336bb83778a580"
      }
    ]
  },
  {
    "id": "3dab199b-b134-496f-9acd-ad0fb16e16a7",
    "expected": {
      "area": "Katosi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "76abef73948de5092f47d323619b71f7",
      "district": "Mukono",
      "extra_md5": "14087deea57b40aa19201c7b67884854",
      "listing_type": "land",
      "price": "60000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "75d32ce7ce06f9f77cae8230d6aaa8e3",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b1aa16c32171ee473c9f76f04a4e9d40543f569211b4b51b50568dea0bd9922e"
      }
    ]
  },
  {
    "id": "3e8a70db-a675-4fcb-b05b-235f3ebdd2f1",
    "expected": {
      "area": "Kira-Nsasa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "d379302161e9f74f1943d109e021abe0",
      "district": "Wakiso",
      "extra_md5": "f5f0118c7cdf47aaf7bb1d534b79d94d",
      "listing_type": "sale",
      "price": "2100000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2100000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a9ddcc2f1638d2175b23a3815b043538",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 240000000,
      "price_original": 240000000
    },
    "extraPatch": {
      "price_original": 240000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b4d285954d2d225bcceafcb0c4259d62ac4cec3f37d0401d2fd835694eda638f"
      }
    ]
  },
  {
    "id": "3ecd0ffb-b5b3-482c-acac-acfee359206f",
    "expected": {
      "area": "Kololo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "5a84fc44604adbb088f2cb305e296073",
      "district": "Kampala",
      "extra_md5": "dea9ef3afe33b3083361d03264be7acd",
      "listing_type": "rent",
      "price": "76000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-10-03 06:46:20.828+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "20",
      "price_original_currency": "USD",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "e88e086d2e5ef6653cc15b7195ae8de6",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 228000000,
      "price_original": 60000,
      "price_period": "year",
      "listing_type": "commercial",
      "transaction_type": "rent",
      "property_type": "office"
    },
    "extraPatch": {
      "price_original": 60000,
      "price_period": "year",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source expressly offers the entire 300sqm office floor at USD60,000 per year, VAT exclusive. USD20 is a per-sqm rate, not whole monthly rent."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "caccac39517c07c5d65c21387bbd021b7e076de7ca06a6de8c34c38b1557cc80"
      }
    ]
  },
  {
    "id": "3ee4642c-d065-487d-9246-7d962a717693",
    "expected": {
      "area": "Kampala",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "400b800839144dd3a034ec467e6809e2",
      "district": "Kampala",
      "extra_md5": "aab8a08078f7a43941d5a17d4ade57b0",
      "listing_type": "sale",
      "price": "3515000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-09-15 08:35:42.2+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "925000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2d7469381678a58567958cf5904c29c0",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment complex"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5ea8ba4ff24c024e7381de8b8bf814468479ab682a198b1c5a1f03b268af76a5"
      }
    ]
  },
  {
    "id": "3f5fb3d8-4d3c-40d9-ac79-d2c2be69a538",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "37cf77b7e45bc3e3c3e8ce4ec2757bac",
      "district": "Wakiso",
      "extra_md5": "787709b3ab116f0f3e4a5d745e7434ea",
      "listing_type": "sale",
      "price": "370000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "370000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "House",
      "title": "House for sale in Kira",
      "description": "4-bedroom house for sale in Kira, Wakiso, listed at UGX 370,000,000. Kira 4 bedrooms house on 100 by 100 plot on sale UGX 370 million. Watch the 2 attached video tours and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land, while raw source explicitly identifies an existing house/bungalow. Canonical sale category and price remain unchanged."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b7c09658313b316afc8cb879ac2d4a7914abf7b5fbb42a3081e46ae57ad9d375"
      }
    ]
  },
  {
    "id": "41127be3-8de4-4aca-9a38-fa90663760a3",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "aabf7f3dfb4763b10a5a6ca5748cc80b",
      "district": "Wakiso",
      "extra_md5": "1a3eb2320fbb65628031aa9dd810d64d",
      "listing_type": "sale",
      "price": "600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "450000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "8d19011afe4f661432b25ca47ad470e6",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 600000000
    },
    "extraPatch": {
      "price_original": 600000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fa8451f8e3eb774e259861ac20b02bec4ed56ed9076cf01ac13ca19a395cd044"
      }
    ]
  },
  {
    "id": "41d86823-146c-4c20-a332-7856c96044ed",
    "expected": {
      "area": "Mukono",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "52fce22db47275cba90fb6caf509c08e",
      "district": "Mukono",
      "extra_md5": "e6a11dec812f9a1919f3e4332e40266e",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f3b80ac0cf5f20c3b431daa4a78454da",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "20febb5bf0abcdebe9ea8e41827ec5ef3f823ca81a22fb38599dfada763b19f3"
      }
    ]
  },
  {
    "id": "42082ceb-37a6-46ae-8a2a-6c2a8600baae",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "3ed0c46b93594e65133ece5e30c49cc2",
      "district": "Kampala",
      "extra_md5": "359911e2040fe1b7855a92f81b0b49c7",
      "listing_type": "sale",
      "price": "4500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "4500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "631cfb9686b49d293dc791e72f7d8db5",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Residential blocks",
      "title": "Residential blocks for sale in Kisaasi",
      "description": "Residential blocks for sale in Kisaasi, Kampala, listed at UGX 4,500,000,000. KISAASI TOWN: 3 blocks each with 4 units of 3 bedrooms on 30 decimals monthly Income is 42 million selling UGX 4.5 billion. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "92871c67c317d37add050cdd7620678265a9dd5394310e64293a1ea98510d6b2"
      }
    ]
  },
  {
    "id": "42f256d4-24f7-4adb-82a0-7875caef88fc",
    "expected": {
      "area": "Kikyusa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2301079a34f2e08a04123314f3b555ce",
      "district": "Nakaseke",
      "extra_md5": "771e15eda7426a98ae063e7cf1a49f0c",
      "listing_type": "commercial",
      "price": "12000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "c06bd0bfd399797de92b5f68d89adb39",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Commercial land for sale in Kikyusa, Nakaseke, listed at UGX 12,000,000/acre. *Massive 200 acres large on sale in Kamira- Kikyusa* Location : Kamira after kikyuusa Luweero (Bombo rd) mairo land title in luweero district 2 kilometers off the main marrum road selling all at once @ 12m each acre Available for viewing Ideal for commercial coffee farming, maize, ranching and many other projects✅. Contact Tuyisengye innocent to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "73f980a37ba58790690bad3f1c15eadc9a2aa1f003423b16cbf673cb427307cd"
      }
    ]
  },
  {
    "id": "433263b3-321e-4d85-a40a-4ce286d90445",
    "expected": {
      "area": "Masaka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c6116af6ccd52ceda5dc2c8fa1227f4a",
      "district": "Masaka",
      "extra_md5": "f9d35a97f5d497d8af2b36eeddb672d2",
      "listing_type": "land",
      "price": "6000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "6000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ff067100c27499621aea0f7c1ebb2db7",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d6c213e409b7c6d732513224e2dee4fef9758f3e0f79046bad6961643ab833c1"
      }
    ]
  },
  {
    "id": "44b8ffe3-b228-4d42-b757-ff91553cfad1",
    "expected": {
      "area": "Najjera",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c35fa5bdbf013bf7277a7a1a235fc823",
      "district": "Wakiso",
      "extra_md5": "42776e9cba734dcbb2b890fe7c30c88d",
      "listing_type": "sale",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6151f30181f0e8a78364606fe5393e37",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 1330000000,
      "price_original": 350000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_on_application": false
    },
    "extraPatch": {
      "price_original": 350000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "price_on_application": false,
      "price_upon_application": false,
      "price_review": null,
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "57137ca80f7118c6ff7f7ff55553130c419ff573f592c2941340029170b7977c"
      }
    ]
  },
  {
    "id": "46015224-758d-4d17-b439-5fac4b7594a4",
    "expected": {
      "area": "Karwenyi",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "52ef7a170580474986a4eb218747f5cb",
      "district": "Kyegegwa",
      "extra_md5": "e56b02ab36408b93bcdbebc270f4cc7e",
      "listing_type": "land",
      "price": "12000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "dc14c902cf05078ab96f0da120e52aca",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "29af944dc2f57c67b04a814a0550b2ac7a84b2ea59cff7020964d54d0fca8e98"
      }
    ]
  },
  {
    "id": "46759d9f-461c-4f7d-af58-8cabab2ef989",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "d2888e61fc9690893f61258bfb73f7fc",
      "district": "Wakiso",
      "extra_md5": "5c8a8ea21fd7ab34321e4be96b2ead92",
      "listing_type": "sale",
      "price": "4200000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "4200000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a9a89e28639d5d52c16d1c4cde52e3da",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 500000000,
      "price_original": 500000000
    },
    "extraPatch": {
      "price_original": 500000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "75e00b64a1ab591c65f06792858df637fe5be0b678b329cab34496202a1a35bd"
      }
    ]
  },
  {
    "id": "47da7e4e-d5b9-44b3-acd9-342ed4d52979",
    "expected": {
      "area": "Munyonyo",
      "bathrooms": null,
      "bedrooms": "5",
      "description_md5": "8aba026442bdc580b37c28b18d4ccf06",
      "district": "Kampala",
      "extra_md5": "96d052d0369acaa0812a2beb5156a987",
      "listing_type": "sale",
      "price": "1100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "9000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0159173c769479a46227ac1364e9631c",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 1100000000
    },
    "extraPatch": {
      "price_original": 1100000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c0c3eecfd16fd5d99be062a592a93408d2fcc553a1e647f4e1f91839ad03811f"
      }
    ]
  },
  {
    "id": "47e3f849-a855-49d3-9fbc-91da60daf1a5",
    "expected": {
      "area": "Luwero",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8dd5d8eaff89199b67f4fee93713e9ee",
      "district": "Luwero",
      "extra_md5": "bf52b43ecf46fba268f2181b6fe02101",
      "listing_type": "land",
      "price": "14000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "14000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "da65ec374003f48c1f66b7e7b8b9c69c",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2ebb75475c3cca06216b6b01153067846e93e0af4fc97830f853b3639a0b66af"
      }
    ]
  },
  {
    "id": "488b4607-b951-4e29-8205-00f2687e7c87",
    "expected": {
      "area": "Busukuma",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "3efa9bfc6f7e497df393a6ea71cd8682",
      "district": "Wakiso",
      "extra_md5": "9b500212d20f52c5c4f69538d62e6501",
      "listing_type": "land",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f0a8fef856eb2000cd1b23e4a8708343",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "e5c6d644dac3d78b7da4c66f730552386d1bc4b1eb339d0eb67452b757b023d6"
      }
    ]
  },
  {
    "id": "4934fe6e-e69d-45c3-a80e-72c795023f6a",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "7f82bdd2c5e70c21f3818ffe078099cf",
      "district": "Wakiso",
      "extra_md5": "6e843a9fc291e74caf6f511b9032ce98",
      "listing_type": "sale",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "650000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "1e856a6041d4afca6e4d07080a488998ea6b034492d3df027c8a5fe12cba3629"
      }
    ]
  },
  {
    "id": "49a9e415-e069-4055-a2c6-cc10682ed920",
    "expected": {
      "area": "Wakiso",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "1a060f7b8399a067cd18344a2dc587f2",
      "district": "Wakiso",
      "extra_md5": "e7afdee5d84a3894c4c3b7c2a7f2ee29",
      "listing_type": "land",
      "price": "250000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "250000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3659c5daba4ef20e04f085992d2c40db",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "249b22969bae9ade75fc1b7cd34ab4340053b11cef32cb6ffa9983fe17cc4795"
      }
    ]
  },
  {
    "id": "4e21e6a2-8b5b-4531-a7ee-43d8135fc15d",
    "expected": {
      "area": "Kyaliwajjala",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "e09ebaa11dff10df212f07abcec54bdf",
      "district": "Wakiso",
      "extra_md5": "87b6f3897f765c126a31f9cc8b19b27a",
      "listing_type": "sale",
      "price": "2000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fc141ae42fe44f81ed2e71cd299a88c9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyaliwajjala",
      "description": "Apartments for sale in Kyaliwajjala, Wakiso, listed at UGX 2,000,000,000. Mbalwa Kyaliwajjala road 12 unit of 2 bedrooms 2 bathrooms apartments monthly income 18 million private mailo on sale UGX 2 billion. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "87133e3f365a6f05f6de6d6c1828211570043f3685239c0e31602fd62dc8a316"
      }
    ]
  },
  {
    "id": "4e783aa9-7efa-4be4-b472-88b633cac488",
    "expected": {
      "area": "Kyankwanzi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "ef3569e40564d31e636158afe56f95f5",
      "district": "Kyankwanzi",
      "extra_md5": "c735aa4ad8a008ae869906b40d4b2c09",
      "listing_type": "land",
      "price": "9000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "9000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2b9d899367fd7e6ab31ba32ccbc4d890",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "28256de553db6bbf51963c461686f14f6928c6d2f54c8eb2070b54f321011835"
      }
    ]
  },
  {
    "id": "4fe17d18-0c94-416e-99db-ca7c06fb7fb6",
    "expected": {
      "area": "Bunga",
      "bathrooms": null,
      "bedrooms": "14",
      "description_md5": "90dbc147d2314fea59ff5f4eb4d30c93",
      "district": "Kampala",
      "extra_md5": "a5d3470f45feb61884e104dd58202777",
      "listing_type": "sale",
      "price": "1600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "apartment",
      "status": "approved",
      "title_md5": "786ffba5abde50f6349ee44d7d5aa93e",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block",
      "title": "Apartment block for sale in Bunga",
      "description": "Apartment block for sale in Bunga, Kampala, listed at UGX 1,600,000,000. One bedroom apartment block available for rent and for sale in Bunga Kampala 1.7m per month 8 units Income is 14m per month selling at 1.6bn ugx. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "84e42ecaa66a5f7e57b527efda242edafeb2732613f6fa87e9cdb0e49b57ca93"
      }
    ]
  },
  {
    "id": "4fe84c5b-8672-405c-8aa9-360f8c5ab0d4",
    "expected": {
      "area": "Garuga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "aad31b589c6bff43fa3c1cd5d60cade1",
      "district": "Wakiso",
      "extra_md5": "d7285cec10f7595dc69c847a7da989bb",
      "listing_type": "sale",
      "price": "850000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "850000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4f854a79da519616b3ea0fee72ac1ba2",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "751514cb5bba01040eb619da1423a566b405c4b6b3b8c0f2a61cee1c88a79019"
      }
    ]
  },
  {
    "id": "4ff70712-a41e-4573-9c1c-8e04307b3cb4",
    "expected": {
      "area": "Nateete",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "44f9c567630889e7ee6e4cd377444cf5",
      "district": "Kampala",
      "extra_md5": "4ba8a47a1b378abcb6ce9f6b1bab616c",
      "listing_type": "commercial",
      "price": "22000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "f958c80be64e2d3b2f9342111168d1a7",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "shop_retail",
      "price": 2500000000,
      "price_original": 2500000000,
      "title": "Shop / retail space for sale in Nateete, Kampala"
    },
    "extraPatch": {
      "price_original": 2500000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Primary offered asset is existing commercial shops making UGX22m/month, not vacant commercial land.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "eb8a8f4648ab54336f93d5a1cd5c1feafa27f95653925af612070d77fc7b04d3"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "eb8a8f4648ab54336f93d5a1cd5c1feafa27f95653925af612070d77fc7b04d3"
      }
    ]
  },
  {
    "id": "514c0311-1040-4d46-bf3c-6892304bed2c",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "733199f44dc10bf7ff41e58935e1ab19",
      "district": "Wakiso",
      "extra_md5": "12bebae4d9f24e2a7480bbda88090242",
      "listing_type": "sale",
      "price": "120000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "120000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Property for sale in Namugongo, Wakiso, listed at UGX 120,000,000/plot. 8 plots of 50 by 100 NAMUGONGO new estate near protestant shrine each UGX 120 million. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9c1afa832f06dc4113c7cd3758298f392c312efb0e81bb3f64c8399a8740fc1d"
      }
    ]
  },
  {
    "id": "51bc6228-ed91-4a05-b8f6-3c6d5d9d7cbc",
    "expected": {
      "area": "",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "59cc14eae4442a0ff56759d77d155b0d",
      "district": "",
      "extra_md5": "7bae89c18d4e24d14d0066b7a5416771",
      "listing_type": "sale",
      "price": "200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "904149a85637b16c2381821050257fb0",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3a164a74481185db75c461860363c908c1f299eab34b527c9d437dfd93833989"
      }
    ]
  },
  {
    "id": "5207ec87-d7af-4fb0-b0fb-fce768067375",
    "expected": {
      "area": "Bukoto",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "69d058bf74a819d565db1d232373aff1",
      "district": "Kampala",
      "extra_md5": "8cd4a1e45bc15078255eb2dfa9212069",
      "listing_type": "sale",
      "price": "3000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "3000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5b0eaa111bee10e09b1a88294b2c57d8",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 3300000000,
      "price_original": 3300000000
    },
    "extraPatch": {
      "price_original": 3300000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8eb6ed88cbe5b5b8dd5ea12e4e9c9bd6212e410eb7cbb1b54386287a9d3d5fe1"
      }
    ]
  },
  {
    "id": "52b82f68-2ace-4e23-ae7f-dcf7d32a1f28",
    "expected": {
      "area": "Bukoto",
      "bathrooms": null,
      "bedrooms": "6",
      "description_md5": "67b96a63720b0db14d84acaac05a1ab0",
      "district": "Kampala",
      "extra_md5": "72b0f05b7fc99b6776109baf153720fe",
      "listing_type": "sale",
      "price": "1444000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822814+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "380",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "da184dcd1a2213ffccd228ac502fa17a",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1444000000,
      "price_original": 380000
    },
    "extraPatch": {
      "price_original": 380000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "030eae70789c9636841d15d375de5db2f58a16306b1d60f50caee0da96cfddb1"
      }
    ]
  },
  {
    "id": "52d07406-04ba-4666-b533-c537a8684327",
    "expected": {
      "area": "Katende",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "89882f43c41799920f4e9c20abee6399",
      "district": "Jinja",
      "extra_md5": "ce4c4a734d2bed29a4c4c9caa018ee49",
      "listing_type": "land",
      "price": "550000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "550000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "8841dac9dc4978ca88fc8da0e74658b0",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "059abfe33e9d7684a7dc300026d3b830b4591fa0ac11b3c14d3514b7d85c49d1"
      }
    ]
  },
  {
    "id": "52dcf83d-97b4-4ba6-9257-12c7715f1e86",
    "expected": {
      "area": "Kyenjojo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "c2631164b2c284e68d2732c2c396d12c",
      "district": "Kyenjojo",
      "extra_md5": "1f87cc8df3bd9a865a20bbeb40785172",
      "listing_type": "land",
      "price": "8000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "8000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e262f4c141ced2b2ef25605e0046aeda",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "83e249bbb14e51e814e6679643a0e6c143fbb34bb2afbc2ab7c924c4d9aa46e2"
      }
    ]
  },
  {
    "id": "53299fca-7cda-4d3c-a2b5-7f281e5622f0",
    "expected": {
      "area": "Gayaza",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "da22f9783bd398e41d54ca54803b8493",
      "district": "Wakiso",
      "extra_md5": "a5006047b14ff70a4953902b584c8c94",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a9fc2791e6504c54a06019d2018362ba",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ae29e9ea84a2ff43e12877d0d9fae0b7c29f4aac2685e2b95ad092ce6b1d707d"
      }
    ]
  },
  {
    "id": "539d294e-6a82-484c-ad94-368467a28cd0",
    "expected": {
      "area": "Ntinda",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "d1fd090e10014d4ff9ece110536d57c2",
      "district": "Kampala",
      "extra_md5": "82a27d2eb1d0dddf6e77bc488e95fa22",
      "listing_type": "sale",
      "price": "1500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ecb9ed28b63e2ca2e66dddf54a455d1c",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c179583a42da20bc40c0357e7a0b7593c2f92de27a34ae0042eab924a46ec0ce"
      }
    ]
  },
  {
    "id": "53a62b5d-9b68-4b48-b258-d0b7f253d33e",
    "expected": {
      "area": "Namugongo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "e10d57a3a5ada9097fe7bf800f5dcd46",
      "district": "Wakiso",
      "extra_md5": "5edf664698b0050051aa62ade3bcf4eb",
      "listing_type": "land",
      "price": "110000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "110000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ebaea7501a81da36c7bab442c471513a",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House and rental units"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "369b7696063b9db9daeebc98a94d13d8e504cf124c431f3eb9ca8f50ce4d8c65"
      }
    ]
  },
  {
    "id": "544501a3-59bd-4af2-8daf-64ab585d7bd4",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "0da6214b9c7d444b0805bc2af9843df3",
      "district": "Kampala",
      "extra_md5": "4c5abb56f2cc44457f5871bb0a704b10",
      "listing_type": "sale",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1d372875339223089db1b91ece0cb7d0",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1000000000,
      "price_original": 1000000000,
      "price_on_application": false
    },
    "extraPatch": {
      "price_original": 1000000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "price_on_application": false,
      "price_upon_application": false,
      "price_review": null
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "2df97d08a526d534e76914274ac226b64f7aa8129ce1cd372721f85bdd1810cd"
      }
    ]
  },
  {
    "id": "54750a02-6cdc-4574-bf1a-b17752ad650a",
    "expected": {
      "area": "Munyonyo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "bf4aa80daf1963fa3b1d2eff0ab3379d",
      "district": "Kampala",
      "extra_md5": "3f6a11c389c9a6bbb6a09c45ebbead45",
      "listing_type": "rent",
      "price": "4699293",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "4699293",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "0ef77c87d9c4814433cd2eab05a92cb1",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 4560000,
      "price_original": 1200,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800
    },
    "extraPatch": {
      "price_original": 1200,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f22450c25811af59aedf07ccdde85b9d008fa3ffb30429eece22960a06f57391"
      }
    ]
  },
  {
    "id": "54f27f64-a885-4f2b-bee0-5ca16930ddcb",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "30a3a86ab33bbabc65343c41f902bc65",
      "district": "Kampala",
      "extra_md5": "ddf2c375338db05d70d70456c20734c0",
      "listing_type": "rent",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "month",
      "property_type": null,
      "status": "approved",
      "title_md5": "bf4f62cc97bb0acbc52d4599641268a8",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1300000,
      "price_original": 1300000,
      "title": "1-bedroom property for rent in Kisaasi, Kampala"
    },
    "extraPatch": {
      "price_original": 1300000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a789712e091a405b411da3dea938f8f2aa534057850d83aaab94eeebbf0cd90d"
      }
    ]
  },
  {
    "id": "56a6ce0c-c1b6-4785-84a8-62956311a4da",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "f26cf7416a30cf12932f54da21986396",
      "district": "Kampala",
      "extra_md5": "270a4599cfd8be2acea41cea4fa2b95f",
      "listing_type": "sale",
      "price": "1200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "11000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "60c6ad9eaddd72c15a4fba724aa2304b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 1200000000
    },
    "extraPatch": {
      "price_original": 1200000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d9ec3b6296da7753b99e18b3b550220c52c9ad2bec56b5315435d5d8afcd855a"
      }
    ]
  },
  {
    "id": "57344404-9f57-4030-8bb4-485e606da27e",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "58ed4c06e44d3e2ad0e2f92d11b02dba",
      "district": "Kampala",
      "extra_md5": "95f349ef8d35c336abba9cb3b9d0bd23",
      "listing_type": "land",
      "price": "1200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4c2951c85b7915bf40076abf016c03d3",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Bungalow",
      "title": "Bungalow for sale in Kiwatule"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "3b74d2dc36e89df024afb2a61f064ff96bbc0c6ad3ff510ad97d6dbb4ee2acc6"
      }
    ]
  },
  {
    "id": "58788b21-f17e-40d4-863f-dd0b64d3aa90",
    "expected": {
      "area": "Bulindo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "6db850b79dd523fd133c3d6ef9c1d30f",
      "district": "Wakiso",
      "extra_md5": "35dd43777eb79852edbc46bab38cce27",
      "listing_type": "land",
      "price": "240000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "240000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "69e249aba15a9040fa004da713ca2534",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 165000000,
      "price_original": 165000000
    },
    "extraPatch": {
      "price_original": 165000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0c33f90f3e1db893c52f0da46faed5e9117817429a2dfa68ff58c068b3b1e7df"
      }
    ]
  },
  {
    "id": "59288436-3476-4709-aef6-b4e2a2388719",
    "expected": {
      "area": "Mengo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "565024adc010b6188c5e305d1ab0ec46",
      "district": "Kampala",
      "extra_md5": "c0d155059ea51bdfdebaebbab3de291d",
      "listing_type": "sale",
      "price": "3300000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "3300000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9f38e0fbfecd66be4b4a99f445477f8f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 270000000,
      "price_original": 270000000,
      "title": "Property for sale in Mengo, Kampala"
    },
    "extraPatch": {
      "price_original": 270000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "78fa8af88ec387bec55701e9861257365300be8e72b3d5a961c11b166f059206"
      }
    ]
  },
  {
    "id": "5a1a2acb-9b7a-4e8a-84b5-c762a9ba807e",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e71b47182f332b7da6f3b0c00f662c40",
      "district": "Kampala",
      "extra_md5": "bd3f142d4d5dbcc765d27c071337c9a7",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "dd07c4fd4b0ec399c12547fe3671a944",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fa5200760764050164eead38677228d4466e8a22d731635fcd44ac337ab10ac4"
      }
    ]
  },
  {
    "id": "5a8ffe87-c9f0-416d-8615-cb39b2cc3609",
    "expected": {
      "area": "Namirembe",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "6768814c53c0818950c426691062ae9f",
      "district": "Kampala",
      "extra_md5": "3bbc5d2bc51de8f4f45aaceeca97547f",
      "listing_type": "land",
      "price": "2500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0380bd937a196b9cb41b8f5bb08fa2ff",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 9500000000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "title": "Land for sale in Namirembe, Kampala"
    },
    "extraPatch": {
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "939c74b9a8505908211755eede92c641b3012a7a4864c98db9f362cc0c8f4fec"
      }
    ]
  },
  {
    "id": "5a9b5b8e-c187-4e4a-9525-1276e6bcaa7b",
    "expected": {
      "area": "Seeta",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "ca92f3d19d1ca89b52fe129efe305085",
      "district": "Mukono",
      "extra_md5": "a759dee4336ab43c48a6140ee3b38942",
      "listing_type": "land",
      "price": "706592177",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0a1122dd9a6480f17d8af7582a3cd54d",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 12000000,
      "price_original": 12000000
    },
    "extraPatch": {
      "price_original": 12000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "669a602204ca3dcd744260eb70f11dc11ad3206cacafde29e383c720a9006e7c"
      }
    ]
  },
  {
    "id": "5aed887d-e0ac-4073-a455-6f814f27a2de",
    "expected": {
      "area": "Kololo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "285fda76e6d86a1d16363587d2847108",
      "district": "Kampala",
      "extra_md5": "1e2da9c059efcfcbd665eda4e53397a5",
      "listing_type": "land",
      "price": "11400000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822814+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "3000000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "afb81d680311cae9e7bcd5c8ce32e643",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4a47c68acdaf72d15d5c3e9bf502c273c928a9ff9408b3c7237a1b7653125a5e"
      }
    ]
  },
  {
    "id": "5c6d460a-4061-4c07-96e3-7dfc53839420",
    "expected": {
      "area": "Wakiso",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e7ecd182056c61740a5d72711f14c5a1",
      "district": "Wakiso",
      "extra_md5": "3f33357f32ea9183a477fe3ed8b03060",
      "listing_type": "commercial",
      "price": "270000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "270000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "ddb2f6b23e0cafc4fce30acbec528784",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Commercial land for sale in Wakiso, listed at UGX 270,000,000/acre. 10 prime Acres in Matuga (Bombo rd) Featuring 900 meters off tarmac Perfect for both industrial and commercial purposes Selling 270m per acre Private mailo land Wakiso district. Watch the attached video tour before enquiring. Contact Tuyisengye Innocent to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "05be2a8f277226769b2f2911bfe03a32f8ca2481ac69d4b18c427e1067afc98f"
      }
    ]
  },
  {
    "id": "5cbe2233-3766-4815-b62b-aa974a91a24b",
    "expected": {
      "area": "Bunamwaya",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "fde9ef7f4276ee0dd6b1198d9288f384",
      "district": "Wakiso",
      "extra_md5": "9ab369fb1e5adea864d32061f4beeb2f",
      "listing_type": "land",
      "price": "60000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "60000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2d3d263d6fa0cabad0858ac89b74423a",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Shell house"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c1def9bc537e005631d96543866a44e228ca03276de0a2d99ac64af06b2d5393"
      }
    ]
  },
  {
    "id": "5e564aa5-705a-46a2-a62c-7ded146dbcae",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "64bb48c9b0c19b591dab9bbbda9af16f",
      "district": "Wakiso",
      "extra_md5": "6468e0c1938f1a9aaa7af663af99804c",
      "listing_type": "land",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "650000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "House for sale in Kira",
      "description": "4-bedroom house for sale in Kira, Wakiso, listed at UGX 650,000,000. 4 bedrooms, house in kira- kitukutwe( parliamentary Sacco estate) Seated on 30 decimals at 650m( Negotiable). Ready title. Watch the attached video tour and browse 4 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e57dcc8929d7f1033ff93c7c6dbc1c1e917712e485c43dcdb33a6d1ed54079a5"
      }
    ]
  },
  {
    "id": "5eade723-ffd9-45c5-9367-5de32f5bbabb",
    "expected": {
      "area": "Luwero",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "e0c2039a7af2572489968adb792a8fc3",
      "district": "Luwero",
      "extra_md5": "014d91cbcd168aac6061d8297469e169",
      "listing_type": "land",
      "price": "13000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "13000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "532582584db3bde0cfb18c3f2a6458f8",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "10bdc371157b0e7e0c3a6a94f57db792b263b49e10806b0cfac6ea8f2d9d948d"
      }
    ]
  },
  {
    "id": "5f5ca492-eda0-4d9f-9e3e-6932a12b710d",
    "expected": {
      "area": "Kyanja",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "0211b24f792b04d5b1dfbd5f15ef9739",
      "district": "Kampala",
      "extra_md5": "41dcfd5f92bfb12aa248e672f374d943",
      "listing_type": "sale",
      "price": "21000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "21000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b173035ba2cc3b4b79c105c62aea21b9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 2300000000,
      "price_original": 2300000000,
      "title": "Property for sale in Kyanja, Kampala"
    },
    "extraPatch": {
      "price_original": 2300000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e60eac85f5de8f412d5ff6871dc5a03ebc0966dc46147dce3302a808e1b73cbe"
      }
    ]
  },
  {
    "id": "603b2cb8-c0b0-4d6c-b093-985b959aeadd",
    "expected": {
      "area": "Kitovu",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "65803a917adfdaa06fd5df450ecacb4c",
      "district": "Mukono",
      "extra_md5": "8293e793ff7f87458962511d8e907163",
      "listing_type": "land",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0a13e01d30768cf44c112c8da5ef48ca",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "83a60b0410935ffca6aaa67bc83b22b578cef2caff7b3483e797f981095faba4"
      }
    ]
  },
  {
    "id": "60468ae1-0651-4cb9-a544-4f20c811567d",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "013bc16ba6dc6c8d6dce315a62c9285c",
      "district": "Kampala",
      "extra_md5": "e8e43979fac5d6f0c002a5325359eb70",
      "listing_type": "sale",
      "price": "1200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "99fc7c0cc0cfbb590cf13fb4773510c2",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 1200000000
    },
    "extraPatch": {
      "price_original": 1200000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a0d774de513d9dad3dac016f1d3b0c7aa0ebb0331b9c53519787da52fdd5475d"
      }
    ]
  },
  {
    "id": "60e8693f-b1a6-42ea-961c-b5be49789ee3",
    "expected": {
      "area": "Namayumba",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4494bcd53f197dfa424b3de7f4da3cc7",
      "district": "Wakiso",
      "extra_md5": "8315f4ab6897775b96dc2f5aa18a6975",
      "listing_type": "land",
      "price": "50000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "50000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "56807ffc29d271c2607f6551aa9a94e3",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b801d13f973c71834c1b23f8f384c36d057036eeabd011c0cce9f754440a4d81"
      }
    ]
  },
  {
    "id": "6125bb42-26f6-45e6-a20b-ac7fe635bcee",
    "expected": {
      "area": "Kawempe",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "8b253506ba439e4dd607c2be91396bb7",
      "district": "Kampala",
      "extra_md5": "547a50be7415672b6fef101a195e77bf",
      "listing_type": "land",
      "price": "68000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "68000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7ea523e95b23c3cfa80c5dcf85a54534",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "477a1d530f45664c15be6c337e75865516ac690478431925e7e18021daa627f9"
      }
    ]
  },
  {
    "id": "61319299-a7fd-4eaa-9b2b-a3ec2436cb76",
    "expected": {
      "area": "Bukerere",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2cd6974b063d77992e46c67a529419ce",
      "district": "Mukono",
      "extra_md5": "53c1ab2bd3ad2d2408d3ee56d20561b8",
      "listing_type": "land",
      "price": "245000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "245000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ef7479010289e060e805e1ff5ef7b001",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 35000000,
      "price_original": 35000000,
      "price_period": "plot",
      "description": "Land for sale in Bukerere, Mukono, listed at UGX 35,000,000/plot. Bukerere 7 plots of 50 by 100 private mailo each UGX 35 million. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 35000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "af354436ca287a027361b36a8b325f649089e84ee90d04cb76eebfd38caf0233"
      }
    ]
  },
  {
    "id": "619393b0-cd44-4af0-9aca-953269e73e0e",
    "expected": {
      "area": "Busukuma",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "5484c3ec4fd9528fc9f03c22dba77955",
      "district": "Wakiso",
      "extra_md5": "311c429a4a14405d7dce34b2816baa55",
      "listing_type": "land",
      "price": "750000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "750000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "8d681fc56b3ad07e49689a1a4fab7a48",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5784fd4cebc3ca05d4d71cbfa584e5955dd5baffc4c3cc6fc72f2e83b4389b47"
      }
    ]
  },
  {
    "id": "62550b7f-230f-45c0-b81f-187b275cc47b",
    "expected": {
      "area": "Wakiso",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "52348b613bb9418e6708a18297154907",
      "district": "Wakiso",
      "extra_md5": "02b0f98f2d8217635fb01a037e8ce1e8",
      "listing_type": "sale",
      "price": "17000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "17000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "land",
      "status": "approved",
      "title_md5": "4ec4695842d2a4b878f6c25e49b2424e",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "5b59be32c015c68f93fcca7056387e6862470d59a2385b9238350de26cd9d3b1"
      }
    ]
  },
  {
    "id": "62718f54-d77f-418d-8400-932ca5d57549",
    "expected": {
      "area": "Gayaza",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "93a4eb03143e916c4bf8f4c61afb9976",
      "district": "Wakiso",
      "extra_md5": "f129a9f7cafd7a0fdeaa5fc34da6edd0",
      "listing_type": "land",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3da6b3b9a1d716ee568f50aca00103bb",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3b7d000d5ff3c5d53ccb0c88703e21bfc83909a97eb83eb21b005ddd4645780c"
      }
    ]
  },
  {
    "id": "628d1e3c-a4ea-4f95-b554-6696ef3e177f",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "5",
      "description_md5": "9e9ca2f326ce10bd5bc8879dbfb24f14",
      "district": "Wakiso",
      "extra_md5": "1b7bcb3fafa6916a55feee1ae0d3d89d",
      "listing_type": "sale",
      "price": "930220500",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "930220500",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "54295f016fe0129017fe2187fcf3f159",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 950000000,
      "price_original": 250000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "title": "5-bedroom property for sale in Kira, Wakiso"
    },
    "extraPatch": {
      "price_original": 250000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8061682229d0a0dd9b32a6bcc87a755252b5e39fb78332dfa27c757337ba849d"
      }
    ]
  },
  {
    "id": "62a9c80d-ce13-4c0a-81e9-2094e95573f2",
    "expected": {
      "area": "Ntinda",
      "bathrooms": "0",
      "bedrooms": "6",
      "description_md5": "3983421b2557e5139f37cd2240cb32fd",
      "district": "Kampala",
      "extra_md5": "f6f048bbeb48e8cc7dfea59a76bfdc44",
      "listing_type": "sale",
      "price": "1691000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-26 07:05:42.675+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "445",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": "house",
      "status": "approved",
      "title_md5": "fbf6a38feffe392d578ee17435aa900b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1691000000,
      "price_original": 445000,
      "title": "6-bedroom house for sale in Ntinda, Kampala"
    },
    "extraPatch": {
      "price_original": 445000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e85c16f5a9012ce0655c619159c90084d6b78ff98bdba723951b7f49b825ce3b"
      }
    ]
  },
  {
    "id": "63d99904-a66c-4ac4-96a6-93a9f9d0b0dd",
    "expected": {
      "area": "Luwero",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4c8e0e2a9f9141abc9e8c1b106cd4302",
      "district": "Luwero",
      "extra_md5": "4605c802fb5a7712d59e59ae832dc2f6",
      "listing_type": "land",
      "price": "13000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "13000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d28b9ba55f5bb8eb22822f60dd9d7f44",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1b46e34dd9a83c82489becb575c9aec9fc79e1249357ceaabb54494a8d970511"
      }
    ]
  },
  {
    "id": "64ec541b-af75-46d9-ba5f-a3bc77675e1e",
    "expected": {
      "area": "Wakiso",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "33cc34458d48f3cbb77c557c180a3962",
      "district": "Wakiso",
      "extra_md5": "920305ad3a1e8420dbf61f0f6fd043f9",
      "listing_type": "land",
      "price": "65000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "65000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f0e5dad493841ae48d9c6c95258f12da",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "06aab9138b616558e99d5bddc9df6ed7804585287174932dd173dba28dd6abad"
      }
    ]
  },
  {
    "id": "6855c96a-5389-4267-9f86-fe022fa36831",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e920df2c7f2502582405b083bc0a9e21",
      "district": "Kampala",
      "extra_md5": "a452100a91e68a08e629b6d1cc42feca",
      "listing_type": "rent",
      "price": "5000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "5000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "7ba0212dbfc7db09dcd9f1f55c9b45ee",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1500000,
      "price_original": 1500000
    },
    "extraPatch": {
      "price_original": 1500000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c27ac018c42866533e321c91c010a81b54caef8d0dae88514b61d19995a52525"
      }
    ]
  },
  {
    "id": "6a230e07-3bc6-4afa-88e0-5e4e8f9e3d97",
    "expected": {
      "area": "Nakwero",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "939559a6e551c0cc4f3e52033d1ad81c",
      "district": "Wakiso",
      "extra_md5": "18b27e170c78582a457e7b8b0da11e97",
      "listing_type": "land",
      "price": "55000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "55000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "35da9f7897dde1e779bf769a4aa02ed1",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Nakwero, Wakiso, listed at UGX 55,000,000/plot. 🔥 QUICK SALE – KIRA NAKWERO! 2 Plots @ 55M UGX Each! 50x100ft | Private Mailo Title Ready Fast-developing area, water & power on site Great access road Buy one or both – Titles on table! Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3a64f0484707c50361ac38d0e35aa7d124a648ecfd7652057c0da35feb4fcc92"
      }
    ]
  },
  {
    "id": "6acca4d4-880e-4b1a-b4df-ec1daf3a4182",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "77ef9782663618ef5116d6272b59f410",
      "district": "Kampala",
      "extra_md5": "6b5865f7d88932f85bebee6efc6648c6",
      "listing_type": "land",
      "price": "240000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "240000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "8f3b57139ecc52755ca148000d34aaf4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments",
      "price": 2600000000,
      "price_original": 2600000000,
      "title": "Apartments for sale in Kiwatule, Kampala"
    },
    "extraPatch": {
      "price_original": 2600000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "91efe01694df0f5454d073be77aa7b387ec514095b3f2a1abb95237feb290f1a"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "91efe01694df0f5454d073be77aa7b387ec514095b3f2a1abb95237feb290f1a"
      }
    ]
  },
  {
    "id": "6b65af98-c8ed-43f2-a98a-b2828c6527db",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": "15",
      "description_md5": "62bfcb91a070437ef3a3342887625812",
      "district": "Wakiso",
      "extra_md5": "ca92e2061330b02a258bed2103615628",
      "listing_type": "land",
      "price": "490000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "490000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "5-bedroom house for sale in Namugongo",
      "bedrooms": 5,
      "description": "5-bedroom house for sale in Namugongo, Wakiso, listed at UGX 490,000,000. Namugongo Five bed room house 15 decimals Ready land tittle Asking price 490 million. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction.",
      "Caption says Five bed room house, 15 decimals. Fifteen is plot size, not bedrooms."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "183f7b54ae93790a434882eda3da3b5af558bdc9e4af9c34d5b4a5fb2631e3fe"
      }
    ]
  },
  {
    "id": "6b778c5c-1dfc-4d87-a0bd-fb19cddbc5b3",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "b5ef93563aaccb1c3de84554c1d33c35",
      "district": "Wakiso",
      "extra_md5": "fcdb4cedcf7a46f8787d7048e92e982d",
      "listing_type": "land",
      "price": "110000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "110000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7ff4daf91575e06436190986b5420ac4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Nakawuka, Wakiso, listed at UGX 110,000,000/acre. 50 acres Nakawuka private mailo title each UGX 110 million. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "44f8a2fe1d85297ffc4311cc68f69907e88f15d86912b069d6ec3bc7e04bbd1c"
      }
    ]
  },
  {
    "id": "6ce2039d-7048-42e0-812a-62eb1fd9da7b",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "fe56cc422ac27a5f558b708cf40da064",
      "district": "Wakiso",
      "extra_md5": "dafa582303a2dd25c597d8a66b582944",
      "listing_type": "sale",
      "price": "2200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "881efde92b1a1dcf491ae3c14cda4c08",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Naalya",
      "description": "Apartments for sale in Naalya, Wakiso, listed at UGX 2,200,000,000. Naalya 16 unit apartments ( mix of 1 &2 bedrooms) monthly income 18 million on sale UGX 2.2 billion negotiable. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0b3feee8d75720fc5769b32dfc67206df7396eb821ad067ded94f07e4aa6bc33"
      }
    ]
  },
  {
    "id": "6cfb4404-190d-4279-b593-78cbfd22345b",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "44947888d7a89ab4043c350bb52d4fb4",
      "district": "Wakiso",
      "extra_md5": "3979c67031773140a05bcebe6488b619",
      "listing_type": "sale",
      "price": "550000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "11",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2fade3a015fec671c45a2ec0605065ad",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 550000000
    },
    "extraPatch": {
      "price_original": 550000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "39db169393e343459d3ecb71043dc137010d61217c987a9e0029089fb79fc5f8"
      }
    ]
  },
  {
    "id": "6cfbf108-edbd-46e9-9498-f73fe020d170",
    "expected": {
      "area": "Mityana",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "52df96010b8391b80dfe8eb1cdbc97b0",
      "district": "Mityana",
      "extra_md5": "7ddcc59c39e331d6c53519ec90fee332",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5e2616b1f17a434b65720163a144cc52",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "51a65f0f1aee0c94c63296b2fb4da4ec63eabbdf96b8bc023b49169569f6248f"
      }
    ]
  },
  {
    "id": "6d41f73e-cee1-428c-956e-434577e10916",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "ce5b2941aabd1884514f711cedf56131",
      "district": "Wakiso",
      "extra_md5": "95b30a9bca76a73a7d6a86232cd910a5",
      "listing_type": "land",
      "price": "250000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "250000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "e39fe726e1b1cfccc117f96a986f78ad",
      "transaction_type": "rent",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "once"
    },
    "extraPatch": {
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "The plots are explicitly for sale. The current UGX 250 million amount matches the 50x100ft option, not a monthly lease."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0a3344a6855cc74f70004db9d26a41b8c72d63b565e7936f97b23a2aa4f7a39a"
      }
    ]
  },
  {
    "id": "6e4e8f60-be64-4d62-ac0b-c638d4463d0b",
    "expected": {
      "area": "Kansanga",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "428bd8d0b10e0a0a9c1e5749a75000de",
      "district": "Kampala",
      "extra_md5": "4c16a90e650c82165fa27291e603f36d",
      "listing_type": "sale",
      "price": "2500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f0c59d3930dd3a4d73e718b2bb215a4d",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment building"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "658016d36d38125ab0c5bf0391f344452a30dda7359a343add1304fdaf96200f"
      }
    ]
  },
  {
    "id": "6e92b774-740f-44de-9d9e-cc49f9f938e8",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "aa62adba032bece17256eb492afee0eb",
      "district": "Kampala",
      "extra_md5": "84beb24b91f3c8581b549a68be6d6980",
      "listing_type": "land",
      "price": "90000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1b35a88711659d8bcecde6f169290919",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f67bfe435f29d3ae3974b102d34c9efd3ec2eb3c92105ce712a73559ff933612"
      }
    ]
  },
  {
    "id": "6f5d8307-8e8f-4336-a509-642b3fff19e6",
    "expected": {
      "area": "Najjera",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "1fd20ae99c2dea8f308695da2f7638d4",
      "district": "Wakiso",
      "extra_md5": "57bec9ba7a5c67db8aaa4c41dc8ee8a5",
      "listing_type": "land",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "650000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "cdc2f32ae69796238a026edaeffa4bc0",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "House for sale in Najjera",
      "description": "4-bedroom house for sale in Najjera, Wakiso, listed at UGX 650,000,000. Najeera Bulabira 4 bedrooms house with staff quarters on 20 decimals plot UGX 650 million. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "315afa0a98695ad8847ed7acd038b0d88cda5b36bec925e20d5863787db6a01c"
      }
    ]
  },
  {
    "id": "6ff3991f-3a7d-4e80-89ed-873fdf1ecb10",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2bd04e035ecd7ee119ec91e7664fa5ac",
      "district": "Kampala",
      "extra_md5": "c4890803b97b6ab1d8190849ea65ded4",
      "listing_type": "rent",
      "price": "1000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": "apartment",
      "status": "approved",
      "title_md5": "776af9c14bc706acbbd41d10c6948df7",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "transaction_type": "sale",
      "price_period": "once",
      "property_type": "Apartment block",
      "price_fx_as_of": "2026-10-01",
      "price": 3800000000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "description": "Apartment block for sale in Kyanja, Kampala, listed at USD 1,000,000. KYANJA TOWN!!! 20 RENTAL UNITS APARTMENT BLOCK MAKING 35M MONTHLY INCOME 25 DECIMALS SELLING 1M USD PRIVATE MAILO. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "transactions",
      "types",
      "prices"
    ],
    "reasons": [
      "The 20-unit apartment block is selling for USD 1 million. UGX 35 million is monthly income. Stored UGX 1 million per month misreads both currency and disposition.",
      "Source explicitly identifies a twenty-unit apartment block for sale; expose the whole asset rather than a single apartment. Sale/rent/price correction must be merged from sibling intent audit.",
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "591248103720b5d6b8362af427b17999f5eedf69cbbf292e6212cf885326a046"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "591248103720b5d6b8362af427b17999f5eedf69cbbf292e6212cf885326a046"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "591248103720b5d6b8362af427b17999f5eedf69cbbf292e6212cf885326a046"
      }
    ]
  },
  {
    "id": "701dddd0-dcea-40a6-9067-cd51a321fc2c",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "67e61f5d3281672d3cd3d27acd5d3484",
      "district": "Wakiso",
      "extra_md5": "2b279d4c72f25803cb21d614e42535e6",
      "listing_type": "land",
      "price": "330000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "330000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "House for sale in Kira"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "ff88dbc30bcab38daba7152fb2c8da6e4c7db581be181381fe416b3738e020b6"
      }
    ]
  },
  {
    "id": "7031c11d-a2c3-4a05-95af-6c833c1446c7",
    "expected": {
      "area": "Kafu",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "fcec12ce731950a63adb323cff830c03",
      "district": "Masindi",
      "extra_md5": "f1faeeec5e52b707cd49f05520e7ccea",
      "listing_type": "land",
      "price": "12000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b8563b169537b7b08dcb21eb30c6c541",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Kafu, Masindi, listed at UGX 12,000,000/acre. Land for sale in Kafu, Masindi District. Five square miles near tarmac; the land starts from tarmac. Virgin and fertile, suitable for agricultural investment including a factory setup, farming, or sugar cane plantation. Freehold land title, squatter free. Asking price: UGX 12 million per acre, slightly negotiable. Watch the attached video tour and browse 4 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "bc284a99298c5530d8df73cb89c66147af6f39716927d8a9dc528ee00a35ca57"
      }
    ]
  },
  {
    "id": "70f8a53c-c6a1-419a-a856-c65762c17c5a",
    "expected": {
      "area": "Kyetume",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "38d21d331fe40ad1eb677e526de3396d",
      "district": "Mityana",
      "extra_md5": "0522c3866cb71c79455be2dbb467b654",
      "listing_type": "land",
      "price": "70000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "70000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c56c05229ea5d93d9386934dea9b5f23",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5b591d65a74f1541809c651f52b4761fed74e0e3ff582613da8cfd1c8832cdec"
      }
    ]
  },
  {
    "id": "714d5d6d-d912-4fd7-b776-90453198e26e",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a32b48fc292b2be59ed5b8f8da990735",
      "district": "Wakiso",
      "extra_md5": "5f9cdd3be695c768f14e3cf7236f422f",
      "listing_type": "sale",
      "price": "3400000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "cf672d55041c7e1c9abbf31c2ec8b0c6",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 380000000,
      "price_original": 380000000,
      "title": "Property for sale in Namugongo, Wakiso"
    },
    "extraPatch": {
      "price_original": 380000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2e932773abbb34517371bec826915d81de2c98ce95ef6d2f74fccbe3165fe267"
      }
    ]
  },
  {
    "id": "71a32220-5b20-4cac-8e3d-93361c5b4956",
    "expected": {
      "area": "Zirobwe",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "c4f7c37904dcfe1813b1ec4166703831",
      "district": "Luwero",
      "extra_md5": "db9b663c855e30f6b5e243ae85617c6e",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a67e4e10a2ef03bd3949c347c709e344",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b0e2c48bf2c458aaddfc5207d1212d801a30f9fb9809a565842af93ef03ef313"
      }
    ]
  },
  {
    "id": "71c55487-3d43-437b-b8ea-c4da2660afc2",
    "expected": {
      "area": "Mbarara",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "fdc149fc092c3c9e7427986abc0f8073",
      "district": "Mbarara",
      "extra_md5": "b9196b94faa6c758d29879961ad3bd5d",
      "listing_type": "land",
      "price": "40000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "40000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "162b7f767d223ea6ebc44be64e9edec9",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "34e882ed62840d1e0891241198e61de7016841660f713e051f11735b61bd6440"
      }
    ]
  },
  {
    "id": "723bb908-a360-47db-ae4a-b6e893693a6b",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "58ed4c06e44d3e2ad0e2f92d11b02dba",
      "district": "Kampala",
      "extra_md5": "542460fe62c9de91a2732491bd4eeaa6",
      "listing_type": "sale",
      "price": "1200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4c2951c85b7915bf40076abf016c03d3",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Bungalow",
      "title": "Bungalow for sale in Kiwatule"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land, while raw source explicitly identifies an existing house/bungalow. Canonical sale category and price remain unchanged."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "3b74d2dc36e89df024afb2a61f064ff96bbc0c6ad3ff510ad97d6dbb4ee2acc6"
      }
    ]
  },
  {
    "id": "7522f7bc-c27e-4294-8d9f-6b63b613a5cc",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8ccfcf0d4e8ae675c22ff84d5524de40",
      "district": "Kampala",
      "extra_md5": "0d1720810729c916f2afc5ad3233f998",
      "listing_type": "land",
      "price": "2600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f6177ea273101365adeb089dc0efe922",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 260000000,
      "price_original": 260000000,
      "price_period": "plot",
      "description": "Land for sale in Kyanja, Kampala, listed at UGX 260,000,000/plot. Two plots of 10 decimals each on sale located Kyanja Kampala at 260m ugx each. Watch the attached video tour before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 260000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3defeab71fc37db6296fd6059517a1453284c0067136c36699dc384a9d846cad"
      }
    ]
  },
  {
    "id": "7554c3f9-cafe-4560-b047-8cbe594f0b23",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "7c769b814247cc6f0ee708fdb850211a",
      "district": "Kampala",
      "extra_md5": "46727db1f1f3bd8dd18a6afc576b0d83",
      "listing_type": "sale",
      "price": "350000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5450c3deed35d92c91508e52b50e4e07",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Rental units"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "00dbedfdacd712289c3b30a6cfdc80f24c74441ae8cfa4b39ef91a27a4cb6b0f"
      }
    ]
  },
  {
    "id": "75c28461-2979-45d6-842e-ac6b6aec9437",
    "expected": {
      "area": "Munyonyo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a3552edf38c6ac5b6b4f38bc2397ea10",
      "district": "Kampala",
      "extra_md5": "815a6d679861f5898a743d7156e28e13",
      "listing_type": "rent",
      "price": "28293356000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "7445620",
      "price_original_currency": "USD",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "374fe7bd731fda3c50bf4bb26c2172f6",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 7600000,
      "price_original": 2000,
      "title": "Property for rent in Munyonyo, Kampala"
    },
    "extraPatch": {
      "price_original": 2000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5efba7e01615e35a9f7541c46e598375a63c5a8c5e2de47a5dc908d877105fc9"
      }
    ]
  },
  {
    "id": "772eccbb-f394-4a6e-9094-87e579da8d55",
    "expected": {
      "area": "Seeta",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "23d9a84b248056c0acaebe463d124547",
      "district": "Mukono",
      "extra_md5": "fe972663ec95e9afd41918852f8215a7",
      "listing_type": "land",
      "price": "30000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c971d4b4ef5419cb32718ec3dbc1cf32",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4157607e739b8d45b57f7f6871f1bcb11fc2d3d002d04b3d4a211285b973914d"
      }
    ]
  },
  {
    "id": "77cf5b82-f613-4f5c-bf8c-94638fe3c07a",
    "expected": {
      "area": "Kakiri",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "eaf35a594ebfc3e0713c5f7276d1fba7",
      "district": "Wakiso",
      "extra_md5": "9f9f0f501ef6bce7b6b6a0a8d51818e6",
      "listing_type": "land",
      "price": "25000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "25000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "2c71f37f0bd27987ee201ac0c544747c",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "085f62b6a51972f5868a041e952172c26fa50ef13399611f0d13c3569c052115"
      }
    ]
  },
  {
    "id": "7a46e695-99fd-4431-9a68-88fe4c663d2c",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "74f044557db5f0f89f4fbeb668acc552",
      "district": "Wakiso",
      "extra_md5": "5d7b144466b2095952cb86cfb3c78bd9",
      "listing_type": "land",
      "price": "150000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "150000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7ff4daf91575e06436190986b5420ac4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Nakawuka, Wakiso, listed at UGX 150,000,000/acre. 100Acres for sale in Nakawuka rd Entebbe road!! * 100 acres near the main road, suitable for real estate, school, Ngo projects with a private milo land title on table!! Price is ugx. 150m per acre. Watch the attached video tour before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d2ea051c6ae70ddb282cd8192c04c594f956fc502db2f394cad98730554ce665"
      }
    ]
  },
  {
    "id": "7aef720d-be98-4004-a202-344b694de3b3",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "96e9f59912180816c95fdc017f2f219a",
      "district": "Wakiso",
      "extra_md5": "2010fed2bb036159985ff2dcbcdca8a9",
      "listing_type": "land",
      "price": "50000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "50000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "abfddfb1a9aa3b82d0d6e17aeeead455",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 47000000,
      "price_original": 47000000,
      "title": "Land for sale in Namugongo, Wakiso"
    },
    "extraPatch": {
      "price_original": 47000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e2313394971f9e70fc4de1a25fb3181ce1c446c0b140cdd2111e577ce4e788ee"
      }
    ]
  },
  {
    "id": "7b310dfe-1e21-4065-8722-dc5dc5a4139c",
    "expected": {
      "area": "Naguru",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "d63ea74a9b4ba4655692fe4675c0a79d",
      "district": "Kampala",
      "extra_md5": "a0c9f1a2a3497afda333e0db18d1d580",
      "listing_type": "sale",
      "price": "2100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "313ae4deb73338591429d1e0f7488cf8",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 210000000,
      "price_original": 210000000,
      "title": "Property for sale in Naguru, Kampala"
    },
    "extraPatch": {
      "price_original": 210000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3737c18632b88716b25f908be8a0fa3a20ee3e483602cb0cf04a55ee9bc5a50b"
      }
    ]
  },
  {
    "id": "7ba95307-66ea-472b-b63d-61e08d262088",
    "expected": {
      "area": "Kyabakadde",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "d43fdd8e5a8124b2dd7ec6f24ea6189b",
      "district": "Mukono",
      "extra_md5": "5d4384fac1accd500e02ecf5b548868c",
      "listing_type": "sale",
      "price": "120000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "120000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "Land",
      "status": "approved",
      "title_md5": "652d850ac35265a409d78c27ebaa45dd",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "197c1eb96bead8f4166b738594115581522d69fbe92e697623d43bbea403bdd3"
      }
    ]
  },
  {
    "id": "7bd05260-271f-44da-82ab-f77f0f4af374",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8871310a6e2d7f3417ca7f6e302c9789",
      "district": "Wakiso",
      "extra_md5": "df00f98d6e23eeaf23ea33305c7e3c72",
      "listing_type": "land",
      "price": "120000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "120000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6aaf49506b48e67f48ee9368b66181da",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Nakawuka, Wakiso, listed at UGX 120,000,000/acre. 38 acres for sale in Nakawuka. 38 acres in Nakawuka. Caption states UGX 120 million per acre and that the full parcel is being sold together. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8298661a920b70a672f0e8131491f1d5151c4854ae13e4c9a1507ad6e8e76ece"
      }
    ]
  },
  {
    "id": "7c40eebf-28be-462d-88ad-c22ae5a8b3db",
    "expected": {
      "area": "Wakiso",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "bc28e962232410e5c194ada5bce692c6",
      "district": "Wakiso",
      "extra_md5": "8204fd6f4f7cb525d49f684ef42dfd67",
      "listing_type": "land",
      "price": "50000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "50000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "8574617695fa70a13b910fa4a5a9d6a5",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4b6853224996101cadda86ee9d3ccf898822a6a975cb1efcaa9348b7d0e1de63"
      }
    ]
  },
  {
    "id": "7cbdd6ea-206e-4699-ac2d-726fcbd22268",
    "expected": {
      "area": "Kampala",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "645ab9de0dadf89ed27e4d4dfb51408e",
      "district": "Kampala",
      "extra_md5": "ba4272365135e977ad90d950be58778c",
      "listing_type": "rent",
      "price": "360000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "360000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "4bde22e7c6546b3e4797f44f3db16512",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "transaction_type": "sale",
      "price_period": "poa",
      "price": null,
      "price_original": null,
      "price_original_currency": null,
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_on_application": true,
      "title": "Property for sale in Kampala"
    },
    "extraPatch": {
      "price_original": null,
      "price_original_currency": null,
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "poa",
      "price_label": null,
      "price_status": "price_upon_application",
      "price_on_application": true,
      "price_upon_application": true,
      "price_review": "asking_price_not_reported"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "The self-contained rental units are explicitly for sale. UGX 360,000 is monthly income and does not establish an asking price.",
      "The only amount is monthly income; no asking price is supplied, so use POA instead of publishing income as a sale price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d4d50b12b1a26d371ab4a7cdf3fe5d08f7883327fdf194a86473228c8488d840"
      }
    ]
  },
  {
    "id": "7cfc71f1-17ac-41df-bc0a-2125c5e63ebd",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2b4a5eb46e2f539581aaf5b1b7d56c72",
      "district": "Kampala",
      "extra_md5": "bcb6d24f6515b46e271a4ce4deeb491e",
      "listing_type": "sale",
      "price": "5000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "5000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e1e79603d3859ed4a78080d07b9a5525",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 5320000000,
      "price_original": 1400000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01"
    },
    "extraPatch": {
      "price_original": 1400000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1a77a018c10007746370145db1285141de083ac3402c2048a97d264ef33525cc"
      }
    ]
  },
  {
    "id": "7edc762c-f0eb-4e84-8a1a-e428afd363f0",
    "expected": {
      "area": "Kira",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "fc97c841f0452a673bf564cbd8a913bf",
      "district": "Wakiso",
      "extra_md5": "b2bc74f108b08e74b4ba91edfc6ee901",
      "listing_type": "land",
      "price": "250000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "250000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0e6788fef7f7a9e4740a72ab8921bbd6",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "56eeaa761f71af4e68449a67613669b7d27c3f93b6b88f53360364ef5a373559"
      }
    ]
  },
  {
    "id": "7f0b4296-89b0-4eb1-a922-0b5a7d68691e",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "3759c237688d17fa55b5ddd7074c5da1",
      "district": "Wakiso",
      "extra_md5": "6fa22f3977c935de9c3931e7f9521223",
      "listing_type": "land",
      "price": "36000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "36000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments",
      "title": "Apartments for sale in Kira",
      "bedrooms": null,
      "price": 3600000000,
      "price_original": 3600000000,
      "price_currency": "UGX",
      "price_original_currency": "UGX",
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "once",
      "price_on_application": false,
      "description": "Apartments for sale in Kira, Wakiso, listed at UGX 3,600,000,000. Nalya Estate 20 apartments for sale 2 bed 12 units 3bed 4 units 1 bed 4 units, making 36m selling for 3.6b ready land title Kira. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 3600000000,
      "price_original_currency": "UGX",
      "price_currency": "UGX",
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset.",
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence.",
      "Stored monthlyincome as wholeproperty askingprice; explicit sellingfor amount confirms correctwholeasset asking. No sourceidentityconflict observed; currentarea matchescaption."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a0a0b10db30e109f49a3139ce69d52d41ee57db34a73c0f82a05398f50a8c05f"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "a0a0b10db30e109f49a3139ce69d52d41ee57db34a73c0f82a05398f50a8c05f"
      }
    ]
  },
  {
    "id": "800d0ac4-fceb-4893-a17e-695b2211726b",
    "expected": {
      "area": "Busiika",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e1e33ea8d0d771061d62a8e77e8b6f89",
      "district": "Luwero",
      "extra_md5": "ddffe618b8285cde824c8a5031b844b7",
      "listing_type": "land",
      "price": "70000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "70000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "dd2e7df0db0976124e29c5b253b341d4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8c6c3ba4120c409fd22902e7f3cb5adce5c9d351997b25ece56798bd2bcf5453"
      }
    ]
  },
  {
    "id": "81099d68-159a-41c6-a3b8-c31dd9aee4cc",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "9168444728fc756f69c2a9c07bb20ac8",
      "district": "Kampala",
      "extra_md5": "b67753539fbb1846302d1c78718c488d",
      "listing_type": "sale",
      "price": "1600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "83c01b1936a0d90dd7ff8984eea37a30",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment building"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d02407f237e614a4c889883590d20a7a0defdb531feedbac44e1cc16e237630d"
      }
    ]
  },
  {
    "id": "811929dd-1a8e-429a-9c40-2430ee23f7b9",
    "expected": {
      "area": "Kyegegwa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a1660b8352335beb4310a8d0ea6b9676",
      "district": "Kyegegwa",
      "extra_md5": "1f38de937152b2d3cfb6aca5888256f3",
      "listing_type": "land",
      "price": "6000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "6000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f4283174423492b38867686529dd1684",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "c27943583716692df73a04983a1a50e98ab7c00e6c1c8fd52b6a5d5aaec6044a"
      }
    ]
  },
  {
    "id": "815cfc6a-828b-427f-8461-0f1ee16050af",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "db94887129463bcb45c69e4ecb8e2960",
      "district": "Wakiso",
      "extra_md5": "ace739d87e00d0db379113129937f6c6",
      "listing_type": "land",
      "price": "500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a451b5fbe0710b6bf9985b71f5b810cd",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "b2aadb70e1282d18e72bd1cc03dc8f5da6873a0604250b6c0ff35f51ccd3f222"
      }
    ]
  },
  {
    "id": "81fb4647-4d28-48c4-95f0-0ff73bf8c8f5",
    "expected": {
      "area": "Najjera",
      "bathrooms": null,
      "bedrooms": "6",
      "description_md5": "dc519ade154368d69a48f902d21fbbe5",
      "district": "Wakiso",
      "extra_md5": "d848a57010b889ea28162e87b5fede59",
      "listing_type": "sale",
      "price": "3000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "3000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1446f81cd2d1d38d20887a9d525c7913",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1300000000,
      "price_original": 1300000000
    },
    "extraPatch": {
      "price_original": 1300000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4b5ad39586207003365f40ac8d5dc61fe260fff602bc58143a826f6a8750489d"
      }
    ]
  },
  {
    "id": "83a7eb0b-7213-4d94-b306-680f737e8c40",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "20dbff40f1942b1638787bc59d861edf",
      "district": "Wakiso",
      "extra_md5": "e75111a30e07956ccd2b3f718119edd2",
      "listing_type": "land",
      "price": "90000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "90000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Namugongo, Wakiso, listed at UGX 90,000,000/plot. 2 plots of 50 by 100 Namugongo Nsasa road each UGX 90 million all in wall perimeter 🔥🔥🔥. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "85a10e625eca9b8343b89cc43eb19b9300ca1681b85fe58e55c68b80149b66f7"
      }
    ]
  },
  {
    "id": "8579579d-f837-4c4c-aa4c-5b9b9b92311a",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8edeeae55277c85d2feecfc0142f4c73",
      "district": "Kampala",
      "extra_md5": "86a9ec2bd450513560b45947c4c318f4",
      "listing_type": "sale",
      "price": "1400000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "16000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "daab1a122f118a81e3258f15432fe6c4",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 1400000000
    },
    "extraPatch": {
      "price_original": 1400000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "20b4128ef9b36795b6366ca0274daf6d3d0ec959ea4a3093bb83458fde649916"
      }
    ]
  },
  {
    "id": "86b79854-6294-4494-8efb-bd54e6bd6934",
    "expected": {
      "area": "Gayaza",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "ef50fe8e201e789e4e06927a32c00b35",
      "district": "Wakiso",
      "extra_md5": "7f63345f430954fd1cf18c2da0208dc3",
      "listing_type": "land",
      "price": "40000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "40000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6cf6d5a842f3b4ee7d632befbd7ec3c2",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "7f41dacdf95804de5ca37ece3dfa44a8564da3a033728fead59c148e7e03adf4"
      }
    ]
  },
  {
    "id": "8b3e6f96-d07c-4cf5-a4f2-021e8293235a",
    "expected": {
      "area": "Mityana",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "bc3334fea0cee0bdf9ebdfbabbf57999",
      "district": "Mityana",
      "extra_md5": "42138c974d371d73d1ad5f2bc2ce266d",
      "listing_type": "land",
      "price": "25000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "25000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "01bf7fa6c925ba0dad063752349873bf",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fcf564e84591e22f0884a1efeb53eb5438c5b619f9326bfb38456551117776e7"
      }
    ]
  },
  {
    "id": "8b9702e2-f095-4d22-9ad4-2c23db1dec4a",
    "expected": {
      "area": "Kyenjojo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "b1ccecf9fe9cfb34443b19e870251251",
      "district": "Kyenjojo",
      "extra_md5": "bff4448797fe2105e8fdb3ba8d84e775",
      "listing_type": "land",
      "price": "2400000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2400000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b16ef5054d16e890a8a6645793340c1b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b41cc1888c835d555a5590bfa2f3f7f6856dfb535a4ac9d9d983321ea570c6b6"
      }
    ]
  },
  {
    "id": "8e165f1e-0227-4935-8b62-120c5f22e6c7",
    "expected": {
      "area": "Mpigi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "85a79876bd625eee1ca203a5fecb9bf0",
      "district": "Mpigi",
      "extra_md5": "3f8d653970c70bb3159d854b803edaa0",
      "listing_type": "commercial",
      "price": "100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "100000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "6ec2a8984f824432115e467140cdf17b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "052fa8dc7226e27b215a67c355070d8cfafed2b01e0d6fe57ce1b3ec5121b4b8"
      }
    ]
  },
  {
    "id": "8e25bf4a-230b-4577-a424-70bf19d8664f",
    "expected": {
      "area": "Nakasero",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2b625e7ce268951440be1d9242d96dde",
      "district": "Kampala",
      "extra_md5": "66e1cbf97bf4a2500d9eceba53d65460",
      "listing_type": "land",
      "price": "3230000000000000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "850000000000000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fa4aa4c442fbb6e5f470ac00b8407936",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 3230000000,
      "price_original": 850000,
      "title": "Land for sale in Nakasero, Kampala"
    },
    "extraPatch": {
      "price_original": 850000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cfebc9097978c9cb75f34ffcc04120bccf17759db79bb41fb792d58b1599ecc7"
      }
    ]
  },
  {
    "id": "8eec38e2-78fa-45b2-87c8-f40c3c317f35",
    "expected": {
      "area": "Seguku",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "1ed3e3c5b68a2f195e5149a344f74a3b",
      "district": "Wakiso",
      "extra_md5": "1664f0d019e2d0aaf88e91d5947f99b5",
      "listing_type": "land",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "01f9c245f3a2f565e491585880499d17",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fb2b844635631e5a424276343d7f3edd7b849da23638f805ae8d704259488e89"
      }
    ]
  },
  {
    "id": "8f0deb37-26cb-40a0-b97f-e32c083c5f21",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "de93fd2e05b22c8780e2467513b84815",
      "district": "Kampala",
      "extra_md5": "cbfa06cb584c9bb325b875f06dda3492",
      "listing_type": "sale",
      "price": "350000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5450c3deed35d92c91508e52b50e4e07",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Rental units"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "09a9a219943bcee7c55cb70b5501d9f56b97a4ebcb639e2dab2e7bf6e6336200"
      }
    ]
  },
  {
    "id": "8f1a194f-6edf-4892-adfc-e6eac8cf97c5",
    "expected": {
      "area": "Ntinda",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "d2a3ff264aa217c3a6cee2bfbfb78c54",
      "district": "Kampala",
      "extra_md5": "19b5087cbcb75da20412301556d0eb5b",
      "listing_type": "land",
      "price": "550000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "550000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0266b64ae26b91e5c975806ae009cb45",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Bungalows",
      "title": "Bungalows for sale in Ntinda",
      "bedrooms": null
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset.",
      "Two bungalows are offered together; three bedrooms is per bungalow, not whole-property count."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2fdf60963fe430d9ad76dc7219129743a83c23a39504a2f90e7db9290dce6e30"
      }
    ]
  },
  {
    "id": "8f49516b-91a3-4b57-8570-11fb7307eecf",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "012c0ba8e07ef8d94d271e366b4b6a02",
      "district": "Kampala",
      "extra_md5": "d22fde40a290757598193bca86960c60",
      "listing_type": "sale",
      "price": "470000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "470000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f6177ea273101365adeb089dc0efe922",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "House",
      "title": "House for sale in Kyanja",
      "description": "4-bedroom house for sale in Kyanja, Kampala, listed at UGX 470,000,000. Kyanja Kungu 4 bedrooms house with staff quarters on 100 by 100 plot private mailo title on sale UGX 470 million. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land, while raw source explicitly identifies an existing house/bungalow. Canonical sale category and price remain unchanged."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6d03e14030e9eaa4811bd7c3e88bac4c269fb2205e1cc4448bdc9d1d10d7b75b"
      }
    ]
  },
  {
    "id": "8fd05de2-5a1c-4d0f-82fb-344d2eb63092",
    "expected": {
      "area": "Ntinda",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "b55f44767700e248cd094153ba89b230",
      "district": "Kampala",
      "extra_md5": "f6effa96e19b06a5179bd1721cf91259",
      "listing_type": "sale",
      "price": "2576400000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822814+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "678000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "85bf416903e066cbb96c94eb76e2a3fd",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6f21de0a870cebfbbbd9999f0f0d5acec3513c461766650869b752987846ed58"
      }
    ]
  },
  {
    "id": "90c177d2-f5ac-49f8-bed5-179629f3f0b6",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "804d76dc4317e76877f9bc3d573a105d",
      "district": "Kampala",
      "extra_md5": "fdf082383e64ab3e49dd9eaf7c61b440",
      "listing_type": "land",
      "price": "480000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6018979c627461bf898be91e49965e10",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "77ed7b76f3d78b8ab6661232a1e7655f3c0b8dbd19ce2e8e50a947c96782c177"
      }
    ]
  },
  {
    "id": "90d6181f-927e-4563-9cc1-83aab0abf085",
    "expected": {
      "area": "Nakasongola",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "65277f12384bbef0f3bdf0da2ec17f89",
      "district": "Nakasongola",
      "extra_md5": "7b1e3d3058748c4dd0a996b16f959bb5",
      "listing_type": "land",
      "price": "5500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "5500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6a8776b87dd224e043ff1983e9cd13d1",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "7bc436d75faf298ab31fa77ac4a7ff833aaecf3b23540e910fc537d0c41001e4"
      }
    ]
  },
  {
    "id": "910b6ae1-b01e-453a-ab97-4b88a44e023d",
    "expected": {
      "area": "Butunduzi",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "57524af4c4d5ac76e7b48c5201b53c2f",
      "district": "Kyenjojo",
      "extra_md5": "0ffd4551e35ffa408b32497d9b038469",
      "listing_type": "land",
      "price": "2500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2b3992f488d9864a058c55f628c93b28",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a29ff970981544eb2a6be5330851ae225a6b7f0d3a0b5d406a2e877d0b8a5058"
      }
    ]
  },
  {
    "id": "9149ab50-605d-4206-ab09-8371b8f0c780",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "80762007af2ec7910b44d35eda2a15a1",
      "district": "Kampala",
      "extra_md5": "de5b3a76e585c39dc22185bd615ab1e1",
      "listing_type": "sale",
      "price": "2000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "84cf4d18caeb0bf62c3630ff94444dbf",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyanja",
      "price": 1550000000,
      "price_original": 1550000000,
      "description": "Apartments for sale in Kyanja, Kampala, listed at UGX 1,550,000,000. Kyanja new apartments for sale 8 units of 1bedrooms and sitting each pays Ugx 2m Asking price Ugx 1.55bn negotiable. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 1550000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fc262dcc45d1f3120c86a91979170b512daf5a026305c5a7d594f56c5b63a6bf"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "fc262dcc45d1f3120c86a91979170b512daf5a026305c5a7d594f56c5b63a6bf"
      }
    ]
  },
  {
    "id": "92fa6535-81f2-4029-afc6-caf6f3e396e0",
    "expected": {
      "area": "Kitende",
      "bathrooms": "0",
      "bedrooms": "4",
      "description_md5": "a223fc5d35c9ab3da6f1f49ea89db0e2",
      "district": "Wakiso",
      "extra_md5": "0ad32143c03a05716fc8374c4b1974c9",
      "listing_type": "sale",
      "price": "6840000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-10-08 07:12:12.805+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "1800000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2558ad111067942c8802df70eeacd73a",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 684000000,
      "price_original": 180000,
      "title": "4-bedroom property for sale in Kitende, Wakiso"
    },
    "extraPatch": {
      "price_original": 180000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9aa0d84882133f01fae1530cca1e7fd42bf710de53a474d0de74ab976b75ed29"
      }
    ]
  },
  {
    "id": "92ffad95-1877-4933-b4d1-265de1802898",
    "expected": {
      "area": "Kyaliwajjala",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "856ab0d51c180663bc154146d53e667b",
      "district": "Wakiso",
      "extra_md5": "bc97e1adb60e6debd3ddff484a51069e",
      "listing_type": "sale",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "18caafc9948c956b968edba76edc27e6",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyaliwajjala",
      "description": "Apartments for sale in Kyaliwajjala, Wakiso, listed at UGX 1,000,000,000. Kyaliwajjala road 8 units of 2 bedrooms apartments monthly income 7.2 million on 30 decimals plot on UGX 1BILLION. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d2cb4c52dbce493ac2293e99894d3be077f6e8c9753cd4076658fa19bedb7506"
      }
    ]
  },
  {
    "id": "9347ff9c-4409-49ab-871a-b029989c163a",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "6f2f58cd59313267891401fe4146e615",
      "district": "Wakiso",
      "extra_md5": "e741c6fdfe89d8e4d6ba10dfb3acdce4",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Namugongo, Wakiso, listed at UGX 75,000,000/plot. Namugongo Sonde 50 by 100 plots New estate near main tarmac on sale each UGX 75 million. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "51d430b85268fe7406e48031422cf8d3980b627680a21adb8bdb0a427b80eed3"
      }
    ]
  },
  {
    "id": "940dd2fe-372e-4bff-b6c7-9ddaf1a2095a",
    "expected": {
      "area": "Nakaseke",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "2cc13567afb70d0e83ad0768cffde11b",
      "district": "Nakaseke",
      "extra_md5": "b705fee4bde3a896d9eb18e52126d935",
      "listing_type": "land",
      "price": "8000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "8000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5ff91be6b0ecfe2db324226166e6fc8b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "548c5221959eb2769c62331e872fe6b02a5d364201e14fabf5eb587ef79a12aa"
      }
    ]
  },
  {
    "id": "947903db-0ab3-4910-a00e-33e599219c6b",
    "expected": {
      "area": "Busukuma",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "52695a6338e45da8a7441d84830c8cff",
      "district": "Wakiso",
      "extra_md5": "aa2a7ca8cb0c1ddb594ba223f67b3941",
      "listing_type": "land",
      "price": "750000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "750000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "13f4d43466660863b819e9e40339b581",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2fde4abfffba45ea524c54c54c185b42a2802e580f91cd63c742be93961e7960"
      }
    ]
  },
  {
    "id": "94d2b246-27f5-4147-a965-871cded0b381",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2ac2d4b674874666657b666aadfd46e9",
      "district": "Kampala",
      "extra_md5": "54d2a1c162eb97f23e0481365f1a64e5",
      "listing_type": "sale",
      "price": "1500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "apartment",
      "status": "approved",
      "title_md5": "dde47984e91e11c9db22c118a5acd90a",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Apartment complex",
      "price": 2600000000,
      "price_original": 2600000000,
      "price_currency": "UGX",
      "price_original_currency": "UGX",
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "once",
      "price_on_application": false,
      "description": "Apartment complex for sale in Kyanja, Kampala, listed at UGX 2,600,000,000. Apartment block for sale in Kyanja Town!!! ( twin block) * 16 units all in total, all occupied, each being rented at 1.5m per month, sitted on 25 decimals plot size, with a private milo land title on table!! Making 24m per month... Price is ugx. 2.6bn negotiatble. Watch the attached video tour before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 2600000000,
      "price_original_currency": "UGX",
      "price_currency": "UGX",
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Source explicitly offers twin apartment blocks containing sixteen units, rather than one dwelling.",
      "Confirmed source-backed correction: UGX2.6B is whole twin-block asking; UGX1.5M is per-unit monthly rent. Existing listing transaction sale is correct."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8145be10e63a5589259ced324eac00ec6665c0c9484ef33802acb80beec8c6e7"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "8145be10e63a5589259ced324eac00ec6665c0c9484ef33802acb80beec8c6e7"
      }
    ]
  },
  {
    "id": "94ef5f3a-a917-4bc3-b4e2-b5a992e51945",
    "expected": {
      "area": "Bulindo",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "921feaf3fd1e8df4f104262dba8ddc60",
      "district": "Wakiso",
      "extra_md5": "68cd8adb4cdb083208d161621d1be3ed",
      "listing_type": "land",
      "price": "370000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "370000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6107c32af398790d3e6c5bb7d352e223",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Rental units",
      "title": "Rental units for sale in Bulindo",
      "bedrooms": null,
      "description": "Rental units for sale in Bulindo, Wakiso, listed at UGX 370,000,000. GOOD DEAL | GOOD BUY. AT UGX370M 7-Unit Rental Property for Sale in Kira–Bulindo Town A great income-generating property with 7 units, each comprising 1 bedroom and sitting room. ● Each unit pays UGX 550,000/month ● Total monthly income: UGX 3.85M ● Selling Price: UGX 370M ● 16 decimals ● Titled Mailo Land A solid investment opportunity with ready rental income and valuable titled land in a fast growing location. Contact Sewa sewa to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset.",
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3da00afc8beb4ff5dc7e2df24e664a2ec55a64a2dd6a59eb6d50290c5d5c9233"
      }
    ]
  },
  {
    "id": "95ed256e-ade3-4086-96fa-dadad4d06ad3",
    "expected": {
      "area": "Wakiso",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "a4c90fe6ae3186b69edc14c58ac9e95f",
      "district": "Wakiso",
      "extra_md5": "1e0c8de9503092b46f84879db00227f8",
      "listing_type": "sale",
      "price": "140000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "140000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ea71ab32ad13dc5b8178698576216dbe",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 150000000,
      "price_original": 150000000,
      "title": "Property for sale in Wakiso"
    },
    "extraPatch": {
      "price_original": 150000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "22109d999b8bd7f8ff91c21d35cbad90a6f37664724d4bf815c9afc38ca7a735"
      }
    ]
  },
  {
    "id": "972d28af-0b45-4aba-93e3-1bd6779ed228",
    "expected": {
      "area": "Kyanja",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "2930c8e20d97f9a600f8d8f8e4822eeb",
      "district": "Kampala",
      "extra_md5": "934fb8c8a62bebc5b9abd585ca6066dc",
      "listing_type": "sale",
      "price": "30000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "30000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5001cb867a32a70caaeb40ecc1872bf9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 3500000000,
      "price_original": 3500000000,
      "title": "Property for sale in Kyanja, Kampala"
    },
    "extraPatch": {
      "price_original": 3500000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "7765bbf28779946b828921aae1a3ab192b6f51ba80e73eec72c31eb26ebc001a"
      }
    ]
  },
  {
    "id": "9787e603-8ac1-43f8-9476-1ef097291f4f",
    "expected": {
      "area": "Ntinda",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "12857abd1efe3a23f785152eb437554d",
      "district": "Kampala",
      "extra_md5": "05bece9e3ba604c91785fef99ad66900",
      "listing_type": "sale",
      "price": "11000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "11000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "40eb00e15e4f5f86c773528dd13ffbaf",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1200000000,
      "price_original": 1200000000,
      "title": "Property for sale in Ntinda, Kampala"
    },
    "extraPatch": {
      "price_original": 1200000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "08ef65faf2943c34ceb728ced77853717a18d1f87965e5e3dc3a09b988a4d4c8"
      }
    ]
  },
  {
    "id": "99134857-0b0e-419d-b47b-ceb290bffcc4",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c25c5384d9a1c0a3a78dda92cf877fd9",
      "district": "Kampala",
      "extra_md5": "e993344ed194c2c294475900d8aea6e5",
      "listing_type": "sale",
      "price": "5500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "60000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6cddd9d90f43956bc14a47f3fb3df848",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 5500000000
    },
    "extraPatch": {
      "price_original": 5500000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "39ac8f08eda1e2dc25d7dadf9b1e67532adf83a888d6bb61903f4a59692bd0cc"
      }
    ]
  },
  {
    "id": "99bb0253-2bb3-424b-99fd-42071dbbd933",
    "expected": {
      "area": "Muyenga",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "42e81c687c527c098f302f10f39b6ac4",
      "district": "Kampala",
      "extra_md5": "adf81468d0c7020e334a9edf88740aa6",
      "listing_type": "sale",
      "price": "2850000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "750",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "494ecc4145f1195e7e18b66ef7018a48",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "rent",
      "transaction_type": "rent",
      "price_period": "mo"
    },
    "extraPatch": {
      "price_period": "mo",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "The stored title and source description/title explicitly offer a two-bedroom Muyenga apartment for rent at USD 750 per month."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_description",
        "sha256": "f3361d81b505daa0588f49d4bdfaefa32175eb3be28244b8f1f6c19b3a1c84ea"
      }
    ]
  },
  {
    "id": "9a88f9d4-bb47-4e50-a539-4ac215b91a14",
    "expected": {
      "area": "Lukwanga",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "d17ad47cd1f66d7d3787abdc9b673912",
      "district": "Wakiso",
      "extra_md5": "e197413cec7136030645561d766bb1a7",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7f20a5ac4c209856677708e8bbdc8760",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "567df317fd59e33a97d6912b5d95d3163ec4a03e56867b71f47ee9421ff6d40d"
      }
    ]
  },
  {
    "id": "9ac7ecdd-a24f-4980-8925-a7486b9edf84",
    "expected": {
      "area": "Ntinda",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "faef680a3cbc7f7673887c3b23bf19fe",
      "district": "Kampala",
      "extra_md5": "ac437ae628fea0127767753a87a7d866",
      "listing_type": "sale",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "6000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "bf2175f78a2f62bad9d93a97a1781d9c",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 650000000
    },
    "extraPatch": {
      "price_original": 650000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a30b2598739638e24a597b4361322b6ebf9f159f4fd404f238f25bf2455093ea"
      }
    ]
  },
  {
    "id": "9b75d66f-fce5-4340-8e59-97e5a77ca63f",
    "expected": {
      "area": "Mengo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "614216e39667942b5a611a2a0e15cc9d",
      "district": "Kampala",
      "extra_md5": "6679684b066fc6b90146b37332048727",
      "listing_type": "land",
      "price": "1500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "51f81d2ca037d2efc41ff3e36139d669",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "311739d09fa2e7bb11757d342779858916d612cf638355ed6de2acddcfba96d9"
      }
    ]
  },
  {
    "id": "9ba43324-c21b-431f-b48a-6d043ae16ccd",
    "expected": {
      "area": "Kireka",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "5527b7fa6de894b62b468dea97427ab3",
      "district": "Wakiso",
      "extra_md5": "3b85420c6b1291bb49495fdd0dba9162",
      "listing_type": "land",
      "price": "95000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "95000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5678652d3e661c78f0ad840398edbdda",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c58945c2f808dbb982f2e962e62d6a73d0f335021dc5e10154126f866d7d145a"
      }
    ]
  },
  {
    "id": "9ba72344-f7b0-4e85-8f1c-4f479d800893",
    "expected": {
      "area": "Munyonyo",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "4355c2f5849d212a16a18abd4a785f5b",
      "district": "Kampala",
      "extra_md5": "8c308c90c9f92c04e25f4be23f5ee26d",
      "listing_type": "sale",
      "price": "4932400000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-09-09 08:02:03.039+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "1298000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5b24864816a0cc185fdb603c499f7545",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment complex"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "adb4046ca8c54e358bf3b1388f3fc3304ef824939275dc82a275bc2e37782c9a"
      }
    ]
  },
  {
    "id": "9bea1241-9e9f-4020-9d53-970d138f0f0f",
    "expected": {
      "area": "Pader",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "8afb9291c1fbe211d2f65aaa690cfecb",
      "district": "Pader",
      "extra_md5": "80ea922177d05dc072af86731fbb7323",
      "listing_type": "land",
      "price": "1800000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1800000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ba2a262459b9893f18f1e365d7ecdb98",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "13fffcee324e113b25d6fb95abff58a428f432f78ecc960329894b8aa937d675"
      }
    ]
  },
  {
    "id": "9d395513-e6ce-4365-8ee8-6dae2ec8a452",
    "expected": {
      "area": "Kitende",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "c9bd086471e5530c6fee2ecd23768005",
      "district": "Wakiso",
      "extra_md5": "79bfa128b1fa28e1646c97153fd32e1d",
      "listing_type": "sale",
      "price": "550000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "550000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "16cf21f2b73d830d619433f233e350d2",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 500000000,
      "price_original": 500000000,
      "title": "4-bedroom property for sale in Kitende, Wakiso"
    },
    "extraPatch": {
      "price_original": 500000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "74c0aae0143dd0242e41d3035c4d763f3cb7fccdb303433fca0e93118d7d2b29"
      }
    ]
  },
  {
    "id": "9d80a134-a64d-49ff-8b7f-d879d0c10744",
    "expected": {
      "area": "Bwebajja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "5cfe4844a4272bea96cbd35c98b9e280",
      "district": "Wakiso",
      "extra_md5": "873d0adb661734a67020a3e118953a7c",
      "listing_type": "sale",
      "price": "1650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "office",
      "status": "approved",
      "title_md5": "969b8f95649d3d25697591c49eb3a523",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source offers an eight-bedroom home; office and gym are features."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "85c3e2da50065252a165e15f9a3cdf21a95b10f3453c09eb146821325450cc16"
      }
    ]
  },
  {
    "id": "9f11a21a-53b3-42ee-a2b9-cc4c98615ee4",
    "expected": {
      "area": "Bujjuko",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "ecdfb261ff20442a13b580747aab2366",
      "district": "Wakiso",
      "extra_md5": "02f3bf801e52fb5baff01558bb08bde9",
      "listing_type": "land",
      "price": "25000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "25000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1c8b3e025e9c6bfaf5ebe0840ba9a7d7",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4797a7e94b1c0368d4f7765aaba0d96c7de972cdeb482102303dba912d6b4efd"
      }
    ]
  },
  {
    "id": "9f255a9a-086c-45bc-a644-58207e0e3c0f",
    "expected": {
      "area": "Bukoto",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "23a25652006c5e02939f15b71655ccb8",
      "district": "Kampala",
      "extra_md5": "02686639475408c4580c663fa2eafd51",
      "listing_type": "sale",
      "price": "345600000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "345600000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ea5f1b1e0582157042ae3537f510502d",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment complex",
      "price": 3200000000,
      "price_original": 3200000000,
      "title": "Apartment complex for sale in Bukoto, Kampala"
    },
    "extraPatch": {
      "price_original": 3200000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "86e128357cae2c27102137b61bf1a57f61e3b39b40464810b254866d78feeaf1"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "86e128357cae2c27102137b61bf1a57f61e3b39b40464810b254866d78feeaf1"
      }
    ]
  },
  {
    "id": "a03daedb-45f4-4d57-bd5a-d7e07b66e894",
    "expected": {
      "area": "Ntinda",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e6e456ed0978bd44706a589f6beab22e",
      "district": "Kampala",
      "extra_md5": "7fc58a04060f129e59c0162057d1af84",
      "listing_type": "sale",
      "price": "1300000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1300000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "cf54e523a899dd40f43571f114a6f40b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1500000000,
      "price_original": 1500000000,
      "title": "Property for sale in Ntinda, Kampala"
    },
    "extraPatch": {
      "price_original": 1500000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "1c49e28d4b5a9a6bab01d1c02d3ee4c432bf5bd375011af7ded10bf3ac355dde"
      }
    ]
  },
  {
    "id": "a0ceff6b-7fc1-4d43-a00c-44ea5d5094ef",
    "expected": {
      "area": "Kyenjojo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "5eff286094ed9f06aacadd5fbe79dc15",
      "district": "Kyenjojo",
      "extra_md5": "b03eb7bea38969d749e41f898aeb7e15",
      "listing_type": "land",
      "price": "9000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "9000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "46509f60e70b724a3701ce581023a0ab",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "961f55450e77a151c73877a2787b46b410b2bfbe88d98735f76ff91a02011005"
      }
    ]
  },
  {
    "id": "a13b3a01-255d-4f5d-b59a-8962d9ddefc8",
    "expected": {
      "area": "Bulindo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "312208d0b24758724774773e443e7aee",
      "district": "Wakiso",
      "extra_md5": "bdac66db0e86dba4cd114e53f7e7fabf",
      "listing_type": "land",
      "price": "125000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "125000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6107c32af398790d3e6c5bb7d352e223",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Double rental units",
      "title": "Double rental units for sale in Bulindo",
      "description": "Double rental units for sale in Bulindo, Wakiso, listed at UGX 125,000,000. Kira Bulindo 3 double rental units monthly income 1.5 million one plot off main tarmac NOW SELLING UGX 125 million. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6ab3942b5665849ea03c40d46cb6ac484e5e857f565f3705a9cc124e099df0f6"
      }
    ]
  },
  {
    "id": "a1616f27-fa2a-4e59-b06a-c452c7da32af",
    "expected": {
      "area": "Gomba",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "63788506c0eadbadb2df9df0decf0718",
      "district": "Gomba",
      "extra_md5": "52f9773256103d61e89201d6fbed6acb",
      "listing_type": "land",
      "price": "115000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "115000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d359cd7eab2839cd26271a3466b2867d",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1431a5bc59551bc5b532944e2b148407f9357d8b37770a4700b052f7a9108c51"
      }
    ]
  },
  {
    "id": "a17a23fe-3a78-4fdc-9950-8a5286413c5d",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "0d90e255bcb927a1aa289f5113724c55",
      "district": "Wakiso",
      "extra_md5": "49b4b5c945cb9e1069758223a64ad223",
      "listing_type": "sale",
      "price": "540000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "540000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "444b80fa4cb439d4f2929151ccc794dc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 45000000,
      "price_original": 45000000,
      "price_period": "plot",
      "description": "Property for sale in Nakawuka, Wakiso, listed at UGX 45,000,000/plot. 12 decimals estate on sale at 45m each 50 by 100 located at sissa buswa nakawuka road. Watch the attached video tour before enquiring. Contact Segawa Frederick Kevin SFK to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 45000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a287fab8e67b27ed0b8cee68171f80230b3296e2b9e63445aa29b2bbb6f287aa"
      }
    ]
  },
  {
    "id": "a2dd9c90-993e-4eeb-ba8a-53d59cb17b9b",
    "expected": {
      "area": "Pader",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "308127f6512b0094e9db82b23087de2e",
      "district": "Pader",
      "extra_md5": "f7df564dd4f50881c37f0c67e7993f36",
      "listing_type": "land",
      "price": "2000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "38e8916fa290633e052a5e93bb50b67c",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d859025358a49f784f08788a767db67089db1633f94551b25ce1766a6d6a0f2c"
      }
    ]
  },
  {
    "id": "a2fd2cbb-ae8b-4fef-8bcf-44d359a8f986",
    "expected": {
      "area": "Munyonyo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "6bfdff3da06d8b3aaba9eb09e099448e",
      "district": "Kampala",
      "extra_md5": "7cd61f0f47f66bb36497af2ca38b315f",
      "listing_type": "land",
      "price": "5700000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-09-09 09:33:17.052+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "1500000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "464ae00385245fa91e3b26bad5b22698",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "73e9cd0fbf590473500c995d161ecc87a36455fd3c9a98b130b323406e78b22b"
      }
    ]
  },
  {
    "id": "a37f8306-1928-41cf-899b-5621c27f56da",
    "expected": {
      "area": "Najjera",
      "bathrooms": null,
      "bedrooms": "6",
      "description_md5": "8e54b559c67213d70a9fdb01316e493e",
      "district": "Wakiso",
      "extra_md5": "8697e757affefd46c6dc5b087e8d44b8",
      "listing_type": "sale",
      "price": "1800000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1800000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "710d4185d8d77bbddfc4045c2ec114f0",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1600000000,
      "price_original": 1600000000
    },
    "extraPatch": {
      "price_original": 1600000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "701b6e8d14713b2f18bce4b71a04e0c780170b84cfdb3383a9b814a083a95981"
      }
    ]
  },
  {
    "id": "a3a9afa9-3517-4441-9e49-6d96428742d3",
    "expected": {
      "area": "Najjera",
      "bathrooms": null,
      "bedrooms": "6",
      "description_md5": "31706c66848d9a8e8dcdf2b313a31900",
      "district": "Wakiso",
      "extra_md5": "4440a1989693335e667516114eb04570",
      "listing_type": "sale",
      "price": "2000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f8fe2e653eba1b0769d2b19ff0577936",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1200000000,
      "price_original": 1200000000
    },
    "extraPatch": {
      "price_original": 1200000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3c5194f081dbf25bc0a1ff9b17c56cf576b83078be8bf1fc334dd6f624d9811e"
      }
    ]
  },
  {
    "id": "a63c4ca6-ebf3-4203-8ca7-ddb6525f9bd2",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "96e82dae6f193bdc9ae1cebd8530f263",
      "district": "Wakiso",
      "extra_md5": "6f7add6a6abdf33ab96232a906e07a45",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Namugongo, Wakiso, listed at UGX 75,000,000/plot. Namugongo Sonde 7 plots of 50 by 100 very near main tarmac on sale each UGX 75 million. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "640041d031c085c8141bae9802ad225f4ea18032361bcd04bcdc8f6df985b5b1"
      }
    ]
  },
  {
    "id": "a6e3744e-12df-4d8a-93f5-774448b3abd3",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "ee0ab1761333bc9dcb992f1d89f074ce",
      "district": "Kampala",
      "extra_md5": "2c5fe0038ca56eac506b57d6970dc059",
      "listing_type": "sale",
      "price": "1800000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1800000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c52cb5c355c501eaeaaf5f34b2744d84",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "bb26cc6087db9dfe5a7d9f435eb97a4acab4a2af44f5d72ec7606125e6fbb67e"
      }
    ]
  },
  {
    "id": "a85431b4-ad26-4f40-bf26-eb3844b0a2fd",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "77a864e177a77214f0284c54eeca7fff",
      "district": "Wakiso",
      "extra_md5": "c5186119187006bc3c327cd80f70ec3c",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "016b446226fbf71aa852fc009122e7c3",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9f3f4aadf19ea0d945f6679f02ec7582088ca6dad36d60e28b91ec9080878d7f"
      }
    ]
  },
  {
    "id": "a8e58d46-2494-4108-8240-d9628c39ce2f",
    "expected": {
      "area": "Namasuba",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "dac766f20a0d7d39eaa3c51c5fc1e451",
      "district": "Wakiso",
      "extra_md5": "ef2b1c94dc345a88749b89b9bd140378",
      "listing_type": "land",
      "price": "1500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "99e957d9b0763a0f093f05d0cce97729",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a34f4a20453769c713fe34f662581f4178b69af03c37a2dc735156a51fe60f09"
      }
    ]
  },
  {
    "id": "a910e59e-3e34-452b-b217-16d5ef485683",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "e755321a1cc4751657ad46724255801b",
      "district": "Kampala",
      "extra_md5": "bbb955797b11bc8d6f04be68a8a9bae5",
      "listing_type": "sale",
      "price": "2363600000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "622000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d3bc0abebab2472c03fa87a5d6100390",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e409c2d51a2ac3ecbdadb2180a34a4362bd152fcacd11ae30e94670b85a58ac7"
      }
    ]
  },
  {
    "id": "a989d750-1cef-400b-aec7-ed4e9e0089f9",
    "expected": {
      "area": "Muyenga",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "4860f793ca1062b59057e4a6847fee71",
      "district": "Kampala",
      "extra_md5": "2af5c9416e92cb64af05699ec76c7c4e",
      "listing_type": "sale",
      "price": "2900000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2900000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "579ca40a6f47134577f29a551b6e8ac7",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment complex"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4dc31d67200544fff9941ea52f64317de0dde69e8515f477639a7e31ec86300d"
      }
    ]
  },
  {
    "id": "ac46726a-45c0-4afb-809b-5c37dc5c55cc",
    "expected": {
      "area": "Wakiso",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "f5229d3aa4883cb84d5fd25d8be83dca",
      "district": "Wakiso",
      "extra_md5": "46618a61f77fd1f30a5f827dd9fdd9bb",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "land",
      "status": "approved",
      "title_md5": "ec71d07a985bd9613fe128efb6f99936",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "913df91bcc0bf5af7a42dd91d78eb1b3b2c08167891e198eba1a3762d3643157"
      }
    ]
  },
  {
    "id": "ac51316c-e8c5-466b-9934-d55a4d137f6b",
    "expected": {
      "area": "Kigo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "5302fa782e31c77bf83f5e2921274811",
      "district": "Wakiso",
      "extra_md5": "1f059c4a1b69fae21ba815ee00289c49",
      "listing_type": "land",
      "price": "85000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "85000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a5154dca5936ac367f6d04824aaa87de",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "acc5f0d6f6872274ba9c944eb43f099bf99c688b007529d556efd1fada576891"
      }
    ]
  },
  {
    "id": "ac6a57d7-09c0-43a4-bb05-2bcbebfbefba",
    "expected": {
      "area": "Nakwero",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "197bc9989c28f725139f9133e8eccdcb",
      "district": "Wakiso",
      "extra_md5": "8140b8bbf88fb3646219009826bb8c27",
      "listing_type": "sale",
      "price": "160000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "160000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "35da9f7897dde1e779bf769a4aa02ed1",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Rental units",
      "bedrooms": null,
      "title": "Rental units for sale in Nakwero"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land but raw source offers the whole set of existing residential units/houses. Recorded two bedrooms is per unit, not the whole asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1c4a86c2867c9db5a2c4375c9beab697bbf946a8005d65dac6c2f196fcf6380d"
      }
    ]
  },
  {
    "id": "ad90c43d-211f-4f4f-b66b-0ac87765e510",
    "expected": {
      "area": "Bunga",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "c92c8437a3513ecd3bfd718db2fd44c3",
      "district": "Kampala",
      "extra_md5": "18c6941d2f0fd35d868f42e1c51bb16d",
      "listing_type": "rent",
      "price": "170000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "170000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "0d426ef3ee669abc50b4e073ef4d4dd9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "night"
    },
    "extraPatch": {
      "price_period": "night",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes a nightly/daily amount; monthly suffix is wrong."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ad3cc66ac4b461506561b71d0cf68ecd3e1de78babc6edd4ee370ff7ce36f35e"
      }
    ]
  },
  {
    "id": "adb31037-0f31-4b73-b0ee-92fb4d5160a4",
    "expected": {
      "area": "Kyebando",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "9ca611367eb21b2eaf5d6d1dbda827a0",
      "district": "Kampala",
      "extra_md5": "efbc46200b053205dcafb90472f1c727",
      "listing_type": "sale",
      "price": "600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "313798f3c97220c54ef05b756b6ba1ac",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Rental units"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b693f2fdf36c7defbbc129e7a11239232009b0dd900d4211ad253bd11043241b"
      }
    ]
  },
  {
    "id": "b02573a2-865a-4fb6-8453-e0b89c540d58",
    "expected": {
      "area": "Kyaliwajjala",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "1b4187b22c6dde8eea9875e164a6a089",
      "district": "Wakiso",
      "extra_md5": "993a2f7bcddf792c5b4e150f82c503b3",
      "listing_type": "sale",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fc141ae42fe44f81ed2e71cd299a88c9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyaliwajjala",
      "description": "Apartments for sale in Kyaliwajjala, Wakiso, listed at UGX 1,000,000,000. Agenda Kyaliwajjala road 8 unit apartment of 2 bedrooms 2 bathrooms monthly income 8 million on 33 decimals plot UGX 1 billion. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b1415588ace74eec15917b446b78ca8fceb2e0ec59f8a9369a133c2329989339"
      }
    ]
  },
  {
    "id": "b0bc9ab4-cbf9-4dfe-9580-2fed9fc5e32c",
    "expected": {
      "area": "Seeta",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c8e17312792ecdec096cb06ef6c7fcc8",
      "district": "Mukono",
      "extra_md5": "c8c0b43b4699697100bc6ceec3c3c43e",
      "listing_type": "land",
      "price": "706592177",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0c63f6f373b0c43b687475db25df86d5",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 35000000,
      "price_original": 35000000,
      "price_period": "plot"
    },
    "extraPatch": {
      "price_original": 35000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1cc72b5f93ccfe5535ff032ed41f73f416219929e48bc894901de45553e4c4db"
      }
    ]
  },
  {
    "id": "b16bcecd-ab59-49e4-bd12-835d1189e821",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c515a1c384a5b7b841b634248e10affa",
      "district": "Wakiso",
      "extra_md5": "2e1f9d4506edf6c67d9c24e54984b79b",
      "listing_type": "land",
      "price": "470000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "f8f3e11d063640101299dd1ab20030e5",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "350484283474c387cb7619061230687f5edd1c503801590c234b20df6df90f18"
      }
    ]
  },
  {
    "id": "b2151bbe-f0f8-401f-8ed7-4d4442f8ecb8",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "86a7952109ed340797b83ef1de2f571e",
      "district": "Wakiso",
      "extra_md5": "dbdaa1351b2bb63e28626ff41aef7b90",
      "listing_type": "land",
      "price": "5500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "5500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 55000000,
      "price_original": 55000000,
      "price_period": "plot",
      "description": "Land for sale in Kira, Wakiso, listed at UGX 55,000,000/plot. KIRA KIJABIJJO 50 by 100 plots each UGX 55 million. Watch the attached video tour and browse 4 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 55000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9b35d7127f68ea6265dd01a5ca12d1ddb9be1c1e8c1ea237a798e07cabf56487"
      }
    ]
  },
  {
    "id": "b2635f95-c6d1-427e-bade-3e7fdff32cc0",
    "expected": {
      "area": "Kyaliwajjala",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "402dbc360f72104281746385a8bdd827",
      "district": "Wakiso",
      "extra_md5": "9209bdb90023e6f7fb95c96b9fe31d25",
      "listing_type": "land",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "18caafc9948c956b968edba76edc27e6",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyaliwajjala",
      "bedrooms": null,
      "description": "Apartments for sale in Kyaliwajjala, Wakiso, listed at UGX 1,000,000,000. Agenda Kyaliwajjala road 8 units of 2 bedrooms 2 bathrooms apartments monthly income 7.2 million on 30 decimals plot 50 metres off main tarmac on sale UGX 1 billion. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset.",
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "91534ac7703e26778c56ba41adde55cd9c64bfa30df6a68784be99cbfae95220"
      }
    ]
  },
  {
    "id": "b3043800-0354-4f0b-bf3f-e5530f9b2702",
    "expected": {
      "area": "Ntinda",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "4521f4bd7ec2ea775846275481c5f13b",
      "district": "Kampala",
      "extra_md5": "b898851a6db7096864edcf2795944c72",
      "listing_type": "sale",
      "price": "1493400000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822814+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "393000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b1027af9fed1a0fef67562e2fa42ae5f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "1372ec736fefbff76d3b344d0e2cdefc58579a0828e9d5019d0607960155c528"
      }
    ]
  },
  {
    "id": "b37ee9a7-6dff-4770-96cf-be6ce4e61b92",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "14138d7eca848668cc9f0a026e238d00",
      "district": "Wakiso",
      "extra_md5": "4c07cbafffe61e363f76075f1f6aa1c2",
      "listing_type": "sale",
      "price": "10000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "10000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "63b29eac9dee5cfcea865a9e22819200",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1000000000,
      "price_original": 1000000000
    },
    "extraPatch": {
      "price_original": 1000000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "48c2ee85deabc2a51973972c104f448f306b5bf79da86e95a187772674049d3a"
      }
    ]
  },
  {
    "id": "b47f3dee-defd-4396-8e2c-6e097808d192",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "1d63c6d871f1828a3f145d4ddcf12a2d",
      "district": "Kampala",
      "extra_md5": "46d79c3e2008235988cf6ba9950d3817",
      "listing_type": "sale",
      "price": "1600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9d9cd25ea04f1696c2a12d84d8bfb8d4",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "04a1607a2781c1908bc9cec6ec8ba862837c2c438c0b2bdecc3804a1fe66a1c3"
      }
    ]
  },
  {
    "id": "b5beeab2-bbe6-408f-ae39-d6d9994d2260",
    "expected": {
      "area": "Kassanda",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "b65023934e7819eef773f1798cef0575",
      "district": "Kassanda",
      "extra_md5": "b3a4962aeae1cc5b3a42ec5025deed65",
      "listing_type": "land",
      "price": "12000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9b176cf957ff9e67516925120c4209ad",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a57b6c701b32647b7481ae2b0a26ed803b20e38db8d0fb8c32b07b078ff47e21"
      }
    ]
  },
  {
    "id": "b6f664c5-6c09-49d7-b332-63d41939960e",
    "expected": {
      "area": "Katende",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "859a2e15c9e3a6e2a4096b6f7ed0a917",
      "district": "Jinja",
      "extra_md5": "7f3971b340daf974a632e4e966fc9fc1",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "72b7479c2dcd75cee8001ce7011f19ec",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f185a0b6eafffaafb1c5c236f414ce8ed3cf50374de2c5a53ef8b87351741629"
      }
    ]
  },
  {
    "id": "b76b06ad-30c7-469e-91e8-efef6b4a1ba2",
    "expected": {
      "area": "Fort Portal",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "fa190973faba5dc1978651100480c8e8",
      "district": "Kabarole",
      "extra_md5": "bc4727bafed918054ce85c0dc58c9e7d",
      "listing_type": "sale",
      "price": "1302308700",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1302308700",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3ee393857ab2fb84d633421c59df978a",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1330000000,
      "price_original": 350000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01"
    },
    "extraPatch": {
      "price_original": 350000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d2fe97360275fce2fa30f3973193d77efbc899634144cafbc17469521c1b7cae"
      }
    ]
  },
  {
    "id": "b84a0c73-55c5-44f3-a37d-89383731a08a",
    "expected": {
      "area": "Kololo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4dbc24c9f5459bc99f37c98e16c24a9f",
      "district": "Kampala",
      "extra_md5": "2cca6d3fdc1db641e7f5442d39e37de8",
      "listing_type": "land",
      "price": "11162646000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "11162646000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e1a7027b122b91dc4c035592bf8f2802",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 11400000000,
      "price_original": 3000000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_period": "acre",
      "price_fx_as_of": "2026-10-01",
      "title": "Land for sale in Kololo, Kampala"
    },
    "extraPatch": {
      "price_original": 3000000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4774bf7b7fb7aa971f649187821b17893e0eb9e920bf50d28dbb73f3c0333010"
      }
    ]
  },
  {
    "id": "b96b3fe9-655d-4d0e-b90d-71de0d45d749",
    "expected": {
      "area": "Butabika",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "061a5b07d4f9ad0d0eedf70995d22207",
      "district": "Kampala",
      "extra_md5": "c2992adadfd7ad373872eb9f1e1147ef",
      "listing_type": "sale",
      "price": "28206617200000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-08-09 18:16:56.86+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "7422794000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "decad829e60b78552c1d8e7a296e2744",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 7600000000,
      "price_original": 2000000,
      "title": "Property for sale in Butabika, Kampala"
    },
    "extraPatch": {
      "price_original": 2000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "eb65b3ec1c1d18aa34c74fe27b8533c62e3f3a6c4fd71f90e1328ab25c8c85cb"
      }
    ]
  },
  {
    "id": "b9b1c774-6f7f-4379-a69f-f6f204e23daf",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": "10",
      "description_md5": "b0cb09029eb390b2d8022cf308ee9afc",
      "district": "Kampala",
      "extra_md5": "b58dc1e49082f5126ed8e726cd84b194",
      "listing_type": "sale",
      "price": "2400000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2400000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "apartment",
      "status": "approved",
      "title_md5": "d61647a5b765e7b1eb455fcd05ec7fe3",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block",
      "title": "Apartment block for sale in Kisaasi",
      "description": "Apartment block for sale in Kisaasi, Kampala, listed at UGX 2,400,000,000. 🔥 *KISAASI APARTMENT BLOCK FOR SALE KAMPALA!* 🏢 💰 *UGX 2.4BN* | 📐 *17 DECIMALS* 💵 *Expected Rent: UGX 23.5M/month!* ✅ 10 Units • 5 × 3BR, 3 bathrooms, modern open kitchen • 5 × 1BR self-contained Stunning views of Kisaasi, Kulambiro, Ntinda & Bukoto 80% complete — fully completed at UGX 2.4BN! Watch the 2 attached video tours and browse 5 extracted key images before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "85a254604a6875774f27d17c3e64f328d57c98c0bd38d41248855715556eef7b"
      }
    ]
  },
  {
    "id": "b9b4bff8-9ea5-474f-9fcc-f107fc0c4d33",
    "expected": {
      "area": "Maya",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "73ce5ebdc53764ae84e7e52d84aeef8b",
      "district": "Wakiso",
      "extra_md5": "c7e87e06810d2243f6d76ea6b78c53a4",
      "listing_type": "land",
      "price": "18000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "18000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "c74765889dbbbcb64d6acf601e1102fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "206d71af1a1a0111212f34af35e527e288067fd46f09cd672d0a366588ccc32d"
      }
    ]
  },
  {
    "id": "b9c9922e-0f64-4051-bff2-e53356e4bcb5",
    "expected": {
      "area": "",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "f7b129915566d8837cfe6446fa327640",
      "district": "",
      "extra_md5": "b0781fc7c0c1ed9d87534cadd80314c5",
      "listing_type": "land",
      "price": "57000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "57000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c83fb3a31a85b619351b8b6a6813cf5d",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c2c95dc2b17ca0aea6924afb98b8308a9d642e008babc302be863665245fb801"
      }
    ]
  },
  {
    "id": "bae2cac9-1d05-4958-8850-06b82202e35b",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "e7bbfe176a12b46ea69a5827d38b2a32",
      "district": "Kampala",
      "extra_md5": "a45f47263489a3585ccc925a61d1762c",
      "listing_type": "sale",
      "price": "17000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "17000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7d526a98ed66cbccfc8f9b523c37ad35",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block",
      "price": 1800000000,
      "price_original": 1800000000
    },
    "extraPatch": {
      "price_original": 1800000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e9823cdffcda81cc62c11b894be4eda239712748d3d2bc8ab562db7445a8b5c4"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "e9823cdffcda81cc62c11b894be4eda239712748d3d2bc8ab562db7445a8b5c4"
      }
    ]
  },
  {
    "id": "bc7ce588-cfd8-49ca-80a9-53db7563577b",
    "expected": {
      "area": "Pader",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "0f8cb24255d845a60a308cad832c9f7d",
      "district": "Pader",
      "extra_md5": "269a9cc1e9b15490a05d525cf16dda6c",
      "listing_type": "land",
      "price": "1600000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1600000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "83f85d1531700bea29718abf1c6f37ba",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "476329e3a94c1784b6b290aee91bc5cdf8097af8e58ce11c5eb20c1333c28f62"
      }
    ]
  },
  {
    "id": "bcc65019-0270-4c1f-a914-3e1aa1544f86",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2b77cc6d8212cc7c78f9654b893698ef",
      "district": "Kampala",
      "extra_md5": "7dacd10faf73516afef2c261d7bf4810",
      "listing_type": "commercial",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "517f870c94034931f330d5ccbafffcb8",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 2000000000,
      "price_original": 2000000000
    },
    "extraPatch": {
      "price_original": 2000000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3396716556451c6eb9d6187920fc8ff0fccb6d8bd2c9369495d99ae19785669e"
      }
    ]
  },
  {
    "id": "bccfdf80-2726-4a06-b101-3f8b4b5535a1",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "201b6f330bf5b4918023196508343bca",
      "district": "Kampala",
      "extra_md5": "f7e86c023d915df1b88d1ad9a82adafb",
      "listing_type": "land",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "650000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "ea4c7b1540073790966829a01dbebdcf",
      "transaction_type": "rent",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "once"
    },
    "extraPatch": {
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "The plot is explicitly for sale. UGX 650 million is the purchase price for 50 decimals, not monthly rent."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "74584542b86fd36aecf2abd6fa573c4f07d1dc09a7190818bd2c37e5a9189829"
      }
    ]
  },
  {
    "id": "be2ad15f-b3ea-49fb-9e3c-a92f1ddb517f",
    "expected": {
      "area": "Buvuma",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "49f59d1a661fa04721ecb385582829fe",
      "district": "Buvuma",
      "extra_md5": "e9b7e217ef281460277babd14e572d93",
      "listing_type": "land",
      "price": "6000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "6000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "242e807cf7ad37b5e89599bdb3d1cfd2",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "38e9654dd5cb02d3b6966e5c15c5d1e7cbf7d8a52db0b67785d344201751056b"
      }
    ]
  },
  {
    "id": "bebf7930-aee8-4332-a189-1ffc0f910aac",
    "expected": {
      "area": "Ntinda",
      "bathrooms": "9",
      "bedrooms": "7",
      "description_md5": "cbc664bd209a0c87cdb98bf8d85ec667",
      "district": "Kampala",
      "extra_md5": "787c2c5e75f0b949231926a1966e917d",
      "listing_type": "sale",
      "price": "1634000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-26 07:05:42.672+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "430",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": "house",
      "status": "approved",
      "title_md5": "bbec86d7c75f251bff7343ca9c349fe5",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1634000000,
      "price_original": 430000,
      "title": "7-bedroom house for sale in Ntinda, Kampala"
    },
    "extraPatch": {
      "price_original": 430000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b1ed72e80c0a6870ab87bad868bbd31e2b81be51fbfcff25d2a826e193756c65"
      }
    ]
  },
  {
    "id": "bf2a6e2f-3e65-417d-b2ec-babbe37a8715",
    "expected": {
      "area": "Namugongo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "e079aceff799d0517ad0b06df7a8b7ec",
      "district": "Wakiso",
      "extra_md5": "610cba6a505baea9378a33dc5d53c1ed",
      "listing_type": "land",
      "price": "80000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "80000000",
      "price_original_currency": "UGX",
      "price_period": "yr",
      "property_type": null,
      "status": "approved",
      "title_md5": "921b8888f0cfbf1584152fbe583253bf",
      "transaction_type": "rent",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "once"
    },
    "extraPatch": {
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "Caption offers ownership of a 50x100 plot for UGX 80 million and includes PlotsForSale. The phrase this year is not an annual lease price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6016b96e1fb156de2f1abaa7bfea095c80df848b0842185967b30501e0b77061"
      }
    ]
  },
  {
    "id": "c057a5f8-5341-4d28-83b6-a8c152d9c91f",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a534cc2df24fb97cb332694ceed465ed",
      "district": "Wakiso",
      "extra_md5": "be24d00561c3da94cd760b81dc20b2ec",
      "listing_type": "land",
      "price": "400000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "349b5fb1926a9bee2ef95a9c32264587",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0b30ef565ca1fd9e169ce3aaf5e932b291aa1c544952a4263a96724b99675dbb"
      }
    ]
  },
  {
    "id": "c18636e8-eb41-40c0-bba2-b1ed7d96ae55",
    "expected": {
      "area": "Nkokonjeru",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "f80c9803794ab8460cf0f2198d0f2bf9",
      "district": "Buikwe",
      "extra_md5": "e5e6a7133cd5f842eb53ae6abcd440a2",
      "listing_type": "land",
      "price": "50000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "50000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e7692605a45127d50065dbdffdd61780",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6dd15a0c0af8a09920ee3874f919e2e8f2c5360c5ada1233149da97c049de779"
      }
    ]
  },
  {
    "id": "c317f98b-f9fe-41ee-936b-dbea6fa83573",
    "expected": {
      "area": "Bugembe",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "d1f6f71b350df83f9cd75bba4ec965f6",
      "district": "Jinja",
      "extra_md5": "92190934cf691732626d29cd223517e0",
      "listing_type": "rent",
      "price": "15000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "15000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "42ee951c8232a298533072a6be3526e0",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "once"
    },
    "extraPatch": {
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "The 55x70ft Igenge/Bugembe plot is explicitly for sale at UGX 15 million. An unrelated houses-for-rent hashtag is not transaction evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9c474417b4079e292e9d22a0e4cb9748647d88071084710fba30fb32de0f2acc"
      }
    ]
  },
  {
    "id": "c34d54a2-d905-4dea-926a-90caf7ec7b77",
    "expected": {
      "area": "Mityana",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "f43f4543cb2a06413d66c6e5e30feb5b",
      "district": "Mityana",
      "extra_md5": "d9c9e215ee04b489261399ca7b81f264",
      "listing_type": "land",
      "price": "13500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "13500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3413001f26c0b051dbbd7a78cfa1807a",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a18be63e19f7d672d76cecc1f744d2e663da64662086105c9c9ef9d2d5136eff"
      }
    ]
  },
  {
    "id": "c4685316-d091-4a6d-838e-8f4df5e79c81",
    "expected": {
      "area": "Najjera",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "6723c6c962a25a2927a824744a62ee40",
      "district": "Wakiso",
      "extra_md5": "45adad36f6fda36ce8edbfa88b805548",
      "listing_type": "commercial",
      "price": "10000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d5d5da93636d84b4702a4513dc8ee101",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 680000000,
      "price_original": 680000000,
      "title": "Commercial property for sale in Najjera, Wakiso"
    },
    "extraPatch": {
      "price_original": 680000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "7b237ada70c0d90c4188a77116467b6a4ac886027111d1e3ef28ac1cdd779d49"
      }
    ]
  },
  {
    "id": "c60b99ee-8558-4916-b09f-e1cb51c143b3",
    "expected": {
      "area": "Amuru",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "9134cb2903ae384d1c11da8e1bb41b89",
      "district": "Amuru",
      "extra_md5": "b0fd1829d89de2fc0c91e9235d5dba5c",
      "listing_type": "land",
      "price": "1800000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1800000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fe5be876cad6404411e4b867db94783d",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cd731d3cabbda481dd6a4e318dbd4d14480328e1a71d22e6c40d74d8f7501455"
      }
    ]
  },
  {
    "id": "c67e0600-e7d1-41af-8a02-fa87f6256add",
    "expected": {
      "area": "Hoima",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "8b54df8fd65baec3d5fe14c8bfde0e42",
      "district": "Hoima",
      "extra_md5": "ff1956dd6ec919e855e75047b87c3073",
      "listing_type": "sale",
      "price": "700000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "700000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b84dc2f33007d52af725090c4471f539",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "eb0a731914505f20a57e2225422cab860c3748c27a932e5e4470a8cd5b1e75a7"
      }
    ]
  },
  {
    "id": "c6f2d4e1-ce9e-41e8-9f5b-59854a5576e8",
    "expected": {
      "area": "Kyenjojo",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "013c3c940262a91dd0d1e10137bd16e1",
      "district": "Kyenjojo",
      "extra_md5": "d03571c71d19eb64f3554f777250b7ca",
      "listing_type": "land",
      "price": "7500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "7500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fab6fde64f30bd787d89b04de89d3bbe",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b8e028b46caa054464090497ad9b7103b4005afeb4c347ace688df31a97532eb"
      }
    ]
  },
  {
    "id": "c72196de-1b63-4e71-b548-e5d6a426276b",
    "expected": {
      "area": "Wakiso",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8ac1f0b5944559d03b9aa8b4425ef331",
      "district": "Wakiso",
      "extra_md5": "2d121147fda207db8067834b9454ae4e",
      "listing_type": "land",
      "price": "750000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "750000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3f72a99d7f0b642b057f5a2e27ae084a",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8e61e51fd1f8360c0e266aa79dc4ade3f431b41231376c8e0459eaf741b9a0ce"
      }
    ]
  },
  {
    "id": "c8f9e551-0fe0-4a0c-a92c-90029252daef",
    "expected": {
      "area": "Kampala",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "04a6d35a43518812ec41012c963b7866",
      "district": "Kampala",
      "extra_md5": "a492095e74e8c634eb56e1e20191796c",
      "listing_type": "sale",
      "price": "1674396900",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1674396900",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6399ff04077e8d382c0dff7de2b82d46",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1710000000,
      "price_original": 450000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "title": "Property for sale in Kampala"
    },
    "extraPatch": {
      "price_original": 450000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cdae948f87cbbc2827ca52525d85edbb9d4a9049b06e559a8016721f10bff1ea"
      }
    ]
  },
  {
    "id": "ca8bf2dd-c4db-478a-9717-22cc16c1a09a",
    "expected": {
      "area": "University",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2d4a15268d3127d19c0e37ea5e220b7c",
      "district": "Abim",
      "extra_md5": "3d4018c33a01c2015f3d539509836d6d",
      "listing_type": "student",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "sem",
      "property_type": null,
      "status": "approved",
      "title_md5": "6e390a67130a76a2bd97274cc8a080b8",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions",
      "prices"
    ],
    "reasons": [
      "The 17 acres of private Mailo land are explicitly for sale at UGX 45 million per acre. University proximity does not establish student accommodation or a semester rate.",
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "11a189f228165eed1ad2eff881f17d12341f1bb6b4f3c81060610a01bf8dacfe"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "11a189f228165eed1ad2eff881f17d12341f1bb6b4f3c81060610a01bf8dacfe"
      }
    ]
  },
  {
    "id": "cc1f2de8-b40c-477a-b739-25aa7ad5afed",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4f5b597a842aa1f02c37f67b6d9bb452",
      "district": "Wakiso",
      "extra_md5": "ea451bc30fd94993d6af926badb6da33",
      "listing_type": "land",
      "price": "120000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "120000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ae10834c96b56f6d62422d88e0c12167",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Namugongo, Wakiso, listed at UGX 120,000,000/plot. 8 plots of 50 by 100 NAMUGONGO new estate near protestant shrine each UGX 120 million. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "9c1afa832f06dc4113c7cd3758298f392c312efb0e81bb3f64c8399a8740fc1d"
      }
    ]
  },
  {
    "id": "cd6635ac-8fa5-4147-b43c-220a49470576",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e7a20a939684f0593913f9ef6f93dad7",
      "district": "Wakiso",
      "extra_md5": "90556cf537ac2250707872b0084ee7f5",
      "listing_type": "land",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b50f28d01d3bf95c186a7cd56978ee62",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "59a369bef6ea72530242195f753a980543a5a81486c9cee9bdb83d0a3a2644b8"
      }
    ]
  },
  {
    "id": "ce5acb3a-4e71-47e3-9226-77b6a87e96e8",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "7eaad66003d771d9a7e73d0071ca5fbf",
      "district": "Wakiso",
      "extra_md5": "b5271a222fc963c52294d7880527b6aa",
      "listing_type": "sale",
      "price": "1100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1100000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "263e460c3a7bafec4bc21d1d5f075a8f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "8f4d5b141a1f3def1e5b48ac6a561d23e393208f12310a4869fa46048a8e8893"
      }
    ]
  },
  {
    "id": "cf68f298-526e-452a-8b5a-cef4233260be",
    "expected": {
      "area": "Bukasa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "0a6a8e7a4e68dc774d99c7cbc72034c0",
      "district": "Kampala",
      "extra_md5": "25f74e852cc1f117c32231122e53288d",
      "listing_type": "sale",
      "price": "62000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "62000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4c58ace9f50709a95a423774f860d1db",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fa8228f75d13d779f3c3076391eb85e7a534c6fac290f8eed27f30b6753839b9"
      }
    ]
  },
  {
    "id": "cf97cc59-438b-42d0-900b-17958a883972",
    "expected": {
      "area": "Naalya",
      "bathrooms": "0",
      "bedrooms": "2",
      "description_md5": "8c80b75b8c648c7d7ab5986ab1008f0f",
      "district": "Wakiso",
      "extra_md5": "4d689199baac4833d8f3ed4d5485230c",
      "listing_type": "rent",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "month",
      "property_type": "house",
      "status": "approved",
      "title_md5": "d734bb6f7ed8a28283f89feb6b903610",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Apartment"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source expressly offers a two-bedroom apartment, not a house."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c0a210bd4f4fc07b1fc39e9a07d0359d6595ee3f97860f2516a67276198355fe"
      }
    ]
  },
  {
    "id": "d0545416-3159-40b0-a68b-8414d806f1b2",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "7d628e0642cb075ddfcbea8255d34fec",
      "district": "Wakiso",
      "extra_md5": "4f11c21cb16c8869c4d180e334698633",
      "listing_type": "sale",
      "price": "700000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "bdcc504b6ed1429b020f69fd1c7f1f32",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment building"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "08e1f07347e747e55b5f9a456bff020bf0d1e89809f92256a65cec7b3fbd8a13"
      }
    ]
  },
  {
    "id": "d06d26b4-54f8-42d0-a42f-daa17ebb7635",
    "expected": {
      "area": "Nakasajja",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "ee895334a22d12d9550e4190c069a4b0",
      "district": "Wakiso",
      "extra_md5": "fd179c28a1674238587a747ce285f3d5",
      "listing_type": "land",
      "price": "180000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "180000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "2486dd130e52ff732b2691e6cf26fd76",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "682d9c38f8dc154d3be77086c221dc09d25c8a96d86bde7909adea7ebfcf736f"
      }
    ]
  },
  {
    "id": "d1c54941-03de-4cf9-9386-3e999f9355b8",
    "expected": {
      "area": "Kiruhura",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "b35994abaab96c1317c966dece8a1afa",
      "district": "Kiruhura",
      "extra_md5": "db830662588f986499abec272d60c1e5",
      "listing_type": "land",
      "price": "40000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "40000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "25d4388075b691734d7407586dd7f145",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "74d1b7d769d5cfa60328f94ee4e2b66743345f713b09009a0ef09e0d8820acae"
      }
    ]
  },
  {
    "id": "d20b08d8-7a66-4ab3-84c1-915a1d64017f",
    "expected": {
      "area": "Kikyusa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2301079a34f2e08a04123314f3b555ce",
      "district": "Nakaseke",
      "extra_md5": "86a08e4cc00c4d349a1aa79f656becef",
      "listing_type": "commercial",
      "price": "12000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "12000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "c06bd0bfd399797de92b5f68d89adb39",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Commercial land for sale in Kikyusa, Nakaseke, listed at UGX 12,000,000/acre. *Massive 200 acres large on sale in Kamira- Kikyusa* Location : Kamira after kikyuusa Luweero (Bombo rd) mairo land title in luweero district 2 kilometers off the main marrum road selling all at once @ 12m each acre Available for viewing Ideal for commercial coffee farming, maize, ranching and many other projects✅. Contact Tuyisengye innocent to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "73f980a37ba58790690bad3f1c15eadc9a2aa1f003423b16cbf673cb427307cd"
      }
    ]
  },
  {
    "id": "d23dc139-1aa0-4a23-aa8a-bda63fbea3c5",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "7d49eb5147bf74ee460f8ce28b455754",
      "district": "Wakiso",
      "extra_md5": "d7090176bf1dd609ea561eeefe0602b1",
      "listing_type": "land",
      "price": "2200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ba66a9247151c127901b410c3f0e553e",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments",
      "title": "Apartments for sale in Naalya"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "4446baf5716f3ca7f142bd29451fda802661d033864d717e7d3f8b5a4d4bd425"
      }
    ]
  },
  {
    "id": "d25a5913-f0f2-47ee-a37c-ad334137b9e1",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "7f8019a66708fb3464bd4595515be1ec",
      "district": "Wakiso",
      "extra_md5": "275d2b258b9626bd71370cd760e2c4ab",
      "listing_type": "land",
      "price": "470000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "488355d329e20bca1d06c492bd7a7b7a",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cc17143771c55d2a582642b16180aa5f9a1d391a2fb3e91834b06c1e7d55d5c7"
      }
    ]
  },
  {
    "id": "d30ca00e-d984-4c69-9cd5-f077a8ae9412",
    "expected": {
      "area": "Bwebajja",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "c1842a4b3c2697a807ebbccd0fa66c42",
      "district": "Wakiso",
      "extra_md5": "de4d3eaeb4429ccfec887f60c721d9a6",
      "listing_type": "sale",
      "price": "700000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "200000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "6660a978f52fbe6e3df5bf0039e7d569",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_original": 700000000
    },
    "extraPatch": {
      "price_original": 700000000
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Canonical asking price already matches source; repair stale original-price metadata that contains income, count or the alternate USD number labelled UGX."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b377346831e6bdb74d5c00fd70fd4445fcf95bd633458ec0fe203cfcece7a868"
      }
    ]
  },
  {
    "id": "d407673b-11ab-4252-8151-f5e6675ba0e2",
    "expected": {
      "area": "Makerere",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "f26723a89abd2b77ee0463a01d8a07b3",
      "district": "Kampala",
      "extra_md5": "361012f8dbd5922a9ce55464399b80d8",
      "listing_type": "land",
      "price": "6840000000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822814+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "1800000",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a8a0a12c2851d0e7d7f2a2c18720af6f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "71e1c44d0e9746f370004d734832f0c5ff8f4c023af69b1c79f8a0f2eac3d1d8"
      }
    ]
  },
  {
    "id": "d5201d5e-0d3f-4ef7-aba5-9c4b7cdb2114",
    "expected": {
      "area": "Kololo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "7a3182fc53f0d4b2f3cfab68939ca6a7",
      "district": "Kampala",
      "extra_md5": "86d667cd30fdb19e96451ed44f756ed8",
      "listing_type": "sale",
      "price": "6673316400",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "6673316400",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "46a9eac6ee8e0f9d0aaf5e5004312caf",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 6840000000,
      "price_original": 1800000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "title": "Property for sale in Kololo, Kampala"
    },
    "extraPatch": {
      "price_original": 1800000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "913e4c02abbda58e9a453b237b3c0dff8ca61b4ef06d9e3d864ddd6ea006623d"
      }
    ]
  },
  {
    "id": "d55cbfa3-9763-45a8-8b92-86f4aca6261c",
    "expected": {
      "area": "Kakiri",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "351b35cf60a61f67b056c568ed44e34d",
      "district": "Wakiso",
      "extra_md5": "def4fd2a9499fb7f8d55e882cfcb1c47",
      "listing_type": "commercial",
      "price": "45000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "45000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "8adf6fd0e8132b5117b5e05571eec02b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "851728ca5685e27a3aba63ec88617cbf5862ac1691316355865df0cca80e1de8"
      }
    ]
  },
  {
    "id": "d564eaeb-c8a5-430d-9f98-92ca8308e85a",
    "expected": {
      "area": "Mukono",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e7aa2696d5af3bdaf4f579e9085b95b1",
      "district": "Mukono",
      "extra_md5": "66559780feedd91decfb831e83aaa106",
      "listing_type": "land",
      "price": "60000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "60000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "4cdcde944da4090a6a24c23ce133427b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b059abaee970cb63f438cc10e781d183f8157ad4ed077bf5feeb2f45bdb50c9f"
      }
    ]
  },
  {
    "id": "d679d134-7d19-4fd9-ac69-4038e911af98",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "0cd36f2ade1e9a9f9a64732485dd0f6c",
      "district": "Kampala",
      "extra_md5": "9a0deeaab084999ff74a58a14a7f42ba",
      "listing_type": "sale",
      "price": "2500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7c4be61db0de534857f907a1a9afce8c",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "55e4f912116917ebc336215e052695ab18cc9d67fd96e6c257ca337f165a7515"
      }
    ]
  },
  {
    "id": "d68d16d9-afb9-42b3-b050-f4831579911e",
    "expected": {
      "area": "",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "71bcdfd94b325d932a2994a624bb3b1d",
      "district": "",
      "extra_md5": "2bbf019d1e6a6474d45124cc20d566d6",
      "listing_type": "land",
      "price": "35000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "35000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0a981e189a825a7a6c53e4003ed369e4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "f4dd34c9fdde290c3459074523335386756c91ae60cf7929d4623abc5a2492c5"
      }
    ]
  },
  {
    "id": "d74524ed-3f59-44fe-a80f-0ecf511aeb6a",
    "expected": {
      "area": "Luwero",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "f5782462418ec6c17ca8db5233b58c67",
      "district": "Luwero",
      "extra_md5": "ccb6548ff4abcdf9cdeb8cfd290640fc",
      "listing_type": "land",
      "price": "15000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "15000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "458d9a0d0cd613a47cdd7568bb09dc6b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5a1ee308c2453ec5b33eea5a4a4295ff1ee6c77223a9ee4b547ba5ef515af95f"
      }
    ]
  },
  {
    "id": "d74be0c5-6818-45fe-a34e-b69b1ea8e8f0",
    "expected": {
      "area": "Ntinda",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "daed2bf69d3fe376681bddea3004d373",
      "district": "Kampala",
      "extra_md5": "dd3c334a89711062ec8327f832a1b1a0",
      "listing_type": "sale",
      "price": "7000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "7000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "07d320c4bb29c14110c02183bd66e7bd",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 3700000000,
      "price_original": 3700000000
    },
    "extraPatch": {
      "price_original": 3700000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "ee2c6b8649da0224fd6e9c39afd86bea7047b81091868c021a5716a0458144a0"
      }
    ]
  },
  {
    "id": "d79be615-84d2-478e-a9e1-64509d438a23",
    "expected": {
      "area": "Kyaliwajjala",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "9e56c51b34ac47d1ff07eb9b7840f03b",
      "district": "Wakiso",
      "extra_md5": "7b06ea2a4e76e45d868dae786ae14c28",
      "listing_type": "sale",
      "price": "6300000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "5a5280280e2551fee2affc83b7df53cb",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "0aa9f4aa8d2941e065dcbb3df936b999515d1c7cdbdff19b4cbc2db46c752b3a"
      }
    ]
  },
  {
    "id": "d7a08254-8c38-4cd7-ba80-2479c8067abf",
    "expected": {
      "area": "Luwero",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "b1c2402e647235a1ab7f2fb3a4c3f0c7",
      "district": "Luwero",
      "extra_md5": "f45a7edd714520973e25dd4ee475bc50",
      "listing_type": "land",
      "price": "4500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "4500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "de1dab5ec7c9b1106eb2963733402298",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "413cdf5d0948318eeb9ccb5346bfb7145cb54224fb4a04d738a32d39a04c9046"
      }
    ]
  },
  {
    "id": "d7ec22d5-662f-4ea3-8ea1-99ac21b9321c",
    "expected": {
      "area": "Fort Portal",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "c36e97bebe7ff6d01db569525a932029",
      "district": "Kabarole",
      "extra_md5": "c87be4ed0c6c7ba128b0b3663cb8dead",
      "listing_type": "sale",
      "price": "1302308700",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1302308700",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3a91688f047406d9863bce0868c4203f",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1330000000,
      "price_original": 350000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "title": "Property for sale in Fort Portal, Kabarole"
    },
    "extraPatch": {
      "price_original": 350000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "67a902a27473ed89b103be8f4ee2c92dca116fc3b296afaaa51602f259d9b486"
      }
    ]
  },
  {
    "id": "d8e151b3-2d4e-4c31-9649-ecdec68441bb",
    "expected": {
      "area": "Munyonyo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4700576d6937e6bc2973d68249e92a72",
      "district": "Kampala",
      "extra_md5": "badf487d5aff7233050ca62cc16023f8",
      "listing_type": "sale",
      "price": "7000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "7000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "9a2a8460bd58a19375d39ea2fe7f98a1",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 700000000,
      "price_original": 700000000,
      "title": "Property for sale in Munyonyo, Kampala"
    },
    "extraPatch": {
      "price_original": 700000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "StoredUGX7M is monthly rentalincome. Caption explicitly gives saleprice700M."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "42b9f2d2fa1df1d434b2006bcd8767e1d67eb761bfa5f05e61e6e1a9b315b3e8"
      }
    ]
  },
  {
    "id": "d9700d0d-e28e-4723-b635-b94b52b1b350",
    "expected": {
      "area": "Kijungu",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "50c6cdd6f9103f28d1c8bb187c6513f8",
      "district": "Wakiso",
      "extra_md5": "a6a8b78315ede2624571b29380ed1299",
      "listing_type": "land",
      "price": "700000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "700000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c29e4bb3406995009c9a0efa03868c60",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cd7726d78ab4731d2c878f8363a1e2a9c9f1e89c07c4e3fbc7f6a0bce4f5fe06"
      }
    ]
  },
  {
    "id": "da599526-3d58-4df4-8ca9-999e8a52d678",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e1f42049090d2f423a56137fef243ca3",
      "district": "Wakiso",
      "extra_md5": "8964ab31b7e02659b12cf7d3827cc884",
      "listing_type": "sale",
      "price": "350000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "76dad77f676233d21feda636f133a22d",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 380000000,
      "price_original": 380000000,
      "title": "Property for sale in Kira, Wakiso"
    },
    "extraPatch": {
      "price_original": 380000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "69ca32da21acd9d8b5523c2e7d8df7cd9a82445f947db048aca61ecd25cfb273"
      }
    ]
  },
  {
    "id": "da773110-9f53-4903-9b2f-07dc61e4ac9b",
    "expected": {
      "area": "Naalya",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "12c5c8ff747bff284f122df1f25bcb90",
      "district": "Wakiso",
      "extra_md5": "4a496e3d086e8c4f91a598b129b7f25f",
      "listing_type": "sale",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e3fa49e546c7a54d735bba8fa784ba59",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "27b47e8f79a1b5b2c249b7b90127239cf467fd48b55ace8824b36b186d8fb9b7"
      }
    ]
  },
  {
    "id": "daaade06-6399-4f70-997b-815fd0b4fc97",
    "expected": {
      "area": "Ntinda",
      "bathrooms": null,
      "bedrooms": "7",
      "description_md5": "b69c6c6884a7b32e354af69fadd04e59",
      "district": "Kampala",
      "extra_md5": "dd4e1a65adfb0aa5cdfda017200f90b7",
      "listing_type": "sale",
      "price": "8000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "8000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "e31d73b2480b2e523e0e87c2cbaf44d1",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1800000000,
      "price_original": 1800000000
    },
    "extraPatch": {
      "price_original": 1800000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fa002874e9de6c8ce26c88c6826bb40c0f232d75e83f05f7bbd253dd84180612"
      }
    ]
  },
  {
    "id": "daf5a251-6370-4f0e-bdc0-5ecbbf62f751",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "3",
      "description_md5": "08a67d720dd50879a4ffc6401bcadde7",
      "district": "Wakiso",
      "extra_md5": "b213ac7f125497987503466bca109cb8",
      "listing_type": "land",
      "price": "330000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "330000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "House",
      "title": "House for sale in Kira"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source describes an existing residential asset offered with its plot, rather than bare land or land suitable for future construction."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "1a1a91c4bd8a20c3742e06cc4cab6b1bbbcfd8553973f07080c9f7000c0ca3fb"
      }
    ]
  },
  {
    "id": "de2beeca-740a-4f85-8580-9830775d0254",
    "expected": {
      "area": "Buziga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "6b63782812c4b703bc37e342ca16ae45",
      "district": "Kampala",
      "extra_md5": "592207381df58b0a52943eaf241884b4",
      "listing_type": "land",
      "price": "1600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "589a99a2ce7d1794e5ae87ce82cb2a33",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartments",
      "title": "Apartments for sale in Buziga",
      "description": "Apartments for sale in Buziga, Kampala, listed at UGX 1,600,000,000. Good Deal Buziga apartment Lake view 12 units Revenue 15.6million monthly 26 decimals plot UGX 1.6 billion negotiable🔥🔥🔥. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "218fe548b1ca8b694b12aab3867f3617201fecdab8db6b76fcff250669b94962"
      }
    ]
  },
  {
    "id": "de6240d0-a1ab-4c55-8521-323771dfeb53",
    "expected": {
      "area": "Bujjuko",
      "bathrooms": "0",
      "bedrooms": "5",
      "description_md5": "4ffc25867b2a43b93f745c2dd4f99317",
      "district": "Wakiso",
      "extra_md5": "580663a849953cdf652e3f59d74d1b09",
      "listing_type": "sale",
      "price": "2394000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-08-02 07:28:59.492+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "630",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "567335d83d904d4e8928acc4ebe39e86",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 2394000000,
      "price_original": 630000,
      "title": "5-bedroom property for sale in Bujjuko, Wakiso"
    },
    "extraPatch": {
      "price_original": 630000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "df306f7faf406b4778fefd5ad7950e212d00beb97100ac6ca473f89d952477a0"
      }
    ]
  },
  {
    "id": "de8299b1-c999-4f81-9b31-c44ac6f61f2e",
    "expected": {
      "area": "Kira-Mulawa",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "4d4cfeffa67217b9b72140ab4e7fbe03",
      "district": "Wakiso",
      "extra_md5": "613833999ce31287da0981b371182a3e",
      "listing_type": "land",
      "price": "1800000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1800000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3734199d777bd9b39b49429902b93990",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 150000000,
      "price_original": 150000000,
      "price_period": "plot",
      "description": "Land for sale in Kira-Mulawa, Wakiso, listed at UGX 150,000,000/plot. 12 decimals plot Kira Mulawa each UGX 150 million few metres off main tarmac. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_original": 150000000,
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c3a4662318f50447230ba26541a0e976e1e5249a1ae414ac270876d346ecf9ae"
      }
    ]
  },
  {
    "id": "dee4f4bd-0286-4c9a-b54c-4ce34769b338",
    "expected": {
      "area": "Buziga",
      "bathrooms": "0",
      "bedrooms": "10",
      "description_md5": "29c2b904237b4c0e63e8bf09731fbc8c",
      "district": "Kampala",
      "extra_md5": "fa273814b0c39b5009959aaecfbbba6f",
      "listing_type": "sale",
      "price": "4560000010",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "4560000010",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "3019bacb371bf780d9898be99ffca494",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price": 4560000000,
      "price_original": 1200000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "title": "10-bedroom property for sale in Buziga, Kampala"
    },
    "extraPatch": {
      "price_original": 1200000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "2dbe95a6ee06f4bc2ee851a200d491d66323514bf466a53c0b5b0a63e3138234"
      }
    ]
  },
  {
    "id": "df110660-9e03-4eeb-abc7-e40dafc14920",
    "expected": {
      "area": "Kira-Mulawa",
      "bathrooms": null,
      "bedrooms": "1",
      "description_md5": "c8a96a30a6882f8af7243bfe925aafc6",
      "district": "Wakiso",
      "extra_md5": "6cafe501b0577063dbfd9349cc362b27",
      "listing_type": "land",
      "price": "145000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "145000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "land",
      "status": "approved",
      "title_md5": "21abd2ffe6696db5449dbdd39805eaec",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "description",
        "sha256": "665453642806013e83f60aa2742fbc3d1632b9c73eb5a8d2cffc7fee52f33798"
      }
    ]
  },
  {
    "id": "e13bc9a3-2f2e-4f12-b707-daec1f57dcdd",
    "expected": {
      "area": "Katosi",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "54aa0fb32ba70d55e966af874e379b80",
      "district": "Mukono",
      "extra_md5": "bd8a351ed58c5abad2ac91dab5211973",
      "listing_type": "sale",
      "price": "30000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "30000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b1710c5124410b7a83c3234b0554e949",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "dcabfa8cd5feb452acc6aa72de460a0fddab6b41c7b7b26ed5865f32fdb3b7ed"
      }
    ]
  },
  {
    "id": "e3333f7e-c934-4cda-972e-b0b3e727ad30",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": "5",
      "description_md5": "49b01de94189ea5afb56fa0b7f6feeaa",
      "district": "Kampala",
      "extra_md5": "54cba04f5ae5acd68109416a16c8ae88",
      "listing_type": "sale",
      "price": "3534837900000",
      "price_currency": "UGX",
      "price_fx_as_of": "2026-07-25 16:51:37.822+00",
      "price_fx_rate_ugx": "3800",
      "price_on_application": "false",
      "price_original": "930220500",
      "price_original_currency": "USD",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "88b051bda5330ac05e3408e00f0f1e29",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 950000000,
      "price_original": 250000,
      "title": "5-bedroom property for sale in Kyanja, Kampala"
    },
    "extraPatch": {
      "price_original": 250000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "49e112cea2674af830133747b19f6cfb49cda02b03f614d560e8f01ffd2d342f"
      }
    ]
  },
  {
    "id": "e3a62fe7-7ede-42b8-ba54-9123643641d9",
    "expected": {
      "area": "Bukoto",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "b82697234cb0323eeb217224f7e3a656",
      "district": "Kampala",
      "extra_md5": "eaf6531d881db728bfc8cce316df3636",
      "listing_type": "sale",
      "price": "6995000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1869000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a512ca52a2368471357becc2950738c3",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment complex",
      "price": 7000000000,
      "price_original": 7000000000,
      "title": "Apartment complex for sale in Bukoto, Kampala"
    },
    "extraPatch": {
      "price_original": 7000000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "types",
      "prices"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence.",
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "bfe09e3102e61b9151c98bc1a9d18646fd95e9f8267ccf06a753cbb84988453a"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "bfe09e3102e61b9151c98bc1a9d18646fd95e9f8267ccf06a753cbb84988453a"
      }
    ]
  },
  {
    "id": "e3d23998-351b-46f1-bb3b-663fc3bfe0bf",
    "expected": {
      "area": "Fort Portal",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "247451b7b02c9a056413fae3a68918f8",
      "district": "Kabarole",
      "extra_md5": "720b394b2fcbe573ff699d5ba0a1b38f",
      "listing_type": "sale",
      "price": "304000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "304000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "8dd018327157cf5e5070a5d991251148",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_fx_as_of": "2026-10-01",
      "price_original": 80000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800
    },
    "extraPatch": {
      "price_original": 80000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b1e48789c13e5b2eb894cbf439695d4075fd03fe55701ca9661161e85b0e31e4"
      }
    ]
  },
  {
    "id": "e47c491e-0954-4ca3-8119-17ce8cfbcae4",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "994991211ff68d2ab30a4f6055f67e83",
      "district": "Kampala",
      "extra_md5": "c53eb6d701fb328f8927eee95db515a8",
      "listing_type": "rent",
      "price": "400000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "400000",
      "price_original_currency": "UGX",
      "price_period": "month",
      "property_type": null,
      "status": "approved",
      "title_md5": "0cf17321e68b54cb1bf098207665854b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "night",
      "description": "Property for rent in Kisaasi, Kampala, listed at UGX 400,000/night. Airbnb for rent both short and long stays. 400k per night. Two bedrooms three bathrooms located in Kisaasi. Watch the attached video tour before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "night",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes a nightly/daily amount; monthly suffix is wrong."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "11bb86bcba5a641480717bd58762502ea7a09f8835c735220672c02f64a9cd39"
      }
    ]
  },
  {
    "id": "e5090ae2-e30a-4dcc-bc34-7e55af84a2fb",
    "expected": {
      "area": "Nakawuka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "73f3bfb121100ff6fad658bb786ad438",
      "district": "Wakiso",
      "extra_md5": "1d655f83aa2a2223dfee0279de7ccbe1",
      "listing_type": "land",
      "price": "110000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "110000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7ff4daf91575e06436190986b5420ac4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Nakawuka, Wakiso, listed at UGX 110,000,000/acre. 50 acres Nakawuka private mailo ideal for real estate, school, hospital each UGX 110 million.. selling all at once. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5faca7461624b31354ba31a5cd9ac0a9da3c96be7e7e53fe3e96f9ecf0183c3d"
      }
    ]
  },
  {
    "id": "e515e147-298b-47e1-aeaf-af581395094c",
    "expected": {
      "area": "Masaka",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "0f15d6a818274859b5fa8ff24b0d1a72",
      "district": "Masaka",
      "extra_md5": "644b5149e0b14183c02df11ce90aa966",
      "listing_type": "land",
      "price": "7000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "7000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "ddc09154c9e4283a61478830546bc57b",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "498f5f4205a849e0f0b608e80891f20659019dde9527c88649fc780f84ad355c"
      }
    ]
  },
  {
    "id": "e52cb0ce-8765-48bd-a18f-2d5597e0d4d2",
    "expected": {
      "area": "Kaliiti",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "a2818449dd5a02101ff1e2895e31543c",
      "district": "Wakiso",
      "extra_md5": "614459b8fab90083c3ace4908d526ab9",
      "listing_type": "land",
      "price": "25000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "25000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "411ee6da9387213a3212fd6db4d5fd85",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6e830744895a8c28f7c96f2ba551561574a4a0500d1c53fedbec6df66687b2c7"
      }
    ]
  },
  {
    "id": "e6dab256-bd8c-4830-8866-313a62e5c06f",
    "expected": {
      "area": "Namanve",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "79d78ebe1185946f3935f6c326bc8603",
      "district": "Mukono",
      "extra_md5": "62a653c85aacfdb93228981fdea818d4",
      "listing_type": "land",
      "price": "600000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "600000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "488aea182922eec36b4a63c5d12c49b9",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_title/source_description",
        "sha256": "eccf9130c8966055d38465dfdcb4106b3a8b64b02c17d6bde809a69d6dc768cf"
      }
    ]
  },
  {
    "id": "e7bc2244-72ab-4b85-9c9a-4d5533019521",
    "expected": {
      "area": "Bulenga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "a4bd219c8df87745c5ae648730451e86",
      "district": "Wakiso",
      "extra_md5": "378076ef1ef86b50804b05fa80888cc8",
      "listing_type": "sale",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "poa",
      "property_type": null,
      "status": "approved",
      "title_md5": "64594325ecd1d3066c424e41e750cce3",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 150000000,
      "price_original": 150000000,
      "price_on_application": false,
      "title": "Property for sale in Bulenga, Wakiso"
    },
    "extraPatch": {
      "price_original": 150000000,
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "price_on_application": false,
      "price_upon_application": false,
      "price_review": null
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b61fe4d39bf114b1444ebef4d7fa349a44c734a4a2e37b88a97d1df97ded7b8b"
      }
    ]
  },
  {
    "id": "e7e200cd-a708-45ac-9c3d-be5ccffc4d5b",
    "expected": {
      "area": "Seguku",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "86250dcbf75ad98c19d01b5b6902db85",
      "district": "Wakiso",
      "extra_md5": "adb649b5a30caf6f2336558b0c057f7a",
      "listing_type": "land",
      "price": "500000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "500000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b6a369aeaa6b1c8c8e838b9054122f67",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre",
      "description": "Land for sale in Seguku, Wakiso, listed at UGX 500,000,000/acre. 2.5 acres Seguku Katale private mailo each UGX 500 million..urgent sale. Watch the attached video tour before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "e7df3876f57ff5a4404900053fd02a5c79309dac5476e0412f8130103cf607f5"
      }
    ]
  },
  {
    "id": "e83b101d-e1cf-4d28-b5e0-7c9b9a1b96b4",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "928c3577555b2fce52817d329f865ff1",
      "district": "Wakiso",
      "extra_md5": "2f7f93103a3ab01d1bc384d3598300ed",
      "listing_type": "land",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "f45da980f9bb39314daacdf3f34d7ff4",
      "transaction_type": "rent",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "once"
    },
    "extraPatch": {
      "price_period": "once",
      "price_label": null,
      "price_status": "price_upon_application"
    },
    "domains": [
      "transactions"
    ],
    "reasons": [
      "Residential land is explicitly available for sale. Potential rental development is not an offer to rent. Preserve the existing price on application."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "d51cd6be91cdbcf3bac9569b3d038c8be7c3c82fbe1eb3df9a5a5957aa0917b0"
      }
    ]
  },
  {
    "id": "e8a69abd-77c7-4026-9588-c12a63e81e24",
    "expected": {
      "area": "Akright City",
      "bathrooms": null,
      "bedrooms": "6",
      "description_md5": "4cb3d50fa55587e2f8d9f07d569fa32e",
      "district": "Wakiso",
      "extra_md5": "9d881fee3a5e9385450015d1142f7f9c",
      "listing_type": "sale",
      "price": "2000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "38892b724da561d4ee02925452f66df2",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1900000000,
      "price_original": 500000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01"
    },
    "extraPatch": {
      "price_original": 500000,
      "price_original_currency": "USD",
      "price_fx_rate_ugx": 3800,
      "price_fx_as_of": "2026-10-01",
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "inventory_price_guide_164": {
        "url": "https://makaug.com/api/fx",
        "as_of": "2026-10-01",
        "rate": 3800,
        "note": "Approximate application display guide; source asking amount remains in original currency."
      }
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes USD; stored original is wrongly labelled UGX or is an unrelated amount. Canonical price is only an approximate guide using documented FX provenance."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "5f0611c0c8d109cd1c488ff096ce23842b5e217806010553a5683fb45d099e2b"
      }
    ]
  },
  {
    "id": "e9a89d23-1abf-47a0-ba43-aa4b09a3c225",
    "expected": {
      "area": "Kyanja",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "b40553adaaca8cebdde603116e249ed4",
      "district": "Kampala",
      "extra_md5": "01fa9c74df7bb3bc949a51ee99d27d8f",
      "listing_type": "land",
      "price": "260000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "260000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "61e52d4b5f330ab294cfbbf66487653e",
      "transaction_type": "rent",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "land",
      "transaction_type": "sale",
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "transactions",
      "prices"
    ],
    "reasons": [
      "Caption offers prime plots on Kyanja Ring Road for UGX 260 million each with LandForSaleUganda. Each is a plot asking price, not monthly rent.",
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "906e4a2113d29e543ad5e80eb5f92abb2c8c6b223e3c0c19211b4a05af348462"
      },
      {
        "field": "extra_fields.source_caption",
        "sha256": "906e4a2113d29e543ad5e80eb5f92abb2c8c6b223e3c0c19211b4a05af348462"
      }
    ]
  },
  {
    "id": "ec0fd61f-9c2b-456d-8724-59140ba4b2d5",
    "expected": {
      "area": "Kayunga",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "e6eec627e42cc276f821d9781864ba81",
      "district": "Kayunga",
      "extra_md5": "e408967d064b06aeef41cc86fa8e1530",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "d964f0ed4f081c1092085821f2a4c808",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "6892dc8516ea82c4ed56701011356e7fac56e766c5db5dedd1a1c427e1e897b1"
      }
    ]
  },
  {
    "id": "ec4b0dc8-7f2a-43d0-8097-b187b8b6e01d",
    "expected": {
      "area": "Kira",
      "bathrooms": null,
      "bedrooms": "4",
      "description_md5": "b204bf775cba5a1b97904cddd3b9d598",
      "district": "Wakiso",
      "extra_md5": "101d1664a1d63cb6614ab0baf2e41119",
      "listing_type": "sale",
      "price": "650000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "650000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c65f037f44feccf06be2d0ff984b05fc",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Residential property",
      "title": "Residential property for sale in Kira",
      "description": "4-bedroom residential property for sale in Kira, Wakiso, listed at UGX 650,000,000. Kira 4 bedrooms on 13 decimals plot UGX 650 million. Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land but source gives existing bedrooms/bathrooms. Specific house versus apartment form is unknown, so use the broad supported residential property label."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "93a492758dcbbb2619900ce1632868f75bc6c6be7cbbf987407df7ef2d58b326"
      }
    ]
  },
  {
    "id": "ec6a65b5-6c6e-46ce-a5bf-ecd1ea1dde6c",
    "expected": {
      "area": "Kira",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "73f9e7056161d2ecb57251a77cfb38eb",
      "district": "Wakiso",
      "extra_md5": "2b7f889d37357ca22322592458d8082d",
      "listing_type": "land",
      "price": "1000000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "1000000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "b647de5b6142643053503897aa8a0cef",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "listing_type": "sale",
      "property_type": "Apartment building",
      "bedrooms": null
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Raw source offers existing income-producing residential units/apartments, not bare land; land title/plot-size text was wrongly treated as the asset.",
      "Source sells an entire twelve-unit apartment building; one bedroom is expressly per unit, not the whole building."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "b6f038edb9c15a51378ee501c249b9fa5bf70d1bb608e25ddc74d867bb77e4e6"
      }
    ]
  },
  {
    "id": "ed3ce2c7-01aa-49a0-aace-e4ad33bd180e",
    "expected": {
      "area": "Katosi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "0b277bd48c0da6e20a64894c301d269f",
      "district": "Mukono",
      "extra_md5": "6873abc89357ef41b6f5eac8108cfd88",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fea5b0fd80a9f91ef65666be876255ba",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "70c9cd620abfcca219bafc06f1ebdc70ef8ed546edd2b6aa446826f81447649f"
      }
    ]
  },
  {
    "id": "f080cce9-c7ee-412e-96b3-360c3ea48ecd",
    "expected": {
      "area": "Kitende",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "28c300364ceb661a8c2d417177cdb507",
      "district": "Wakiso",
      "extra_md5": "1f2cc135bd2b7eadb8204fc9e46b0071",
      "listing_type": "land",
      "price": "43000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "43000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "c24342529e6fa869f0596de7550f4ef4",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "72751b5705b03fbe9376cede250c752232a6509abd62cf72cfe425bb4e38600d"
      }
    ]
  },
  {
    "id": "f09b1da1-09b5-4a93-bd84-942b42b300ba",
    "expected": {
      "area": "Kitende",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8fec9f6f87d46d12833553ce6514f671",
      "district": "Wakiso",
      "extra_md5": "332638c25c241bce98d7728c3b120140",
      "listing_type": "land",
      "price": "75000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "75000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "167cc21659035227f6ce10b98b771d67",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot",
      "description": "Land for sale in Kitende, Wakiso, listed at UGX 75,000,000/plot. Prime Land for Sale in Kitende! 🔥 📍 Size: 50x100ft 💰 Price: UGX 75M per plot ✨ Great neighborhood, stunning scenery, and fast-growing development. 📞 Call/WhatsApp me now. Watch the attached video tour before enquiring. Contact Kazi Honest to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "176c755a1422976fa3f33ed0a3609e5305d0c2ddc82d556eb7d34e61c53674b0"
      }
    ]
  },
  {
    "id": "f27c8b19-f739-456b-b79a-8a8b2290a199",
    "expected": {
      "area": "Mbarara",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "1ae34e6f4f5145df89099d626c46525b",
      "district": "Mbarara",
      "extra_md5": "1c5739b156d4616aefeb609cc0f34850",
      "listing_type": "sale",
      "price": "65000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "65000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "a796be03a264c5f66c80c46651f6c5fa",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "3eb6043e819dc425c8202533431835f4239636768318592fa35f798b462e1d6a"
      }
    ]
  },
  {
    "id": "f2d5087a-d2a6-4027-9268-82c53f1b9ce1",
    "expected": {
      "area": "Bujjuko",
      "bathrooms": "0",
      "bedrooms": "7",
      "description_md5": "2626d19e401c97fbf6f7ac7d1be0cf09",
      "district": "Wakiso",
      "extra_md5": "506512d46e5eb955055c666285dc5771",
      "listing_type": "sale",
      "price": "2073000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2073000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": "commercial_land",
      "status": "approved",
      "title_md5": "52f3a9b294a060937eb203754b88204d",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Mansion"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source expressly offers a seven-bedroom mansion, not commercial land."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "96cea9e4c6b77c6969ee71a8aa5cbb078be5ae831b98e3573ae90db260703d14"
      }
    ]
  },
  {
    "id": "f3108ce6-df1f-4e7c-af72-a50e1ce6c2de",
    "expected": {
      "area": "Butunduzi",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "d5b6fad2a4e6f8f84131456807c4939e",
      "district": "Kyenjojo",
      "extra_md5": "c8b00e94d25f7c26628d8654a9fb426c",
      "listing_type": "land",
      "price": "7500000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "7500000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "7e803fffa39eaa83567fff00e0538915",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "fa2d1690d139932923535a9150cb161a69a9cdc9868c09bd9eebb1f6bc575e25"
      }
    ]
  },
  {
    "id": "f518825d-26ad-4791-89bc-6b2eac4ab057",
    "expected": {
      "area": "Butunduzi",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "7541805c17c5417f0ea0ea5611f8f5ad",
      "district": "Kyenjojo",
      "extra_md5": "f41d9b5edd98d3eedf5b34b0026b544c",
      "listing_type": "land",
      "price": "9000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "9000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0fd96c7066653891c03608c8896eebd9",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "96a9da6036a5e0210df31def4f79aee0e0e9e2d731274d8f8f95fdc538a2b065"
      }
    ]
  },
  {
    "id": "f5528a41-1aea-4a15-83d0-d9fe0b6a1f94",
    "expected": {
      "area": "Kiwatule",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "593bc2a7d5daddd3b3794e816d253791",
      "district": "Kampala",
      "extra_md5": "a6ba2334f103b2543c829240043a2e00",
      "listing_type": "rent",
      "price": "3000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "3000000",
      "price_original_currency": "UGX",
      "price_period": "mo",
      "property_type": null,
      "status": "approved",
      "title_md5": "6ec1c51b79c7868b07283fe14a5c636b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 1300000,
      "price_original": 1300000
    },
    "extraPatch": {
      "price_original": 1300000,
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "25a4031b103222ce9d19eb3fa46e174db32216a458502ec82aaa842d04147180"
      }
    ]
  },
  {
    "id": "f559a474-9c80-4a55-a50f-4ce0ea854f96",
    "expected": {
      "area": "Amuru",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "29a81240d42793569385b8d3f10cd29a",
      "district": "Amuru",
      "extra_md5": "0884b77351fc840700e8f08904d1063f",
      "listing_type": "land",
      "price": "2000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "1aaf4eed21eadbc1a26991ba424ab946",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "66870e5b63c28de2407b0d71fcee410583e672e09fac9fd8a622596bd5f359b5"
      }
    ]
  },
  {
    "id": "f5c5df0e-b4e6-42dd-9f09-db50c57277c5",
    "expected": {
      "area": "Entebbe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "2544caf9005334d3a07d2542ae5e1c37",
      "district": "Wakiso",
      "extra_md5": "cf2f75d459d150dbc9a773518792a569",
      "listing_type": "land",
      "price": "100000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "91807e7d7d72e8b9e1fa8b206d0ff52b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "plot"
    },
    "extraPatch": {
      "price_period": "plot",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state plot price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "a09080b98babff3c36c456de3703a07085a33c89c47f7e12e49f7cd07c869f72"
      }
    ]
  },
  {
    "id": "fa0290bd-532b-4263-be1a-0cc8465f68e3",
    "expected": {
      "area": "Kisaasi",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "8bf15db599a8722491d5275111c77949",
      "district": "Kampala",
      "extra_md5": "ae0063f2c00fa8f934b9963808f7429e",
      "listing_type": "rent",
      "price": "400000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "400000",
      "price_original_currency": "UGX",
      "price_period": "month",
      "property_type": "apartment",
      "status": "approved",
      "title_md5": "0cf17321e68b54cb1bf098207665854b",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "night",
      "description": "Apartment for rent in Kisaasi, Kampala, listed at UGX 400,000/night. It is 400k per night Airbnb Rent Rent It is for rent Apartment Kisaasi kampala. Watch the attached video tour before enquiring. Contact Kimuli Brian to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {
      "price_period": "night",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Source explicitly quotes a nightly/daily amount; monthly suffix is wrong."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "4969db97164b6e4171102efb5676531289b386cf1912f7cc6d8c3d3c29196063"
      }
    ]
  },
  {
    "id": "fa7a4ba1-38c8-4ff8-80b4-45df98a32846",
    "expected": {
      "area": "Kungu",
      "bathrooms": "0",
      "bedrooms": "1",
      "description_md5": "743cd9559bea24a97fb1ae7c6407c7e6",
      "district": "Apac",
      "extra_md5": "f03bc568092f82cfae9ce003593c1dce",
      "listing_type": "sale",
      "price": "950000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "950000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "68e3e67736ff73561270813eae3f2c3e",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartment block"
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "843874706772e4374809f3e0fbb43651f252dc0516a1b9ebcff6000dbfd3910d"
      }
    ]
  },
  {
    "id": "fbfe54e8-0b10-4479-964f-462e4eed525d",
    "expected": {
      "area": "Namugongo",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "6ce11cec31e27a2115701dd2e3301df9",
      "district": "Wakiso",
      "extra_md5": "990ef653c8527dbf59f637b973eedb54",
      "listing_type": "sale",
      "price": "6000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "0d578d7fb38b9dbe22bffd125412cf61",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 600000000,
      "price_original": 600000000,
      "price_currency": "UGX",
      "price_original_currency": "UGX",
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "once",
      "price_on_application": false,
      "property_type": "Rental units",
      "description": "Six units NAMUGONGO two bedrooms two bathrooms making 6m monthly selling for 600m is a property around Namugongo. The guide price shown in the source is UGX 600,000,000. Six units NAMUGONGO two bedrooms two bathrooms making 6m monthly selling for 600m The source post is titled \"Six units NAMUGONGO two bedrooms two bathrooms making 6m monthly selling for 600m\". First posted online on 2026-01-06. It is connected to UGANDA YAFFEE PROPERTIES's public property source, with the available contact route shown on the listing for direct enquiry. Viewers should use the gallery, source evidence, map area and contact route to confirm availability and arrange a viewing.",
      "title": "Rental units for sale in Namugongo, Wakiso"
    },
    "extraPatch": {
      "price_original": 600000000,
      "price_original_currency": "UGX",
      "price_currency": "UGX",
      "price_fx_rate_ugx": null,
      "price_fx_as_of": null,
      "price_period": "once",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored monthlyincome as wholeproperty askingprice; explicit sellingfor amount confirms correctwholeasset asking. No sourceidentityconflict observed; currentarea matchescaption."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_description",
        "sha256": "c57fb135016cab8763984fae03d84a02749c93ed0973100506f9cbbc8f61f407"
      }
    ]
  },
  {
    "id": "fc617866-5eef-4d1f-9a26-57b8118d6e81",
    "expected": {
      "area": "Kyaliwajjala",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "db6da3b4265c773de363fa6e923f3092",
      "district": "Wakiso",
      "extra_md5": "0a9c7795dcf29cf0d657cd7929ef3278",
      "listing_type": "sale",
      "price": "2200000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "2200000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "fc141ae42fe44f81ed2e71cd299a88c9",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "bedrooms": null,
      "property_type": "Apartments",
      "title": "Apartments for sale in Kyaliwajjala",
      "description": "Apartments for sale in Kyaliwajjala, Wakiso, listed at UGX 2,200,000,000. Mbalwa Kyaliwajjala road 12 units of 2 bedrooms apartments monthly income 18 million on sale UGX 2.2 billion negotiable. Watch the 2 attached video tours and browse 5 extracted key images before enquiring. Contact Francis Isabirye to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Source sells the whole multi-unit asset. Recorded bedrooms is a per-unit bed count, unit count or income value, not the whole-asset bedrooms field; keep detailed unit mix in unchanged source evidence."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "cd7f2d36b9353eeb1022356976ab7c2145698f62328e2c01c70c46da22b6197d"
      }
    ]
  },
  {
    "id": "fc63ad4d-4c37-4d28-b86a-cd5e70d009fd",
    "expected": {
      "area": "Kitwe",
      "bathrooms": null,
      "bedrooms": null,
      "description_md5": "bf8560a997571cad9af85296679b6277",
      "district": "Ntungamo",
      "extra_md5": "2fec6bcd4ac3d182c9b1af388630424e",
      "listing_type": "land",
      "price": "10000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "10000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "deeeff852da84a0cfc66bc15d1a673b5",
      "transaction_type": "sale",
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price_period": "acre"
    },
    "extraPatch": {
      "price_period": "acre",
      "price_label": null,
      "price_status": "published_price_or_guide_price"
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Stored amount equals source explicit per-unit rate; retain amount and state acre price basis. This does not assert that seller will split the parcel."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "923c33d5f036c8da49c36c0eb8807ac37c6cfca489ded1aebd3eee428a1a2181"
      }
    ]
  },
  {
    "id": "fca4bfa1-9861-4a02-bf45-8afd81f4c008",
    "expected": {
      "area": "Zana",
      "bathrooms": "0",
      "bedrooms": null,
      "description_md5": "5853311a104c04b5b4a630a18e4bd617",
      "district": "Wakiso",
      "extra_md5": "ea3f729ebc565135d553f4fd2c2757b9",
      "listing_type": "rent",
      "price": null,
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "true",
      "price_original": null,
      "price_original_currency": "UGX",
      "price_period": "month",
      "property_type": null,
      "status": "approved",
      "title_md5": "a44d272db7257af9c26477fd0b9188ee",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "price": 300000,
      "price_original": 300000,
      "price_on_application": false
    },
    "extraPatch": {
      "price_original": 300000,
      "price_label": null,
      "price_status": "published_price_or_guide_price",
      "price_on_application": false,
      "price_upon_application": false,
      "price_review": null
    },
    "domains": [
      "prices"
    ],
    "reasons": [
      "Asking price in original source differs from stored price."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "352249737269d18d1a0b04450de4f4c359a1db9091499081f9ad4f0be9d8bfba"
      }
    ]
  },
  {
    "id": "fda41707-5490-47b9-8a94-ec81e5251493",
    "expected": {
      "area": "Kajjansi",
      "bathrooms": null,
      "bedrooms": "2",
      "description_md5": "412aa690f1b348e44af0d0a5a84c1a35",
      "district": "Wakiso",
      "extra_md5": "9a85f5dde93926c0dd20c1b44e8e51a5",
      "listing_type": "sale",
      "price": "270000000",
      "price_currency": "UGX",
      "price_fx_as_of": null,
      "price_fx_rate_ugx": null,
      "price_on_application": "false",
      "price_original": "270000000",
      "price_original_currency": "UGX",
      "price_period": "once",
      "property_type": null,
      "status": "approved",
      "title_md5": "079ef0453415a26c9054b62033bb326a",
      "transaction_type": null,
      "updated_at": "2026-10-23 06:21:45.533547+00"
    },
    "patch": {
      "property_type": "Unfinished rental houses",
      "bedrooms": null,
      "title": "Unfinished rental houses for sale in Kajjansi",
      "description": "Unfinished rental houses for sale in Kajjansi, Wakiso, listed at UGX 270,000,000. Un finished rentals on sale at a price of 270m located at kajjansi on entebbe road seated on 14 decimals land size with a private mailo land title The rentals has 4 houses with 2 bedrooms, two bathrooms, kitchen, sitting and dining hoping to 3.2m per month when complete (800000 per household). Watch the attached video tour and browse 5 extracted key images before enquiring. Contact Segawa Frederick Kevin SFK to confirm current availability, full specifications and viewing arrangements."
    },
    "extraPatch": {},
    "domains": [
      "types"
    ],
    "reasons": [
      "Stored title says Land but raw source offers the whole set of existing residential units/houses. Recorded two bedrooms is per unit, not the whole asset."
    ],
    "evidence": [
      {
        "field": "extra_fields.source_caption",
        "sha256": "c3f0d7bb19acb76707abdfcd02626c5d239567286c1f23784b8e5492083668e0"
      }
    ]
  }
]
$reviewed_inventory$::jsonb)
), eligible AS (
  SELECT p.id, r.spec,
         COALESCE(p.extra_fields, '{}'::jsonb) || (r.spec->'extraPatch') AS next_extra
    FROM properties p JOIN repairs r ON p.id = (r.spec->>'id')::uuid
   WHERE current_setting('app.country_code', true) = 'UG'
     AND NOT (COALESCE(p.extra_fields, '{}'::jsonb) ? 'inventory_fact_correction_164')
     AND jsonb_build_object(
       'listing_type', p.listing_type::text,
       'transaction_type', p.transaction_type::text,
       'property_type', p.property_type::text,
       'bedrooms', p.bedrooms::text,
       'bathrooms', p.bathrooms::text,
       'price', p.price::text,
       'price_original', p.price_original::text,
       'price_period', p.price_period::text,
       'price_currency', p.price_currency::text,
       'price_original_currency', p.price_original_currency::text,
       'price_fx_rate_ugx', p.price_fx_rate_ugx::text,
       'price_fx_as_of', p.price_fx_as_of::text,
       'price_on_application', p.price_on_application::text,
       'status', p.status::text,
       'area', p.area::text,
       'district', p.district::text,
       'updated_at', p.updated_at::text,
       'extra_md5', md5(COALESCE(p.extra_fields, '{}'::jsonb)::text),
       'title_md5', md5(COALESCE(p.title, '')),
       'description_md5', md5(COALESCE(p.description, ''))
     ) = r.spec->'expected'
     AND NOT EXISTS (
       SELECT 1 FROM property_video_ocr o WHERE o.property_id = p.id
         AND o.override IS NULL AND o.resolution IS NULL
         AND CASE WHEN jsonb_typeof(o.conflicts) = 'array' THEN jsonb_array_length(o.conflicts) > 0 ELSE TRUE END
     )
)
UPDATE properties p
   SET
       title = CASE WHEN e.spec->'patch' ? 'title' THEN (e.spec->'patch'->>'title')::text ELSE p.title END,
       description = CASE WHEN e.spec->'patch' ? 'description' THEN (e.spec->'patch'->>'description')::text ELSE p.description END,
       listing_type = CASE WHEN e.spec->'patch' ? 'listing_type' THEN (e.spec->'patch'->>'listing_type')::text ELSE p.listing_type END,
       transaction_type = CASE WHEN e.spec->'patch' ? 'transaction_type' THEN (e.spec->'patch'->>'transaction_type')::text ELSE p.transaction_type END,
       property_type = CASE WHEN e.spec->'patch' ? 'property_type' THEN (e.spec->'patch'->>'property_type')::text ELSE p.property_type END,
       bedrooms = CASE WHEN e.spec->'patch' ? 'bedrooms' THEN (e.spec->'patch'->>'bedrooms')::integer ELSE p.bedrooms END,
       bathrooms = CASE WHEN e.spec->'patch' ? 'bathrooms' THEN (e.spec->'patch'->>'bathrooms')::integer ELSE p.bathrooms END,
       price = CASE WHEN e.spec->'patch' ? 'price' THEN (e.spec->'patch'->>'price')::numeric ELSE p.price END,
       price_original = CASE WHEN e.spec->'patch' ? 'price_original' THEN (e.spec->'patch'->>'price_original')::numeric ELSE p.price_original END,
       price_period = CASE WHEN e.spec->'patch' ? 'price_period' THEN (e.spec->'patch'->>'price_period')::text ELSE p.price_period END,
       price_currency = CASE WHEN e.spec->'patch' ? 'price_currency' THEN (e.spec->'patch'->>'price_currency')::text ELSE p.price_currency END,
       price_original_currency = CASE WHEN e.spec->'patch' ? 'price_original_currency' THEN (e.spec->'patch'->>'price_original_currency')::text ELSE p.price_original_currency END,
       price_fx_rate_ugx = CASE WHEN e.spec->'patch' ? 'price_fx_rate_ugx' THEN (e.spec->'patch'->>'price_fx_rate_ugx')::numeric ELSE p.price_fx_rate_ugx END,
       price_fx_as_of = CASE WHEN e.spec->'patch' ? 'price_fx_as_of' THEN (e.spec->'patch'->>'price_fx_as_of')::timestamptz ELSE p.price_fx_as_of END,
       price_on_application = CASE WHEN e.spec->'patch' ? 'price_on_application' THEN (e.spec->'patch'->>'price_on_application')::boolean ELSE p.price_on_application END,
       extra_fields = e.next_extra || jsonb_build_object('inventory_fact_correction_164', jsonb_build_object(
         'applied_at', NOW(),
         'domains', e.spec->'domains',
         'reasons', e.spec->'reasons',
         'source_evidence', e.spec->'evidence',
         'before', jsonb_build_object('title',p.title,'description',p.description,'listing_type',p.listing_type,'transaction_type',p.transaction_type,'property_type',p.property_type,'bedrooms',p.bedrooms,'bathrooms',p.bathrooms,'price',p.price,'price_original',p.price_original,'price_period',p.price_period,'price_currency',p.price_currency,'price_original_currency',p.price_original_currency,'price_fx_rate_ugx',p.price_fx_rate_ugx,'price_fx_as_of',p.price_fx_as_of,'price_on_application',p.price_on_application,'updated_at',p.updated_at),
         'after', jsonb_build_object('title',p.title,'description',p.description,'listing_type',p.listing_type,'transaction_type',p.transaction_type,'property_type',p.property_type,'bedrooms',p.bedrooms,'bathrooms',p.bathrooms,'price',p.price,'price_original',p.price_original,'price_period',p.price_period,'price_currency',p.price_currency,'price_original_currency',p.price_original_currency,'price_fx_rate_ugx',p.price_fx_rate_ugx,'price_fx_as_of',p.price_fx_as_of,'price_on_application',p.price_on_application,'updated_at',p.updated_at) || (e.spec->'patch'),
         'extra_before', COALESCE((SELECT jsonb_object_agg(k,v) FROM jsonb_each(COALESCE(p.extra_fields, '{}'::jsonb)) kv(k,v) WHERE e.spec->'extraPatch' ? k), '{}'::jsonb),
         'extra_keys', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(e.spec->'extraPatch') k),
         'after_extra_md5', md5(e.next_extra::text)
       )),
       updated_at = NOW()
  FROM eligible e
 WHERE p.id = e.id
   -- Recheck against the locked UPDATE target after any concurrent edit.
   AND current_setting('app.country_code', true) = 'UG'
   AND NOT (COALESCE(p.extra_fields, '{}'::jsonb) ? 'inventory_fact_correction_164')
   AND jsonb_build_object(
       'listing_type', p.listing_type::text,
       'transaction_type', p.transaction_type::text,
       'property_type', p.property_type::text,
       'bedrooms', p.bedrooms::text,
       'bathrooms', p.bathrooms::text,
       'price', p.price::text,
       'price_original', p.price_original::text,
       'price_period', p.price_period::text,
       'price_currency', p.price_currency::text,
       'price_original_currency', p.price_original_currency::text,
       'price_fx_rate_ugx', p.price_fx_rate_ugx::text,
       'price_fx_as_of', p.price_fx_as_of::text,
       'price_on_application', p.price_on_application::text,
       'status', p.status::text,
       'area', p.area::text,
       'district', p.district::text,
       'updated_at', p.updated_at::text,
       'extra_md5', md5(COALESCE(p.extra_fields, '{}'::jsonb)::text),
       'title_md5', md5(COALESCE(p.title, '')),
       'description_md5', md5(COALESCE(p.description, ''))
   ) = e.spec->'expected';
