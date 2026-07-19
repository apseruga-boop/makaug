CREATE INDEX IF NOT EXISTS idx_properties_found_online_review_queue
  ON properties (source, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)
  WHERE source = 'found_online_property_source_v1';

CREATE INDEX IF NOT EXISTS idx_properties_found_online_listed_via_queue
  ON properties (listed_via, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)
  WHERE listed_via = 'found_online';

COMMENT ON INDEX idx_properties_found_online_review_queue IS
  'Supports paginated King/staff Found Online review without loading the full moderation queue.';
