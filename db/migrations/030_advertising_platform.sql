CREATE TABLE IF NOT EXISTS advertising_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  preferred_contact_channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (preferred_contact_channel IN ('whatsapp','email','phone')),
  product_interests JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_listing_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  budget_ugx BIGINT,
  desired_start_date DATE,
  desired_duration_days INTEGER,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','proposal_sent','won','lost','archived')),
  estimated_value_ugx BIGINT NOT NULL DEFAULT 0,
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advertising_inquiries_status_created
  ON advertising_inquiries(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_advertising_inquiries_email
  ON advertising_inquiries(email);

CREATE INDEX IF NOT EXISTS idx_advertising_inquiries_phone
  ON advertising_inquiries(phone);

DROP TRIGGER IF EXISTS advertising_inquiries_set_updated_at ON advertising_inquiries;
CREATE TRIGGER advertising_inquiries_set_updated_at
BEFORE UPDATE ON advertising_inquiries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS advertising_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES advertising_inquiries(id) ON DELETE SET NULL,
  advertiser_name TEXT NOT NULL,
  advertiser_email TEXT,
  advertiser_phone TEXT,
  campaign_name TEXT NOT NULL,
  package_key TEXT,
  package_label TEXT,
  placements JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_listing_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  creative_status TEXT NOT NULL DEFAULT 'brief_needed' CHECK (creative_status IN ('brief_needed','draft','review','approved','live_asset')),
  creative_brief TEXT,
  logo_url TEXT,
  creative_preview_url TEXT,
  ai_copy JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_model TEXT NOT NULL DEFAULT 'fixed_days' CHECK (pricing_model IN ('fixed_days','cpm','cpc','one_off','hybrid')),
  quoted_amount_ugx BIGINT NOT NULL DEFAULT 0,
  paid_amount_ugx BIGINT NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','invoiced','paid','refunded','waived')),
  payment_reference TEXT,
  payment_method TEXT,
  payment_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_payment','paid','live','paused','completed','cancelled')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  leads BIGINT NOT NULL DEFAULT 0,
  last_report_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_advertising_campaigns_status_dates
  ON advertising_campaigns(status, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_advertising_campaigns_inquiry
  ON advertising_campaigns(inquiry_id);

DROP TRIGGER IF EXISTS advertising_campaigns_set_updated_at ON advertising_campaigns;
CREATE TRIGGER advertising_campaigns_set_updated_at
BEFORE UPDATE ON advertising_campaigns
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS advertising_performance_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES advertising_campaigns(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  leads BIGINT NOT NULL DEFAULT 0,
  spend_ugx BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_advertising_performance_daily_date
  ON advertising_performance_daily(metric_date DESC);

DROP TRIGGER IF EXISTS advertising_performance_daily_set_updated_at ON advertising_performance_daily;
CREATE TRIGGER advertising_performance_daily_set_updated_at
BEFORE UPDATE ON advertising_performance_daily
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
