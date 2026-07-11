CREATE INDEX IF NOT EXISTS idx_properties_staff_active_review_unsuppressed_order
  ON properties (updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)
  WHERE LOWER(COALESCE(status, '')) NOT IN ('approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'declined', 'fraud', 'archived')
    AND LOWER(COALESCE(status, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review')
    AND LOWER(COALESCE(moderation_stage, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review')
    AND (
      LOWER(COALESCE(status, '')) IN ('pending', 'pending_review', 'submitted', 'in_review', 'under_review')
      OR LOWER(COALESCE(moderation_stage, '')) IN ('pending', 'pending_review', 'submitted', 'in_review', 'under_review')
    )
    AND NOT (
      LOWER(COALESCE(extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
      OR LOWER(COALESCE(extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
    );

CREATE INDEX IF NOT EXISTS idx_properties_staff_review_lower_title_created
  ON properties (LOWER(COALESCE(title, '')), created_at DESC)
  WHERE LOWER(COALESCE(status, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review');

CREATE INDEX IF NOT EXISTS idx_properties_staff_review_source_url_created
  ON properties ((COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '')), created_at DESC)
  WHERE COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '') <> ''
    AND LOWER(COALESCE(status, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review');

ANALYZE properties;
