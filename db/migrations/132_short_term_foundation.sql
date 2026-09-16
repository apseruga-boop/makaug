-- 132_short_term_foundation.sql
--
-- Short Term stays foundation for makaug.
--
-- SAFETY CONTRACT FOR THIS MIGRATION:
--   * Additive only. Every statement is CREATE ... IF NOT EXISTS.
--   * No ALTER, no DROP, no TRUNCATE against any pre-existing table.
--   * The `properties`, `users`, `agents` and `property_images` tables are
--     NOT touched. Short term inventory lives in its own st_* namespace so a
--     rollback is "stop reading these tables", never a data migration.
--   * No foreign key points at `users`, because the tenant bootstrap path in
--     scripts/migrate.js treats that table as optional.
--
-- Business model encoded here:
--   makaug is a DISCOVERY platform. We publish the listing and the host's own
--   contact details. We never take a booking, never hold guest money, and never
--   sit in the middle of the conversation. That keeps makaug inside the
--   intermediary safe harbour in the Electronic Transactions Act 2011 and well
--   clear of needing a payment licence under the National Payment Systems Act
--   2020. The only money makaug takes is a flat listing fee (UGX 50,000 for a
--   3 month run), recorded in st_listing_payment.

-- ---------------------------------------------------------------------------
-- 1. The listing itself
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_listing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,

  title TEXT NOT NULL,
  description TEXT NOT NULL,

  district TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),

  place_type TEXT NOT NULL DEFAULT 'entire_place'
    CHECK (place_type IN ('entire_place','private_room','shared_room')),
  property_type TEXT,
  bedrooms INTEGER NOT NULL DEFAULT 1,
  beds INTEGER NOT NULL DEFAULT 1,
  bathrooms INTEGER NOT NULL DEFAULT 1,
  max_guests INTEGER NOT NULL DEFAULT 2,

  -- Nightly money. Stored in whole UGX, never floats.
  base_nightly_ugx BIGINT NOT NULL CHECK (base_nightly_ugx >= 0),
  cleaning_fee_ugx BIGINT NOT NULL DEFAULT 0 CHECK (cleaning_fee_ugx >= 0),
  security_deposit_ugx BIGINT NOT NULL DEFAULT 0 CHECK (security_deposit_ugx >= 0),
  weekly_discount_pct SMALLINT NOT NULL DEFAULT 0
    CHECK (weekly_discount_pct BETWEEN 0 AND 90),
  monthly_discount_pct SMALLINT NOT NULL DEFAULT 0
    CHECK (monthly_discount_pct BETWEEN 0 AND 90),

  min_nights INTEGER NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  max_nights INTEGER,
  check_in_from TEXT NOT NULL DEFAULT '14:00',
  check_out_by TEXT NOT NULL DEFAULT '10:00',

  -- The host's own contact details ARE the product on a discovery platform.
  host_name TEXT NOT NULL,
  host_phone TEXT NOT NULL,
  host_whatsapp TEXT,
  host_email TEXT,
  host_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (host_type IN ('owner','manager','agent')),
  -- Deliberately NOT a foreign key: `users` is optional on a fresh tenant.
  host_user_id UUID,

  -- Everything the host sets that a guest must agree to before arriving.
  house_rules TEXT,
  terms_text TEXT,
  cancellation_policy TEXT NOT NULL DEFAULT 'moderate'
    CHECK (cancellation_policy IN ('flexible','moderate','strict','no_refund')),

  -- Host declarations. These are the audit trail behind the public disclaimer.
  right_to_let_declared BOOLEAN NOT NULL DEFAULT FALSE,
  right_to_let_reference TEXT,
  local_hotel_tax_ack BOOLEAN NOT NULL DEFAULT FALSE,
  terms_accepted_at TIMESTAMPTZ,
  terms_accepted_ip TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','rejected','suspended','expired')),
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,

  -- Flat listing fee. UGX 50,000 buys a 3 month run.
  listing_fee_ugx BIGINT NOT NULL DEFAULT 50000,
  listing_fee_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (listing_fee_status IN ('unpaid','pending','paid','waived')),
  listing_term_months INTEGER NOT NULL DEFAULT 3,
  preferred_payment_method TEXT
    CHECK (preferred_payment_method IS NULL OR preferred_payment_method IN (
      'mtn_mobile_money','airtel_money','bank_transfer','cash','card','other'
    )),
  payout_note TEXT,
  listed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Where this row came from, and where a guest goes if it is a partner row.
  source TEXT NOT NULL DEFAULT 'direct'
    CHECK (source IN ('direct','partner','imported','whatsapp')),
  partner_name TEXT,
  external_booking_url TEXT,

  view_count INTEGER NOT NULL DEFAULT 0,
  enquiry_count INTEGER NOT NULL DEFAULT 0,

  extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_listing_status ON st_listing (status);
