CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH youtube_rows AS (
  SELECT
    id,
    COALESCE(
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM '[?&]v=([A-Za-z0-9_-]{6,})'),
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM 'youtu\.be/([A-Za-z0-9_-]{6,})'),
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM '/shorts/([A-Za-z0-9_-]{6,})')
    ) AS video_id
  FROM properties
  WHERE COALESCE(source, '') = 'found_online_property_source_v1'
    AND COALESCE(extra_fields->>'source_platform', '') ILIKE 'YouTube'
)
DELETE FROM property_images pi
USING youtube_rows yt
WHERE pi.property_id = yt.id
  AND (
    pi.url LIKE 'https://i.ytimg.com/vi/%'
    OR pi.slot_key = 'source_evidence_card'
  );

WITH youtube_rows AS (
  SELECT
    id,
    COALESCE(
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM '[?&]v=([A-Za-z0-9_-]{6,})'),
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM 'youtu\.be/([A-Za-z0-9_-]{6,})'),
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM '/shorts/([A-Za-z0-9_-]{6,})')
    ) AS video_id
  FROM properties
  WHERE COALESCE(source, '') = 'found_online_property_source_v1'
    AND COALESCE(extra_fields->>'source_platform', '') ILIKE 'YouTube'
),
frames(file_name, room_label, slot_key, sort_order, is_primary) AS (
  VALUES
    ('hqdefault.jpg', 'YouTube video cover still', 'youtube_video_cover_still', 0, TRUE),
    ('0.jpg', 'YouTube video preview still', 'youtube_video_preview_still', 1, FALSE),
    ('1.jpg', 'YouTube video still 1', 'youtube_video_still_1', 2, FALSE),
    ('2.jpg', 'YouTube video still 2', 'youtube_video_still_2', 3, FALSE),
    ('3.jpg', 'YouTube video still 3', 'youtube_video_still_3', 4, FALSE)
)
INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
SELECT
  yt.id,
  'https://i.ytimg.com/vi/' || yt.video_id || '/' || f.file_name,
  f.is_primary,
  f.sort_order,
  f.slot_key,
  f.room_label
FROM youtube_rows yt
CROSS JOIN frames f
WHERE yt.video_id IS NOT NULL;

WITH youtube_rows AS (
  SELECT
    id,
    COALESCE(
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM '[?&]v=([A-Za-z0-9_-]{6,})'),
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM 'youtu\.be/([A-Za-z0-9_-]{6,})'),
      substring(COALESCE(extra_fields->>'source_url', extra_fields->>'youtube_url', '') FROM '/shorts/([A-Za-z0-9_-]{6,})')
    ) AS video_id
  FROM properties
  WHERE COALESCE(source, '') = 'found_online_property_source_v1'
    AND COALESCE(extra_fields->>'source_platform', '') ILIKE 'YouTube'
)
UPDATE properties p
SET extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
  || jsonb_build_object(
    'photo_source_urls', jsonb_build_array(
      'https://i.ytimg.com/vi/' || yt.video_id || '/hqdefault.jpg',
      'https://i.ytimg.com/vi/' || yt.video_id || '/0.jpg',
      'https://i.ytimg.com/vi/' || yt.video_id || '/1.jpg',
      'https://i.ytimg.com/vi/' || yt.video_id || '/2.jpg',
      'https://i.ytimg.com/vi/' || yt.video_id || '/3.jpg'
    ),
    'minimum_reliable_image_count', 5,
    'video_still_count', 5,
    'video_still_policy', 'Use YouTube public thumbnail/still URLs as source evidence only; confirm authorisation before public approval.',
    'first_posted_online_label', COALESCE(NULLIF(p.extra_fields->>'first_posted_online_label', ''), 'First seen online in the 2026 found-online sweep; exact platform publish date needs confirmation')
  ),
  updated_at = NOW()
FROM youtube_rows yt
WHERE p.id = yt.id
  AND yt.video_id IS NOT NULL;

