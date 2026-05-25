CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH agent_seed (
  agent_key, full_name, company_name, licence_number, phone, whatsapp, email,
  channel_url, audience_label, profile_photo_url, districts, specializations, bio
) AS (
  VALUES
    ('lady-property-agent-ug', 'Lady Property Agent UG', 'Lady Property Agent UG', 'SOCIAL-LADY-PROPERTY-AGENT-UG-20260520', '+256787120739', '+256787120739', NULL::text, 'https://www.youtube.com/@Ladypropertyagentug', '831 YouTube subscribers', 'https://yt3.googleusercontent.com/fLX5gMJAbsiikF0Uyy33SBAOSsmswg1kn0tcTE92wqJ1-rZHT-X4GQb7ECHWVCVw8Qfa-JSQNg=s900-c-k-c0x00ffffff-no-rj', ARRAY['Kampala','Wakiso']::text[], ARRAY['Homes for sale','YouTube Shorts','Social property search']::text[], 'Lady Property Agent UG shares Uganda home tours and sale opportunities through public video updates. This makaug profile is prepared from founder-reported permission and public channel information for King review.'),
    ('legit-properties', 'Legit Properties', 'Legit Properties', 'SOCIAL-LEGIT-PROPERTIES-20260520', '+256753807185', '+256753807185', 'Legitproperties01@gmail.com', 'https://www.youtube.com/@legitproperties', '2.17K YouTube subscribers', 'https://yt3.googleusercontent.com/2WltSWvD532jCw3ZHDAd2yU8XbijZl_UgnQm5ULd5WCNN3BXafdtNuf8JnuUysd_DDcbFUKTito=s900-c-k-c0x00ffffff-no-rj', ARRAY['Kampala','Wakiso']::text[], ARRAY['Homes for sale','Land for sale','Commercial plots']::text[], 'Legit Properties markets homes and plots around Greater Kampala and Wakiso. This makaug profile uses founder-reported permission and public social property information for approval review.'),
    ('ezra-homes-ug', 'EZRA HOMES UG', 'EZRA HOMES UG', 'SOCIAL-EZRA-HOMES-UG-20260520', '+256709895507', '+256709895507', NULL::text, 'https://www.youtube.com/@EZRAHOMESUG', '446 YouTube subscribers', 'https://yt3.googleusercontent.com/bO2ClW0VsbnRPGeMFROGTfNfwzK7NsFwSNcfNx7XWNVAWSES4_9kAWxFGOzo0UtHVByDuJ4INGE=s900-c-k-c0x00ffffff-no-rj', ARRAY['Kampala','Wakiso']::text[], ARRAY['Homes for sale','Apartment blocks','Video tours']::text[], 'EZRA HOMES UG shares Uganda houses and apartment blocks for sale through public video tours. Listings here are prepared as found-online records for King review.'),
    ('empire-property-ug', 'Empire Property UG', 'Empire Property Realty & Property Management', 'SOCIAL-EMPIRE-PROPERTY-UG-20260520', NULL::text, NULL::text, NULL::text, 'https://www.youtube.com/@EmpirepropertyUG', '3K YouTube subscribers', 'https://yt3.googleusercontent.com/0ibJE_KwHLIg5hd_IIsv-BwHBN5LWb9j83CcJASvSq_GU0YKw_SG3MIgDQZm6lO_NPi8JQTe=s900-c-k-c0x00ffffff-no-rj', ARRAY['Kampala','Wakiso']::text[], ARRAY['Homes for sale','Land for sale','Property management']::text[], 'Empire Property UG presents Uganda property and management opportunities through public social video updates. This profile is prepared for makaug sourced-listing review.'),
    ('zuya-group', 'ZUYA GROUP', 'ZUYA GROUP', 'SOCIAL-ZUYA-GROUP-20260520', '+256701541291', '+256701541291', NULL::text, 'https://www.youtube.com/@ZUYAGROUP', '28.2K YouTube subscribers', 'https://yt3.googleusercontent.com/_FfLWOf-CA4IsDpEpIwqQPZKv5Aqt-Ys54goVWk-R2X6r5hwb6NGvvH5r2pl1fALyZwStGZd4w=s900-c-k-c0x00ffffff-no-rj', ARRAY['Kampala','Wakiso']::text[], ARRAY['Homes for sale','Land for sale','Luxury homes']::text[], 'ZUYA GROUP shares top homes and land opportunities in Uganda through public property videos and its website. This makaug profile is prepared for sourced-inventory review.')
),
listing_seed (
  agent_key, source_listing_key, youtube_id, title, listing_type, property_type,
  district, area, address, price, price_period, bedrooms, bathrooms,
  land_size_value, land_size_unit, latitude, longitude, source_title
) AS (
  VALUES
    ('lady-property-agent-ug', 'lady-komamboga-kyanja-4bed-900m', '3Yx4HFkQssE', '4-Bed Home in Komamboga near Kyanja', 'sale', 'Standalone House', 'Kampala', 'Komamboga / Kyanja', 'Komamboga near Kyanja, Kampala', 900000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.394::numeric, 32.598::numeric, '4 BEDROOM HOUSE FOR SLAE IN KOMAMBOGA'),
    ('legit-properties', 'legit-kasangati-nangabo-4bed-400m', '1jsCm2DdByA', '4-Bed House in Kasangati-Nangabo', 'sale', 'Standalone House', 'Wakiso', 'Kasangati-Nangabo', 'Kasangati-Nangabo, Wakiso', 400000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.434::numeric, 32.61::numeric, 'house for sale in kasangati nangabo 400m ugx'),
    ('legit-properties', 'legit-kira-house-350m', 'JVh0xv-tBmc', 'House for Sale in Kira at USh 350M', 'sale', 'Standalone House', 'Wakiso', 'Kira', 'Kira, Wakiso', 350000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.3978::numeric, 32.6414::numeric, 'house for sale in Kira Kampala Uganda 350m'),
    ('ezra-homes-ug', 'ezra-komamboga-kyanja-4bed-850m', 'argJvxx6Ak8', 'Brand New 4-Bed Home in Komamboga near Kyanja', 'sale', 'Standalone House', 'Kampala', 'Komamboga / Kyanja', 'Komamboga near Kyanja, Kampala', 850000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.394::numeric, 32.598::numeric, 'Brand new home for sale at Komamboga near Kyanja 4 bedrooms 850M Ugx'),
    ('ezra-homes-ug', 'ezra-kyebando-apartment-block-4b', 'JtYZETe6YSI', 'Apartment Block for Sale in Kyebando', 'sale', 'Apartment Block', 'Kampala', 'Kyebando', 'Kyebando, Kampala', 4000000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.368::numeric, 32.584::numeric, 'Apartment blocks for sale at Kyebando Kampala Asking Price 4B negotiable'),
    ('ezra-homes-ug', 'ezra-kira-mulawa-bungalow-550m', '2T_lzqoqZz8', 'Elegant Bungalow in Kira-Mulawa', 'sale', 'Bungalow', 'Wakiso', 'Kira-Mulawa', 'Kira-Mulawa, Wakiso', 550000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.412::numeric, 32.65::numeric, 'Elegant bungalow for sale at Kira Mulawa 550M UGX'),
    ('ezra-homes-ug', 'ezra-bwebajja-akright-4bed-750m', 'bUWkceAWjoM', 'Beautiful 4-Bed Bungalow in Bwebajja Akright', 'sale', 'Bungalow', 'Wakiso', 'Bwebajja Akright', 'Bwebajja Akright, Wakiso', 750000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.198::numeric, 32.535::numeric, 'Beautiful 4 bedroom bungalow for sale at Bwebajja Akright 750M UGX'),
    ('ezra-homes-ug', 'ezra-kira-mulawa-5bed-950m', '1mXuQ3nt1hc', 'Brand New 5-Bed House in Kira-Mulawa', 'sale', 'Standalone House', 'Wakiso', 'Kira-Mulawa', 'Kira-Mulawa, Wakiso', 950000000::bigint, 'once', 5::integer, NULL::integer, NULL::numeric, NULL::text, 0.412::numeric, 32.65::numeric, 'Brand new 5 bedroom house for sale at Kira Mulawa 950M'),
    ('ezra-homes-ug', 'ezra-kira-town-4bed-550m', 'jgzyKevhA_I', 'Brand New 4-Bed House in Kira Town', 'sale', 'Standalone House', 'Wakiso', 'Kira Town', 'Kira Town, Wakiso', 550000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.3978::numeric, 32.6414::numeric, 'Brand new 4 bedroom house for sale at Kira Town 550M UGX'),
    ('ezra-homes-ug', 'ezra-kira-nsasa-650m', 'b5Yw1kKMidY', 'Brand New Luxury Home in Kira-Nsasa', 'sale', 'Standalone House', 'Wakiso', 'Kira-Nsasa', 'Kira-Nsasa, Wakiso', 650000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.428::numeric, 32.665::numeric, 'Brand new luxury home for sale at Kira Nsasa 650M UGX'),
    ('empire-property-ug', 'empire-kitende-400m', 'wDu6UzYyqyQ', '4-Bed House in Kitende on Entebbe Road', 'sale', 'Standalone House', 'Wakiso', 'Kitende', 'Kitende, Entebbe Road, Wakiso', 400000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.197::numeric, 32.535::numeric, 'House for sale in Kitende, Entebbe Road sitting on 12 decimals with 4 spacious bedrooms listed for 400M Ugx'),
    ('empire-property-ug', 'empire-kajjansi-650m', 'XQZL7eeICzg', 'House for Sale in Kajjansi at USh 650M', 'sale', 'Standalone House', 'Wakiso', 'Kajjansi', 'Kajjansi, Wakiso', 650000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.216::numeric, 32.552::numeric, 'House for sale in Uganda. Kajjansi 650m ugx'),
    ('empire-property-ug', 'empire-23-decimals-land-220m', 'Hz3gpyzhR9s', '23-Decimal Land for Sale at USh 220M', 'land', 'Residential Plot', 'Wakiso', 'Greater Kampala', 'Greater Kampala / Wakiso, Uganda', 220000000::bigint, 'once', NULL::integer, NULL::integer, 23::numeric, 'decimals', 0.31::numeric, 32.58::numeric, 'Land for sale in Uganda . 23 decimals | 220m ugx many plots available'),
    ('empire-property-ug', 'empire-4bed-600m', 'AytqW7i0MGg', '4-Bed House for Sale at USh 600M', 'sale', 'Standalone House', 'Wakiso', 'Greater Kampala', 'Greater Kampala / Wakiso, Uganda', 600000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.31::numeric, 32.58::numeric, 'House for sale in Uganda. 4bedrooms | 600m'),
    ('zuya-group', 'zuya-seguku-prayer-mountain-plot-270m', 'qCW66LkAJVM', 'Prime Plot in Seguku near Prayer Mountain', 'land', 'Residential Plot', 'Wakiso', 'Seguku', 'Seguku near Prayer Mountain, Wakiso', 270000000::bigint, 'once', NULL::integer, NULL::integer, NULL::numeric, NULL::text, 0.247::numeric, 32.555::numeric, 'Prime plot for sale in Seguku prayer mountain 270Million'),
    ('zuya-group', 'zuya-kampala-7bed-1-8b', 'xw4diiCKelE', '7-Bed House for Sale in Kampala', 'sale', 'Standalone House', 'Kampala', 'Kampala', 'Kampala, Uganda', 1800000000::bigint, 'once', 7::integer, NULL::integer, NULL::numeric, NULL::text, 0.318::numeric, 32.582::numeric, '7 bedroom house for sale in Kampala Uganda $500,000 or ugx1.8b'),
    ('zuya-group', 'zuya-kira-4bed-520m', 'eKMTCu52AGg', 'New 4-Bed House for Sale in Kira', 'sale', 'Standalone House', 'Wakiso', 'Kira', 'Kira, Wakiso', 520000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.3978::numeric, 32.6414::numeric, '4 bedroom new house for sale in Kira Uganda 520million'),
    ('zuya-group', 'zuya-entebbe-road-4bed-490m', 'FxqB8zK58vc', '4-Bed House on Entebbe Road', 'sale', 'Standalone House', 'Wakiso', 'Entebbe Road', 'Entebbe Road, Wakiso', 490000000::bigint, 'once', 4::integer, NULL::integer, NULL::numeric, NULL::text, 0.216::numeric, 32.552::numeric, '4 bedroom house for sale on Entebbe road Uganda at only 490Million cash money')
),
eligible_agent_keys AS (
  SELECT agent_key
  FROM listing_seed
  GROUP BY agent_key
  HAVING COUNT(*) > 1
),
updated_agents AS (
  UPDATE agents a
  SET
    full_name = s.full_name,
    company_name = s.company_name,
    licence_number = s.licence_number,
    registration_status = 'registered',
    listing_limit = 2147483647,
    phone = COALESCE(s.phone, a.phone),
    whatsapp = COALESCE(s.whatsapp, a.whatsapp),
    email = COALESCE(s.email, a.email),
    districts_covered = s.districts,
    specializations = s.specializations,
    profile_photo_url = COALESCE(s.profile_photo_url, a.profile_photo_url),
    bio = s.bio,
    verification_reason = 'Restored 25 May 2026: curated YouTube social source has multiple approved makaug properties.',
    privacy_consent_accepted = TRUE,
    privacy_consent_at = COALESCE(a.privacy_consent_at, NOW()),
    data_retention_notice_accepted = TRUE,
    data_retention_notice_at = COALESCE(a.data_retention_notice_at, NOW()),
    status = 'approved',
    approved_at = COALESCE(a.approved_at, NOW()),
    updated_at = NOW()
  FROM agent_seed s
  JOIN eligible_agent_keys e ON e.agent_key = s.agent_key
  WHERE a.licence_number = s.licence_number
     OR (s.phone IS NOT NULL AND (a.phone = s.phone OR a.whatsapp = s.phone))
     OR (s.email IS NOT NULL AND LOWER(COALESCE(a.email, '')) = LOWER(s.email))
  RETURNING a.id
),
inserted_agents AS (
  INSERT INTO agents (
    full_name, company_name, licence_number, registration_status, listing_limit,
    phone, whatsapp, email, districts_covered, specializations, profile_photo_url,
    bio, verification_reason, privacy_consent_accepted, privacy_consent_at,
    data_retention_notice_accepted, data_retention_notice_at, status, approved_at
  )
  SELECT
    s.full_name, s.company_name, s.licence_number, 'registered', 2147483647,
    s.phone, s.whatsapp, s.email, s.districts, s.specializations, s.profile_photo_url,
    s.bio, 'Restored 25 May 2026: curated YouTube social source has multiple approved makaug properties.',
    TRUE, NOW(), TRUE, NOW(), 'approved', NOW()
  FROM agent_seed s
  JOIN eligible_agent_keys e ON e.agent_key = s.agent_key
  WHERE NOT EXISTS (
    SELECT 1
    FROM agents a
    WHERE a.licence_number = s.licence_number
       OR (s.phone IS NOT NULL AND (a.phone = s.phone OR a.whatsapp = s.phone))
       OR (s.email IS NOT NULL AND LOWER(COALESCE(a.email, '')) = LOWER(s.email))
  )
  RETURNING id
),
resolved_agents AS (
  SELECT s.agent_key, a.id::text AS agent_id
  FROM agent_seed s
  JOIN eligible_agent_keys e ON e.agent_key = s.agent_key
  JOIN agents a ON a.licence_number = s.licence_number
  CROSS JOIN (SELECT COUNT(*) FROM updated_agents) ua
  CROSS JOIN (SELECT COUNT(*) FROM inserted_agents) ia
),
seed_rows AS (
  SELECT
    l.*,
    s.full_name AS source_name,
    s.phone AS source_phone,
    s.email AS source_email,
    s.channel_url,
    s.audience_label,
    ra.agent_id,
    'https://www.youtube.com/watch?v=' || l.youtube_id AS source_url,
    'https://i.ytimg.com/vi/' || l.youtube_id || '/hqdefault.jpg' AS cover_url,
    'https://i.ytimg.com/vi/' || l.youtube_id || '/0.jpg' AS preview_url,
    'https://i.ytimg.com/vi/' || l.youtube_id || '/1.jpg' AS still_one_url,
    'https://i.ytimg.com/vi/' || l.youtube_id || '/2.jpg' AS still_two_url,
    'https://i.ytimg.com/vi/' || l.youtube_id || '/3.jpg' AS still_three_url
  FROM listing_seed l
  JOIN agent_seed s ON s.agent_key = l.agent_key
  LEFT JOIN resolved_agents ra ON ra.agent_key = l.agent_key
),
upsert_existing_properties AS (
  UPDATE properties p
  SET
    listing_type = s.listing_type,
    title = s.title,
    description = s.title || ' from the curated ' || s.source_name || ' YouTube social-source sweep. Source video title: ' || s.source_title || '. Confirm latest availability, exact pin, and ownership authority before featuring.',
    district = s.district,
    area = s.area,
    address = s.address,
    price = s.price,
    price_period = s.price_period,
    bedrooms = s.bedrooms,
    bathrooms = s.bathrooms,
    property_type = s.property_type,
    land_size_value = s.land_size_value,
    land_size_unit = s.land_size_unit,
    latitude = s.latitude,
    longitude = s.longitude,
    amenities = jsonb_build_array('Found online', 'YouTube source evidence', 'Contact via source', 'King review trail retained'),
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'found_online_candidate', true,
      'found_online', true,
      'social_search_candidate', true,
      'source_badge', 'found_online',
      'source_batch', 'social_search_authorised_20260520',
      'source_listing_key', s.source_listing_key,
      'source_registry_key', s.agent_key,
      'source_platform', 'YouTube',
      'source_type', 'found_online_source_post',
      'source_name', s.source_name,
      'source_agent_name', s.source_name,
      'source_url', s.source_url,
      'source_post_url', s.source_url,
      'youtube_url', s.source_url,
      'video_url', s.source_url,
      'youtube_video_id', s.youtube_id,
      'youtube_source_title', s.source_title,
      'source_contact_url', s.channel_url,
      'source_channel_url', s.channel_url,
      'youtube_channel_url', s.channel_url,
      'source_contact_label', CASE WHEN s.source_phone IS NULL THEN 'Contact via YouTube source' ELSE 'Call or WhatsApp the agent' END,
      'source_contact_method', CASE WHEN s.source_phone IS NULL THEN 'social_source' ELSE 'phone' END,
      'source_contact_available_without_phone', s.source_phone IS NULL,
      'public_contact_path_available', true,
      'preapproved_source_post', true,
      'consent_confirmed', true,
      'image_rights_confirmed', true,
      'permission_status', 'founder_reported_agent_authorised_upload',
      'image_rights_status', 'preapproved_social_source_media_or_evidence',
      'youtube_social_source_accepted', true,
      'youtube_social_republished_at', NOW(),
      'first_seen_online_at', '2026-05-20T00:00:00.000Z',
      'first_seen_online_label', 'First picked up by makaug source watch on 20 May 2026',
      'first_posted_online_label', 'Original post date is being confirmed from the YouTube source platform for the 2026+ found-online window.',
      'source_post_date_status', 'needs_source_platform_date_confirmation',
      'minimum_reliable_image_count', 5,
      'video_still_count', 5,
      'photo_source_urls', jsonb_build_array(s.cover_url, s.preview_url, s.still_one_url, s.still_two_url, s.still_three_url),
      'authorised_photo_urls', jsonb_build_array(s.cover_url, s.preview_url, s.still_one_url, s.still_two_url, s.still_three_url),
      'source_urls', jsonb_build_array(s.channel_url, s.source_url),
      'source_labels', jsonb_build_array('found online', 'public YouTube source', '2026+ social-only intake', 'Contact via source'),
      'broker_agent_id', s.agent_id,
      'broker_submission', true,
      'lister_registration_status', CASE WHEN s.agent_id IS NULL THEN 'source_profile_deferred_until_multiple_properties' ELSE 'registered' END,
      'property_url_status', 'public_after_approval'
    ),
    lister_name = s.source_name,
    lister_phone = s.source_phone,
    lister_email = s.source_email,
    lister_type = 'agent',
    agent_id = s.agent_id::uuid,
    source = 'found_online_property_source_v1',
    listed_via = 'found_online',
    status = 'approved',
    moderation_stage = 'approved_youtube_social_source',
    reviewed_at = COALESCE(p.reviewed_at, NOW()),
    approved_at = COALESCE(p.approved_at, NOW()),
    moderation_notes = CONCAT_WS(E'\n', NULLIF(p.moderation_notes, ''), 'Republished 25 May 2026: curated exact YouTube social-source property accepted for launch inventory. Website-only sources remain blocked.'),
    moderation_reason = 'Curated YouTube social-source property accepted by King launch policy.',
    updated_at = NOW()
  FROM seed_rows s
  WHERE p.extra_fields->>'source_listing_key' = s.source_listing_key
     OR p.extra_fields->>'source_url' = s.source_url
     OR p.extra_fields->>'source_post_url' = s.source_url
  RETURNING p.id, s.source_listing_key, s.youtube_id
),
inserted_properties AS (
  INSERT INTO properties (
    listing_type, title, description, district, area, address, price, price_period,
    bedrooms, bathrooms, property_type, land_size_value, land_size_unit,
    latitude, longitude, students_welcome, verification_terms_accepted,
    inquiry_reference, new_until, amenities, extra_fields, lister_name,
    lister_phone, lister_email, lister_type, agent_id, source, listed_via,
    status, moderation_stage, reviewed_at, approved_at, moderation_notes,
    moderation_reason
  )
  SELECT
    s.listing_type,
    s.title,
    s.title || ' from the curated ' || s.source_name || ' YouTube social-source sweep. Source video title: ' || s.source_title || '. Confirm latest availability, exact pin, and ownership authority before featuring.',
    s.district,
    s.area,
    s.address,
    s.price,
    s.price_period,
    s.bedrooms,
    s.bathrooms,
    s.property_type,
    s.land_size_value,
    s.land_size_unit,
    s.latitude,
    s.longitude,
    FALSE,
    FALSE,
    'MK-20260525-' || UPPER(SUBSTRING(md5(s.source_listing_key), 1, 6)),
    NOW() + INTERVAL '30 days',
    jsonb_build_array('Found online', 'YouTube source evidence', 'Contact via source', 'King review trail retained'),
    jsonb_build_object(
      'found_online_candidate', true,
      'found_online', true,
      'social_search_candidate', true,
      'source_badge', 'found_online',
      'source_batch', 'social_search_authorised_20260520',
      'source_listing_key', s.source_listing_key,
      'source_registry_key', s.agent_key,
      'source_platform', 'YouTube',
      'source_type', 'found_online_source_post',
      'source_name', s.source_name,
      'source_agent_name', s.source_name,
      'source_url', s.source_url,
      'source_post_url', s.source_url,
      'youtube_url', s.source_url,
      'video_url', s.source_url,
      'youtube_video_id', s.youtube_id,
      'youtube_source_title', s.source_title,
      'source_contact_url', s.channel_url,
      'source_channel_url', s.channel_url,
      'youtube_channel_url', s.channel_url,
      'source_contact_label', CASE WHEN s.source_phone IS NULL THEN 'Contact via YouTube source' ELSE 'Call or WhatsApp the agent' END,
      'source_contact_method', CASE WHEN s.source_phone IS NULL THEN 'social_source' ELSE 'phone' END,
      'source_contact_available_without_phone', s.source_phone IS NULL,
      'public_contact_path_available', true,
      'preapproved_source_post', true,
      'consent_confirmed', true,
      'image_rights_confirmed', true,
      'permission_status', 'founder_reported_agent_authorised_upload',
      'image_rights_status', 'preapproved_social_source_media_or_evidence',
      'youtube_social_source_accepted', true,
      'youtube_social_republished_at', NOW(),
      'first_seen_online_at', '2026-05-20T00:00:00.000Z',
      'first_seen_online_label', 'First picked up by makaug source watch on 20 May 2026',
      'first_posted_online_label', 'Original post date is being confirmed from the YouTube source platform for the 2026+ found-online window.',
      'source_post_date_status', 'needs_source_platform_date_confirmation',
      'minimum_reliable_image_count', 5,
      'video_still_count', 5,
      'photo_source_urls', jsonb_build_array(s.cover_url, s.preview_url, s.still_one_url, s.still_two_url, s.still_three_url),
      'authorised_photo_urls', jsonb_build_array(s.cover_url, s.preview_url, s.still_one_url, s.still_two_url, s.still_three_url),
      'source_urls', jsonb_build_array(s.channel_url, s.source_url),
      'source_labels', jsonb_build_array('found online', 'public YouTube source', '2026+ social-only intake', 'Contact via source'),
      'broker_agent_id', s.agent_id,
      'broker_submission', true,
      'lister_registration_status', CASE WHEN s.agent_id IS NULL THEN 'source_profile_deferred_until_multiple_properties' ELSE 'registered' END,
      'property_url_status', 'public_after_approval'
    ),
    s.source_name,
    s.source_phone,
    s.source_email,
    'agent',
    s.agent_id::uuid,
    'found_online_property_source_v1',
    'found_online',
    'approved',
    'approved_youtube_social_source',
    NOW(),
    NOW(),
    'Republished 25 May 2026: curated exact YouTube social-source property accepted for launch inventory. Website-only sources remain blocked.',
    'Curated YouTube social-source property accepted by King launch policy.'
  FROM seed_rows s
  WHERE NOT EXISTS (
    SELECT 1
    FROM properties p
    WHERE p.extra_fields->>'source_listing_key' = s.source_listing_key
       OR p.extra_fields->>'source_url' = s.source_url
       OR p.extra_fields->>'source_post_url' = s.source_url
  )
  RETURNING id, extra_fields->>'source_listing_key' AS source_listing_key, extra_fields->>'youtube_video_id' AS youtube_id
),
affected_properties AS (
  SELECT id, source_listing_key, youtube_id FROM upsert_existing_properties
  UNION ALL
  SELECT id, source_listing_key, youtube_id FROM inserted_properties
),
deleted_old_images AS (
  DELETE FROM property_images pi
  USING affected_properties ap
  WHERE pi.property_id = ap.id
    AND (
      pi.url LIKE 'https://i.ytimg.com/vi/%'
      OR pi.slot_key LIKE 'source_video_%'
      OR pi.slot_key LIKE 'youtube_video_%'
    )
  RETURNING pi.id
),
frames(file_name, room_label, slot_key, sort_order, is_primary) AS (
  VALUES
    ('hqdefault.jpg', 'Source video cover still', 'source_video_cover_still', 0, TRUE),
    ('0.jpg', 'Source video preview still', 'source_video_preview_still', 1, FALSE),
    ('1.jpg', 'Source video supporting still', 'source_video_supporting_still', 2, FALSE),
    ('2.jpg', 'Source video additional still', 'source_video_additional_still', 3, FALSE),
    ('3.jpg', 'Source video extra still', 'source_video_extra_still', 4, FALSE)
),
inserted_images AS (
  INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
  SELECT
    ap.id,
    'https://i.ytimg.com/vi/' || ap.youtube_id || '/' || f.file_name,
    f.is_primary,
    f.sort_order,
    f.slot_key,
    f.room_label
  FROM affected_properties ap
  CROSS JOIN frames f
  WHERE ap.youtube_id IS NOT NULL
  RETURNING property_id
),
event_rows AS (
  INSERT INTO property_moderation_events (
    property_id, actor_id, action, status_from, status_to,
    checklist, reason, notes, delivery
  )
  SELECT
    ap.id,
    'youtube_social_republish_20260525',
    'youtube_social_found_online_republished',
    'deleted_or_missing',
    'approved',
    jsonb_build_object(
      'youtube_social_source_accepted', true,
      'website_sources_blocked', true,
      'deterministic_source_key', ap.source_listing_key,
      'youtube_video_id', ap.youtube_id
    ),
    'Republished curated YouTube social-source property after King confirmed YouTube source posts are acceptable launch inventory.',
    'This migration repairs live inventory even when the previous deleted-row restore predicate did not match production rows.',
    jsonb_build_object(
      'restore_batch', 'youtube_social_batch_republish_20260525',
      'images_inserted', (SELECT COUNT(*) FROM inserted_images),
      'old_images_deleted', (SELECT COUNT(*) FROM deleted_old_images)
    )
  FROM affected_properties ap
  RETURNING property_id
)
UPDATE agents a
SET
  status = 'approved',
  registration_status = 'registered',
  approved_at = COALESCE(a.approved_at, NOW()),
  verification_reason = CONCAT_WS(
    E'\n',
    NULLIF(a.verification_reason, ''),
    'Republished 25 May 2026: profile has multiple approved curated YouTube social-source properties on makaug.'
  ),
  updated_at = NOW()
FROM (
  SELECT p.agent_id, COUNT(*)::int AS listing_count
  FROM properties p
  WHERE p.agent_id IS NOT NULL
    AND p.status = 'approved'
    AND p.extra_fields->>'source_batch' = 'social_search_authorised_20260520'
    AND LOWER(COALESCE(p.extra_fields->>'source_platform', '')) = 'youtube'
  GROUP BY p.agent_id
  HAVING COUNT(*) > 1
) approved_social,
(SELECT COUNT(*) FROM event_rows) events_written
WHERE a.id = approved_social.agent_id;
