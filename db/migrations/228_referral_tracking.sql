-- Referral tracking (16 Nov 2026)
--
-- Arthur, via Marketing: record ?ref=<code> on any page (first touch, about
-- 30 days) and save it when someone lists a property or signs up as an
-- agent or owner. Admin can count sign-ups and listings by ref, and add
-- staff codes (ronald, sharon, arthur to start; more later, e.g. harriet).
-- Unknown codes are still recorded. A ref is supporting first-touch evidence
-- for staff commission only; it never bypasses the #787 guards and a ref
-- alone never makes someone eligible.
--
-- Additive only. New table plus three nullable columns. Nothing existing is
-- changed or backfilled.
--
-- Rollback:
--   ALTER TABLE properties DROP COLUMN IF EXISTS referral_code;
--   ALTER TABLE agents DROP COLUMN IF EXISTS referral_code;
--   ALTER TABLE users DROP COLUMN IF EXISTS referral_code;
--   DROP TABLE IF EXISTS referral_codes;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  -- Optional staff / recruit key (ronald, sharon, harriet, ...).
  person_key TEXT,
  label TEXT NOT NULL,
  -- staff = a named person, campaign = a marketing code, system = reserved
  -- (e.g. owner-share). System codes are counted but never used for
  -- commission attribution.
  kind TEXT NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff', 'campaign', 'system')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO referral_codes (code, person_key, label, kind, created_by) VALUES
  ('ronald', 'ronald', 'Ronald', 'staff', 'Arthur, 16 Nov 2026'),
  ('sharon', 'sharon', 'Sharon', 'staff', 'Arthur, 16 Nov 2026'),
  ('arthur', 'arthur', 'Arthur', 'staff', 'Arthur, 16 Nov 2026'),
  ('owner-share', NULL, 'Owner WhatsApp share', 'system', 'Arthur, 16 Nov 2026')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_referral_code
  ON properties (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_referral_code
  ON agents (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_referral_code
  ON users (referral_code) WHERE referral_code IS NOT NULL;
