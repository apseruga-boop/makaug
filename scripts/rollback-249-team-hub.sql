-- Rollback for migration 249: King's team messages, read marks, the Rules,
-- T&Cs and Working hours text and the how-to video links are lost if you run this.
BEGIN;
DROP TABLE IF EXISTS team_message_reads;
DROP TABLE IF EXISTS team_messages;
DROP TABLE IF EXISTS team_pages;
DROP TABLE IF EXISTS team_videos;
DELETE FROM schema_migrations WHERE filename = '249_team_hub.sql';
COMMIT;
