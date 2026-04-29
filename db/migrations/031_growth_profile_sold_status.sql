ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'properties'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE properties DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE properties
ADD CONSTRAINT properties_status_check
CHECK (status IN ('draft','pending','approved','rejected','hidden','deleted','archived','sold'));

CREATE INDEX IF NOT EXISTS idx_properties_sold_at ON properties(sold_at DESC);
