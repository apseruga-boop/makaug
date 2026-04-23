ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS featured_homepage BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_featured_homepage
  ON agents (featured_homepage)
  WHERE featured_homepage = TRUE;
