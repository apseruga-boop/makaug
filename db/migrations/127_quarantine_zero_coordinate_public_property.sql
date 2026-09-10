-- Migration 126 held audited public rows whose coordinates were NULL. One of
-- the same four rows uses the equally unusable sentinel point 0,0 instead.
-- Keep this exact row out of public search until staff confirms its location.

UPDATE properties
SET
  status = 'pending',
  moderation_stage = 'source_review',
  moderation_reason = 'Location evidence is required before public search publication.',
  moderation_notes = CONCAT_WS(
    E'\n',
    NULLIF(moderation_notes, ''),
    'Automatically held by migration 127 after the 2026-09-10 live verification found an unusable 0,0 coordinate. Confirm the property location before approving again.'
  ),
  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
    'publication_eligible', false,
    'location_review_required', true,
    'location_review_source', '2026-09-10-zero-coordinate-live-verification'
  ),
  updated_at = NOW()
WHERE id = 'eb3515cc-3ab9-46d1-9e6e-632ae8714c05'
  AND status = 'approved'
  AND NULLIF(TRIM(COALESCE(area, '')), '') IS NULL
  AND NULLIF(TRIM(COALESCE(district, '')), '') IS NULL
  AND latitude = 0
  AND longitude = 0
  AND NULLIF(TRIM(COALESCE(extra_fields->>'canonical_location_id', '')), '') IS NULL;
