ALTER TABLE source_drip_state
  DROP CONSTRAINT IF EXISTS source_drip_batch_size_check;

ALTER TABLE source_drip_state
  ADD CONSTRAINT source_drip_batch_size_check CHECK (batch_size BETWEEN 1 AND 25);

ALTER TABLE source_drip_state
  ADD COLUMN IF NOT EXISTS monthly_read_cap INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS monthly_read_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_window_started_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW());

ALTER TABLE source_drip_run_logs
  ADD COLUMN IF NOT EXISTS api_read_count INTEGER NOT NULL DEFAULT 0;

UPDATE source_drip_state
SET search_mode = CASE WHEN search_mode = 'all' THEN 'recent' ELSE search_mode END,
    base_interval_minutes = CASE WHEN base_interval_minutes = 15 THEN 2 ELSE base_interval_minutes END,
    current_interval_minutes = CASE WHEN current_interval_minutes = 15 THEN 2 ELSE current_interval_minutes END,
    monthly_read_cap = COALESCE(monthly_read_cap, 10000),
    monthly_read_count = COALESCE(monthly_read_count, 0),
    monthly_window_started_at = COALESCE(monthly_window_started_at, date_trunc('month', NOW())),
    updated_at = NOW()
WHERE drip_key = 'x_source_drip';

UPDATE source_drip_state
SET batch_size = CASE
      WHEN search_mode = 'all' THEN LEAST(batch_size, 5)
      WHEN batch_size <= 5 THEN 20
      ELSE LEAST(batch_size, 25)
    END,
    updated_at = NOW()
WHERE drip_key = 'x_source_drip';
