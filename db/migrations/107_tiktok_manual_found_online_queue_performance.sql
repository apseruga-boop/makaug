CREATE INDEX IF NOT EXISTS idx_properties_tiktok_manual_found_online_review_order
  ON properties (
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE (
    source = 'found_online_property_source_v1'
    OR listed_via = 'found_online'
  )
  AND (
    COALESCE(status, '') IN (
      'pending',
      'pending_review',
      'test_pending_review',
      'pending_review_hidden',
      'draft',
      'submitted',
      'resubmitted',
      'in_review',
      'under_review',
      'needs_review',
      'awaiting_review',
      'queued',
      'source_review',
      'source_review_required',
      'pending_king_source_review',
      'king_review'
    )
    OR (
      COALESCE(status, '') = ''
      AND COALESCE(moderation_stage, '') IN (
        'pending',
        'pending_review',
        'test_pending_review',
        'pending_review_hidden',
        'draft',
        'submitted',
        'resubmitted',
        'in_review',
        'under_review',
        'needs_review',
        'awaiting_review',
        'queued',
        'source_review',
        'source_review_required',
        'pending_king_source_review',
        'king_review'
      )
    )
  );

COMMENT ON INDEX idx_properties_tiktok_manual_found_online_review_order IS
  'Matches the raw lowercase-status predicate used by the paginated King Found Online review route.';

ANALYZE properties;
