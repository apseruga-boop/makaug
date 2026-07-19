CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS marketplace_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  secondary_categories TEXT[] NOT NULL DEFAULT '{}'::text[],
  description TEXT NOT NULL DEFAULT '',
  services_text TEXT,
  year_established SMALLINT,
  district TEXT NOT NULL,
  area TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  serves_regions TEXT[] NOT NULL DEFAULT '{}'::text[],
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  website TEXT,
  facebook TEXT,
  instagram TEXT,
  tiktok TEXT,
  linkedin TEXT,
  x TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  ursb_number TEXT,
  tier TEXT NOT NULL DEFAULT 'private',
  verified_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending_review',
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'private',
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  source_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  moderation_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tier IN ('verified', 'private', 'found_online')),
  CHECK (status IN ('pending_review', 'live', 'hidden', 'removed')),
  CHECK (source_type IN ('private', 'found_online', 'staff')),
  CHECK (source IN ('ursb', 'google_maps', 'mtn_directory', 'yellow_pages', 'ug_business_dir', 'linkedin', 'facebook', 'website', 'manual')),
  CHECK (year_established IS NULL OR year_established BETWEEN 1800 AND 2200),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_live_sort
  ON marketplace_businesses (status, tier, rating_avg DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_category_location
  ON marketplace_businesses (category, district, area)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_serves_regions
  ON marketplace_businesses USING GIN (serves_regions);

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_normalized_name_district
  ON marketplace_businesses (LOWER(name), district);

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_phone
  ON marketplace_businesses (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_search
  ON marketplace_businesses USING GIN (
    to_tsvector('simple',
      COALESCE(name, '') || ' ' ||
      COALESCE(description, '') || ' ' ||
      COALESCE(category, '') || ' ' ||
      COALESCE(district, '') || ' ' ||
      COALESCE(area, '')
    )
  );

DROP TRIGGER IF EXISTS trg_marketplace_businesses_updated_at ON marketplace_businesses;
CREATE TRIGGER trg_marketplace_businesses_updated_at
BEFORE UPDATE ON marketplace_businesses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES marketplace_businesses(id) ON DELETE CASCADE,
  reviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_name TEXT,
  rating INTEGER NOT NULL,
  review_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (rating BETWEEN 1 AND 5),
  CHECK (status IN ('pending_review', 'live', 'hidden', 'removed'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_business_status
  ON marketplace_reviews (business_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_marketplace_reviews_updated_at ON marketplace_reviews;
CREATE TRIGGER trg_marketplace_reviews_updated_at
BEFORE UPDATE ON marketplace_reviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES marketplace_businesses(id) ON DELETE SET NULL,
  requester_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  requester_name TEXT,
  requester_phone TEXT,
  requester_email TEXT,
  category TEXT,
  district TEXT,
  area TEXT,
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'marketplace',
  status TEXT NOT NULL DEFAULT 'new',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('new', 'in_progress', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_leads_status_created
  ON marketplace_leads (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_marketplace_leads_updated_at ON marketplace_leads;
CREATE TRIGGER trg_marketplace_leads_updated_at
BEFORE UPDATE ON marketplace_leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES marketplace_businesses(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  plan TEXT NOT NULL DEFAULT 'verified_annual',
  provider TEXT NOT NULL DEFAULT 'flutterwave',
  product_key TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  paid_until TIMESTAMPTZ,
  CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_payments_business_status
  ON marketplace_payments (business_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_marketplace_payments_updated_at ON marketplace_payments;
CREATE TRIGGER trg_marketplace_payments_updated_at
BEFORE UPDATE ON marketplace_payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES marketplace_businesses(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES marketplace_leads(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_type_created
  ON marketplace_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_business_created
  ON marketplace_events (business_id, created_at DESC)
  WHERE business_id IS NOT NULL;

COMMENT ON TABLE marketplace_businesses IS
  'Uganda property-services marketplace directory. Public visibility requires status=live.';

COMMENT ON TABLE marketplace_payments IS
  'Prepared marketplace payment linkage. Paid verification remains disabled until P3.';
