CREATE TABLE IF NOT EXISTS saved_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_properties_user_property
  ON saved_properties(user_id, property_id);

CREATE INDEX IF NOT EXISTS idx_saved_properties_user_created
  ON saved_properties(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_properties_property
  ON saved_properties(property_id);

DROP TRIGGER IF EXISTS trg_saved_properties_updated_at ON saved_properties;
CREATE TRIGGER trg_saved_properties_updated_at
BEFORE UPDATE ON saved_properties
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
