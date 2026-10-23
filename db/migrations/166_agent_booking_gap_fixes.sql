-- Agent booking and short-stay reply gaps.
-- Short public references, the number a request was actually sent to,
-- and when staff were last alerted. Stay listings can be paused or fully booked.

ALTER TABLE agent_booking_requests
  ADD COLUMN IF NOT EXISTS public_ref TEXT,
  ADD COLUMN IF NOT EXISTS sent_to_phone TEXT,
  ADD COLUMN IF NOT EXISTS staff_alerted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_booking_requests_public_ref
  ON agent_booking_requests (public_ref)
  WHERE public_ref IS NOT NULL;

ALTER TABLE st_booking_request
  ADD COLUMN IF NOT EXISTS sent_to_phone TEXT,
  ADD COLUMN IF NOT EXISTS staff_alerted_at TIMESTAMPTZ;

ALTER TABLE st_listing DROP CONSTRAINT IF EXISTS st_listing_availability_status_check;

ALTER TABLE st_listing
  ADD CONSTRAINT st_listing_availability_status_check
  CHECK (availability_status IN (
    'available', 'under_offer', 'let_agreed', 'sold', 'paused', 'fully_booked'
  ));
