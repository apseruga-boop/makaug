-- Rollback for migration 250: the team's lessons and script suggestions (and
-- the approved team tips on the calling screen) are lost if you run this.
BEGIN;
DROP TABLE IF EXISTS team_learnings;
DELETE FROM schema_migrations WHERE filename = '250_team_learnings.sql';
COMMIT;
