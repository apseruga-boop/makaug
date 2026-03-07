CREATE TABLE IF NOT EXISTS mortgage_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL,
  residential_rate NUMERIC(6,3),
  commercial_rate NUMERIC(6,3),
  land_rate NUMERIC(6,3),
  min_deposit_residential NUMERIC(6,3) NOT NULL DEFAULT 20,
  min_deposit_commercial NUMERIC(6,3) NOT NULL DEFAULT 20,
  min_deposit_land NUMERIC(6,3) NOT NULL DEFAULT 20,
  max_years_residential INTEGER NOT NULL DEFAULT 20,
  max_years_commercial INTEGER NOT NULL DEFAULT 20,
  max_years_land INTEGER NOT NULL DEFAULT 20,
  arrangement_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 1.5,
  source_label TEXT,
  source_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_mortgage_providers_updated_at ON mortgage_providers;
CREATE TRIGGER trg_mortgage_providers_updated_at
BEFORE UPDATE ON mortgage_providers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_mortgage_providers_active ON mortgage_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_mortgage_providers_key ON mortgage_providers(provider_key);
