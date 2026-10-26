-- WhatsApp marketing consent records and a separate email_verified flag.
-- Asked for by Arthur on 26 Oct 2026 (areas B and E), including his 06:45 UK
-- steering on the users who already agreed in person.
--
-- 1. marketing_consent_events: one row per consent decision. It records the
--    channel (whatsapp), the purpose ('marketing' = new property alerts and
--    offers; 'search_alerts' = only the alerts for one saved search), whether
--    consent was given, the source, the wording version and wording shown,
--    who recorded it (staff user for an in-person tick) and when the person
--    agreed (consented_at). A device without an account is recorded by its
--    device id and the phone it gave.
-- 2. users gains marketing_consent_at, marketing_consent_source and
--    marketing_consent_wording_version, the current marketing consent in one
--    place, and email_verified. An email code now proves the email only; it
--    no longer marks the phone verified. Nobody's phone_verified changes here,
--    so nobody is locked out.
-- 3. The users who already said yes in person keep marketing_opt_in = TRUE.
--    On 26 Oct 2026 there were 20 (10 buyer_renter, 7 agent_broker,
--    2 field_agent, 1 admin). Their consent is recorded as source 'in_person',
--    wording version 'in_person_pre_2026_10_26'. None has a consent date
--    stored anywhere, so the date used is their account creation time
--    (users.created_at). No date is invented. Only accounts created before
--    the steering decision (26 Oct 2026 06:45 UTC) are backfilled: an account
--    opted in by the old default after that is not counted as in person.
--    marketing_opt_in itself is not changed for anyone.
-- 4. The column defaults for marketing_opt_in and weekly_tips_opt_in become
--    FALSE (they were TRUE), so no new account is opted in by default.
--
-- Backup before any write: data_change_186_backup holds each backfilled
-- user's consent columns as they were (row_kind 'user_consent').
-- Rollback: scripts/rollback-186-whatsapp-consent-records-and-email-verified.sql

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS data_change_186_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_consent_wording_version TEXT;

-- New accounts start with NO marketing consent, whichever code path creates
-- them. Existing rows keep their values.
ALTER TABLE users ALTER COLUMN marketing_opt_in SET DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN weekly_tips_opt_in SET DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS marketing_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id TEXT,
  phone TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  purpose TEXT NOT NULL CHECK (purpose IN ('marketing', 'search_alerts')),
  granted BOOLEAN NOT NULL,
  source TEXT NOT NULL CHECK (source IN (
    'signup_checkbox', 'search_alert_button', 'in_person', 'staff_in_person',
    'account_settings', 'whatsapp_stop', 'staff_withdrawn'
  )),
  wording_version TEXT NOT NULL,
  wording_text TEXT,
  saved_search_id UUID REFERENCES saved_searches(id) ON DELETE SET NULL,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_marketing_consent_events_user
  ON marketing_consent_events(user_id, consented_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_consent_events_device
  ON marketing_consent_events(device_id, consented_at DESC) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_consent_events_search
  ON marketing_consent_events(saved_search_id) WHERE saved_search_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_consent_events_created
  ON marketing_consent_events(created_at DESC);

DO $migration_186$
DECLARE
  u RECORD;
  n INTEGER := 0;
  cutoff CONSTANT TIMESTAMPTZ := '2026-10-26 06:45:00+00';
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_186 backfill skipped: app.country_code is not UG';
    RETURN;
  END IF;

  FOR u IN
    SELECT id, created_at, marketing_opt_in, marketing_consent_at, marketing_consent_source,
           marketing_consent_wording_version
    FROM users
    WHERE marketing_opt_in = TRUE
      AND marketing_consent_at IS NULL
      AND created_at < cutoff
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    INSERT INTO data_change_186_backup (row_kind, row_key, before_row)
    VALUES ('user_consent', u.id::text, jsonb_build_object(
      'marketing_opt_in', u.marketing_opt_in,
      'marketing_consent_at', u.marketing_consent_at,
      'marketing_consent_source', u.marketing_consent_source,
      'marketing_consent_wording_version', u.marketing_consent_wording_version
    ))
    ON CONFLICT (row_kind, row_key) DO NOTHING;

    UPDATE users
    SET marketing_consent_at = u.created_at,
        marketing_consent_source = 'in_person',
        marketing_consent_wording_version = 'in_person_pre_2026_10_26'
    WHERE id = u.id;

    INSERT INTO marketing_consent_events (
      user_id, channel, purpose, granted, source, wording_version, wording_text, consented_at
    )
    SELECT u.id, 'whatsapp', 'marketing', TRUE, 'in_person', 'in_person_pre_2026_10_26',
           'Agreed in person before 26 Oct 2026 (date is the account creation time; no separate consent date was stored).',
           u.created_at
    WHERE NOT EXISTS (
      SELECT 1 FROM marketing_consent_events e
      WHERE e.user_id = u.id AND e.source = 'in_person' AND e.wording_version = 'in_person_pre_2026_10_26'
    );
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'migration_186: % in-person consents recorded', n;
END
$migration_186$;
