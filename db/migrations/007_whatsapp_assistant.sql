CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT NOT NULL,
  wa_message_id TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_search_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_results_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_request_id UUID NOT NULL REFERENCES property_search_requests(id) ON DELETE CASCADE,
  results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT NOT NULL,
  draft_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES listing_drafts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'document', 'audio')),
  media_url TEXT NOT NULL,
  caption TEXT,
  slot_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES listing_drafts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('draft','pending_review','approved','rejected')),
  reference_no TEXT NOT NULL UNIQUE,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_track TEXT NOT NULL CHECK (registration_track IN ('registered','not_registered')),
  full_name TEXT NOT NULL,
  agency_name TEXT,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  areas_covered TEXT,
  nin TEXT,
  licence_number TEXT,
  licence_certificate_url TEXT,
  listing_limit INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mortgage_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT,
  property_price NUMERIC,
  property_purpose TEXT,
  deposit_percent NUMERIC,
  term_years INTEGER,
  household_income NUMERIC,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  phone TEXT,
  email TEXT,
  preferred_area TEXT,
  purpose TEXT,
  category TEXT,
  budget NUMERIC,
  notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_ref TEXT,
  reporter_name TEXT,
  reporter_phone TEXT,
  details TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT,
  wa_message_id TEXT,
  transcript TEXT NOT NULL,
  confidence NUMERIC,
  detected_language TEXT,
  media_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS current_intent TEXT,
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_created ON whatsapp_messages(user_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_requests_phone ON property_search_requests(user_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_drafts_phone ON listing_drafts(user_phone, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_submissions_status ON listing_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_phone_expires ON otp_verifications(phone, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_applications_status ON agent_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mortgage_enquiries_phone ON mortgage_enquiries(user_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_leads_phone ON property_leads(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_reports_status ON listing_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_phone ON transcriptions(user_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
