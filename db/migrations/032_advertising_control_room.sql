CREATE TABLE IF NOT EXISTS advertising_placements (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  page_key TEXT NOT NULL DEFAULT 'all',
  slot_type TEXT NOT NULL DEFAULT 'native',
  size_label TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  base_price_ugx BIGINT NOT NULL DEFAULT 0,
  preview_image_url TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS advertising_placements_set_updated_at ON advertising_placements;
CREATE TRIGGER advertising_placements_set_updated_at
BEFORE UPDATE ON advertising_placements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE advertising_campaigns
  ADD COLUMN IF NOT EXISTS advertiser_approval_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS report_cadence TEXT NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS target_pages JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE advertising_campaigns
  DROP CONSTRAINT IF EXISTS advertising_campaigns_advertiser_approval_status_check;

ALTER TABLE advertising_campaigns
  ADD CONSTRAINT advertising_campaigns_advertiser_approval_status_check
  CHECK (advertiser_approval_status IN ('draft','sent','approved','changes_requested','rejected'));

ALTER TABLE advertising_campaigns
  DROP CONSTRAINT IF EXISTS advertising_campaigns_report_cadence_check;

ALTER TABLE advertising_campaigns
  ADD CONSTRAINT advertising_campaigns_report_cadence_check
  CHECK (report_cadence IN ('none','daily','weekly','post_campaign','dashboard'));

INSERT INTO advertising_placements (
  key,
  label,
  page_key,
  slot_type,
  size_label,
  is_premium,
  base_price_ugx,
  preview_image_url,
  notes,
  sort_order
) VALUES
  ('sitewide_top_leaderboard','Sitewide Top Leaderboard','all','leaderboard','970x250 / responsive',true,650000,'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80','Premium banner across all main discovery pages.',10),
  ('homepage_hero_sponsor','Homepage Hero Sponsor','home','hero','Full-width hero sponsor',true,350000,'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80','High visibility homepage sponsor placement.',20),
  ('sale_inline_native','For Sale Inline Sponsored Card','sale','native_card','Listing grid card',false,180000,'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80','Native sponsored card in for-sale results.',30),
  ('rent_inline_native','Rental Inline Sponsored Card','rent','native_card','Listing grid card',false,180000,'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80','Native sponsored card in rental results.',40),
  ('students_leaderboard','Student Page Leaderboard','students','leaderboard','970x250 / responsive',true,220000,'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80','Student accommodation sponsor and university targeting.',50),
  ('commercial_leaderboard','Commercial Page Leaderboard','commercial','leaderboard','970x250 / responsive',true,240000,'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80','Business, office, retail, and commercial investor sponsor.',60),
  ('land_leaderboard','Land Page Leaderboard','land','leaderboard','970x250 / responsive',true,240000,'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80','Land buyers, surveyors, legal support, and developers.',70),
  ('brokers_spotlight','Broker Directory Spotlight','brokers','spotlight','Profile spotlight',false,160000,'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200&q=80','Featured broker or agency promotion.',80),
  ('property_detail_mpu','Property Detail MPU','property_detail','mpu','300x250 / responsive',false,120000,'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80','Contextual ad on property detail pages.',90),
  ('whatsapp_sponsored_match','WhatsApp Sponsored Match','whatsapp','chatbot_native','Assistant result card',true,200000,'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80','Sponsored result inside WhatsApp AI property/agent journeys.',100)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  page_key = EXCLUDED.page_key,
  slot_type = EXCLUDED.slot_type,
  size_label = EXCLUDED.size_label,
  is_premium = EXCLUDED.is_premium,
  base_price_ugx = EXCLUDED.base_price_ugx,
  preview_image_url = EXCLUDED.preview_image_url,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
