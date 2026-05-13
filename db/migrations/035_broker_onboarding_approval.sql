ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS identity_document_name TEXT,
  ADD COLUMN IF NOT EXISTS identity_document_url TEXT,
  ADD COLUMN IF NOT EXISTS identity_document_type TEXT,
  ADD COLUMN IF NOT EXISTS identity_document_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reason TEXT,
  ADD COLUMN IF NOT EXISTS privacy_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_retention_notice_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS data_retention_notice_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_review_status_created ON agents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_identity_uploaded ON agents(identity_document_uploaded_at DESC)
  WHERE identity_document_url IS NOT NULL;
