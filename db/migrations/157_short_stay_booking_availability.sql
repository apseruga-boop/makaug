-- Short-stay requests use the same reply loop as agent profile bookings.
-- Dates stay a check-in/check-out range. Callback and question requests
-- have no dates. Pricing columns are not touched.

ALTER TABLE st_listing
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available';

ALTER TABLE st_listing
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;

UPDATE st_listing
   SET last_confirmed_at = COALESCE(listed_at, updated_at, created_at, NOW())
 WHERE last_confirmed_at IS NULL
   AND LOWER(COALESCE(status, '')) = 'approved';

DO $$
BEGIN
  ALTER TABLE st_listing
    ADD CONSTRAINT st_listing_availability_status_check
    CHECK (availability_status IN ('available', 'under_offer', 'let_agreed', 'sold'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_st_listing_availability_confirmed
  ON st_listing (availability_status, last_confirmed_at);

ALTER TABLE st_booking_request
  ADD COLUMN IF NOT EXISTS intent TEXT NOT NULL DEFAULT 'dates';

ALTER TABLE st_booking_request
  ALTER COLUMN check_in DROP NOT NULL;

ALTER TABLE st_booking_request
  ALTER COLUMN check_out DROP NOT NULL;

ALTER TABLE st_booking_request DROP CONSTRAINT IF EXISTS st_booking_request_check;
ALTER TABLE st_booking_request DROP CONSTRAINT IF EXISTS st_booking_request_dates_check;

DO $$
BEGIN
  ALTER TABLE st_booking_request
    ADD CONSTRAINT st_booking_request_dates_check
    CHECK (
      (check_in IS NULL AND check_out IS NULL)
      OR (check_out > check_in)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE st_booking_request DROP CONSTRAINT IF EXISTS st_booking_request_status_check;

DO $$
BEGIN
  ALTER TABLE st_booking_request
    ADD CONSTRAINT st_booking_request_status_check
    CHECK (status IN (
      'requested', 'accepted', 'declined', 'expired', 'cancelled', 'completed',
      'reschedule', 'no_response', 'escalated'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE st_booking_request
    ADD CONSTRAINT st_booking_request_intent_check
    CHECK (intent IN ('dates', 'callback', 'question'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE st_booking_request
  ADD COLUMN IF NOT EXISTS reminder_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalate_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_check_in DATE,
  ADD COLUMN IF NOT EXISTS proposed_check_out DATE,
  ADD COLUMN IF NOT EXISTS visitor_reminder_24h_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visitor_reminder_2h_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

UPDATE st_booking_request
   SET reminder_due_at = COALESCE(reminder_due_at, created_at + INTERVAL '1 hour'),
       escalate_due_at = COALESCE(escalate_due_at, created_at + INTERVAL '2 hours')
 WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS st_availability_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, week_key)
);
