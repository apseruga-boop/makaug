-- 230: Calling screen, part 2 (16 Nov 2026).
--
-- 1. Own logins for Ronald and Sharon (Arthur approved, 16 Nov 14:10 UK).
--    Two staff (moderator) users are created with NO usable password: the
--    password_hash is a bcrypt hash of a random value nobody ever sees. King
--    makes a one-time setup link (valid 48 h) in Staff Performance → Calling →
--    Logins, sends it to the person, and they choose their own password.
--    Ronald gets staff_scope 'caller' (calling screen only); Sharon gets the
--    normal staff dashboard plus calling. Nothing else is changed or disabled.
-- 2. staff_setup_links: only a SHA-256 hash of each link token is stored.
-- 3. pipeline_items: the meeting review list. One row per agent/prospect that
--    King has acted on (decision, next action, due date, archive with reason).
--    Archive hides a row from the review; nothing is deleted.
-- 4. call_attempts.client_ops: ids of offline operations already applied, so a
--    retry after a lost connection can never double-count a tap or wrap-up.
--
-- Rollback:
--   UPDATE commission_staff SET user_id = NULL WHERE user_id IN (SELECT id::text FROM users WHERE email IN ('ronald@staff.makaug.internal','sharon@staff.makaug.internal'));
--   DELETE FROM users WHERE email IN ('ronald@staff.makaug.internal','sharon@staff.makaug.internal');
--   DROP TABLE IF EXISTS staff_setup_links, pipeline_items;
--   ALTER TABLE call_attempts DROP COLUMN IF EXISTS client_ops;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS client_ops TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS staff_setup_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_staff_setup_links_user ON staff_setup_links (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_items (
  phone_key TEXT PRIMARY KEY CHECK (phone_key ~ '^[0-9]{9}$'),
  decision TEXT,
  next_action TEXT,
  next_action_due DATE,
  owner_key TEXT,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  person RECORD;
  new_id UUID;
BEGIN
  FOR person IN
    SELECT * FROM (VALUES
      ('ronald', 'Ronald', 'ronald@staff.makaug.internal', '+256700002001', 'caller', 'CALL-01'),
      ('sharon', 'Sharon', 'sharon@staff.makaug.internal', '+256700002002', 'staff',  'CALL-02')
    ) AS v(person_key, first_name, email, phone, scope, staff_code)
  LOOP
    SELECT id INTO new_id FROM users WHERE LOWER(email) = person.email LIMIT 1;
    IF new_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE phone = person.phone) THEN
      INSERT INTO users (first_name, last_name, phone, email, role, password_hash, phone_verified, status,
                         marketing_opt_in, weekly_tips_opt_in, preferred_contact_channel, preferred_language, profile_data)
      VALUES (person.first_name, 'Makaug', person.phone, person.email, 'moderator',
              crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 12)), TRUE, 'active',
              FALSE, FALSE, 'email', 'en',
              jsonb_build_object('audience', 'moderator', 'account_kind', 'moderator', 'staff_dashboard_enabled', true,
                                 'staff_code', person.staff_code, 'employee_number', person.staff_code,
                                 'staff_scope', person.scope, 'person_key', person.person_key,
                                 'password_setup', 'pending', 'password_managed_by_admin', false,
                                 'created_by', 'migration 230 (Arthur approved 16 Nov 2026)'))
      RETURNING id INTO new_id;
    END IF;
    IF new_id IS NOT NULL THEN
      UPDATE commission_staff SET user_id = new_id::text WHERE person_key = person.person_key AND (user_id IS NULL OR user_id = '');
    END IF;
  END LOOP;
END $$;
