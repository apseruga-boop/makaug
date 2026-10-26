-- Pending WhatsApp alerts (website side only). Asked for by Arthur on
-- 26 Oct 2026 (area C).
--
-- The website matches new live listings to saved searches and device alerts
-- and writes at most one digest per person per Kampala day into
-- pending_whatsapp_alerts. Nothing in the website reads this table to send.
-- While WHATSAPP_ALERTS_ENABLED is off (the default) rows are written with
-- status 'preview', which no sender can claim. A WhatsApp sender built later
-- (outside this change) may claim only status 'pending'.
--
-- pending_whatsapp_alert_listings remembers every listing put in front of a
-- person, so the same listing is never alerted twice to the same person.
--
-- No existing row is changed, so the backup table stays empty; it exists to
-- keep the convention.
-- Rollback: scripts/rollback-187-pending-whatsapp-alerts.sql

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS data_change_187_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

CREATE TABLE IF NOT EXISTS pending_whatsapp_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('digest', 'consent_confirmation', 'welcome')),
  recipient_key TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id TEXT,
  phone TEXT NOT NULL,
  digest_date DATE NOT NULL,
  listing_ids UUID[] NOT NULL DEFAULT '{}',
  saved_search_ids UUID[] NOT NULL DEFAULT '{}',
  consent_event_id UUID REFERENCES marketing_consent_events(id) ON DELETE SET NULL,
  message_preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'pending', 'claimed', 'sent', 'failed', 'cancelled')),
  status_reason TEXT,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recipient_key, kind, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_pending_whatsapp_alerts_status
  ON pending_whatsapp_alerts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_whatsapp_alerts_created
  ON pending_whatsapp_alerts(created_at DESC);

CREATE TABLE IF NOT EXISTS pending_whatsapp_alert_listings (
  recipient_key TEXT NOT NULL,
  listing_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES pending_whatsapp_alerts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recipient_key, listing_id)
);
