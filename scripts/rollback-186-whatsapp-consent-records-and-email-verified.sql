-- Manual rollback for db/migrations/186_whatsapp_consent_records_and_email_verified.sql.
-- Not in db/migrations, so scripts/migrate.js does not run it. Run inside one
-- transaction (psql --single-transaction) with SET app.country_code = 'UG'.
--
-- Deploy the previous code first. The previous code treats an email code as
-- phone verification, so before this rollback, any account that is only
-- email-verified (email_verified = TRUE, phone_verified = FALSE) would be
-- locked out by the old login gate. Step 1 lists them; step 2 gives them
-- phone_verified = TRUE (the old behaviour) so nobody is locked out, and
-- records that in the backup table first.
--
-- marketing_opt_in is never changed by the migration or this rollback.
-- Consent events are archived into data_change_186_backup (row_kind
-- 'consent_event') before the table is dropped.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback_186$
DECLARE
  b RECORD;
  n INTEGER;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_186 skipped: app.country_code is not UG';
    RETURN;
  END IF;
  IF to_regclass('public.data_change_186_backup') IS NULL THEN
    RAISE NOTICE 'rollback_186 skipped: backup table missing';
    RETURN;
  END IF;

  INSERT INTO data_change_186_backup (row_kind, row_key, before_row)
  SELECT 'email_only_user', id::text, jsonb_build_object('phone_verified', phone_verified, 'email_verified', email_verified)
  FROM users WHERE email_verified = TRUE AND phone_verified = FALSE
  ON CONFLICT (row_kind, row_key) DO NOTHING;
  UPDATE users SET phone_verified = TRUE WHERE email_verified = TRUE AND phone_verified = FALSE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'rollback_186: % email-only accounts given phone_verified (old behaviour)', n;

  IF to_regclass('public.marketing_consent_events') IS NOT NULL THEN
    INSERT INTO data_change_186_backup (row_kind, row_key, before_row)
    SELECT 'consent_event', e.id::text, to_jsonb(e) FROM marketing_consent_events e
    ON CONFLICT (row_kind, row_key) DO NOTHING;
  END IF;

  UPDATE data_change_186_backup SET restored_at = NOW()
  WHERE row_kind IN ('user_consent', 'email_only_user') AND restored_at IS NULL;
END
$rollback_186$;

DROP TABLE IF EXISTS marketing_consent_events;
ALTER TABLE users ALTER COLUMN marketing_opt_in SET DEFAULT TRUE;
ALTER TABLE users ALTER COLUMN weekly_tips_opt_in SET DEFAULT TRUE;
ALTER TABLE users
  DROP COLUMN IF EXISTS email_verified,
  DROP COLUMN IF EXISTS marketing_consent_at,
  DROP COLUMN IF EXISTS marketing_consent_source,
  DROP COLUMN IF EXISTS marketing_consent_wording_version;
