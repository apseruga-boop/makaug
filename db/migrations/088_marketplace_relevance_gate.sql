ALTER TABLE marketplace_businesses
  ADD COLUMN IF NOT EXISTS relevance_status TEXT NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS relevance_score SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relevance_reason TEXT,
  ADD COLUMN IF NOT EXISTS relevance_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS relevance_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE marketplace_businesses
  DROP CONSTRAINT IF EXISTS marketplace_businesses_relevance_status_check;

ALTER TABLE marketplace_businesses
  ADD CONSTRAINT marketplace_businesses_relevance_status_check
  CHECK (relevance_status IN ('unchecked', 'qualified', 'pending_review', 'reject'));

ALTER TABLE marketplace_businesses
  DROP CONSTRAINT IF EXISTS marketplace_businesses_relevance_score_check;

ALTER TABLE marketplace_businesses
  ADD CONSTRAINT marketplace_businesses_relevance_score_check
  CHECK (relevance_score BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_relevance_status
  ON marketplace_businesses (status, relevance_status, relevance_checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_relevance_review
  ON marketplace_businesses (relevance_reason, category, district)
  WHERE status IN ('live', 'pending_review');

COMMENT ON COLUMN marketplace_businesses.relevance_status IS
  'Marketplace category relevance decision: unchecked, qualified, pending_review, or reject.';

COMMENT ON COLUMN marketplace_businesses.relevance_metadata IS
  'Auditable Google types, classifier marker, actor, and check timestamp for the relevance decision.';
