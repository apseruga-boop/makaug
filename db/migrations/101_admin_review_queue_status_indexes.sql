CREATE INDEX IF NOT EXISTS idx_properties_admin_review_status_order_v2
  ON properties (
    LOWER(COALESCE(status, '')),
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) IN (
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
  );

CREATE INDEX IF NOT EXISTS idx_properties_admin_review_stage_order_v2
  ON properties (
    LOWER(COALESCE(moderation_stage, '')),
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE LOWER(COALESCE(moderation_stage, '')) IN (
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
  );

CREATE INDEX IF NOT EXISTS idx_properties_admin_found_online_review_status_v2
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
    LOWER(COALESCE(status, '')) IN (
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
    OR LOWER(COALESCE(moderation_stage, '')) IN (
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
  );

ANALYZE properties;
