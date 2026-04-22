ALTER TABLE properties
ADD COLUMN IF NOT EXISTS moderation_stage TEXT NOT NULL DEFAULT 'submitted',
ADD COLUMN IF NOT EXISTS moderation_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS moderation_notes TEXT,
ADD COLUMN IF NOT EXISTS moderation_reason TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by UUID,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS owner_edit_token_hash TEXT,
ADD COLUMN IF NOT EXISTS owner_edit_token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS owner_last_edited_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_moderation_notification_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS id_number TEXT,
ADD COLUMN IF NOT EXISTS id_document_name TEXT,
ADD COLUMN IF NOT EXISTS id_document_url TEXT;

UPDATE properties
SET moderation_stage = CASE
  WHEN status = 'approved' THEN 'approved'
  WHEN status = 'rejected' THEN 'rejected'
  WHEN status = 'hidden' THEN 'hidden'
  WHEN status = 'deleted' THEN 'deleted'
  ELSE COALESCE(NULLIF(moderation_stage, ''), 'submitted')
END
WHERE moderation_stage IS NULL
   OR moderation_stage = '';

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
CHECK (status IN ('draft','pending','approved','rejected','hidden','deleted','archived'));

CREATE TABLE IF NOT EXISTS property_moderation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  actor_id TEXT,
  action TEXT NOT NULL,
  status_from TEXT,
  status_to TEXT,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  notes TEXT,
  delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE property_moderation_events
ADD COLUMN IF NOT EXISTS actor_id TEXT,
ADD COLUMN IF NOT EXISTS action TEXT,
ADD COLUMN IF NOT EXISTS status_from TEXT,
ADD COLUMN IF NOT EXISTS status_to TEXT,
ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS reason TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE property_moderation_events
SET
  action = COALESCE(NULLIF(action, ''), 'moderation_event'),
  checklist = COALESCE(checklist, '{}'::jsonb),
  delivery = COALESCE(delivery, '{}'::jsonb),
  created_at = COALESCE(created_at, NOW());

ALTER TABLE property_moderation_events
ALTER COLUMN action SET NOT NULL,
ALTER COLUMN checklist SET NOT NULL,
ALTER COLUMN delivery SET NOT NULL,
ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_moderation_stage ON properties(moderation_stage);
CREATE INDEX IF NOT EXISTS idx_properties_owner_edit_token_hash ON properties(owner_edit_token_hash);
CREATE INDEX IF NOT EXISTS idx_properties_id_number ON properties(id_number);
CREATE INDEX IF NOT EXISTS idx_property_moderation_events_property_id ON property_moderation_events(property_id, created_at DESC);
