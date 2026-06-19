ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('buyer_renter','property_owner','agent_broker','field_agent','admin','super_admin','moderator'));

ALTER TABLE advertising_inquiries
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_staff_action_at TIMESTAMPTZ;

ALTER TABLE advertising_campaigns
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_staff_action_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_advertising_inquiries_assigned_staff
  ON advertising_inquiries(assigned_to_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_advertising_campaigns_assigned_staff
  ON advertising_campaigns(assigned_to_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_logs_staff_created
  ON staff_activity_logs(staff_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_activity_logs_action_created
  ON staff_activity_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_activity_logs_target
  ON staff_activity_logs(target_type, target_id, created_at DESC);
