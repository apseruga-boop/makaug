-- Add area-centre auto-pins for approved listings that still have no pin,
-- using catalogue points cached from free OpenStreetMap Nominatim lookups
-- on 10 Nov 2026 (see utils/ugandaAreaCentroids.js). No paid geocoding,
-- and no runtime geocoding.
--
-- Migration 211 took makaug.com down on 10 Nov 2026 by updating many
-- property rows in one startup transaction. This file only creates the
-- backup table. The listing updates run after the process is already
-- serving, in batches of 20, from
-- scripts/run-auto-pin-missing-area-centres-217.js (hooked from
-- scheduleStartupDataRepairs). Re-running this file is a no-op.
--
-- A production read on 10 Nov 2026 found 221 approved listings with no
-- stored pin. 24 of them match a verified area centre (including
-- MK-20261110-66D71E Mayangayanga, MK-20261109-3DB7E7 Akright City,
-- and two title-only pins: MK-20261004-4D2362 Kololo and
-- MK-20260922-6F5C3B Busabala). District-only rows, and rows whose title names a different
-- place from the stored area, are left alone.
--
-- Backup: auto_pin_217_backup.
-- Rollback: scripts/rollback-217-auto-pin-missing-area-centres.sql.
-- Nothing is deleted. updated_at is not changed, so the listings do not
-- jump to "recently updated".
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS auto_pin_217_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  old_latitude numeric,
  old_longitude numeric,
  new_latitude numeric NOT NULL,
  new_longitude numeric NOT NULL,
  old_area text,
  old_district text,
  extra_fields jsonb,
  updated_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);
