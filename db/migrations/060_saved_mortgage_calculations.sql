CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS saved_mortgage_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_price NUMERIC,
  deposit_percent NUMERIC,
  loan_amount NUMERIC,
  annual_rate NUMERIC,
  term_years INTEGER,
  monthly_repayment NUMERIC,
  household_income NUMERIC,
  currency TEXT NOT NULL DEFAULT 'UGX',
  product_type TEXT,
  preferred_provider_key TEXT,
  preferred_provider_name TEXT,
  extra_monthly_payment NUMERIC,
  estimated_interest_saved NUMERIC,
  estimated_months_saved INTEGER,
  source TEXT NOT NULL DEFAULT 'mortgage_calculator',
  language TEXT NOT NULL DEFAULT 'en',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_mortgage_calculations_user_updated
  ON saved_mortgage_calculations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_mortgage_calculations_provider
  ON saved_mortgage_calculations(preferred_provider_key, created_at DESC)
  WHERE preferred_provider_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_saved_mortgage_calculations_updated_at ON saved_mortgage_calculations;
CREATE TRIGGER trg_saved_mortgage_calculations_updated_at
BEFORE UPDATE ON saved_mortgage_calculations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
