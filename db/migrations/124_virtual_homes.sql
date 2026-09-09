-- Maka Virtual Homes: additive, review-first production workflow.
-- No record is public until an authorised King/admin publishes it explicitly.

CREATE TABLE IF NOT EXISTS virtual_home_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(220) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  source_kind VARCHAR(40) NOT NULL DEFAULT 'standalone_customer',
  off_plan_development_id UUID REFERENCES off_plan_developments(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  unit_type_key VARCHAR(180),
  client_name VARCHAR(220),
  company_name VARCHAR(220),
  country_code VARCHAR(2) NOT NULL DEFAULT 'UG',
  location TEXT,
  property_category VARCHAR(100),
  bedrooms INTEGER,
  bathrooms NUMERIC(5, 2),
  floors INTEGER,
  floor_area_sqm NUMERIC(12, 2),
  ceiling_height_m NUMERIC(6, 3),
  specification_notes TEXT,
  finish_notes TEXT,
  furniture_preference VARCHAR(80),
  customer_notes TEXT,
  internal_notes TEXT,
  requested_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  commercial_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  error_code VARCHAR(60),
  error_message TEXT,
  accuracy_level VARCHAR(40) NOT NULL DEFAULT 'CONCEPT_VISUALISATION',
  accuracy_disclosure TEXT NOT NULL DEFAULT 'Concept visualisation. Dimensions, finishes and furnishings require approval before reliance.',
  property_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  property_model_version INTEGER NOT NULL DEFAULT 0,
  scene_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  viewer_settings JSONB NOT NULL DEFAULT '{"default_mode":"dollhouse","default_furniture":"furnished","default_environment":"day","lite_fallback":true}'::jsonb,
  public_slug VARCHAR(180) UNIQUE,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  plan_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  plan_approved_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT virtual_home_source_kind_check CHECK (source_kind IN ('off_plan_development','existing_property','standalone_customer')),
  CONSTRAINT virtual_home_status_check CHECK (status IN ('DRAFT','INPUT_RECEIVED','PREPROCESSING','PLAN_PARSED','NEEDS_REVIEW','PLAN_APPROVED','SCENE_BUILDING','SCENE_READY','QA','APPROVED','PUBLISHED','DELIVERED','ARCHIVED','INPUT_UNREADABLE','SCALE_UNKNOWN','GEOMETRY_INVALID','MODEL_GENERATION_FAILED','RENDER_FAILED','VIDEO_FAILED','EXPORT_FAILED')),
  CONSTRAINT virtual_home_accuracy_check CHECK (accuracy_level IN ('DEVELOPER_VERIFIED','AI_RECONSTRUCTED','CONCEPT_VISUALISATION')),
  CONSTRAINT virtual_home_dimensions_check CHECK (
    (bedrooms IS NULL OR bedrooms >= 0) AND
    (bathrooms IS NULL OR bathrooms >= 0) AND
    (floors IS NULL OR floors > 0) AND
    (floor_area_sqm IS NULL OR floor_area_sqm > 0) AND
    (ceiling_height_m IS NULL OR ceiling_height_m > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_virtual_home_project_workflow
  ON virtual_home_projects (status, assigned_staff_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_virtual_home_project_off_plan
  ON virtual_home_projects (off_plan_development_id, unit_type_key);
CREATE INDEX IF NOT EXISTS idx_virtual_home_project_property
  ON virtual_home_projects (property_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_home_public_slug
  ON virtual_home_projects (public_slug) WHERE is_public = TRUE;

CREATE TABLE IF NOT EXISTS virtual_home_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES virtual_home_projects(id) ON DELETE CASCADE,
  parent_asset_id UUID REFERENCES virtual_home_assets(id) ON DELETE SET NULL,
  version_type VARCHAR(40) NOT NULL,
  asset_kind VARCHAR(40) NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  original_filename VARCHAR(260),
  mime_type VARCHAR(120),
  storage_url TEXT,
  internal_ref TEXT,
  byte_size BIGINT,
  sha256 VARCHAR(64),
  is_private BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT virtual_home_asset_version_check CHECK (version_type IN ('ORIGINAL','CLEANED','STAFF_CORRECTED','APPROVED_MASTER','SCENE','RENDER','VIDEO','EXPORT','AUDIT')),
  CONSTRAINT virtual_home_asset_kind_check CHECK (asset_kind IN ('floor_plan','plan_image','property_model','scene_manifest','svg','json','glb','render','video','document','archive')),
  CONSTRAINT virtual_home_asset_size_check CHECK (byte_size IS NULL OR byte_size >= 0)
);

CREATE INDEX IF NOT EXISTS idx_virtual_home_assets_project
  ON virtual_home_assets (project_id, version_type, version_number DESC, created_at DESC);

-- Originals are immutable evidence. Derived versions must be created as new rows.
CREATE OR REPLACE FUNCTION protect_virtual_home_original_asset()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.version_type = 'ORIGINAL' THEN
    RAISE EXCEPTION 'Original Virtual Home assets are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_virtual_home_original_update ON virtual_home_assets;
CREATE TRIGGER trg_protect_virtual_home_original_update
BEFORE UPDATE OR DELETE ON virtual_home_assets
FOR EACH ROW EXECUTE FUNCTION protect_virtual_home_original_asset();

CREATE TABLE IF NOT EXISTS virtual_home_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES virtual_home_projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  property_model JSONB NOT NULL,
  correction_summary TEXT,
  source VARCHAR(40) NOT NULL DEFAULT 'staff',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version_number)
);

CREATE TABLE IF NOT EXISTS virtual_home_confidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES virtual_home_projects(id) ON DELETE CASCADE,
  element_key VARCHAR(180) NOT NULL,
  element_type VARCHAR(80) NOT NULL,
  label VARCHAR(220),
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5, 4),
  confidence_band VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  source VARCHAR(80) NOT NULL DEFAULT 'unknown',
  review_state VARCHAR(30) NOT NULL DEFAULT 'UNREVIEWED',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, element_key),
  CONSTRAINT virtual_home_confidence_value_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT virtual_home_confidence_band_check CHECK (confidence_band IN ('GREEN','AMBER','RED','UNKNOWN')),
  CONSTRAINT virtual_home_review_state_check CHECK (review_state IN ('UNREVIEWED','CONFIRMED','CORRECTED','REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_virtual_home_confidence_review
  ON virtual_home_confidence_items (project_id, review_state, confidence_band);

CREATE TABLE IF NOT EXISTS virtual_home_listing_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES virtual_home_projects(id) ON DELETE CASCADE,
  off_plan_development_id UUID REFERENCES off_plan_developments(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  unit_type_key VARCHAR(180),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT virtual_home_listing_target_check CHECK (off_plan_development_id IS NOT NULL OR property_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_home_listing_link_unique
  ON virtual_home_listing_links (project_id, COALESCE(off_plan_development_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(unit_type_key, ''));

CREATE TABLE IF NOT EXISTS virtual_home_commercial_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  price_ugx BIGINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT virtual_home_product_price_check CHECK (price_ugx >= 0)
);

INSERT INTO virtual_home_commercial_products (product_key, name, description, price_ugx, settings)
VALUES
  ('MAKA_BRANDED_VIDEO', 'Maka branded walkthrough video', 'A walkthrough export carrying the makaug.com brand.', 50000, '{"branding":"makaug","configurable":true}'::jsonb),
  ('WHITE_LABEL_VIDEO', 'White-label walkthrough video', 'A clean walkthrough export without Maka branding.', 80000, '{"branding":"white_label","configurable":true}'::jsonb)
ON CONFLICT (product_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS virtual_home_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES virtual_home_projects(id) ON DELETE SET NULL,
  customer_name VARCHAR(220),
  customer_phone VARCHAR(80),
  customer_email VARCHAR(260),
  product_key VARCHAR(100),
  amount_ugx BIGINT,
  payment_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUESTED',
  order_status VARCHAR(40) NOT NULL DEFAULT 'ENQUIRY',
  requested_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT virtual_home_payment_status_check CHECK (payment_status IN ('NOT_REQUESTED','PENDING','PAID','FAILED','REFUNDED')),
  CONSTRAINT virtual_home_order_status_check CHECK (order_status IN ('ENQUIRY','QUOTED','ACCEPTED','IN_PRODUCTION','DELIVERED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS virtual_home_furniture_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(220) NOT NULL,
  category VARCHAR(100) NOT NULL,
  merchant_name VARCHAR(220),
  merchant_url TEXT,
  affiliate_url TEXT,
  currency VARCHAR(3),
  price NUMERIC(14, 2),
  model_url TEXT,
  image_url TEXT,
  license_name VARCHAR(120),
  license_url TEXT,
  commission_disclosure TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT virtual_home_furniture_status_check CHECK (status IN ('DRAFT','REVIEW','ACTIVE','ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS virtual_home_furniture_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES virtual_home_furniture_products(id) ON DELETE CASCADE,
  project_id UUID REFERENCES virtual_home_projects(id) ON DELETE SET NULL,
  room_key VARCHAR(180),
  anonymous_session_hash VARCHAR(64),
  referrer_path TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_virtual_home_furniture_clicks_reporting
  ON virtual_home_furniture_clicks (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS virtual_home_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES virtual_home_projects(id) ON DELETE CASCADE,
  action VARCHAR(120) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(80),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_virtual_home_events_project
  ON virtual_home_events (project_id, created_at DESC);

