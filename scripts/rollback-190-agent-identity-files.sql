-- Manual rollback for db/migrations/190_agent_identity_files.sql.
-- Not in db/migrations, so scripts/migrate.js does not run it. Run inside one
-- transaction (psql --single-transaction). Deploy the previous code first:
-- the agent manager reads this table.
-- The ID files are NOT dropped: the table is renamed to an archive name so
-- every uploaded document is kept. Drop it only on a deliberate super_admin
-- decision.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS agent_identity_files_one_live_side;
DROP INDEX IF EXISTS agent_identity_files_agent_idx;
ALTER TABLE IF EXISTS agent_identity_files RENAME TO data_change_190_agent_identity_files_archive;

DELETE FROM schema_migrations WHERE filename = '190_agent_identity_files.sql';
