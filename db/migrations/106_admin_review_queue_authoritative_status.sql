CREATE INDEX IF NOT EXISTS idx_properties_admin_actionable_review_order_v3
  ON properties (
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE (
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
    OR (
      COALESCE(status, '') = ''
      AND LOWER(COALESCE(moderation_stage, '')) IN (
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
  )
  AND NOT (
    COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  )
  AND (
    NOT (
      COALESCE(extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
    )
    OR source = 'found_online_property_source_v1'
    OR listed_via = 'found_online'
  );

CREATE INDEX IF NOT EXISTS idx_properties_admin_found_online_review_order_v3
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
    OR (
      COALESCE(status, '') = ''
      AND LOWER(COALESCE(moderation_stage, '')) IN (
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

ANALYZE properties;
