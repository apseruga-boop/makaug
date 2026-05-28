BEGIN;

WITH corrected AS (
  UPDATE properties
  SET
    listing_type = 'sale',
    title = 'Luxury mansion for sale in Kira',
    description = 'Mansion with 5 bedrooms, 2 living rooms and a spacious compound for sale around Kira, Wakiso. Source details mention a private Mailo land title. Contact through the original TikTok source and verify availability before payment.',
    property_type = 'Mansion',
    bedrooms = 5,
    bathrooms = NULL,
    area = 'Kira',
    district = 'Wakiso',
    address = 'Kira, Wakiso',
    price = 1300000000,
    price_period = 'once',
    latitude = 0.3978,
    longitude = 32.6414,
    amenities = '["Spacious compound", "Private Mailo land title", "Found online", "Contact via source"]'::jsonb,
    moderation_stage = CASE WHEN status = 'approved' THEN 'approved' ELSE moderation_stage END,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb)
      || jsonb_build_object(
        'king_review_corrected_fields', jsonb_build_array(
          'listing_type',
          'title',
          'description',
          'property_type',
          'bedrooms',
          'area',
          'district',
          'address',
          'latitude',
          'longitude',
          'amenities'
        ),
        'king_review_corrected_at', '2026-05-28T14:05:00.000Z',
        'king_review_facts_confirmed', true,
        'resolved_location_label', 'Kira, Wakiso',
        'map_pin_confirmed', true,
        'map_pin_source', 'king_review_migration_058',
        'map_pin_confirmed_at', '2026-05-28T14:05:00.000Z',
        'source_category_correction_reason', 'TikTok caption describes a luxury mansion/house for sale; land title and decimals are supporting facts, not the listing category.'
      ),
    updated_at = NOW()
  WHERE
    id = '1e3bdf76-2afc-43a2-bef1-3d3c85e9baec'::uuid
    OR COALESCE(extra_fields->>'source_url', '') ILIKE '%7644543309066571015%'
    OR COALESCE(extra_fields->>'video_url', '') ILIKE '%7644543309066571015%'
    OR COALESCE(extra_fields->>'tiktok_url', '') ILIKE '%7644543309066571015%'
    OR COALESCE(extra_fields->>'source_listing_key', '') ILIKE '%7644543309066571015%'
    OR COALESCE(extra_fields::text, '') ILIKE '%7644543309066571015%'
  RETURNING id
)
INSERT INTO property_moderation_events (property_id, actor_id, action, notes, delivery)
SELECT
  id,
  'migration_058',
  'king_review_type_location_correction',
  'Corrected Lady Property Agent TikTok Kira mansion from land to sale and confirmed the public facts/map pin.',
  jsonb_build_object(
    'listing_type', 'sale',
    'property_type', 'Mansion',
    'source_platform', 'TikTok',
    'source_video_id', '7644543309066571015',
    'reason', 'Dwelling sale post was previously misclassified because the caption mentioned decimals/private Mailo land title.'
  )
FROM corrected;

COMMIT;
