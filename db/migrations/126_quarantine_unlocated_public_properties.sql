-- The production search audit found four approved rows with no usable location
-- evidence at all. Do not invent a place for them: return them to staff review
-- until a moderator can confirm a canonical location and/or map pin.

UPDATE properties
SET
  status = 'pending',
  moderation_stage = 'source_review',
  moderation_reason = 'Location evidence is required before public search publication.',
  moderation_notes = CONCAT_WS(
    E'\n',
    NULLIF(moderation_notes, ''),
    'Automatically held by migration 126 after the 2026-09-09 public location-search audit. Confirm the property location before approving again.'
  ),
  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
    'publication_eligible', false,
    'location_review_required', true,
    'location_review_source', '2026-09-09-public-search-audit'
  ),
  updated_at = NOW()
WHERE id IN (
  '0975abd6-4e44-4a6f-af06-0818698a9012',
  'd1c6e881-2f00-4515-a297-2f3197111fb6',
  '93e858be-d023-40b0-a6ee-467f8a5d5ec9',
  'eb3515cc-3ab9-46d1-9e6e-632ae8714c05'
)
  AND status = 'approved'
  AND NULLIF(TRIM(COALESCE(area, '')), '') IS NULL
  AND NULLIF(TRIM(COALESCE(district, '')), '') IS NULL
  AND latitude IS NULL
  AND longitude IS NULL
  AND NULLIF(TRIM(COALESCE(extra_fields->>'canonical_location_id', '')), '') IS NULL;
