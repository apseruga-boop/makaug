CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS property_seeker_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  preferred_contact_channel TEXT NOT NULL DEFAULT 'whatsapp',
  whatsapp_consent BOOLEAN NOT NULL DEFAULT FALSE,
  email_alert_consent BOOLEAN NOT NULL DEFAULT FALSE,
  sms_consent BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  seeker_type TEXT NOT NULL DEFAULT 'casual_browser',
  current_goal TEXT,
  timeline TEXT,
  profile_completion_percent INTEGER NOT NULL DEFAULT 0,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_seeker_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_budget BIGINT,
  max_budget BIGINT,
  currency TEXT NOT NULL DEFAULT 'UGX',
  bedrooms INTEGER,
  bathrooms INTEGER,
  property_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  furnished_status TEXT,
  verification_preference TEXT NOT NULL DEFAULT 'open_with_warnings',
  campus TEXT,
  max_distance_to_campus NUMERIC,
  land_title_preference TEXT,
  land_size_preference TEXT,
  commercial_use TEXT,
  mortgage_interest BOOLEAN NOT NULL DEFAULT FALSE,
  deposit_amount BIGINT,
  move_in_date DATE,
  timeline TEXT,
  alert_frequency TEXT NOT NULL DEFAULT 'weekly',
  alert_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  campus TEXT,
  university TEXT,
  preferred_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_budget BIGINT,
  max_budget BIGINT,
  currency TEXT NOT NULL DEFAULT 'UGX',
  price_period_preference TEXT NOT NULL DEFAULT 'semester',
  room_type TEXT,
  shared_or_self_contained TEXT,
  wifi_required BOOLEAN NOT NULL DEFAULT FALSE,
  security_required BOOLEAN NOT NULL DEFAULT TRUE,
  water_required BOOLEAN NOT NULL DEFAULT TRUE,
  meals_required BOOLEAN NOT NULL DEFAULT FALSE,
  shuttle_required BOOLEAN NOT NULL DEFAULT FALSE,
  parking_required BOOLEAN NOT NULL DEFAULT FALSE,
  gender_policy_preference TEXT,
  max_distance_to_campus NUMERIC,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  alert_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  alert_frequency TEXT NOT NULL DEFAULT 'weekly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_session_id TEXT,
  phone TEXT,
  category TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  label TEXT,
  location TEXT,
  min_price BIGINT,
  max_price BIGINT,
  currency TEXT NOT NULL DEFAULT 'UGX',
  bedrooms INTEGER,
  bathrooms INTEGER,
  property_type TEXT,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_preference TEXT,
  student_campus TEXT,
  student_distance NUMERIC,
  land_title_type TEXT,
  land_size TEXT,
  commercial_subtype TEXT,
  alert_frequency TEXT NOT NULL DEFAULT 'weekly',
  alert_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  language_preference TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'active',
  created_from TEXT NOT NULL DEFAULT 'web',
  consent_record_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_matched_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS alert_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_search_id UUID NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'pending',
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failure_reason TEXT,
  notification_payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (saved_search_id, listing_id, channel)
);

CREATE TABLE IF NOT EXISTS property_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  property_list_id UUID REFERENCES property_lists(id) ON DELETE SET NULL,
  list_name TEXT NOT NULL DEFAULT 'Shortlist',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS listing_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hidden_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS recently_viewed_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_session_id TEXT,
  listing_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'web',
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_seeker_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_session_id TEXT,
  activity_type TEXT NOT NULL,
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  search_id UUID REFERENCES saved_searches(id) ON DELETE SET NULL,
  lead_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_need_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  contact_id UUID,
  source TEXT NOT NULL DEFAULT 'web',
  category TEXT,
  location TEXT,
  budget BIGINT,
  currency TEXT NOT NULL DEFAULT 'UGX',
  bedrooms INTEGER,
  property_type TEXT,
  campus TEXT,
  land_title_preference TEXT,
  message TEXT,
  urgency TEXT,
  preferred_contact_channel TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_phone TEXT,
  recipient_email TEXT,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  related_saved_search_id UUID REFERENCES saved_searches(id) ON DELETE SET NULL,
  related_lead_id UUID,
  failure_reason TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_seeker_profiles_user ON property_seeker_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_property_seeker_preferences_user ON property_seeker_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_student_preferences_user ON student_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_status ON saved_searches(user_id, status);
CREATE INDEX IF NOT EXISTS idx_saved_searches_category_location ON saved_searches(category, location);
CREATE INDEX IF NOT EXISTS idx_saved_listings_user ON saved_listings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recently_viewed_user ON recently_viewed_listings(user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_seeker_activities_user ON property_seeker_activities(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_need_requests_status ON property_need_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_property_seeker_profiles_updated_at ON property_seeker_profiles;
CREATE TRIGGER trg_property_seeker_profiles_updated_at
BEFORE UPDATE ON property_seeker_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_property_seeker_preferences_updated_at ON property_seeker_preferences;
CREATE TRIGGER trg_property_seeker_preferences_updated_at
BEFORE UPDATE ON property_seeker_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_student_preferences_updated_at ON student_preferences;
CREATE TRIGGER trg_student_preferences_updated_at
BEFORE UPDATE ON student_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_saved_searches_updated_at ON saved_searches;
CREATE TRIGGER trg_saved_searches_updated_at
BEFORE UPDATE ON saved_searches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_property_lists_updated_at ON property_lists;
CREATE TRIGGER trg_property_lists_updated_at
BEFORE UPDATE ON property_lists
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_saved_listings_updated_at ON saved_listings;
CREATE TRIGGER trg_saved_listings_updated_at
BEFORE UPDATE ON saved_listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_listing_notes_updated_at ON listing_notes;
CREATE TRIGGER trg_listing_notes_updated_at
BEFORE UPDATE ON listing_notes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_property_comparisons_updated_at ON property_comparisons;
CREATE TRIGGER trg_property_comparisons_updated_at
BEFORE UPDATE ON property_comparisons
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_property_need_requests_updated_at ON property_need_requests;
CREATE TRIGGER trg_property_need_requests_updated_at
BEFORE UPDATE ON property_need_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
