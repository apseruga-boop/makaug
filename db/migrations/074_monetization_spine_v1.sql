CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL,
  gateway TEXT NOT NULL DEFAULT 'flutterwave',
  gateway_txn_id TEXT,
  checkout_reference TEXT UNIQUE NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending',
  payer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payer_name TEXT,
  payer_email TEXT,
  payer_phone TEXT,
  checkout_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_purpose_status_created
  ON payments(purpose, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_gateway_txn
  ON payments(gateway, gateway_txn_id)
  WHERE gateway_txn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_payer_created
  ON payments(payer_id, created_at DESC)
  WHERE payer_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS products (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  billing TEXT NOT NULL DEFAULT 'one_off',
  active BOOLEAN NOT NULL DEFAULT false,
  feature_flag TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_type_active
  ON products(type, active, key);

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO products (
  key, type, name, description, price, currency, billing, active, feature_flag, metadata
) VALUES
  (
    'listing_boost_basic',
    'listing_boost',
    'Listing boost',
    'Prepared product for future paid listing boosts. Kept inactive until Arthur enables boosts.',
    50000,
    'UGX',
    'one_off',
    false,
    'MAKAUG_LISTING_BOOSTS_ENABLED',
    '{"duration_days":7,"boost_tier":"basic","launch_state":"prepared_not_live"}'::jsonb
  ),
  (
    'agent_pro_monthly',
    'agent_plan',
    'Agent Pro',
    'Prepared monthly plan for future agent subscriptions. Everyone remains Free by default.',
    150000,
    'UGX',
    'monthly',
    false,
    'MAKAUG_AGENT_PRO_ENABLED',
    '{"lead_allowance_monthly":0,"launch_state":"prepared_not_live"}'::jsonb
  ),
  (
    'featured_lender_monthly',
    'featured_lender',
    'Featured lender slot',
    'Prepared product for future mortgage/lender sponsored slots.',
    250000,
    'UGX',
    'monthly',
    false,
    'MAKAUG_FEATURED_LENDERS_ENABLED',
    '{"placement":"mortgage_finder","launch_state":"prepared_not_live"}'::jsonb
  )
ON CONFLICT (key) DO UPDATE SET
  type = EXCLUDED.type,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  billing = EXCLUDED.billing,
  feature_flag = EXCLUDED.feature_flag,
  metadata = products.metadata || EXCLUDED.metadata,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS account_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL REFERENCES products(key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive',
  expires_at TIMESTAMPTZ,
  quantity INTEGER NOT NULL DEFAULT 0,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_account_status
  ON account_entitlements(account_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_product
  ON account_entitlements(product_key, status);

DROP TRIGGER IF EXISTS trg_account_entitlements_updated_at ON account_entitlements;
CREATE TRIGGER trg_account_entitlements_updated_at
BEFORE UPDATE ON account_entitlements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boost_tier TEXT,
  ADD COLUMN IF NOT EXISTS development_id TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_featured_until
  ON properties(featured_until DESC)
  WHERE featured_until IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS verified_badge BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF to_regclass('public.agents') IS NOT NULL THEN
    ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS verified_badge BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rental_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  applicant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  applicant_name TEXT,
  applicant_email TEXT,
  applicant_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rental_applications_listing_status
  ON rental_applications(listing_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_rental_applications_updated_at ON rental_applications;
CREATE TRIGGER trg_rental_applications_updated_at
BEFORE UPDATE ON rental_applications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF to_regclass('public.field_agent_jobs') IS NOT NULL THEN
    ALTER TABLE field_agent_jobs
      ADD COLUMN IF NOT EXISTS fee NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS platform_margin NUMERIC(14,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS listing_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  listing_type TEXT,
  district TEXT,
  area TEXT,
  price NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'UGX',
  source TEXT NOT NULL DEFAULT 'current_listing_snapshot',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_price_history_listing_captured
  ON listing_price_history(listing_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_price_history_market
  ON listing_price_history(listing_type, district, area, captured_at DESC);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_ref TEXT,
  ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS charged BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_agent_month
  ON leads(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_billable_status
  ON leads(agent_id, billable, charged, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE OR REPLACE VIEW agent_monthly_lead_counters AS
SELECT
  agent_id,
  date_trunc('month', created_at)::date AS month_start,
  COUNT(*)::int AS lead_count,
  COUNT(*) FILTER (WHERE billable = true)::int AS billable_count,
  COUNT(*) FILTER (WHERE charged = true)::int AS charged_count,
  MAX(created_at) AS last_lead_at
FROM leads
WHERE agent_id IS NOT NULL
GROUP BY agent_id, date_trunc('month', created_at)::date;
