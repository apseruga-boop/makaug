ALTER TABLE marketplace_businesses
  ADD COLUMN IF NOT EXISTS source_place_id TEXT;

UPDATE marketplace_businesses
SET source_place_id = NULLIF(source_metadata->>'google_place_id', '')
WHERE source_place_id IS NULL
  AND source = 'google_maps'
  AND NULLIF(source_metadata->>'google_place_id', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_source_place_id
  ON marketplace_businesses (source, source_place_id)
  WHERE source_place_id IS NOT NULL;

COMMENT ON COLUMN marketplace_businesses.source_place_id IS
  'Stable upstream place identifier. Volatile Google Place Details remain short-lived in application cache.';
