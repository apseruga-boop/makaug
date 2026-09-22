-- Extra report data: traffic sources, busiest day, peak time, rank, new listings.
ALTER TABLE agent_weekly_reports ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'::jsonb;
