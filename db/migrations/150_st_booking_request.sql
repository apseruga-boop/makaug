-- 150_st_booking_request.sql
--
-- A closed request loop for short stays. makaug introduces the guest and the
-- host and records whether the host accepted the dates. makaug does not take
-- a payment, hold a deposit, or sit in the money.
--
-- SAFETY: new st_* tables only, plus ADD COLUMN IF NOT EXISTS on st_review,
-- which 132 created for this feature. No pre-existing makaug table is touched.

CREATE TABLE IF NOT EXISTS st_booking_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INTEGER,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','declined','expired','cancelled','completed')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expiry_notified_at TIMESTAMPTZ,
  review_requested_at TIMESTAMPTZ,
  staff_wa_link TEXT,
  decided_via TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS idx_st_booking_request_listing
  ON st_booking_request (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_st_booking_request_status
  ON st_booking_request (status, expires_at);

CREATE TABLE IF NOT EXISTS st_ical_subscription (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  last_fetched_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, url)
);

ALTER TABLE st_review
  ADD COLUMN IF NOT EXISTS booking_request_id UUID,
  ADD COLUMN IF NOT EXISTS verified_stay BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_st_review_booking
  ON st_review (booking_request_id);
