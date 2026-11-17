-- The Companion's list can be uploaded as a CSV (King > Staff Performance >
-- Today's numbers). Keep what the person posted and where the number came
-- from, plus the row's place in the file so upload order is kept.
-- All nullable: pasted numbers leave them empty.
--
-- Rollback:
--   ALTER TABLE outreach_list_numbers DROP COLUMN IF EXISTS what_they_posted,
--     DROP COLUMN IF EXISTS list_source, DROP COLUMN IF EXISTS list_order;
--   DELETE FROM schema_migrations WHERE filename = '239_outreach_list_csv_fields.sql';
ALTER TABLE outreach_list_numbers ADD COLUMN IF NOT EXISTS what_they_posted TEXT;
ALTER TABLE outreach_list_numbers ADD COLUMN IF NOT EXISTS list_source TEXT;
ALTER TABLE outreach_list_numbers ADD COLUMN IF NOT EXISTS list_order INTEGER;
