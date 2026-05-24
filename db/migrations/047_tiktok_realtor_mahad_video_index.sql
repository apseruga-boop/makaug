WITH tiktok_index_sources (
  source_key,
  source_name,
  platform,
  source_type,
  source_url,
  handle,
  contact_phone,
  districts,
  listing_types,
  languages,
  hashtags,
  status,
  trust_level,
  consent_status,
  scrape_policy,
  can_contact_directly,
  notes,
  metadata
) AS (
  VALUES
    (
      'tiktok-realtor-mahad-urlebird-video-index',
      'TikTok mirror index: Realtor Mahad recent property videos',
      'tiktok',
      'public_video_index_mirror',
      'https://urlebird.com/user/realtor_mahad/',
      '@realtor_mahad',
      '+256789906044',
      ARRAY['Kampala','Wakiso']::text[],
      ARRAY['sale','rent','land']::text[],
      ARRAY['English','Luganda','Kiswahili']::text[],
      ARRAY['RealtorMahad','UgandaRealEstate','KampalaRealEstate','HouseForSaleUganda']::text[],
      'candidate',
      'review_needed',
      'public_source_review_needed',
      'public_tiktok_mirror_index_manual_review_only',
      TRUE,
      'Public TikTok mirror/index for Realtor Mahad. It shows recent 2026 property video snippets, but exact TikTok post URLs, image/still URLs, and full descriptions must be extracted through authenticated TikTok review before queueing properties.',
      jsonb_build_object(
        'deep_sweep_batch', 'tiktok_realtor_mahad_video_index_20260524',
        'source_record_kind', 'public_video_index_mirror',
        'review_required', true,
        'source_window_start', '2026-01-01T00:00:00.000Z',
        'public_reference_urls', jsonb_build_array(
          'https://urlebird.com/user/realtor_mahad/',
          'https://tikbuddy.com/tiktok/realtor_mahad'
        ),
        'public_fetch_status', 'public search results exposed creator metadata and recent property-video snippets through TikTok mirror/index pages',
        'exact_post_url_status', 'exact TikTok post URLs still required before importing review-queue properties',
        'image_rule', 'Capture TikTok thumbnails/stills only from exact post URLs or an authorised export; do not use mirror snippets as property images.'
      )
    )
)
INSERT INTO property_source_registry (
  source_key,
  source_name,
  platform,
  source_type,
  source_url,
  handle,
  contact_phone,
  districts,
  listing_types,
  languages,
  hashtags,
  status,
  trust_level,
  consent_status,
  scrape_policy,
  can_contact_directly,
  first_seen_at,
  last_seen_at,
  last_checked_at,
  notes,
  metadata
)
SELECT
  source_key,
  source_name,
  platform,
  source_type,
  source_url,
  handle,
  contact_phone,
  districts,
  listing_types,
  languages,
  hashtags,
  status,
  trust_level,
  consent_status,
  scrape_policy,
  can_contact_directly,
  NOW(),
  NOW(),
  NOW(),
  notes,
  metadata
