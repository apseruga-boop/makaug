CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  objective TEXT,
  message_template TEXT NOT NULL,
  target_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE marketing_campaigns
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN IF NOT EXISTS objective TEXT,
ADD COLUMN IF NOT EXISTS message_template TEXT,
ADD COLUMN IF NOT EXISTS target_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS created_by TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE marketing_campaigns
SET
  channel = COALESCE(NULLIF(channel, ''), 'whatsapp'),
  target_filter = COALESCE(target_filter, '{}'::jsonb),
  status = COALESCE(NULLIF(status, ''), 'draft'),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW());

UPDATE marketing_campaigns
SET channel = 'whatsapp'
WHERE channel NOT IN ('whatsapp','sms','email');

UPDATE marketing_campaigns
SET status = CASE
  WHEN status IN ('live','active','published') THEN 'queued'
  WHEN status IN ('complete','completed','delivered') THEN 'sent'
  WHEN status IN ('stopped','paused') THEN 'cancelled'
  ELSE 'draft'
END
WHERE status NOT IN ('draft','queued','sending','sent','cancelled');

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'marketing_campaigns'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE marketing_campaigns
ADD CONSTRAINT marketing_campaigns_status_check
CHECK (status IN ('draft','queued','sending','sent','cancelled'));

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'marketing_campaigns'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE marketing_campaigns
ADD CONSTRAINT marketing_campaigns_channel_check
CHECK (channel IN ('whatsapp','sms','email'));

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_updated_at ON marketing_campaigns(updated_at DESC);
