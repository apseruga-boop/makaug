-- Report / claim pipeline v2: structured request metadata and action audit fields.
ALTER TABLE report_listings
  ADD COLUMN IF NOT EXISTS request_type TEXT,
  ADD COLUMN IF NOT EXISTS request_source TEXT,
  ADD COLUMN IF NOT EXISTS structured_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_property_id UUID,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS actioned_by TEXT,
  ADD COLUMN IF NOT EXISTS actioned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_report_listings_status_created
  ON report_listings (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_listings_request_type_created
  ON report_listings (request_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_listings_linked_property
  ON report_listings (linked_property_id)
  WHERE linked_property_id IS NOT NULL;
