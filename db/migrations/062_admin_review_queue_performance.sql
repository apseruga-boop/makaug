CREATE INDEX IF NOT EXISTS idx_properties_admin_review_queue_status_updated
  ON properties (LOWER(COALESCE(status, '')), COALESCE(updated_at, created_at) DESC)
  WHERE LOWER(COALESCE(status, '')) IN (
    'pending',
    'pending_review',
    'test_pending_review',
    'pending_review_hidden',
    'draft',
    'submitted',
    'in_review',
    'under_review'
  );

CREATE INDEX IF NOT EXISTS idx_properties_admin_review_queue_stage_updated
  ON properties (LOWER(COALESCE(moderation_stage, '')), COALESCE(updated_at, created_at) DESC)
  WHERE LOWER(COALESCE(moderation_stage, '')) IN (
    'pending',
    'pending_review',
    'test_pending_review',
    'pending_review_hidden',
    'draft',
    'submitted',
    'in_review',
    'under_review'
  );

CREATE INDEX IF NOT EXISTS idx_property_images_admin_primary_lookup
  ON property_images (property_id, is_primary DESC, sort_order ASC, created_at ASC);
