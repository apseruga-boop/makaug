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
ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS reason TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_properties_moderation_stage ON properties(moderation_stage);
CREATE INDEX IF NOT EXISTS idx_properties_owner_edit_token_hash ON properties(owner_edit_token_hash);
CREATE INDEX IF NOT EXISTS idx_properties_id_number ON properties(id_number);
CREATE INDEX IF NOT EXISTS idx_property_moderation_events_property_id ON property_moderation_events(property_id, created_at DESC);
