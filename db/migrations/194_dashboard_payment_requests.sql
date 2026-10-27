-- Dashboard receipt retries must never extend a subscription twice, including cash.
SET LOCAL lock_timeout = '8s';
CREATE TABLE IF NOT EXISTS dashboard_payment_requests (
  request_id UUID PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  entry_id UUID NOT NULL REFERENCES revenue_entries(id),
  result JSONB NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
