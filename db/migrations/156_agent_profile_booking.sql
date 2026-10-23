-- Agent profile booking (Option 2).
-- Listing availability the public can see, per-agent default viewing hours,
-- and the tracked reply loop for a profile request. Existing viewing_bookings
-- rows stay as they are; a viewing from the profile also inserts one.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;

UPDATE properties
   SET last_confirmed_at = COALESCE(approved_at, updated_at, created_at, NOW())
 WHERE last_confirmed_at IS NULL
   AND LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

DO $$
BEGIN
  ALTER TABLE properties
    ADD CONSTRAINT properties_availability_status_check
    CHECK (availability_status IN ('available', 'under_offer', 'let_agreed', 'sold'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_properties_availability_confirmed
  ON properties (availability_status, last_confirmed_at);

CREATE TABLE IF NOT EXISTS agent_viewing_defaults (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  available_days JSONB NOT NULL DEFAULT '["mon","tue","wed","thu","fri","sat"]'::jsonb,
  available_time_windows JSONB NOT NULL DEFAULT '[{"start":"09:00","end":"12:00"},{"start":"14:00","end":"17:00"}]'::jsonb,
  notice_period_hours INTEGER NOT NULL DEFAULT 24,
  blocked_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_bookings_per_slot INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_agent_viewing_defaults_updated_at ON agent_viewing_defaults;
CREATE TRIGGER trg_agent_viewing_defaults_updated_at
BEFORE UPDATE ON agent_viewing_defaults
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS agent_booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  viewing_booking_id UUID REFERENCES viewing_bookings(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  visitor_name TEXT NOT NULL,
  visitor_phone TEXT NOT NULL,
  visitor_message TEXT,
  preferred_date DATE,
  preferred_time TEXT,
  callback_window TEXT,
  contact_channel TEXT,
  offer_amount TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  proposed_date DATE,
  proposed_time TEXT,
  reminded_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  no_response_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  visitor_reminder_24h_at TIMESTAMPTZ,
  visitor_reminder_2h_at TIMESTAMPTZ,
  outcome_asked_at TIMESTAMPTZ,
  outcome TEXT,
  reminder_due_at TIMESTAMPTZ,
  escalate_due_at TIMESTAMPTZ,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_booking_requests_intent_check
    CHECK (intent IN ('viewing', 'callback', 'question', 'offer')),
  CONSTRAINT agent_booking_requests_status_check
    CHECK (status IN ('pending', 'confirmed', 'reschedule', 'declined', 'no_response', 'escalated', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_agent_booking_requests_status_due
  ON agent_booking_requests (status, escalate_due_at, reminder_due_at);

CREATE INDEX IF NOT EXISTS idx_agent_booking_requests_agent
  ON agent_booking_requests (agent_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_agent_booking_requests_updated_at ON agent_booking_requests;
CREATE TRIGGER trg_agent_booking_requests_updated_at
BEFORE UPDATE ON agent_booking_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS agent_booking_staff_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES agent_booking_requests(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_booking_staff_flags_open
  ON agent_booking_staff_flags (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS listing_availability_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, week_key)
);
