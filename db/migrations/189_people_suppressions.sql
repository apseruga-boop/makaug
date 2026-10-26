-- People list clean-up: delete with suppression, 26 Oct 2026.
--
-- Arthur (26 Oct 2026 09:56 UK) wants to delete junk and unnamed contacts
-- from the People list and keep them out. The People list is derived (see
-- 188): people_reconcile() rebuilds it from the source tables every 15
-- minutes and nightly, so a plain DELETE FROM people would come back on the
-- next run. This migration adds a suppression list:
--
--   1. people_suppressions: one row per deleted person, keyed by the same
--      person_key the list uses (p:+256… or e:email) plus the phone and the
--      email it had. snapshot holds what the Deleted view shows (name,
--      roles, sources, dates, counts, first query snippet), so staff can see
--      who was removed without reading a source table. restored_at /
--      restored_by mark a restore; a restored row is kept as history.
--   2. people_skip_suppressed(): a BEFORE INSERT trigger on people. When the
--      reconcile tries to add a person who is not already in the list and an
--      active suppression matches their key, phone or email, the row is
--      skipped (RETURN NULL). Rows already in the list are never touched by
--      it, and people_links only links rows that exist in people, so a
--      suppressed person gets no links either.
--   3. Backup: data_change_189_backup holds a manifest of people (count and
--      an md5 of the ordered ids) taken before this runs (UG only). This
--      migration writes no people row and no source row; the manifest lets
--      the rollback prove that.
--
-- No source row (users, contacts, leads, WhatsApp tables, seeker profiles,
-- saved searches) is written, here or by the delete endpoint.
--
-- Rollback: scripts/rollback-189-people-suppressions.sql (manual).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS people_suppressions (
  id BIGSERIAL PRIMARY KEY,
  person_key TEXT NOT NULL,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('phone', 'email')),
  phone_e164 TEXT,
  email TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL DEFAULT 'staff_delete',
  deleted_by UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_by UUID,
  restored_at TIMESTAMPTZ
);

-- One active suppression per key; restored rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_suppressions_active_key
  ON people_suppressions (person_key) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_people_suppressions_active_phone
  ON people_suppressions (phone_e164) WHERE restored_at IS NULL AND phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_suppressions_active_email
  ON people_suppressions (email) WHERE restored_at IS NULL AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_suppressions_deleted_at
  ON people_suppressions (deleted_at DESC);

CREATE OR REPLACE FUNCTION people_skip_suppressed() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- An existing row is an update path (ON CONFLICT); leave it alone.
  IF EXISTS (SELECT 1 FROM people p WHERE p.person_key = NEW.person_key) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM people_suppressions s
    WHERE s.restored_at IS NULL
      AND (
        s.person_key = NEW.person_key
        OR (NEW.phone_e164 IS NOT NULL AND s.phone_e164 = NEW.phone_e164)
        -- An email-keyed person has no usable phone: match on email.
        OR (NEW.key_kind = 'email' AND NEW.email IS NOT NULL AND s.email = NEW.email)
        -- A person deleted while known only by email who later shows up
        -- with a phone and the same email stays deleted.
        OR (s.phone_e164 IS NULL AND NEW.email IS NOT NULL AND s.email = NEW.email)
      )
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_people_skip_suppressed ON people;
CREATE TRIGGER trg_people_skip_suppressed
  BEFORE INSERT ON people
  FOR EACH ROW EXECUTE FUNCTION people_skip_suppressed();

CREATE TABLE IF NOT EXISTS data_change_189_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

DO $migration_189$
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_189 backup skipped: app.country_code is not UG (table and trigger are created)';
    RETURN;
  END IF;
  INSERT INTO data_change_189_backup (row_kind, row_key, before_row)
  SELECT 'people_manifest', 'people',
         jsonb_build_object('rows', count(*), 'id_md5', md5(COALESCE(string_agg(id::text, ',' ORDER BY id), '')))
  FROM people
  ON CONFLICT (row_kind, row_key) DO NOTHING;
END
$migration_189$;
