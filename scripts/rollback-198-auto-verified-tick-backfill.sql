-- Rollback for db/migrations/198_auto_verified_tick_backfill.sql.
-- Restores verification_reason and contact_phone_verified_at for the agents
-- the backfill ticked. Keeps the backup table for the record.
BEGIN;
UPDATE agents a
SET verification_reason = b.verification_reason,
    contact_phone_verified_at = b.contact_phone_verified_at,
    updated_at = NOW()
FROM migration_198_verified_tick_backup b
WHERE b.agent_id = a.id;
INSERT INTO audit_logs (actor_id, action, details)
SELECT 'rollback_198', 'agent_verified_tick_backfill_rolled_back', jsonb_build_object('agent_id', b.agent_id)
FROM migration_198_verified_tick_backup b;
COMMIT;
