CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  company_name TEXT,
  licence_number TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  whatsapp TEXT,
  email TEXT UNIQUE,
  districts_covered TEXT[] NOT NULL DEFAULT '{}',
  specializations TEXT[] NOT NULL DEFAULT '{}',
  nin TEXT,
  area_certificate_url TEXT,
  profile_photo_url TEXT,
  bio TEXT,
  rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type TEXT NOT NULL CHECK (listing_type IN ('sale','rent','land','commercial','student','students')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  district TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT,
  price BIGINT,
  price_period TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  property_type TEXT,
  title_type TEXT,
  year_built INTEGER,
  furnishing TEXT,
  contract_months INTEGER,
  deposit_amount BIGINT,
  land_size_value NUMERIC,
  land_size_unit TEXT,
  floor_area_sqm NUMERIC,
  usable_size_sqm NUMERIC,
  parking_bays INTEGER,
  nearest_university TEXT,
  distance_to_uni_km NUMERIC,
  room_type TEXT,
  room_arrangement TEXT,
  commercial_intent TEXT,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  lister_name TEXT,
  lister_phone TEXT,
  lister_email TEXT,
  lister_type TEXT NOT NULL DEFAULT 'owner' CHECK (lister_type IN ('owner','agent')),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft','pending','approved','rejected','archived')),
  source TEXT NOT NULL DEFAULT 'website',
  listed_via TEXT NOT NULL DEFAULT 'website',
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  message TEXT,
  channel TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  reporter_contact TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  preferred_locations TEXT,
  listing_type TEXT,
  max_budget BIGINT,
  requirements TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  phone TEXT PRIMARY KEY,
  current_step TEXT NOT NULL DEFAULT 'greeting',
  language TEXT NOT NULL DEFAULT 'en',
  listing_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otps (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  client_id TEXT,
  user_phone TEXT,
  page_path TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','moderator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
BEFORE UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_report_listings_updated_at ON report_listings;
CREATE TRIGGER trg_report_listings_updated_at
BEFORE UPDATE ON report_listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_sessions_updated_at ON whatsapp_sessions;
CREATE TRIGGER trg_whatsapp_sessions_updated_at
BEFORE UPDATE ON whatsapp_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON admin_users;
CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
