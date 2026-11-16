-- 237: "Arthur (test)" practice caller (Arthur asked 16 Nov 2026 18:02 UK; merged only after he approves).
--
-- One staff (moderator) user, calling screen only (staff_scope 'caller'), flagged
-- profile_data.sandbox = true. Like the 230 logins it has NO usable password:
-- the hash is of a random value nobody sees. King makes the one-time setup
-- link in King → Staff Performance → Logins → "Make setup link".
--
-- What the sandbox flag does (enforced in code, services/callingSandbox.js):
--   * its queue is only TEST practice numbers (+256 700 0001NN, checked unused
--     in production on 16 Nov 2026); it never gets real callbacks, leads,
--     WhatsApp contacts or agents, and real callers never get TEST numbers;
--   * pay links, MoMo codes, "They say they paid", payment-SMS uploads, video
--     requests, added numbers, the cash check and number action items are
--     refused, so nothing is sent and no claim/revenue/commission/Road to
--     1000 entry can exist for it;
--   * its calls and work time are left out of every team total (activity,
--     calls summary, leaderboard, pipeline, callbacks, saved reports).
-- No commission_staff row is made, so it has no commission rate.
--
-- Backup: calling_sandbox_backup_237 keeps any users row that already had this
-- e-mail or person_key before the insert (expected: none).
-- Rollback:
--   DELETE FROM call_session_events WHERE session_id IN (SELECT id FROM call_sessions WHERE person_key = 'arthurtest');
--   DELETE FROM call_attempts WHERE person_key = 'arthurtest';
--   DELETE FROM call_sessions WHERE person_key = 'arthurtest';
--   DELETE FROM users WHERE LOWER(email) = 'arthur.test@staff.makaug.internal' AND profile_data->>'sandbox' = 'true';
--   DROP VIEW IF EXISTS calling_sandbox_people;
--   DROP TABLE IF EXISTS calling_sandbox_backup_237;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS calling_sandbox_backup_237 AS
  SELECT NOW() AS backed_up_at, u.* FROM users u
   WHERE LOWER(u.email) = 'arthur.test@staff.makaug.internal' OR u.profile_data->>'person_key' = 'arthurtest';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = 'arthur.test@staff.makaug.internal')
     AND NOT EXISTS (SELECT 1 FROM users WHERE profile_data->>'person_key' = 'arthurtest')
     AND NOT EXISTS (SELECT 1 FROM users WHERE phone = '+256700002009') THEN
    INSERT INTO users (first_name, last_name, phone, email, role, password_hash, phone_verified, status,
                       marketing_opt_in, weekly_tips_opt_in, preferred_contact_channel, preferred_language, profile_data)
    VALUES ('Arthur', '(test)', '+256700002009', 'arthur.test@staff.makaug.internal', 'moderator',
            crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 12)), TRUE, 'active',
            FALSE, FALSE, 'email', 'en',
            jsonb_build_object('audience', 'moderator', 'account_kind', 'moderator', 'staff_dashboard_enabled', true,
                               'staff_code', 'TEST-01', 'employee_number', 'TEST-01',
                               'staff_scope', 'caller', 'person_key', 'arthurtest', 'sandbox', true,
                               'password_setup', 'pending', 'password_managed_by_admin', false,
                               'created_by', 'migration 237 (practice account for Arthur)'));
  END IF;
END $$;

-- Who is a practice caller: read by every team total to leave them out.
CREATE OR REPLACE VIEW calling_sandbox_people AS
  SELECT DISTINCT profile_data->>'person_key' AS person_key
    FROM users
   WHERE COALESCE(profile_data->>'sandbox', 'false') = 'true'
     AND COALESCE(profile_data->>'person_key', '') <> '';
