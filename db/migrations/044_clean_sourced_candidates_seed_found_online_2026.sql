CREATE EXTENSION IF NOT EXISTS pgcrypto;

DELETE FROM properties
WHERE COALESCE(source, '') = 'sourced_inventory_candidate_v1'
   OR COALESCE(listed_via, '') = 'sourced_inventory'
   OR title ILIKE 'Sourced candidate - %'
   OR COALESCE(extra_fields->>'sourced_inventory_candidate', 'false') IN ('true', '1', 'yes');

UPDATE properties
SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
  || jsonb_build_object(
    'found_online_candidate', true,
    'found_online', true,
    'source_badge', 'found_online',
    'source_discovery_label', 'Found online'
  ),
  source = 'found_online_property_source_v1',
  listed_via = 'found_online',
  updated_at = NOW()
WHERE COALESCE(source, '') = 'found_online_property_source_v1'
   OR COALESCE(listed_via, '') = 'found_online'
   OR COALESCE(extra_fields->>'found_online_candidate', 'false') IN ('true', '1', 'yes')
   OR COALESCE(extra_fields->>'found_online', 'false') IN ('true', '1', 'yes');

WITH candidates (
  source_key,
  source_platform,
  source_name,
  source_contact_url,
  source_url,
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
  latitude,
  longitude,
  first_seen_at,
  source_date_status,
  description
) AS (
  VALUES
  ('yt-lady-komamboga-kyanja-4bed-900m', 'YouTube', 'Lady Property Agent UG', 'https://www.youtube.com/@Ladypropertyagentug', 'https://www.youtube.com/watch?v=3Yx4HFkQssE', '4-Bed Home in Komamboga near Kyanja', 'sale', 'Standalone House', 'Kampala', 'Komamboga / Kyanja', 'Komamboga near Kyanja, Kampala', 900000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.394::numeric, 32.598::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record with a 4-bed home in Komamboga near Kyanja and a USh 900M guide price. Confirm exact post date, availability, title details, and media rights before approval.'),
  ('yt-legit-kasangati-nangabo-4bed-400m', 'YouTube', 'Legit Properties', 'https://www.youtube.com/@legitproperties', 'https://www.youtube.com/watch?v=1jsCm2DdByA', '4-Bed House in Kasangati-Nangabo', 'sale', 'Standalone House', 'Wakiso', 'Kasangati-Nangabo', 'Kasangati-Nangabo, Wakiso', 400000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.434::numeric, 32.61::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a Kasangati-Nangabo house with a USh 400M guide price. Confirm exact post date, pin, title details, and availability before approval.'),
  ('yt-legit-kira-house-350m', 'YouTube', 'Legit Properties', 'https://www.youtube.com/@legitproperties', 'https://www.youtube.com/watch?v=JVh0xv-tBmc', 'House for Sale in Kira at USh 350M', 'sale', 'Standalone House', 'Wakiso', 'Kira', 'Kira, Wakiso', 350000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.3978::numeric, 32.6414::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a Kira house with a USh 350M guide price. Confirm exact post date, bedroom count, title details, and availability before approval.'),
  ('yt-ezra-komamboga-kyanja-4bed-850m', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=argJvxx6Ak8', 'Brand New 4-Bed Home in Komamboga near Kyanja', 'sale', 'Standalone House', 'Kampala', 'Komamboga / Kyanja', 'Komamboga near Kyanja, Kampala', 850000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.394::numeric, 32.598::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a brand new 4-bed home near Kyanja with a USh 850M guide price. Confirm exact post date, pin, and media rights before approval.'),
  ('yt-ezra-kyebando-apartment-block-4b', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=JtYZETe6YSI', 'Apartment Block for Sale in Kyebando', 'commercial', 'Apartment Block', 'Kampala', 'Kyebando', 'Kyebando, Kampala', 4000000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.368::numeric, 32.584::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a Kyebando apartment block with a USh 4B guide price. Confirm exact post date, unit count, income, title details, and availability before approval.'),
  ('yt-ezra-kira-mulawa-bungalow-550m', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=2T_lzqoqZz8', 'Elegant Bungalow in Kira-Mulawa', 'sale', 'Bungalow', 'Wakiso', 'Kira-Mulawa', 'Kira-Mulawa, Wakiso', 550000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.412::numeric, 32.65::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a Kira-Mulawa bungalow with a USh 550M guide price. Confirm exact post date, room count, and availability before approval.'),
  ('yt-ezra-bwebajja-akright-4bed-750m', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=bUWkceAWjoM', 'Beautiful 4-Bed Bungalow in Bwebajja Akright', 'sale', 'Bungalow', 'Wakiso', 'Bwebajja Akright', 'Bwebajja Akright, Wakiso', 750000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.198::numeric, 32.535::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a 4-bed bungalow in Bwebajja Akright with a USh 750M guide price. Confirm exact post date, pin, title details, and availability before approval.'),
  ('yt-ezra-kira-mulawa-5bed-950m', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=1mXuQ3nt1hc', 'Brand New 5-Bed House in Kira-Mulawa', 'sale', 'Standalone House', 'Wakiso', 'Kira-Mulawa', 'Kira-Mulawa, Wakiso', 950000000::bigint, 'once', 5, NULL::integer, NULL::numeric, NULL::text, 0.412::numeric, 32.65::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a brand new 5-bed house in Kira-Mulawa with a USh 950M guide price. Confirm exact post date, title details, and availability before approval.'),
  ('yt-ezra-kira-town-4bed-550m', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=jgzyKevhA_I', 'Brand New 4-Bed House in Kira Town', 'sale', 'Standalone House', 'Wakiso', 'Kira Town', 'Kira Town, Wakiso', 550000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.3978::numeric, 32.6414::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a brand new 4-bed house in Kira Town with a USh 550M guide price. Confirm exact post date, road, title details, and availability before approval.'),
  ('yt-ezra-kira-nsasa-650m', 'YouTube', 'EZRA HOMES UG', 'https://www.youtube.com/@EZRAHOMESUG', 'https://www.youtube.com/watch?v=b5Yw1kKMidY', 'Brand New Luxury Home in Kira-Nsasa', 'sale', 'Standalone House', 'Wakiso', 'Kira-Nsasa', 'Kira-Nsasa, Wakiso', 650000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.428::numeric, 32.665::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a Kira-Nsasa luxury home with a USh 650M guide price. Confirm exact post date, room count, title details, and availability before approval.'),
  ('yt-empire-kitende-400m', 'YouTube', 'Empire Property UG', 'https://www.youtube.com/@EmpirepropertyUG', 'https://www.youtube.com/watch?v=wDu6UzYyqyQ', '4-Bed House in Kitende on Entebbe Road', 'sale', 'Standalone House', 'Wakiso', 'Kitende', 'Kitende, Entebbe Road, Wakiso', 400000000::bigint, 'once', 4, NULL::integer, 12::numeric, 'decimals', 0.197::numeric, 32.535::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a 4-bed Kitende house on 12 decimals with a USh 400M guide price. Confirm exact post date, pin, title details, and availability before approval.'),
  ('yt-empire-kajjansi-650m', 'YouTube', 'Empire Property UG', 'https://www.youtube.com/@EmpirepropertyUG', 'https://www.youtube.com/watch?v=XQZL7eeICzg', 'House for Sale in Kajjansi at USh 650M', 'sale', 'Standalone House', 'Wakiso', 'Kajjansi', 'Kajjansi, Wakiso', 650000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.216::numeric, 32.552::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a Kajjansi house with a USh 650M guide price. Confirm exact post date, room count, title details, and availability before approval.'),
  ('yt-empire-23-decimals-land-220m', 'YouTube', 'Empire Property UG', 'https://www.youtube.com/@EmpirepropertyUG', 'https://www.youtube.com/watch?v=Hz3gpyzhR9s', '23-Decimal Land for Sale at USh 220M', 'land', 'Residential Plot', 'Wakiso', 'Greater Kampala', 'Greater Kampala / Wakiso, Uganda', 220000000::bigint, 'once', NULL::integer, NULL::integer, 23::numeric, 'decimals', 0.31::numeric, 32.58::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for 23-decimal land with a USh 220M guide price. Confirm exact post date, district, boundaries, title details, and availability before approval.'),
  ('yt-empire-4bed-600m', 'YouTube', 'Empire Property UG', 'https://www.youtube.com/@EmpirepropertyUG', 'https://www.youtube.com/watch?v=AytqW7i0MGg', '4-Bed House for Sale at USh 600M', 'sale', 'Standalone House', 'Wakiso', 'Greater Kampala', 'Greater Kampala / Wakiso, Uganda', 600000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.31::numeric, 32.58::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a 4-bed house with a USh 600M guide price. Confirm exact post date, area, title details, and availability before approval.'),
  ('yt-zuya-seguku-prayer-mountain-plot-270m', 'YouTube', 'ZUYA GROUP', 'https://www.youtube.com/@ZUYAGROUP', 'https://www.youtube.com/watch?v=qCW66LkAJVM', 'Prime Plot in Seguku near Prayer Mountain', 'land', 'Residential Plot', 'Wakiso', 'Seguku', 'Seguku near Prayer Mountain, Wakiso', 270000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.247::numeric, 32.555::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a prime Seguku plot near Prayer Mountain with a USh 270M guide price. Confirm exact post date, plot size, boundaries, title details, and availability before approval.'),
  ('yt-zuya-kampala-7bed-1-8b', 'YouTube', 'ZUYA GROUP', 'https://www.youtube.com/@ZUYAGROUP', 'https://www.youtube.com/watch?v=xw4diiCKelE', '7-Bed House for Sale in Kampala', 'sale', 'Standalone House', 'Kampala', 'Kampala', 'Kampala, Uganda', 1800000000::bigint, 'once', 7, NULL::integer, NULL::numeric, NULL::text, 0.318::numeric, 32.582::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a 7-bed Kampala house with a USh 1.8B guide price. Confirm exact post date, neighbourhood, title details, and availability before approval.'),
  ('yt-zuya-kira-4bed-520m', 'YouTube', 'ZUYA GROUP', 'https://www.youtube.com/@ZUYAGROUP', 'https://www.youtube.com/watch?v=eKMTCu52AGg', 'New 4-Bed House for Sale in Kira', 'sale', 'Standalone House', 'Wakiso', 'Kira', 'Kira, Wakiso', 520000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.3978::numeric, 32.6414::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a new 4-bed house in Kira with a USh 520M guide price. Confirm exact post date, road, title details, and availability before approval.'),
  ('yt-zuya-entebbe-road-4bed-490m', 'YouTube', 'ZUYA GROUP', 'https://www.youtube.com/@ZUYAGROUP', 'https://www.youtube.com/watch?v=FxqB8zK58vc', '4-Bed House on Entebbe Road', 'sale', 'Standalone House', 'Wakiso', 'Entebbe Road', 'Entebbe Road, Wakiso', 490000000::bigint, 'once', 4, NULL::integer, NULL::numeric, NULL::text, 0.216::numeric, 32.552::numeric, '2026-05-20'::date, 'first_seen_2026_pending_platform_publish_date', 'Public YouTube source record for a 4-bed house on Entebbe Road with a USh 490M guide price. Confirm exact post date, section, title details, and availability before approval.'),
  ('upc-10917-kyanja-3bed-190m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/kampala/10917-3-bedroom-single-family-house-in-kyanja-town', '3 Bedroom Single-family House in Kyanja Town', 'sale', 'Terraced Bungalow', 'Kampala', 'Kyanja Town', 'Kyanja Town, Kampala', 190000000::bigint, 'once', 3, 3, NULL::numeric, NULL::text, NULL::numeric, NULL::numeric, '2026-01-10'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10917. Added on 10 Jan 2026 with a USh 190M sale price. Confirm availability, agent authority, and image rights before approval.'),
  ('upc-11006-kyanja-6bed-1-2b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/11006-luxurious-6-bedroom-house-in-kyanja-town', 'Luxurious 6 Bedroom House in Kyanja Town', 'sale', 'Terraced Duplex', 'Kampala', 'Kyanja', 'Kyanja, Kampala', 1200000000::bigint, 'once', 6, 7, 809::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-02-25'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11006. Added on 25 Feb 2026 with a USh 1.2B sale price. Confirm availability, source contact, and media rights before approval.'),
  ('upc-11004-kulambiro-4bed-395k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/kampala/11004-4-bedroom-house-on-kulambiro-hill-top', '4 Bedroom House on Kulambiro Hill Top', 'sale', 'Terraced Bungalow', 'Kampala', 'Kulambiro', 'Kulambiro, Kampala', 1553842863::bigint, 'once', 4, 4, 1618::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-02-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11004. Added on 24 Feb 2026 with an approximate USh 1.553B sale price. Confirm availability and source media rights before approval.'),
  ('upc-10944-ntinda-kiwatule-6bed-499k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/10944-luxury-new-6-bedroom-house-in-ntinda-kiwatule', 'Luxury New 6 Bedroom House in Ntinda Kiwatule', 'sale', 'Terraced Duplex', 'Kampala', 'Ntinda-Kiwatule', 'Ntinda-Kiwatule Road, Kampala', 1966010265::bigint, 'once', 6, 6, 809::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10944. Added on 24 Jan 2026 with an approximate USh 1.966B sale price. Confirm availability and media rights before approval.'),
  ('upc-10982-muyenga-5bed-350k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/10982-luxury-5-bedroom-house-in-muyenga', 'Luxury 5 Bedroom House in Muyenga Bukasa', 'sale', 'Terraced Duplex', 'Kampala', 'Muyenga Bukasa', 'Muyenga Bukasa, Kampala', 1378965116::bigint, 'once', 5, 5, 809::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-02-13'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10982. Added on 13 Feb 2026 with an approximate USh 1.379B sale price. Confirm availability and media rights before approval.'),
  ('upc-10921-nakasero-2bed-270k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/flats-apartments/central-region/kampala/10921-luxury-2-bedrooms-with-excellent-facilities', 'Luxury 2 Bedroom Apartment in Nakasero', 'sale', 'Apartment', 'Kampala', 'Nakasero', 'Mackinnon Road, Nakasero, Kampala', 1065225718::bigint, 'once', 2, 1, 120::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-01-13'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10921. Added on 13 Jan 2026 with an approximate USh 1.065B sale price. Confirm availability and media rights before approval.'),
  ('upc-10946-muyenga-townhouse-330k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/townhouses/central-region/kampala/10946-luxury-4-bedroom-townhouse-in-muyenga', 'Luxury 4 Bedroom Townhouse in Muyenga', 'sale', 'Townhouse', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 1298147202::bigint, 'once', 4, 4, 485::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10946. Added on 24 Jan 2026 with an approximate USh 1.298B sale price. Confirm availability and media rights before approval.'),
  ('upc-10948-muyenga-5bed-599k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/10948-luxury-5-bedroom-house-in-muyenga', 'Luxury 5 Bedroom House in Muyenga', 'sale', 'Terraced Duplex', 'Kampala', 'Muyenga', 'Muyenga, Kampala', 2360000299::bigint, 'once', 5, 5, 1011::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10948. Added on 24 Jan 2026 with an approximate USh 2.36B sale price. Confirm availability and media rights before approval.'),
  ('upc-11057-lubowa-2bed-100k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/flats-apartments/central-region/kampala/11057-spring-hill-condominium-apartments-lubowa', 'Spring Hill Condominium Apartments Lubowa', 'sale', 'Apartment', 'Kampala', 'Lubowa', 'Lubowa Along Entebbe Road, Kampala', 388633094::bigint, 'once', 2, 2, 100::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-03-19'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11057. Added on 19 Mar 2026 with an approximate USh 388.6M sale price. Confirm availability and media rights before approval.'),
  ('upc-11056-ntinda-5bed-1-5b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/kampala/11056-luxury-5-bedroom-house-in-ntinda', 'Luxury 5 Bedroom House in Ntinda', 'sale', 'Terraced Duplex', 'Kampala', 'Ntinda', 'Ministers Village Ntinda, Kampala', 1500000000::bigint, 'once', 5, 5, 606::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-03-17'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11056. Added on 17 Mar 2026 with a USh 1.5B sale price. Confirm availability and media rights before approval.'),
  ('upc-11023-najjera-buwate-plot-370m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/land/mixed-use-land/central-region/kampala/11023-najjera-buwate-plot-26-decimal-at-370m', 'Najjera Buwate 26-Decimal Plot at USh 370M', 'land', 'Mixed-use Land', 'Kampala', 'Najjera Buwate', 'Najjera Buwate, Kampala', 370000000::bigint, 'once', NULL::integer, NULL::integer, 26::numeric, 'decimals', NULL::numeric, NULL::numeric, '2026-03-03'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11023. Added on 03 Mar 2026 for a 26-decimal mixed-use plot at USh 370M. Confirm title, boundaries, availability, and media rights before approval.'),
  ('jiji-50by100-wakiso-kikandwa-17m', 'Website', 'Jiji Uganda', 'https://jiji.ug', 'https://jiji.ug/wakiso-wakiso/land-and-plots-for-sale/50by100-17m-ready-title-in-wakiso-kikandwa-CwDCVo413F5OMks8CAELFU6W.html', '50by100 Ready-title Land in Wakiso-Kikandwa', 'land', 'Residential Land', 'Wakiso', 'Wakiso-Kikandwa', 'Wakiso-Kikandwa, Wakiso', 17000000::bigint, 'once', NULL::integer, NULL::integer, 464::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-02-26'::date, 'confirmed_2026_source_post_date', 'Jiji Uganda listing seen with a 26 Feb source date, 464 sqm residential land, and a USh 17M asking price. Confirm availability, title, boundaries, and media rights before approval.'),
  ('upc-10989-bwebajja-6bed-1-1b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/10989-brand-new-6-bedroom-house-in-bwebajja', 'Brand New 6 Bedroom House in Bwebajja', 'sale', 'Terraced Duplex', 'Wakiso', 'Bwebajja', 'Bwebajja, Entebbe Road, Wakiso', 1100000000::bigint, 'once', 6, 5, 809::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-02-16'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10989. Added on 16 Feb 2026 with a USh 1.1B sale price. Confirm availability and media rights before approval.'),
  ('upc-11044-arkright-4bed-950m', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-bungalows/central-region/wakiso/11044-4-bedroom-house-in-arkright-city-bwebajja', '4 Bedroom House in Arkright City Bwebajja', 'sale', 'Terraced Bungalow', 'Wakiso', 'Arkright City Bwebajja', 'Arkright City, Bwebajja, Wakiso', 950000000::bigint, 'once', 4, 4, 809::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-03-10'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11044. Added on 10 Mar 2026 with a USh 950M sale price. Confirm availability and media rights before approval.'),
  ('upc-11010-arkright-6bed-550k', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/11010-luxury-6-bedroom-house-in-arkright-bwebajja', 'Luxury 6 Bedroom House in Arkright Bwebajja', 'sale', 'Terraced Duplex', 'Wakiso', 'Arkright Bwebajja', 'Bwebajja, Arkright Estate, Entebbe Road, Wakiso', 2166945182::bigint, 'once', 6, 7, 1416::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-03-02'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 11010. Added on 02 Mar 2026 with an approximate USh 2.167B sale price. Confirm availability and media rights before approval.'),
  ('upc-10978-namulanda-5bed-1b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/terraced-duplexes/central-region/wakiso/10978-luxury-lakeview-5-bedroom-house-in-namulanda-off-entebbe-road', 'Luxury Lakeview 5 Bedroom House in Namulanda', 'sale', 'Terraced Duplex', 'Wakiso', 'Namulanda', 'Namulanda, Buzzi, Entebbe Road, Wakiso', 1000000000::bigint, 'once', 5, 5, 607::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-02-10'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10978. Added on 10 Feb 2026 with a USh 1B sale price. Confirm availability and media rights before approval.'),
  ('upc-10941-ntinda-8unit-1-2b', 'Website', 'Uganda Property Centre', 'https://ugandapropertycentre.com', 'https://ugandapropertycentre.com/for-sale/houses/block-of-flats/central-region/kampala/10941-fully-occupied-8-unit-apartment-block-in-ntinda', 'Fully Occupied 8-Unit Apartment Block in Ntinda', 'commercial', 'Block of Flats', 'Kampala', 'Ntinda', 'Ntinda, Kampala', 1200000000::bigint, 'once', 8, 8, 485::numeric, 'sqm', NULL::numeric, NULL::numeric, '2026-01-24'::date, 'confirmed_2026_source_added_on', 'Uganda Property Centre listing ref 10941. Added on 24 Jan 2026 with a USh 1.2B sale price and reported rental income. Confirm availability, income, and media rights before approval.')
),
inserted AS (
  INSERT INTO properties (
    listing_type, title, description, district, area, address, price, price_period,
    bedrooms, bathrooms, property_type, land_size_value, land_size_unit,
    latitude, longitude, students_welcome, verification_terms_accepted,
    inquiry_reference, new_until, amenities, extra_fields, lister_name, lister_type,
    source, listed_via, status, moderation_stage, moderation_notes, moderation_reason
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
    c.latitude,
    c.longitude,
    c.listing_type = 'students',
    FALSE,
    'MK-20260524-' || UPPER(SUBSTRING(md5(c.source_key), 1, 6)),
    NOW() + INTERVAL '30 days',
    jsonb_build_array(
      'Found online',
      c.source_platform || ' source evidence',
      'Contact via source',
      'King review required'
    ),
    jsonb_build_object(
      'found_online_candidate', true,
      'found_online', true,
      'social_search_candidate', true,
      'source_badge', 'found_online',
      'source_discovery_label', 'Found online',
      'source_batch', 'found_online_2026_platform_sweep_20260524',
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
      'source_post_window_start', '2026-01-01T00:00:00.000Z',
      'source_seen_at', c.first_seen_at::text,
      'source_published_at', c.first_seen_at::text,
      'first_posted_online_at', c.first_seen_at::text,
      'first_posted_online_label', CASE
        WHEN c.source_date_status LIKE 'confirmed_%'
          THEN 'First posted online on ' || to_char(c.first_seen_at, 'DD Mon YYYY')
        ELSE 'First seen in the 2026 found-online sweep on ' || to_char(c.first_seen_at, 'DD Mon YYYY') || '; platform post date needs confirmation'
      END,
      'source_post_date_status', c.source_date_status,
      'permission_status', 'public_source_evidence_pending_agent_authorisation',
      'consent_confirmed', false,
      'image_rights_confirmed', false,
      'image_rights_status', 'public_source_evidence_pending_authorisation',
      'minimum_reliable_image_count', 1,
      'generated_source_evidence_card', true,
      'source_labels', jsonb_build_array('found online', lower(c.source_platform), '2026 found-online sweep', 'Contact via source'),
      'source_urls', jsonb_build_array(c.source_url, c.source_contact_url),
      'property_url_status', 'public_after_king_approval'
    ),
    c.source_name,
    'agent',
    'found_online_property_source_v1',
    'found_online',
    'pending',
    'submitted',
    'FOUND-ONLINE 2026 PLATFORM SWEEP. Public source inventory from ' || c.source_name || '. Source post: ' || c.source_url || '. Confirm availability, exact pin, contact authority, price, and media rights before approval.',
    'Pending King review of public found-online source evidence, source contact, exact pin, latest availability, and image/photo rights.'
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM properties p
    WHERE COALESCE(p.status, '') <> 'deleted'
      AND (
        p.extra_fields->>'source_listing_key' = c.source_key
        OR p.extra_fields->>'source_post_url' = c.source_url
        OR p.extra_fields->>'source_url' = c.source_url
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
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="%230f172a"/><rect x="70" y="70" width="1060" height="660" fill="%23ffffff" opacity="0.08"/><text x="90" y="340" fill="%23ffffff" font-family="Arial" font-size="60" font-weight="700">Found online</text><text x="90" y="410" fill="%23bfdbfe" font-family="Arial" font-size="34">Source evidence card</text><text x="90" y="470" fill="%23cbd5e1" font-family="Arial" font-size="28">Verify media rights before approval</text></svg>',
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
  'found_online_platform_sweep_20260524',
  'found_online_2026_platform_sweep_created',
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
