CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  preferred_contact_channel TEXT NOT NULL DEFAULT 'whatsapp',
  preferred_language TEXT NOT NULL DEFAULT 'en',
  role_type TEXT NOT NULL DEFAULT 'unknown',
  location_interest TEXT,
  category_interest TEXT,
  budget_range TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown',
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_consent BOOLEAN NOT NULL DEFAULT FALSE,
  sms_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_unique
  ON contacts(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts(LOWER(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON contacts(phone)
  WHERE phone IS NOT NULL;

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON contacts;
CREATE TRIGGER trg_contacts_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES advertising_campaigns(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'web',
  lead_type TEXT NOT NULL DEFAULT 'enquiry',
  category TEXT,
  location TEXT,
  budget BIGINT,
  message TEXT,
  lifecycle_stage TEXT NOT NULL DEFAULT 'new',
  lead_status TEXT NOT NULL DEFAULT 'open',
  lead_score INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  next_follow_up_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  sla_status TEXT NOT NULL DEFAULT 'open',
  outcome TEXT,
  lost_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status_created
  ON leads(lead_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_source_type
  ON leads(source, lead_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_assignment
  ON leads(assigned_to_user_id, next_follow_up_at);

CREATE INDEX IF NOT EXISTS idx_leads_listing
  ON leads(listing_id);

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  activity_type TEXT NOT NULL DEFAULT 'note',
  message TEXT,
  old_status TEXT,
  new_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_created
  ON lead_activities(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_status_due
  ON lead_tasks(status, due_at);

DROP TRIGGER IF EXISTS trg_lead_tasks_updated_at ON lead_tasks;
CREATE TRIGGER trg_lead_tasks_updated_at
BEFORE UPDATE ON lead_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS lead_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id UUID REFERENCES users(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES advertising_campaigns(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'draft',
  payment_method TEXT,
  payment_provider TEXT,
  payment_reference TEXT,
  receipt_url TEXT,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invoices_status_created
  ON invoices(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_campaign
  ON invoices(campaign_id);

CREATE TABLE IF NOT EXISTS payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'manual',
  amount BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  purpose TEXT NOT NULL DEFAULT 'campaign',
  related_campaign_id UUID REFERENCES advertising_campaigns(id) ON DELETE SET NULL,
  advertiser_id UUID REFERENCES users(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'created',
  provider_reference TEXT,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_links_status_created
  ON payment_links(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_links_campaign
  ON payment_links(related_campaign_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_email_masked TEXT,
  recipient_role TEXT,
  template_key TEXT,
  subject TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'logged',
  provider TEXT,
  provider_message_id TEXT,
  related_listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  related_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  related_viewing_id UUID,
  related_advertiser_id UUID REFERENCES users(id) ON DELETE SET NULL,
  related_campaign_id UUID REFERENCES advertising_campaigns(id) ON DELETE SET NULL,
  related_mortgage_lead_id UUID,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_logs_status_created
  ON email_logs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID,
  recipient_phone_masked TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  template_key TEXT,
  message_type TEXT NOT NULL DEFAULT 'freeform',
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'logged',
  related_listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  related_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  related_booking_id UUID,
  related_campaign_id UUID REFERENCES advertising_campaigns(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_logs_status_created
  ON whatsapp_message_logs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS viewing_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
  accepts_viewings BOOLEAN NOT NULL DEFAULT FALSE,
  booking_mode TEXT NOT NULL DEFAULT 'disabled',
  manager_type TEXT NOT NULL DEFAULT 'owner',
  manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  contact_method TEXT NOT NULL DEFAULT 'whatsapp',
  available_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  available_time_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
  notice_period_hours INTEGER NOT NULL DEFAULT 24,
  max_bookings_per_slot INTEGER NOT NULL DEFAULT 1,
  blackout_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_house_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  public_instructions TEXT,
  private_instructions TEXT,
  language_preference TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_viewing_configs_listing
  ON viewing_configs(listing_id, accepts_viewings);

DROP TRIGGER IF EXISTS trg_viewing_configs_updated_at ON viewing_configs;
CREATE TRIGGER trg_viewing_configs_updated_at
BEFORE UPDATE ON viewing_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS viewing_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  broker_id UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  preferred_date DATE,
  preferred_time TEXT,
  contact_method TEXT NOT NULL DEFAULT 'whatsapp',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  source TEXT NOT NULL DEFAULT 'web',
  language_preference TEXT NOT NULL DEFAULT 'en',
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_viewing_bookings_user_status
  ON viewing_bookings(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_viewing_bookings_listing
  ON viewing_bookings(listing_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_viewing_bookings_updated_at ON viewing_bookings;
CREATE TRIGGER trg_viewing_bookings_updated_at
BEFORE UPDATE ON viewing_bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  broker_id UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  preferred_callback_time TEXT,
  contact_method TEXT NOT NULL DEFAULT 'whatsapp',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  source TEXT NOT NULL DEFAULT 'web',
  language_preference TEXT NOT NULL DEFAULT 'en',
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_callback_requests_user_status
  ON callback_requests(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_callback_requests_listing
  ON callback_requests(listing_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_callback_requests_updated_at ON callback_requests;
CREATE TRIGGER trg_callback_requests_updated_at
BEFORE UPDATE ON callback_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
