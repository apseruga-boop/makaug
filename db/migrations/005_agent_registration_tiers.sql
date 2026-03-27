ALTER TABLE agents
ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'registered'
CHECK (registration_status IN ('registered','not_registered'));

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS listing_limit INTEGER NOT NULL DEFAULT 20;

UPDATE agents
SET listing_limit = CASE
  WHEN registration_status = 'not_registered' THEN 5
  ELSE 20
END
WHERE listing_limit IS NULL OR listing_limit <= 0;

