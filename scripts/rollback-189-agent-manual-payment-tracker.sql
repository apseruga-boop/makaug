-- Manual rollback for db/migrations/189_agent_manual_payment_tracker.sql.
-- Not in db/migrations, so scripts/migrate.js does not run it. Run inside one
-- transaction (psql --single-transaction). Deploy the previous code first:
-- the agent manager reads these columns.
-- Values staff typed are archived into data_change_189_backup before the
-- columns go, so nothing typed is lost.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS data_change_189_backup (
  agent_id UUID PRIMARY KEY,
  plan_started_on DATE,
  last_payment_on DATE,
  last_payment_ugx INTEGER,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO data_change_189_backup (agent_id, plan_started_on, last_payment_on, last_payment_ugx)
SELECT id, plan_started_on, last_payment_on, last_payment_ugx
  FROM agents
 WHERE plan_started_on IS NOT NULL OR last_payment_on IS NOT NULL OR last_payment_ugx IS NOT NULL
ON CONFLICT (agent_id) DO NOTHING;

ALTER TABLE agents DROP COLUMN IF EXISTS plan_started_on;
ALTER TABLE agents DROP COLUMN IF EXISTS last_payment_on;
ALTER TABLE agents DROP COLUMN IF EXISTS last_payment_ugx;

DELETE FROM schema_migrations WHERE filename = '189_agent_manual_payment_tracker.sql';
