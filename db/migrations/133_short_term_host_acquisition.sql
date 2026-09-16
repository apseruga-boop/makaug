-- 133_short_term_host_acquisition.sql
--
-- Provenance for how a short term listing arrived.
--
-- SAFETY: this ALTERs st_listing only - a table created by 132, owned entirely
-- by the short term feature and read by nothing else. Every column is
-- ADD COLUMN IF NOT EXISTS with a default, so applying it to a table that
-- already has rows is a metadata-only change. No pre-existing makaug table is
-- touched: not properties, not users, not agents.
--
-- 132 is already applied in production, which is why these columns arrive in
-- their own migration rather than being edited into it.
--
-- WHY THIS EXISTS: supply is the bottleneck, not code. Most Ugandan hosts will
-- not fill in a four step web form on a phone, on mobile data, for a site they
-- have not heard of. So the people building supply need to be able to sit with
-- a host and enter the place themselves - and the review pipeline needs to
-- know when that happened, because a listing typed by staff has not been
-- screened by an independent pair of eyes at the first gate.

ALTER TABLE st_listing
  -- website | staff_assisted | whatsapp | import | partner
  ADD COLUMN IF NOT EXISTS listed_via TEXT NOT NULL DEFAULT 'website',
  -- Which staff member typed it in, when it was staff-assisted. Surfaced in
  -- the King review sheet so the final gate can weigh who entered it.
  ADD COLUMN IF NOT EXISTS entered_by_staff_id TEXT,
  ADD COLUMN IF NOT EXISTS entered_by_staff_name TEXT,
  -- Who brought this host in. A WhatsApp share carrying ?ref=kunta lands here,
  -- so supply work becomes measurable instead of anecdotal.
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  -- Free text for the person who signed the host up: where they met, what the
  -- host is nervous about, when to call back.
  ADD COLUMN IF NOT EXISTS acquisition_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_st_listing_listed_via
  ON st_listing (listed_via, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_st_listing_referral
  ON st_listing (referral_code)
  WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_st_listing_entered_by
  ON st_listing (entered_by_staff_id)
  WHERE entered_by_staff_id IS NOT NULL;