WITH candidates (
  source_key,
  source_platform,
  source_name,
  source_contact_url,
  source_url,
  source_url_is_exact,
  title,
  listing_type,
  property_type,
  district,
  area,
  address,
  price,
  price_period,
  bedrooms,
  bathrooms,
  land_size_value,
  land_size_unit,
  first_seen_at,
  source_date_status,
  description
) AS (
  VALUES
  ('upc-10931-munyonyo-7bed-700k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/10931-new-luxury-7-bedroom-house-in-munyonyo', TRUE, 'New Luxury 7 Bedroom House in Munyonyo', 'sale', 'Terraced Duplex', 'Wakiso', 'Munyonyo', 'Munyonyo, Wakiso', 2725934006::bigint, 'once', 7, 7, 728::numeric, 'sqm', '2026-01-21'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10931. Added on 21 Jan 2026 with a USD 700,000 guide price. Confirm availability, source contact authority, and media rights before approval.'),
  ('upc-10914-kira-residential-plot-165m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/land/residential-land/central-region/wakiso/kira-town/10914-residential-plot-in-kira', TRUE, 'Residential Plot in Kira Town', 'land', 'Residential Land', 'Wakiso', 'Kira Kiwologoma', 'Kira Kiwologoma, Kira Town, Wakiso', 165000000::bigint, 'once', NULL::integer, NULL::integer, 1011::numeric, 'sqm', '2026-01-07'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10914. Added on 07 Jan 2026 for a 100ft by 100ft Kira residential plot. Confirm title, boundaries, and media rights before approval.'),
  ('upc-10935-kira-nsasa-plot-80m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/land/residential-land/central-region/wakiso/kira-town/10935-prime-residential-plot-in-kira', TRUE, 'Prime Residential Plot in Kira Nsasa', 'land', 'Residential Land', 'Wakiso', 'Kira Nsasa Estate', 'Kira Nsasa Estate, Kira Town, Wakiso', 80000000::bigint, 'once', NULL::integer, NULL::integer, 485::numeric, 'sqm', '2026-01-22'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10935. Added on 22 Jan 2026 for a 12-decimal Kira Nsasa plot. Confirm title, access, and media rights before approval.'),
  ('upc-10940-kira-town-6bed-750m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/kira-town/10940-luxury-6-bedroom-house-in-kira-town', TRUE, 'Luxury 6 Bedroom House in Kira Town', 'sale', 'Terraced Duplex', 'Wakiso', 'Kira Town', 'Kira Town, Wakiso', 750000000::bigint, 'once', 6, 6, 1011::numeric, 'sqm', '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10940. Added on 24 Jan 2026 with a USh 750M guide price. Confirm availability and media rights before approval.'),
  ('upc-10949-kira-shimon-4bed-400m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/wakiso/kira-town/10949-beautiful-4-bedroom-house-in-kira-town', TRUE, 'Beautiful 4 Bedroom House in Kira Town', 'sale', 'Terraced Bungalow', 'Wakiso', 'Kira Mulawa / Shimon Estate', 'Kira Mulawa, Shimon Estate, Kira Town, Wakiso', 400000000::bigint, 'once', 4, 4, 526::numeric, 'sqm', '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10949. Added on 24 Jan 2026 with a USh 400M guide price. Confirm exact price, availability, and media rights before approval.'),
  ('upc-10916-arkright-city-4bed-750m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/wakiso/10916-beautiful-new-4-bedroom-house-in-arkright-city', TRUE, 'Beautiful New 4 Bedroom House in Arkright City', 'sale', 'Terraced Bungalow', 'Wakiso', 'Arkright Estate', 'Arkright Estate, Wakiso', 750000000::bigint, 'once', 4, 4, 809::numeric, 'sqm', '2026-01-08'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10916. Added on 08 Jan 2026 for a 4-bedroom Arkright City home. Confirm availability and media rights before approval.'),
  ('upc-10952-namugongo-4bed-400m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/wakiso/10952-4-bedroom-house-in-namugongo', TRUE, '4 Bedroom House in Namugongo Nabusugwe', 'sale', 'Terraced Bungalow', 'Wakiso', 'Namugongo Nabusugwe', 'Namugongo Nabusugwe, Wakiso', 400000000::bigint, 'once', 4, 3, 485::numeric, 'sqm', '2026-01-25'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10952. Added on 25 Jan 2026 with a USh 400M guide price. Confirm availability and media rights before approval.'),
  ('upc-10971-kira-town-4bed-550m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/wakiso/kira-town/10971-newly-built-4-bedroom-house-in-kira', TRUE, 'Newly Built 4 Bedroom House in Kira', 'sale', 'Terraced Bungalow', 'Wakiso', 'Kira Town', 'Kira Town, Wakiso', 550000000::bigint, 'once', 4, 4, 485::numeric, 'sqm', '2026-02-03'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10971. Added on 03 Feb 2026 for a newly built 4-bedroom Kira home. Confirm availability and media rights before approval.'),
  ('upc-10928-ntinda-kiwatule-6bed-1-5b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/10928-luxury-6-bedroom-house-in-ntinda-kiwatule', TRUE, 'Luxury 6 Bedroom House in Ntinda Kiwatule', 'sale', 'Terraced Duplex', 'Kampala', 'Ntinda / Kiwatule', 'Ntinda, Kiwatule Road, Kampala', 1500000000::bigint, 'once', 6, 6, 1011::numeric, 'sqm', '2026-01-21'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10928. Added on 21 Jan 2026 with a USh 1.5B guide price. Confirm availability and media rights before approval.'),
  ('upc-10989-bwebajja-6bed-1-1b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/10989-brand-new-6-bedroom-house-in-bwebajja', TRUE, 'Brand New 6 Bedroom House in Bwebajja', 'sale', 'Terraced Duplex', 'Wakiso', 'Bwebajja', 'Bwebajja, Entebbe Road, Wakiso', 1100000000::bigint, 'once', 6, 5, 809::numeric, 'sqm', '2026-02-16'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10989. Added on 16 Feb 2026 with a USh 1.1B guide price. Confirm availability, exact pin, and media rights before approval.'),
  ('upc-10978-namulanda-lakeview-5bed-1b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/10978-luxury-lakeview-5-bedroom-house-in-namulanda-off-entebbe-road', TRUE, 'Luxury Lakeview 5 Bedroom House in Namulanda', 'sale', 'Terraced Duplex', 'Wakiso', 'Namulanda / Buzzi', 'Namulanda, Buzzi, Entebbe Road, Wakiso', 1000000000::bigint, 'once', 5, 5, 607::numeric, 'sqm', '2026-02-10'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10978. Added on 10 Feb 2026 with a USh 1B guide price. Confirm availability, lake-view claims, and media rights before approval.'),
  ('upc-11023-najjera-buwate-plot-370m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/land/mixed-use-land/central-region/kampala/11023-najjera-buwate-plot-26-decimal-at-370m', TRUE, 'Najjera Buwate 26 Decimal Mixed-use Plot', 'land', 'Mixed-use Land', 'Kampala', 'Najjera Buwate', 'Najjera Buwate, Kampala', 370000000::bigint, 'once', NULL::integer, NULL::integer, 1052::numeric, 'sqm', '2026-03-03'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 11023. Added on 03 Mar 2026 for a 26-decimal mixed-use Najjera Buwate plot. Confirm title, permitted use, and media rights before approval.'),
  ('upc-10921-nakasero-2bed-apartment-270k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/flats-apartments/central-region/kampala/10921-luxury-2-bedrooms-with-excellent-facilities', TRUE, 'Luxury 2 Bedroom Apartment on Mackinnon Road', 'sale', 'Apartment', 'Kampala', 'Nakasero', 'Mackinnon Road, Nakasero, Kampala', 1065225718::bigint, 'once', 2, 1, 120::numeric, 'sqm', '2026-01-13'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10921. Added on 13 Jan 2026 with a USD 270,000 guide price. Confirm service charge, availability, and media rights before approval.'),
  ('upc-10946-muyenga-4bed-townhouse-330k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/townhouses/central-region/kampala/10946-luxury-4-bedroom-townhouse-in-muyenga', TRUE, 'Luxury 4 Bedroom Townhouse in Muyenga', 'sale', 'Townhouse', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 1298147202::bigint, 'once', 4, 4, 485::numeric, 'sqm', '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10946. Added on 24 Jan 2026 with a USD 330,000 guide price. Confirm availability, estate/security details, and media rights before approval.'),
  ('upc-10944-ntinda-kiwatule-6bed-499k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/10944-luxury-new-6-bedroom-house-in-ntinda-kiwatule', TRUE, 'Luxury New 6 Bedroom House in Ntinda Kiwatule', 'sale', 'Terraced Duplex', 'Kampala', 'Ntinda / Kiwatule', 'Ntinda-Kiwatule Road, Kampala', 1966010265::bigint, 'once', 6, 6, NULL::numeric, NULL::text, '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10944. Added on 24 Jan 2026 with a USD 499,000 guide price. Confirm full area details, availability, and media rights before approval.'),
  ('upc-11004-kulambiro-4bed-395k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/kampala/11004-4-bedroom-house-on-kulambiro-hill-top', TRUE, '4 Bedroom House on Kulambiro Hill Top', 'sale', 'Terraced Bungalow', 'Kampala', 'Kulambiro', 'Kulambiro Hill Top, Kampala', 1553842863::bigint, 'once', 4, 4, 1618::numeric, 'sqm', '2026-02-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 11004. Added on 24 Feb 2026 with a USD 395,000 guide price. Confirm availability, land size, and media rights before approval.'),
  ('upc-11056-ntinda-ministers-5bed-1-5b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/11056-luxury-5-bedroom-house-in-ntinda', TRUE, 'Luxury 5 Bedroom House in Ntinda Ministers Village', 'sale', 'Terraced Duplex', 'Kampala', 'Ntinda Ministers Village', 'Ministers Village Ntinda, Kampala', 1500000000::bigint, 'once', 5, 5, 606::numeric, 'sqm', '2026-03-17'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 11056. Added on 17 Mar 2026 with a USh 1.5B guide price. Confirm availability and media rights before approval.'),
  ('upc-11006-kyanja-6bed-1-2b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/11006-luxurious-6-bedroom-house-in-kyanja-town', TRUE, 'Luxurious 6 Bedroom House in Kyanja Town', 'sale', 'Terraced Duplex', 'Kampala', 'Kyanja', 'Kyanja Town, Kampala', 1200000000::bigint, 'once', 6, 7, 809::numeric, 'sqm', '2026-02-25'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 11006. Added on 25 Feb 2026 with a USh 1.2B guide price. Confirm availability, exact amenities, and media rights before approval.'),
  ('upc-10941-ntinda-8unit-apartment-block-1-2b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/block-of-flats/central-region/kampala/10941-fully-occupied-8-unit-apartment-block-in-ntinda', TRUE, 'Fully Occupied 8-unit Apartment Block in Ntinda', 'sale', 'Block of Flats', 'Kampala', 'Ntinda', 'Ntinda, Kampala', 1200000000::bigint, 'once', 8, 8, 485::numeric, 'sqm', '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10941. Added on 24 Jan 2026 with a USh 1.2B guide price and reported rental income. Confirm occupancy, income proof, and media rights before approval.'),
  ('upc-10982-muyenga-5bed-350k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/10982-luxury-5-bedroom-house-in-muyenga', TRUE, 'Luxury 5 Bedroom House in Muyenga', 'sale', 'Terraced Duplex', 'Kampala', 'Muyenga Bukasa', 'Muyenga Bukasa, Kampala', 1376822790::bigint, 'once', 5, NULL::integer, NULL::numeric, NULL::text, '2026-02-13'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre ref 10982. Added on 13 Feb 2026 with a USD 350,000 guide price. Confirm bathroom count, land size, availability, and media rights before approval.'),
  ('jiji-rent-kampala-munyonyo-3bed-duplex-2-1m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '3bdrm Duplex in Munyonyo for Rent', 'rent', 'Duplex', 'Kampala', 'Munyonyo', 'Munyonyo, Kampala', 2100000::bigint, 'month', 3, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 2.1M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-muyenga-2bed-apartment-1m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '2bdrm Apartment in Muyenga for Rent', 'rent', 'Apartment', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 1000000::bigint, 'month', 2, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 1M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-upper-lweza-4bed-duplex-3m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '4bdrm Duplex in Upper Lweza for Rent', 'rent', 'Duplex', 'Kampala', 'Upper Lweza', 'Upper Lweza, Kampala', 3000000::bigint, 'month', 4, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 3M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-ntinda-ministers-5bed-duplex-4-5m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '5bdrm Duplex in Ntinda Ministers for Rent', 'rent', 'Duplex', 'Kampala', 'Ntinda Ministers', 'Ntinda Ministers, Kampala', 4500000::bigint, 'month', 5, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 4.5M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-lweza-lubowa-4bed-duplex-2-8m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '4bdrm Duplex in Lweza Lubowa for Rent', 'rent', 'Duplex', 'Kampala', 'Lweza Lubowa', 'Lweza Lubowa, Kampala', 2800000::bigint, 'month', 4, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 2.8M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-bukoto-1bed-apartment-700k', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '1bdrm Apartment in Bukoto for Rent', 'rent', 'Apartment', 'Kampala', 'Bukoto', 'Bukoto, Kampala', 700000::bigint, 'month', 1, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 700K monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-bahia-road-nakawa-3bed-apartment-1-8m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '3bdrm Apartment on Bahia Road Nakawa for Rent', 'rent', 'Apartment', 'Kampala', 'Bahia Road, Nakawa', 'Bahia Road, Nakawa, Kampala', 1800000::bigint, 'month', 3, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 1.8M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-buziga-5bed-duplex-2-5m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '5bdrm Duplex in Buziga for Rent', 'rent', 'Duplex', 'Kampala', 'Buziga', 'Buziga, Kampala', 2500000::bigint, 'month', 5, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 2.5M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-muyenga-3bed-apartment-1-5m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '3bdrm Apartment in Muyenga for Rent', 'rent', 'Apartment', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 1500000::bigint, 'month', 3, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 1.5M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-rent-kampala-muyenga-4bed-duplex-3-5m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-rent', FALSE, '4bdrm Duplex in Muyenga for Rent', 'rent', 'Duplex', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 3500000::bigint, 'month', 4, NULL::integer, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala rental category row seen on 24 May 2026 with a USh 3.5M monthly guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-bukoto-5bed-house-950m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '5bdrm House in Bukoto for Sale', 'sale', 'House', 'Kampala', 'Bukoto', 'Bukoto, Kampala', 950000000::bigint, 'once', 5, NULL::integer, 500::numeric, 'sqm', '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 950M guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-ministers-village-3bed-apartment-400m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '3bdrm Apartment in Ministers Village for Sale', 'sale', 'Apartment', 'Kampala', 'Ministers Village, Nakawa', 'Ministers Village, Nakawa, Kampala', 400000000::bigint, 'once', 3, 3, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 400M guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-muyenga-4bed-house-1-2b', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '4bdrm House in Muyenga for Sale', 'sale', 'House', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 1200000000::bigint, 'once', 4, 5, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 1.2B guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-naguru-4bed-bungalow-1-776b', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '4bdrm Bungalow in Naguru for Sale', 'sale', 'Bungalow', 'Kampala', 'Naguru', 'Naguru, Kampala', 1776000000::bigint, 'once', 4, 4, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 1.776B guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-naalya-estate-3bed-condo-280m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '3bdrm Condo in Naalya Estate for Sale', 'sale', 'Condo', 'Kampala', 'Naalya Estate', 'Naalya Estate, Kampala', 280000000::bigint, 'once', 3, NULL::integer, 220::numeric, 'sqm', '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 280M guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-upper-nakasero-7bed-house-4-5b', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '7bdrm House in Upper Nakasero for Sale', 'sale', 'House', 'Kampala', 'Upper Nakasero', 'Upper Nakasero, Kampala', 4500000000::bigint, 'once', 7, NULL::integer, 350::numeric, 'sqm', '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 4.5B guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-kololo-5bed-townhouse-3b', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '5bdrm Townhouse in Kololo for Sale', 'sale', 'Townhouse', 'Kampala', 'Kololo', 'Kololo, Kampala', 3000000000::bigint, 'once', 5, NULL::integer, 250::numeric, 'sqm', '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 3B guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-bukoto-4bed-maisonette-925m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '4bdrm Maisonette in Bukoto for Sale', 'sale', 'Maisonette', 'Kampala', 'Bukoto', 'Bukoto, Kampala', 925000000::bigint, 'once', 4, NULL::integer, 170::numeric, 'sqm', '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 925M guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-bugolobi-house-1-8b', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, 'House for Sale in Bugolobi', 'sale', 'House', 'Kampala', 'Bugolobi', 'Bugolobi, Kampala', 1800000000::bigint, 'once', 8, 5, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 1.8B guide price. Confirm exact listing page, availability, and media rights before approval.'),
  ('jiji-sale-kampala-muyenga-5bed-house-1-12b', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/kampala/houses-apartments-for-sale', FALSE, '5bdrm House in Muyenga for Sale', 'sale', 'House', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 1120000000::bigint, 'once', 5, 4, NULL::numeric, NULL::text, '2026-05-24'::date, 'first_seen_2026_live_category_pending_exact_post_date', 'Jiji live Kampala sale category row seen on 24 May 2026 with a USh 1.12B guide price. Confirm exact listing page, availability, and media rights before approval.')
),
inserted AS (
  INSERT INTO properties (
    listing_type, title, description, district, area, address, price, price_period,
    bedrooms, bathrooms, property_type, land_size_value, land_size_unit,
    students_welcome, verification_terms_accepted, inquiry_reference, new_until,
    amenities, extra_fields, lister_name, lister_type, source, listed_via,
    status, moderation_stage, moderation_notes, moderation_reason
  )
  SELECT
    c.listing_type,
    c.title,
    c.description,
    c.district,
    c.area,
    c.address,
    c.price,
    c.price_period,
    c.bedrooms,
    c.bathrooms,
    c.property_type,
    c.land_size_value,
    c.land_size_unit,
    c.listing_type = 'students',
    FALSE,
    'MK-20260524-' || UPPER(SUBSTRING(md5(c.source_key), 1, 6)),
    NOW() + INTERVAL '30 days',
    jsonb_build_array('Found online', c.source_name || ' source evidence', 'Contact via source', 'King review required'),
    jsonb_build_object(
      'found_online_candidate', true,
      'found_online', true,
      'social_search_candidate', true,
      'source_badge', 'found_online',
      'source_discovery_label', 'Found online',
      'source_batch', 'found_online_2026_second_sweep_20260524',
      'source_listing_key', c.source_key,
      'source_platform', c.source_platform,
      'source_name', c.source_name,
      'source_type', 'found_online_source_post',
      'source_url', c.source_url,
      'source_post_url', c.source_url,
      'source_contact_url', c.source_contact_url,
      'source_contact_label', 'Contact via source',
      'source_contact_method', 'source_page',
      'source_contact_available_without_phone', true,
      'public_contact_path_available', true,
      'source_url_is_exact_listing', c.source_url_is_exact,
      'source_post_window_start', '2026-01-01T00:00:00.000Z',
      'source_seen_at', c.first_seen_at::text,
      'first_seen_online_at', c.first_seen_at::text,
      'first_seen_online_label', 'First seen online in makaug sweep on ' || to_char(c.first_seen_at, 'DD Mon YYYY'),
      'source_published_at', c.first_seen_at::text,
      'first_posted_online_at', c.first_seen_at::text,
      'first_posted_online_label', CASE
        WHEN c.source_date_status = 'confirmed_2026_source_added_on'
          THEN 'First posted online on ' || to_char(c.first_seen_at, 'DD Mon YYYY')
        ELSE 'First seen online in live ' || c.source_name || ' category on ' || to_char(c.first_seen_at, 'DD Mon YYYY') || '; exact original post date needs platform confirmation'
      END,
      'source_post_date_status', c.source_date_status,
      'permission_status', 'public_source_evidence_pending_agent_authorisation',
      'consent_confirmed', false,
      'image_rights_confirmed', false,
      'image_rights_status', 'public_source_evidence_pending_authorisation',
      'minimum_reliable_image_count', 1,
      'generated_source_evidence_card', true,
      'source_labels', jsonb_build_array('found online', lower(c.source_name), '2026 found-online sweep', 'Contact via source'),
      'source_urls', jsonb_build_array(c.source_url, c.source_contact_url),
      'property_url_status', 'public_after_king_approval'
    ),
    c.source_name,
    'agent',
    'found_online_property_source_v1',
    'found_online',
    'pending',
    'submitted',
    'FOUND-ONLINE SECOND 2026 SWEEP. Public source inventory from ' || c.source_name || '. Source: ' || c.source_url || '. Confirm availability, exact pin, contact authority, price, and media rights before approval.',
    'Pending King review of public found-online source evidence, source contact, exact pin, latest availability, and image/photo rights.'
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM properties p
    WHERE COALESCE(p.status, '') <> 'deleted'
      AND (
        p.extra_fields->>'source_listing_key' = c.source_key
        OR (c.source_url_is_exact AND (p.extra_fields->>'source_post_url' = c.source_url OR p.extra_fields->>'source_url' = c.source_url))
        OR (
          LOWER(COALESCE(p.title, '')) = LOWER(c.title)
          AND LOWER(COALESCE(p.area, '')) = LOWER(c.area)
          AND COALESCE(p.price, 0) = c.price
        )
      )
  )
  RETURNING id, title, extra_fields, moderation_reason, moderation_notes
),
image_rows AS (
  INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
  SELECT
    id,
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="%230f172a"/><rect x="70" y="70" width="1060" height="660" fill="%23ffffff" opacity="0.08"/><text x="90" y="315" fill="%23ffffff" font-family="Arial" font-size="56" font-weight="700">Found online</text><text x="90" y="385" fill="%23bfdbfe" font-family="Arial" font-size="32">Open source link for full media</text><text x="90" y="445" fill="%23cbd5e1" font-family="Arial" font-size="28">Verify image rights before approval</text></svg>',
    TRUE,
    0,
    'source_evidence_card',
    'Found online source evidence'
  FROM inserted
  RETURNING property_id
)
INSERT INTO property_moderation_events (
  property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
)
SELECT
  i.id,
  'found_online_second_sweep_20260524',
  'found_online_2026_second_sweep_created',
  NULL,
  'pending',
  jsonb_build_object(
    'found_online_candidate', true,
    'found_online', true,
    'consent_confirmed', false,
    'image_rights_confirmed', false,
    'source_batch', i.extra_fields->>'source_batch',
    'source_url', i.extra_fields->>'source_url'
  ),
  i.moderation_reason,
  i.moderation_notes,
  jsonb_build_object(
    'source_url', i.extra_fields->>'source_url',
    'source_contact_url', i.extra_fields->>'source_contact_url',
    'source_platform', i.extra_fields->>'source_platform',
    'image_row_created', EXISTS (SELECT 1 FROM image_rows ir WHERE ir.property_id = i.id)
  )
FROM inserted i;
