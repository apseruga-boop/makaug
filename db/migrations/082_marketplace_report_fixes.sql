CREATE TABLE IF NOT EXISTS marketplace_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES marketplace_businesses(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  claimant_name TEXT NOT NULL,
  claimant_phone TEXT NOT NULL,
  claimant_email TEXT,
  claimant_role TEXT NOT NULL,
  proof_url TEXT,
  proof_notes TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'pending_review',
  moderation_reason TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_claims_status_created
  ON marketplace_claims (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_marketplace_claims_business_status
  ON marketplace_claims (business_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_marketplace_claims_updated_at ON marketplace_claims;
CREATE TRIGGER trg_marketplace_claims_updated_at
BEFORE UPDATE ON marketplace_claims
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE marketplace_claims IS
  'Role-gated ownership claims for found-online Marketplace business records.';
