-- Paid = closed, and staff removal requests (Arthur, 21 Nov 2026).
--
-- 1. "Closed" means the money is in. The calling task "Get new agents" had a
--    "Closed / signed up" outcome counted as a close. It is now
--    "Interested – signed up, not paid yet": not a close, and it needs a next
--    step (collect the payment). Past calls with that outcome stop counting as
--    closes. Only "Paid now" and "Renewed / paid" are closes (the code also
--    enforces this).
-- 2. Staff can no longer remove or restore agents. They send a removal
--    request with a reason; only King removes.
--
-- Backups: call_tasks_243_backup (full rows) and call_attempts_close_243_backup
-- (id, is_close, outcome) for every call this changes.
-- Rollback: scripts/rollback-243-paid-is-closed.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS call_tasks_243_backup AS SELECT *, NOW() AS backed_up_at FROM call_tasks WHERE false;
INSERT INTO call_tasks_243_backup SELECT t.*, NOW() FROM call_tasks t
  WHERE NOT EXISTS (SELECT 1 FROM call_tasks_243_backup b WHERE b.key = t.key);

CREATE TABLE IF NOT EXISTS call_attempts_close_243_backup (
  id uuid PRIMARY KEY,
  is_close boolean,
  outcome text,
  backed_up_at timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO call_attempts_close_243_backup (id, is_close, outcome)
  SELECT id, is_close, outcome FROM call_attempts
   WHERE is_close AND COALESCE(outcome, '') NOT IN ('paid', 'renewed')
  ON CONFLICT (id) DO NOTHING;

UPDATE call_tasks t
   SET outcomes = (
     SELECT jsonb_agg(CASE WHEN o->>'key' = 'signed_up'
         THEN o || '{"label":"Interested – signed up, not paid yet","close":false,"terminal":false}'::jsonb
         WHEN COALESCE(o->>'key', '') NOT IN ('paid', 'renewed') AND (o->>'close')::boolean IS TRUE
         THEN o || '{"close":false}'::jsonb
         ELSE o END ORDER BY ord)
       FROM jsonb_array_elements(t.outcomes) WITH ORDINALITY AS e(o, ord)),
       updated_by = 'migration 243', updated_at = NOW()
 WHERE jsonb_typeof(t.outcomes) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.outcomes) o
                WHERE (o->>'key' = 'signed_up' AND ((o->>'close')::boolean IS TRUE OR o->>'label' <> 'Interested – signed up, not paid yet'))
                   OR (COALESCE(o->>'key', '') NOT IN ('paid', 'renewed') AND (o->>'close')::boolean IS TRUE));

UPDATE call_attempts SET is_close = false
 WHERE is_close AND COALESCE(outcome, '') NOT IN ('paid', 'renewed');

CREATE TABLE IF NOT EXISTS agent_removal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  agent_name text NOT NULL DEFAULT '',
  reason_code text NOT NULL,
  reason_label text NOT NULL DEFAULT '',
  note text NOT NULL,
  requested_by text NOT NULL DEFAULT '',
  requested_by_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_removal_requests_one_open
  ON agent_removal_requests (agent_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS agent_removal_requests_status_created
  ON agent_removal_requests (status, created_at DESC);
