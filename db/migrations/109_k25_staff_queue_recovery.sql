-- K25: match the protected staff-visible list predicate and its newest-first order.
CREATE INDEX IF NOT EXISTS idx_properties_staff_visible_order_v2
  ON properties (
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) NOT IN (
    'deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review'
  )
  AND LOWER(COALESCE(moderation_stage, '')) NOT IN (
    'deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review'
  );

COMMENT ON INDEX idx_properties_staff_visible_order_v2 IS
  'Supports the bounded protected staff property list without a full-catalogue sort.';

ANALYZE properties;
