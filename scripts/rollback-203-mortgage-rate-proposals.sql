-- Manual rollback for db/migrations/203_mortgage_rate_proposals.sql.
-- Run only on request: psql "$DATABASE_URL" -f scripts/rollback-203-mortgage-rate-proposals.sql
-- Migration 203 changed no existing rows; this drops the two new tables (and
-- every staff approval in them), so GET /api/mortgage-rates falls back to the
-- coded rates in routes/mortgage.js. The schema_migrations row is removed so
-- the migration can be re-applied later.
BEGIN;
DROP TABLE IF EXISTS mortgage_rate_proposals;
DROP TABLE IF EXISTS mortgage_rate_source_snapshots;
DROP TABLE IF EXISTS data_change_203_backup;
DELETE FROM schema_migrations WHERE filename = '203_mortgage_rate_proposals.sql';
COMMIT;
