WITH social_rows AS (
  SELECT
    p.id,
    LOWER(CONCAT_WS(
      ' ',
      p.title,
      p.area,
      p.address,
      p.description,
      p.extra_fields->>'resolved_location_label',
      p.extra_fields->>'source_url',
      p.extra_fields->>'source_post_url'
    )) AS haystack
  FROM properties p
  WHERE COALESCE(p.source, '') = 'found_online_property_source_v1'
     OR COALESCE(p.listed_via, '') = 'found_online'
     OR COALESCE(p.extra_fields->>'found_online', '') IN ('true', '1', 'yes')
     OR COALESCE(p.extra_fields->>'social_search_candidate', '') IN ('true', '1', 'yes')
),
resolved AS (
  SELECT
    id,
    CASE
      WHEN haystack ~ '(kakiri|masulita|hoima road)' THEN 'Kakiri'
      WHEN haystack ~ '(bujjuko|bujuuko|akright)' THEN 'Bujjuko Akright Estate'
      WHEN haystack ~ '(ndejje|lubugumu)' THEN 'Ndejje'
      WHEN haystack ~ '(kira[- ]mulawa|mulawa)' THEN 'Kira-Mulawa'
      WHEN haystack ~ '(kira[- ]nsasa|nsasa)' THEN 'Kira-Nsasa'
      WHEN haystack ~ '(kira town|(^|[^a-z0-9])kira([^a-z0-9]|$))' THEN 'Kira'
      WHEN haystack ~ '(katosi|mpunge|mpungwe)' THEN 'Katosi'
      WHEN haystack ~ '(kololo)' THEN 'Kololo'
      ELSE NULL
    END AS area_label,
    CASE
      WHEN haystack ~ '(katosi|mpunge|mpungwe)' THEN 'Mukono'
      WHEN haystack ~ '(kololo)' THEN 'Kampala'
      ELSE 'Wakiso'
    END AS district_label,
    CASE
      WHEN haystack ~ '(kakiri|masulita|hoima road)' THEN 0.409::numeric
      WHEN haystack ~ '(bujjuko|bujuuko|akright)' THEN 0.374::numeric
      WHEN haystack ~ '(ndejje|lubugumu)' THEN 0.244::numeric
      WHEN haystack ~ '(kira[- ]mulawa|mulawa)' THEN 0.412::numeric
      WHEN haystack ~ '(kira[- ]nsasa|nsasa)' THEN 0.428::numeric
      WHEN haystack ~ '(kira town|(^|[^a-z0-9])kira([^a-z0-9]|$))' THEN 0.3978::numeric
      WHEN haystack ~ '(katosi|mpunge|mpungwe)' THEN 0.181::numeric
      WHEN haystack ~ '(kololo)' THEN 0.356::numeric
      ELSE NULL::numeric
    END AS latitude,
    CASE
      WHEN haystack ~ '(kakiri|masulita|hoima road)' THEN 32.38::numeric
      WHEN haystack ~ '(bujjuko|bujuuko|akright)' THEN 32.389::numeric
      WHEN haystack ~ '(ndejje|lubugumu)' THEN 32.553::numeric
      WHEN haystack ~ '(kira[- ]mulawa|mulawa)' THEN 32.65::numeric
      WHEN haystack ~ '(kira[- ]nsasa|nsasa)' THEN 32.665::numeric
      WHEN haystack ~ '(kira town|(^|[^a-z0-9])kira([^a-z0-9]|$))' THEN 32.6414::numeric
      WHEN haystack ~ '(katosi|mpunge|mpungwe)' THEN 32.797::numeric
      WHEN haystack ~ '(kololo)' THEN 32.612::numeric
      ELSE NULL::numeric
    END AS longitude
  FROM social_rows
),
updated AS (
  UPDATE properties p
  SET
    district = r.district_label,
    area = CASE
      WHEN COALESCE(TRIM(p.area), '') = ''
        OR LOWER(TRIM(COALESCE(p.area, ''))) IN ('kampala', 'wakiso', 'hoima', 'greater kampala', 'uganda')
        THEN r.area_label
      ELSE p.area
    END,
    address = CASE
      WHEN COALESCE(TRIM(p.address), '') = ''
        OR LOWER(TRIM(COALESCE(p.address, ''))) IN ('kampala', 'wakiso', 'hoima', 'greater kampala', 'uganda')
        THEN r.area_label || ', ' || r.district_label
      ELSE p.address
    END,
    latitude = CASE WHEN p.latitude IS NULL THEN r.latitude ELSE p.latitude END,
    longitude = CASE WHEN p.longitude IS NULL THEN r.longitude ELSE p.longitude END,
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'location_pin_repaired_at', NOW(),
      'location_pin_repair_batch', 'social_area_pin_repair_20260527',
      'resolved_location_label', COALESCE(NULLIF(p.extra_fields->>'resolved_location_label', ''), r.area_label || ', ' || r.district_label)
    ),
    updated_at = NOW()
  FROM resolved r
  WHERE p.id = r.id
    AND r.area_label IS NOT NULL
    AND r.latitude IS NOT NULL
    AND (
      p.latitude IS NULL
      OR p.longitude IS NULL
      OR LOWER(TRIM(COALESCE(p.district, ''))) IN ('kampala', 'hoima')
      OR LOWER(TRIM(COALESCE(p.area, ''))) IN ('hoima', 'greater kampala')
    )
  RETURNING p.id, r.area_label, r.district_label, r.latitude, r.longitude
)
INSERT INTO property_moderation_events (
  property_id, actor_id, action, status_from, status_to,
  checklist, reason, notes, delivery
)
SELECT
  id,
  'social_area_pin_repair_20260527',
  'social_source_location_pin_repaired',
  'approved_or_pending',
  'approved_or_pending',
  jsonb_build_object(
    'area', area_label,
    'district', district_label,
    'latitude', latitude,
    'longitude', longitude,
    'source', 'area/address/title social-source resolver'
  ),
  'Repaired social found-online area-level location pin so each listing maps to its own visible source area instead of the shared district fallback.',
  'Existing social/TikTok found-online rows without stored coordinates now carry area-level pins; exact pins can still be adjusted in King review.',
  jsonb_build_object('rollback', 'Set latitude/longitude back to NULL and remove location_pin_repair_batch = social_area_pin_repair_20260527 from extra_fields if this repair must be reverted.')
FROM updated;