FROM tiktok_index_sources
ON CONFLICT (source_key) DO UPDATE
SET
  source_name = EXCLUDED.source_name,
  platform = EXCLUDED.platform,
  source_type = EXCLUDED.source_type,
  source_url = EXCLUDED.source_url,
  handle = EXCLUDED.handle,
  contact_phone = COALESCE(EXCLUDED.contact_phone, property_source_registry.contact_phone),
  districts = EXCLUDED.districts,
  listing_types = EXCLUDED.listing_types,
  languages = EXCLUDED.languages,
  hashtags = EXCLUDED.hashtags,
  status = EXCLUDED.status,
  trust_level = EXCLUDED.trust_level,
  consent_status = EXCLUDED.consent_status,
  scrape_policy = EXCLUDED.scrape_policy,
  can_contact_directly = EXCLUDED.can_contact_directly,
  last_seen_at = NOW(),
  last_checked_at = NOW(),
  notes = EXCLUDED.notes,
  metadata = COALESCE(property_source_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

UPDATE property_source_registry
SET
  last_checked_at = NOW(),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'latest_profile_index_batch', 'tiktok_realtor_mahad_video_index_20260524',
    'public_creator_index_urls', jsonb_build_array(
      'https://urlebird.com/user/realtor_mahad/',
      'https://tikbuddy.com/tiktok/realtor_mahad'
    ),
    'public_profile_bio_evidence', 'SELLING | CONSULTANT || PROPERTY MANAGER INFO - 0789.906.044',
    'public_profile_metric_evidence', jsonb_build_object(
      'urlebird_followers', '247.8K',
      'urlebird_videos', '521',
      'tikbuddy_fans', '59.8K',
      'tikbuddy_videos', '94'
    ),
    'public_2026_video_snippet_count', 14,
    'public_2026_video_snippets', jsonb_build_array(
      jsonb_build_object('date_evidence', '3 weeks ago from 2026-05-24 search', 'snippet', 'Inside this stunning ultra modern 5 bedroom house.', 'status', 'needs exact TikTok post URL and stills before property import'),
      jsonb_build_object('date_evidence', '1 month ago from 2026-05-24 search', 'snippet', 'This beautiful house has 7 bedrooms, Swimming Pool.', 'status', 'needs exact TikTok post URL and price normalization before property import'),
      jsonb_build_object('date_evidence', '1 month ago from 2026-05-24 search', 'snippet', 'House tour of this bungalow in Kira, Uganda.', 'status', 'needs exact TikTok post URL, price, and stills before property import'),
      jsonb_build_object('date_evidence', '1 month ago from 2026-05-24 search', 'snippet', 'Uganda modern contemporary house design in Kungu/Kyanja area.', 'status', 'needs exact TikTok post URL and listing intent before property import'),
      jsonb_build_object('date_evidence', '1 month ago from 2026-05-24 search', 'snippet', 'Beautiful mansion with underground gym and movie theater.', 'status', 'needs exact TikTok post URL, location, price, and stills before property import'),
      jsonb_build_object('date_evidence', '2 months ago from 2026-05-24 search', 'snippet', 'Trending now in Uganda property video.', 'status', 'needs exact TikTok post URL and listing details before property import'),
      jsonb_build_object('date_evidence', '2 months ago from 2026-05-24 search', 'snippet', 'Beautiful house in Arkright City with 6 spacious bedrooms.', 'status', 'needs exact TikTok post URL, price, and stills before property import'),
      jsonb_build_object('date_evidence', '2 months ago from 2026-05-24 search', 'snippet', 'House in Kigo with terrace/lake-view language.', 'status', 'needs exact TikTok post URL, price, and stills before property import'),
      jsonb_build_object('date_evidence', '2 months ago from 2026-05-24 search', 'snippet', 'La Rose Royal apartment project covers 1.4 acres.', 'status', 'needs exact TikTok post URL, unit details, price, and stills before property import'),
      jsonb_build_object('date_evidence', '2 months ago from 2026-05-24 search', 'snippet', 'Luxury La Rose Royal houses in Uganda.', 'status', 'needs exact TikTok post URL, availability, price, and stills before property import')
    ),
    'next_ingestion_step', 'Open @realtor_mahad in authenticated TikTok review, capture exact 2026+ post URLs, posted dates, captions, prices, locations, source-contact path, and at least five authorised video stills, then import through inventory:import-source-posts.'
  ),
  updated_at = NOW()
WHERE source_key = 'tiktok-realtor-mahad-profile';

UPDATE agents
SET
  verification_reason = CONCAT_WS(
    E'\n',
    NULLIF(verification_reason, ''),
    'TikTok video-index sweep 20260524: public creator indexes identified recent 2026 property videos for authenticated extraction: https://urlebird.com/user/realtor_mahad/'
  ),
  updated_at = NOW()
WHERE licence_number = 'SOCIAL-REALTOR-MAHAD-20260520';
