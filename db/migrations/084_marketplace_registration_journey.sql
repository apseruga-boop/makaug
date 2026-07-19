ALTER TABLE marketplace_businesses
  ADD COLUMN IF NOT EXISTS registration_reference TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS owner_language TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS rejection_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS rejection_message TEXT,
  ADD COLUMN IF NOT EXISTS profile_images TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS profile_view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_profile_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day7_followup_sent_at TIMESTAMPTZ;

UPDATE marketplace_businesses
SET registration_reference = NULLIF(source_metadata->>'registration_reference', ''),
    owner_phone = COALESCE(NULLIF(owner_phone, ''), NULLIF(whatsapp, ''), NULLIF(phone, '')),
    owner_email = COALESCE(NULLIF(owner_email, ''), NULLIF(email, '')),
    owner_language = COALESCE(NULLIF(source_metadata->>'language', ''), owner_language, 'en')
WHERE source_type = 'private';

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_businesses_registration_reference
  ON marketplace_businesses (registration_reference)
  WHERE registration_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_owner_followup
  ON marketplace_businesses (status, tier, reviewed_at, day7_followup_sent_at)
  WHERE status = 'live' AND tier = 'private';

CREATE TABLE IF NOT EXISTS marketplace_edit_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES marketplace_businesses(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES marketplace_claims(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_edit_tokens_business_active
  ON marketplace_edit_tokens (business_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS marketplace_verified_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES marketplace_businesses(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  source TEXT NOT NULL DEFAULT 'marketplace_verified_waitlist',
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('waiting', 'contacted', 'converted', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_verified_waitlist_status_created
  ON marketplace_verified_waitlist (status, created_at ASC);

DROP TRIGGER IF EXISTS trg_marketplace_verified_waitlist_updated_at ON marketplace_verified_waitlist;
CREATE TRIGGER trg_marketplace_verified_waitlist_updated_at
BEFORE UPDATE ON marketplace_verified_waitlist
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_owner_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES marketplace_businesses(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES marketplace_leads(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  trigger_key TEXT NOT NULL UNIQUE,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  recipient_phone TEXT,
  recipient_email TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_owner_notifications_pending
  ON marketplace_owner_notifications (status, created_at ASC)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_marketplace_owner_notifications_updated_at ON marketplace_owner_notifications;
CREATE TRIGGER trg_marketplace_owner_notifications_updated_at
BEFORE UPDATE ON marketplace_owner_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE marketplace_edit_tokens IS
  'Hashed, expiring owner links for passwordless Marketplace profile management.';

COMMENT ON TABLE marketplace_owner_notifications IS
  'Deduplicated owner lifecycle and upgrade-touchpoint delivery log.';
