ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('buyer_renter','property_owner','agent_broker','field_agent','admin','super_admin'));

CREATE TABLE IF NOT EXISTS admin_security_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin',
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_password_change_at TIMESTAMPTZ,
  force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_admin_security_settings_updated_at ON admin_security_settings;
CREATE TRIGGER trg_admin_security_settings_updated_at
BEFORE UPDATE ON admin_security_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_created
  ON admin_audit_logs(admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created
  ON admin_audit_logs(action, created_at DESC);

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS location_object JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_saved_searches_location_object_gin
  ON saved_searches USING GIN (location_object);

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_payment_links_updated_at ON payment_links;
CREATE TRIGGER trg_payment_links_updated_at
BEFORE UPDATE ON payment_links
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
