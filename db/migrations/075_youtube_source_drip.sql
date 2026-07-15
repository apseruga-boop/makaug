ALTER TABLE source_drip_state
  DROP CONSTRAINT IF EXISTS source_drip_platform_check;

ALTER TABLE source_drip_state
  ADD CONSTRAINT source_drip_platform_check CHECK (platform IN ('x','youtube'));

ALTER TABLE source_drip_state
  DROP CONSTRAINT IF EXISTS source_drip_batch_size_check;

ALTER TABLE source_drip_state
  ADD CONSTRAINT source_drip_batch_size_check CHECK (batch_size BETWEEN 1 AND 25);
