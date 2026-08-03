-- K24: keep the protected staff property list bounded and index-backed.
CREATE INDEX IF NOT EXISTS idx_properties_staff_status_list_order
  ON properties (
    LOWER(COALESCE(status, '')),
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE LOWER(COALESCE(status, '')) NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived');

COMMENT ON INDEX idx_properties_staff_status_list_order IS
  'Supports the protected paginated /api/staff/properties list without public-route fallbacks.';

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created
  ON analytics_events (event_name, created_at DESC);

COMMENT ON INDEX idx_analytics_events_event_created IS
  'Supports bounded admin-summary event totals and rolling 48-hour analytics widgets.';

ANALYZE properties;
ANALYZE analytics_events;
