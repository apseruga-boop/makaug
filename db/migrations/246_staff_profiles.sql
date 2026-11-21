-- Staff profile (Arthur, 21 Nov 2026): photo, ID details and an emergency
-- contact for each staff login. The ID number is private: staff see it masked
-- after saving, only King's APIs return it in full. New table only.
-- Rollback: scripts/rollback-246-staff-profiles.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id uuid PRIMARY KEY,
  person_key text NOT NULL DEFAULT '',
  photo_data text NOT NULL DEFAULT '' CHECK (length(photo_data) <= 120000),
  id_type text NOT NULL DEFAULT '' CHECK (id_type IN ('', 'national_id', 'passport', 'driving_permit', 'refugee_id')),
  id_number text NOT NULL DEFAULT '',
  id_expiry date,
  home_area text NOT NULL DEFAULT '',
  emergency_name text NOT NULL DEFAULT '',
  emergency_phone text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_profiles_person ON staff_profiles (person_key);
