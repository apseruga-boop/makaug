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

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS latitude NUMERIC,
ADD COLUMN IF NOT EXISTS longitude NUMERIC,
ADD COLUMN IF NOT EXISTS students_welcome BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verification_terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS inquiry_reference TEXT,
ADD COLUMN IF NOT EXISTS id_number TEXT,
ADD COLUMN IF NOT EXISTS id_document_name TEXT,
ADD COLUMN IF NOT EXISTS new_until TIMESTAMPTZ;

UPDATE properties
SET new_until = COALESCE(new_until, created_at + INTERVAL '5 days')
WHERE new_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_properties_students_welcome ON properties(students_welcome);
CREATE INDEX IF NOT EXISTS idx_properties_new_until ON properties(new_until DESC);
CREATE INDEX IF NOT EXISTS idx_properties_lat_lng ON properties(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_properties_inquiry_reference ON properties(inquiry_reference);
