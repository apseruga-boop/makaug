-- Device saves and one saved-properties table. Asked for by Arthur on
-- 26 Oct 2026 (save journey fix, area A).
--
-- 1. saved_properties can hold a save made without an account: user_id
--    becomes nullable and a device_id column holds the anonymous first-party
--    device id (cookie mk_did). Every row still needs one of the two
--    (CHECK saved_properties_owner_present). A device keeps one row per
--    listing while it has no user (partial unique index). The existing
--    (user_id, property_id) unique index is unchanged, so account saves work
--    exactly as before.
-- 2. saved_properties gains list_name, note, status and source, so it can
--    carry everything the duplicate saved_listings table carried.
-- 3. Every saved_listings row is copied into saved_properties (source
--    'saved_listings_185'). A row that already exists for the same user and
--    listing keeps its saved_properties copy and only takes the note and
--    list name when it had none. saved_listings itself is NOT dropped and
--    NOT changed; the code stops reading and writing it. On 26 Oct 2026 both
--    tables had 0 rows in production.
-- 4. saved_searches gets indexes for device alerts (guest_session_id holds
--    the device id) and an alert_scope column so an "alert me" request is
--    recorded as consent for those alerts only.
--
-- Backup before any write: data_change_185_backup holds every saved_listings
-- row and every saved_properties row it touched, as they were.
-- Rollback: scripts/rollback-185-device-saves-and-merge-saved-listings.sql

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS data_change_185_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

ALTER TABLE saved_properties ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE saved_properties
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS list_name TEXT NOT NULL DEFAULT 'Saved',
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'saved',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web';

DO $constraint_185$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_properties_owner_present') THEN
    ALTER TABLE saved_properties
      ADD CONSTRAINT saved_properties_owner_present CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_properties_device_id_shape') THEN
    ALTER TABLE saved_properties
      ADD CONSTRAINT saved_properties_device_id_shape CHECK (device_id IS NULL OR device_id ~ '^[A-Za-z0-9_-]{20,64}$');
  END IF;
END
$constraint_185$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_properties_device_property_anon
  ON saved_properties(device_id, property_id)
  WHERE user_id IS NULL AND device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_properties_device_created
  ON saved_properties(device_id, created_at DESC)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_properties_created
  ON saved_properties(created_at DESC);

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS alert_scope TEXT NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_saved_searches_guest_session
  ON saved_searches(guest_session_id, created_at DESC)
  WHERE guest_session_id IS NOT NULL;

DO $migration_185$
DECLARE
  sl RECORD;
  existing RECORD;
  n_copied INTEGER := 0;
  n_merged INTEGER := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_185 data copy skipped: app.country_code is not UG';
    RETURN;
  END IF;
  IF to_regclass('public.saved_listings') IS NULL THEN
    RAISE NOTICE 'migration_185 data copy skipped: saved_listings does not exist';
    RETURN;
  END IF;

  FOR sl IN SELECT * FROM saved_listings ORDER BY created_at ASC LOOP
    INSERT INTO data_change_185_backup (row_kind, row_key, before_row)
    VALUES ('saved_listing', sl.id::text, to_jsonb(sl))
    ON CONFLICT (row_kind, row_key) DO NOTHING;

    SELECT * INTO existing FROM saved_properties
    WHERE user_id = sl.user_id AND property_id = sl.listing_id
    FOR UPDATE;

    IF FOUND THEN
      INSERT INTO data_change_185_backup (row_kind, row_key, before_row)
      VALUES ('saved_property', existing.id::text, to_jsonb(existing))
      ON CONFLICT (row_kind, row_key) DO NOTHING;
      UPDATE saved_properties
      SET note = COALESCE(note, sl.note),
          list_name = CASE WHEN list_name = 'Saved' THEN COALESCE(NULLIF(sl.list_name, ''), list_name) ELSE list_name END
      WHERE id = existing.id;
      n_merged := n_merged + 1;
    ELSE
      INSERT INTO saved_properties (user_id, property_id, list_name, note, status, source, created_at, updated_at)
      VALUES (sl.user_id, sl.listing_id, COALESCE(NULLIF(sl.list_name, ''), 'Saved'), sl.note,
              COALESCE(NULLIF(sl.status, ''), 'saved'), 'saved_listings_185', sl.created_at, sl.updated_at);
      n_copied := n_copied + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'migration_185: % saved_listings rows copied, % merged into existing saves', n_copied, n_merged;
END
$migration_185$;
