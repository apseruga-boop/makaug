SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS idx_property_source_registry_staff_panel_order
  ON property_source_registry ((COALESCE(last_seen_at, last_checked_at, created_at)) DESC)
  WHERE status IN ('active', 'candidate', 'review_needed');
