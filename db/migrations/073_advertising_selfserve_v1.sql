ALTER TABLE advertising_placements
  ADD COLUMN IF NOT EXISTS weekly_impressions BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS baseline_weekly_impressions BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS traffic_multiplier NUMERIC(8,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS self_serve_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_assisted_booking BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_methods JSONB NOT NULL DEFAULT '["paypal","mobile_money","card"]'::jsonb;

INSERT INTO advertising_placements (
  key,
  label,
  page_key,
  slot_type,
  size_label,
  is_premium,
  is_active,
  base_price_ugx,
  preview_image_url,
  notes,
  sort_order,
  weekly_impressions,
  baseline_weekly_impressions,
  traffic_multiplier,
  self_serve_enabled,
  requires_assisted_booking,
  payment_methods
) VALUES
  (
    'homepage_hero_banner',
    'Homepage hero banner',
    'home',
    'hero',
    '1440x420 / 390x220 mobile',
    true,
    true,
    350000,
    'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
    'Phase 1 self-serve homepage hero placement. Price is weekly floor; quote uses daily floor x duration x traffic multiplier.',
    10,
    52000,
    36000,
    1.44,
    true,
    false,
    '["paypal","mobile_money","card"]'::jsonb
  ),
  (
    'sponsored_search_result',
    'Sponsored search result',
    'search',
    'native_card',
    '720x540 / native listing card',
    false,
    true,
    180000,
    'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
    'Phase 1 self-serve native sponsored result across category searches.',
    20,
    41000,
    30000,
    1.37,
    true,
    false,
    '["paypal","mobile_money","card"]'::jsonb
  ),
  (
    'feature_my_listing',
    'Feature my listing',
    'category',
    'featured_listing',
    '720x540 / featured listing tile',
    false,
    true,
    75000,
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
    'Phase 1 self-serve boost for an approved listing in its category.',
    30,
    18000,
    16000,
    1.13,
    true,
    false,
    '["paypal","mobile_money","card"]'::jsonb
  )
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  page_key = EXCLUDED.page_key,
  slot_type = EXCLUDED.slot_type,
  size_label = EXCLUDED.size_label,
  is_premium = EXCLUDED.is_premium,
  is_active = EXCLUDED.is_active,
  base_price_ugx = EXCLUDED.base_price_ugx,
  preview_image_url = EXCLUDED.preview_image_url,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  weekly_impressions = EXCLUDED.weekly_impressions,
  baseline_weekly_impressions = EXCLUDED.baseline_weekly_impressions,
  traffic_multiplier = EXCLUDED.traffic_multiplier,
  self_serve_enabled = EXCLUDED.self_serve_enabled,
  requires_assisted_booking = EXCLUDED.requires_assisted_booking,
  payment_methods = EXCLUDED.payment_methods,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_advertising_placements_selfserve
  ON advertising_placements(self_serve_enabled, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_advertising_campaigns_selfserve_queue
  ON advertising_campaigns(status, payment_status, creative_status, advertiser_approval_status, created_at DESC);