CREATE INDEX IF NOT EXISTS idx_st_listing_district ON st_listing (LOWER(district));
CREATE INDEX IF NOT EXISTS idx_st_listing_area ON st_listing (LOWER(area));
CREATE INDEX IF NOT EXISTS idx_st_listing_nightly ON st_listing (base_nightly_ugx);
CREATE INDEX IF NOT EXISTS idx_st_listing_expires ON st_listing (expires_at);
CREATE INDEX IF NOT EXISTS idx_st_listing_live
  ON st_listing (status, expires_at, base_nightly_ugx);
CREATE INDEX IF NOT EXISTS idx_st_listing_host_user ON st_listing (host_user_id);
CREATE INDEX IF NOT EXISTS idx_st_listing_geo ON st_listing (latitude, longitude);

-- ---------------------------------------------------------------------------
-- 2. Photos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_listing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- Object key inside the existing Cloudflare R2 bucket. New prefix only:
  -- short-term/<listing_id>/<file>. Nothing existing is read or rewritten.
  storage_key TEXT,
  caption TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_listing_media_listing
  ON st_listing_media (listing_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Amenities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_listing_amenity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  amenity_slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, amenity_slug)
);

CREATE INDEX IF NOT EXISTS idx_st_listing_amenity_slug
  ON st_listing_amenity (amenity_slug);

-- ---------------------------------------------------------------------------
-- 4. Availability the host publishes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'host'
    CHECK (source IN ('host','staff','ical','partner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_st_availability_listing
  ON st_availability (listing_id, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- 5. Seasonal / event pricing (AFCON 2027, Christmas, and so on)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_rate_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  nightly_ugx BIGINT NOT NULL CHECK (nightly_ugx >= 0),
  label TEXT,
  min_nights INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_st_rate_override_listing
  ON st_rate_override (listing_id, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- 6. Guest enquiries
--
-- NOTE ON SCHEMA SHAPE: there is deliberately no status, no replied_at and no
-- expires_at column here. makaug hands the enquiry to the host and steps out.
-- The moment the platform tracks whether a host replied, it has taken on a
-- duty to chase, and it stops being a discovery platform. Do not add those
-- columns without re-reading the liability position first.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_lead (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INTEGER,
  check_in DATE,
  check_out DATE,
  message TEXT,
  channel TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web','whatsapp','phone','email')),
  consent_share_with_host BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_lead_listing
  ON st_lead (listing_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Guest reviews and scores under privately listed places
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  -- Contact is hashed, never published. It exists to spot duplicate scoring.
  reviewer_contact_hash TEXT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  stayed_on DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','published','rejected')),
  moderation_note TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_review_listing
  ON st_review (listing_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. The flat listing fee
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_listing_payment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  amount_ugx BIGINT NOT NULL CHECK (amount_ugx >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  method TEXT NOT NULL DEFAULT 'mtn_mobile_money'
    CHECK (method IN ('mtn_mobile_money','airtel_money','bank_transfer','cash','card','other')),
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','pending','paid','failed','refunded','waived')),
  covers_from DATE,
  covers_to DATE,
  recorded_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_listing_payment_listing
  ON st_listing_payment (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_st_listing_payment_status
  ON st_listing_payment (status);

-- ---------------------------------------------------------------------------
-- 9. Reporting a listing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS st_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES st_listing(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  reporter_contact TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_report_listing ON st_report (listing_id);
CREATE INDEX IF NOT EXISTS idx_st_report_status ON st_report (status);

-- ---------------------------------------------------------------------------
-- 10. updated_at triggers, reusing set_updated_at() from 001_init.sql
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_st_listing_updated_at ON st_listing;
CREATE TRIGGER trg_st_listing_updated_at
BEFORE UPDATE ON st_listing
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_st_review_updated_at ON st_review;
CREATE TRIGGER trg_st_review_updated_at
BEFORE UPDATE ON st_review
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_st_listing_payment_updated_at ON st_listing_payment;
CREATE TRIGGER trg_st_listing_payment_updated_at
BEFORE UPDATE ON st_listing_payment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_st_report_updated_at ON st_report;
CREATE TRIGGER trg_st_report_updated_at
BEFORE UPDATE ON st_report
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 11. Human readable reference numbers (ST-000001, ST-000002, ...)
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS st_listing_reference_seq START WITH 1 INCREMENT BY 1;
