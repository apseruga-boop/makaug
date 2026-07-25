ALTER TABLE advertising_placements
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS cta_label TEXT,
  ADD COLUMN IF NOT EXISTS cta_url TEXT,
  ADD COLUMN IF NOT EXISTS background_position TEXT,
  ADD COLUMN IF NOT EXISTS copy_side TEXT;

UPDATE advertising_placements
SET copy_side = 'right'
WHERE copy_side IS NULL OR copy_side NOT IN ('left', 'right');

ALTER TABLE advertising_placements
  ALTER COLUMN copy_side SET DEFAULT 'right';

ALTER TABLE advertising_placements
  DROP CONSTRAINT IF EXISTS advertising_placements_copy_side_check;

ALTER TABLE advertising_placements
  ADD CONSTRAINT advertising_placements_copy_side_check
  CHECK (copy_side IN ('left', 'right'));

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
  headline,
  cta_label,
  cta_url,
  background_position,
  copy_side,
  notes,
  sort_order
) VALUES
  ('home-featured','Homepage Featured Properties Band','home','house_band','Full width x 200px',true,true,350000,'/assets/house-ads-v3/home-hero.webp','Home starts here.','Advertise here','/advertise','left center','right','House Ads v3 band after homepage featured properties.',10),
  ('home-brokers','Homepage Featured Agents Band','home','house_band','Full width x 200px',true,true,300000,'/assets/house-ads-v3/agents.webp','The right hands for your keys.','Advertise here','/advertise','left center','right','House Ads v3 band after homepage featured agents.',20),
  ('sale-grid','For Sale Results Band','sale','house_band','Full width x 200px',false,true,180000,'/assets/house-ads-v3/sale.webp','Say hello to yours.','Advertise here','/advertise','center 30%','right','House Ads v3 band after for-sale results.',30),
  ('rent-grid','Rental Results Band','rent','house_band','Full width x 200px',false,true,180000,'/assets/house-ads-v3/rent.webp','Move in Monday.','Advertise here','/advertise','left center','right','House Ads v3 band after rental results.',40),
  ('student-grid','Student Accommodation Results Band','students','house_band','Full width x 200px',true,true,220000,'/assets/house-ads-v3/students.webp','Your campus. Your room.','Advertise here','/advertise','left 25%','right','House Ads v3 band after student accommodation results.',50),
  ('commercial-grid','Commercial Results Band','commercial','house_band','Full width x 200px',true,true,240000,'/assets/house-ads-v3/commercial.webp','Open for business.','Advertise here','/advertise','right center','left','House Ads v3 mirrored band after commercial results.',60),
  ('land-grid','Land Results Band','land','house_band','Full width x 200px',true,true,240000,'/assets/house-ads-v3/land.webp','Own the hill.','Advertise here','/advertise','center 40%','right','House Ads v3 band after land results.',70),
  ('marketplace-results','Marketplace Results Band','marketplace','house_band','Full width x 200px',false,true,180000,'/assets/house-ads-v3/marketplace.webp','Built by people who care.','Advertise here','/advertise','left center','right','House Ads v3 band after marketplace results.',80),
  ('brokers-grid','Broker Directory Band','brokers','house_band','Full width x 200px',false,true,160000,'/assets/house-ads-v3/brokers.webp','Walk in with an expert.','Advertise here','/advertise','20% center','right','House Ads v3 band after broker directory results.',90),
  ('mortgage-results','Mortgage Results Band','mortgage','house_band','Full width x 200px',true,true,220000,'/assets/house-ads-v3/mortgage.webp','Closer than you think.','Advertise here','/advertise','25% 30%','right','House Ads v3 band after mortgage results.',100),
  ('property-detail','Property Detail Band','property_detail','house_band','Full width x 200px',false,true,120000,'/assets/house-ads-v3/detail.webp','Open the door.','Advertise here','/advertise','left center','right','House Ads v3 band after property detail content.',110)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  page_key = EXCLUDED.page_key,
  slot_type = EXCLUDED.slot_type,
  size_label = EXCLUDED.size_label,
  is_premium = EXCLUDED.is_premium,
  is_active = EXCLUDED.is_active,
  base_price_ugx = EXCLUDED.base_price_ugx,
  preview_image_url = EXCLUDED.preview_image_url,
  headline = EXCLUDED.headline,
  cta_label = EXCLUDED.cta_label,
  cta_url = EXCLUDED.cta_url,
  background_position = EXCLUDED.background_position,
  copy_side = EXCLUDED.copy_side,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
