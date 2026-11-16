-- Calling screen: permanent "do not contact" and incoming calls.
--
-- call_blocks: one row per phone_key that must never be called again, from a
--   "Do not contact" outcome or skip. Every queue and source (callbacks, own
--   numbers, the Companion's list, leads, listings, Outreach, manual adds)
--   checks it. Only King can lift a block (removed_at/removed_by kept).
-- call_attempts.direction: 'outbound' (we rang) or 'inbound' (they rang us,
--   answered on the laptop through Phone Link and logged with "Incoming call").
--
-- Rollback:
--   ALTER TABLE call_attempts DROP COLUMN IF EXISTS direction;
--   DROP TABLE IF EXISTS call_blocks;
CREATE TABLE IF NOT EXISTS call_blocks (
  phone_key TEXT PRIMARY KEY,
  reason TEXT,
  blocked_by TEXT NOT NULL,
  attempt_id UUID,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by TEXT,
  removed_note TEXT
);
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';
