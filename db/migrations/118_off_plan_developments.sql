CREATE TABLE IF NOT EXISTS off_plan_developments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code VARCHAR(2) NOT NULL DEFAULT 'UG',
  slug VARCHAR(180) NOT NULL,
  name VARCHAR(220) NOT NULL,
  developer_name VARCHAR(220),
  source_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  source_display_name VARCHAR(220),
  status VARCHAR(40) NOT NULL DEFAULT 'pending_review',
  verification_status VARCHAR(40) NOT NULL DEFAULT 'needs_verification',
  description TEXT NOT NULL DEFAULT '',
  area VARCHAR(140),
  district VARCHAR(140),
  address TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  project_type VARCHAR(80) NOT NULL DEFAULT 'development',
  completion_date DATE,
  construction_started_at DATE,
  construction_progress NUMERIC(5, 2),
  units_total INTEGER,
  units_sold INTEGER,
  units_available INTEGER,
  launch_price_ugx BIGINT,
  original_currency VARCHAR(3) NOT NULL DEFAULT 'UGX',
  reservation_fee_ugx BIGINT,
  discount_percentage NUMERIC(5, 2),
  payment_plan_months INTEGER,
  unit_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  videos JSONB NOT NULL DEFAULT '[]'::jsonb,
  floor_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  nearby_places JSONB NOT NULL DEFAULT '[]'::jsonb,
  brochure_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  walkthrough_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, slug),
  CONSTRAINT off_plan_development_status_check CHECK (status IN ('draft', 'pending_review', 'changes_requested', 'published', 'archived', 'rejected')),
  CONSTRAINT off_plan_development_verification_check CHECK (verification_status IN ('needs_verification', 'partially_verified', 'verified')),
  CONSTRAINT off_plan_construction_progress_check CHECK (construction_progress IS NULL OR (construction_progress >= 0 AND construction_progress <= 100)),
  CONSTRAINT off_plan_units_check CHECK (
    (units_total IS NULL OR units_total >= 0)
    AND (units_sold IS NULL OR units_sold >= 0)
    AND (units_available IS NULL OR units_available >= 0)
    AND (units_total IS NULL OR units_sold IS NULL OR units_sold <= units_total)
  )
);

CREATE INDEX IF NOT EXISTS idx_off_plan_public_search
  ON off_plan_developments (country_code, status, district, area, completion_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_off_plan_slug
  ON off_plan_developments (country_code, slug);

CREATE TABLE IF NOT EXISTS off_plan_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id UUID REFERENCES off_plan_developments(id) ON DELETE SET NULL,
  enquiry_type VARCHAR(40) NOT NULL DEFAULT 'project_interest',
  preferred_contact_channel VARCHAR(20) NOT NULL,
  name VARCHAR(180) NOT NULL,
  phone VARCHAR(80),
  email VARCHAR(260),
  requested_callback_at TIMESTAMPTZ,
  message TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  source_path TEXT,
  external_key VARCHAR(220),
  notification_delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_key),
  CONSTRAINT off_plan_enquiry_channel_check CHECK (preferred_contact_channel IN ('whatsapp', 'email', 'call')),
  CONSTRAINT off_plan_enquiry_status_check CHECK (status IN ('new', 'contacted', 'qualified', 'closed', 'spam'))
);

CREATE INDEX IF NOT EXISTS idx_off_plan_enquiries_queue
  ON off_plan_enquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS off_plan_walkthrough_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id UUID NOT NULL REFERENCES off_plan_developments(id) ON DELETE CASCADE,
  floor_plan_url TEXT NOT NULL,
  output_video_url TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'brief_ready',
  render_engine VARCHAR(80) NOT NULL DEFAULT 'external_3d_pipeline',
  camera_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT off_plan_walkthrough_status_check CHECK (status IN ('brief_ready', 'render_requested', 'draft_ready', 'approved', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_off_plan_walkthrough_project
  ON off_plan_walkthrough_jobs (development_id, created_at DESC);

CREATE TABLE IF NOT EXISTS off_plan_development_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id UUID REFERENCES off_plan_developments(id) ON DELETE CASCADE,
  enquiry_id UUID REFERENCES off_plan_enquiries(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(80),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_off_plan_events_development
  ON off_plan_development_events (development_id, created_at DESC);

INSERT INTO off_plan_developments (
  country_code,
  slug,
  name,
  source_display_name,
  status,
  verification_status,
  description,
  area,
  district,
  project_type,
  original_currency,
  discount_percentage,
  payment_plan_months,
  unit_types,
  payment_plan,
  images,
  videos,
  floor_plans,
  amenities,
  nearby_places,
  brochure_settings,
  walkthrough_settings,
  extra_fields
) VALUES (
  'UG',
  'entebbe-victoria-palms',
  'Entebbe Victoria Palms',
  'Mackenzie',
  'pending_review',
  'needs_verification',
  'Townhouse development information supplied to makaug for staff verification. Public description, developer identity, exact map pin, completion date, construction percentage and availability remain to be confirmed before publication.',
  'Entebbe',
  'Wakiso',
  'townhouse development',
  'USD',
  40,
  15,
  '[
    {"key":"2-bedroom-townhouse","label":"2 Bedroom townhouse","bedrooms":2,"property_type":"Townhouse","price_original":108000,"price_original_currency":"USD","price_ugx":null,"bathrooms":null,"size_sqm":null},
    {"key":"3-bedroom-townhouse","label":"3 Bedroom townhouse","bedrooms":3,"property_type":"Townhouse","price_original":144000,"price_original_currency":"USD","price_ugx":null,"bathrooms":null,"size_sqm":null},
    {"key":"4-bedroom-townhouse","label":"4 Bedroom townhouse","bedrooms":4,"property_type":"Townhouse","price_original":177000,"price_original_currency":"USD","price_ugx":null,"bathrooms":null,"size_sqm":null}
  ]'::jsonb,
  '[
    {"key":"reservation","label":"Reserve a unit","kind":"fixed","amount_original":1500,"currency":"USD","due":"At reservation","verified":false},
    {"key":"balance","label":"Balance","kind":"equal_monthly","months":15,"due":"Monthly after reservation","verified":false}
  ]'::jsonb,
  '[
    {"url":"/assets/off-plan/entebbe-victoria-palms/construction-interior-1.jpg","caption":"Construction progress photo supplied to makaug","kind":"construction_photo"},
    {"url":"/assets/off-plan/entebbe-victoria-palms/construction-interior-2.jpg","caption":"Construction progress photo supplied to makaug","kind":"construction_photo"},
    {"url":"/assets/off-plan/entebbe-victoria-palms/bedroom-render.jpg","caption":"Artist impression supplied to makaug - final finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/entebbe-victoria-palms/residents-lounge-render.jpg","caption":"Artist impression supplied to makaug - final facilities may differ","kind":"artist_impression"}
  ]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '{"brand":"makaug.com","footer_url":"https://makaug.com/off-plan/entebbe-victoria-palms"}'::jsonb,
  '{"status":"not_started","floor_plan_required":true,"output_requires_staff_approval":true}'::jsonb,
  '{
    "source":"user_supplied_2026_09_03",
    "source_note":"Forwarded project pricing and four supplied images. All facts require staff verification before publication.",
    "offer_note":"Supplied message says prices are a limited investor offer with a 40 percent discount, payable in 15 months, and a USD 1,500 reservation fee.",
    "price_ugx_required_before_publish":true,
    "developer_identity_required_before_publish":true,
    "completion_and_sales_progress_required_before_publish":true,
    "source_profile_link_pending":true
  }'::jsonb
)
ON CONFLICT (country_code, slug) DO NOTHING;
