-- 153_valuation_price_hints.sql
--
-- Local "tell us a price you have seen" notes from the property-value page.
-- A hint is not a formal valuation and not a payment.
--
-- Additive only. No existing table is altered.
-- The table is created here, not on the request path.
--
-- gen_random_uuid() ships with pgcrypto on Postgres before 13 and in core
-- afterwards. Numbered migrations that default a UUID column to it enable
-- pgcrypto first (see 001_init.sql and 081_marketplace.sql) so the function
-- is available before the table is created.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'gen_random_uuid() is not available; pgcrypto is required before valuation_price_hints';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS valuation_price_hints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  district TEXT,
  bedrooms INTEGER,
  price NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valuation_price_hints_category_check
    CHECK (category IN ('sale', 'rent', 'land', 'commercial', 'student')),
  CONSTRAINT valuation_price_hints_price_check
    CHECK (price > 0),
  CONSTRAINT valuation_price_hints_bedrooms_check
    CHECK (bedrooms IS NULL OR (bedrooms >= 0 AND bedrooms <= 20))
);

CREATE INDEX IF NOT EXISTS idx_valuation_price_hints_location_time
  ON valuation_price_hints (location, created_at DESC);
