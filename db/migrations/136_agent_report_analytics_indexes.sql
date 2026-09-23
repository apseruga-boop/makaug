-- Weekly agent reports read a week of property_open events; these indexes keep
-- that cheap as analytics_events grows.
CREATE INDEX IF NOT EXISTS idx_analytics_property_open_created
  ON analytics_events (created_at)
  WHERE event_name = 'property_open';

CREATE INDEX IF NOT EXISTS idx_property_inquiries_property_created
  ON property_inquiries (property_id, created_at);

CREATE INDEX IF NOT EXISTS idx_saved_properties_property_created
  ON saved_properties (property_id, created_at);
