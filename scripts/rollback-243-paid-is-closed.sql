-- Rollback for migration 243 (paid = closed). Restores the calling task
-- outcome lists and the is_close flag on the calls it changed, from the
-- backups. The agent_removal_requests table is left in place (it only holds
-- requests); drop it by hand if the feature is withdrawn.
BEGIN;
UPDATE call_tasks t SET outcomes = b.outcomes, updated_by = b.updated_by, updated_at = b.updated_at
  FROM call_tasks_243_backup b WHERE b.key = t.key;
UPDATE call_attempts a SET is_close = b.is_close
  FROM call_attempts_close_243_backup b WHERE b.id = a.id;
COMMIT;
