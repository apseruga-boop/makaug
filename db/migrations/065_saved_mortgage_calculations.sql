CREATE TABLE IF NOT EXISTS mortgage_calculations (
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
  source TEXT,
  language TEXT,
  source_note TEXT,
  public_record_disclosure TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mortgage_calculations_user_created
  ON mortgage_calculations(user_id, created_at DESC);
