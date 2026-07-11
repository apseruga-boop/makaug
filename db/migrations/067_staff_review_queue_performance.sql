CREATE INDEX IF NOT EXISTS idx_properties_staff_active_review_queue_order
  ON properties (updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)
  WHERE LOWER(COALESCE(status, '')) NOT IN ('approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'declined', 'fraud', 'archived')
    AND LOWER(COALESCE(status, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review')
    AND LOWER(COALESCE(moderation_stage, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review')
    AND (
      LOWER(COALESCE(status, '')) IN ('pending', 'pending_review', 'submitted', 'in_review', 'under_review')
      OR LOWER(COALESCE(moderation_stage, '')) IN ('pending', 'pending_review', 'submitted', 'in_review', 'under_review')
    );

ANALYZE properties;
