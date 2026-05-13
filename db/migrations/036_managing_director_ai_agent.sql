INSERT INTO ai_agents (code, name, description, enabled, run_mode, config)
VALUES (
  'managing_director_ceo',
  'MakaUg Managing Director',
  'Monitors launch-critical operations: broker approvals, listing review backlog, failed notifications, leads, advertising revenue, and provider readiness.',
  TRUE,
  'recommend',
  '{"maxFindings":25,"reviewBacklogHigh":20,"failedNotificationHigh":5}'::jsonb
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  enabled = TRUE,
  run_mode = EXCLUDED.run_mode,
  config = ai_agents.config || EXCLUDED.config,
  updated_at = NOW();
