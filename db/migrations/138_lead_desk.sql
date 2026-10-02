-- Lead desk (2 Oct 2026)
--
-- One place for every person makaug could not serve straight away — a WhatsApp
-- search with no match, a "tell us what you need" form, a property-finder
-- request, an Ask AI search with no results — so each one is passed to an
-- agent within a day, the agent's response is tracked, and the person is told
-- when a matching property appears.
--
-- demand_leads holds one row per request, copied in from the source tables by
-- services/leadDeskService.js (source_ref is the source row, so copying again
-- never duplicates). demand_lead_referrals holds each time it went to an agent
-- and what the agent said.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS demand_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                 -- whatsapp | website_form | property_finder | ask_ai | student
  source_ref TEXT NOT NULL UNIQUE,      -- e.g. property_leads:<uuid>
  name TEXT,
  phone TEXT,
  phone_key TEXT,
  email TEXT,
  want TEXT NOT NULL DEFAULT 'any',     -- rent | sale | land | commercial | student | short_term | any
  area TEXT,
  budget BIGINT,
  bedrooms INTEGER,
  message TEXT,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  status TEXT NOT NULL DEFAULT 'new',   -- new | sent_to_agent | agent_has_property | matched | client_notified | closed | archived
  first_sent_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  matched_listing_ids UUID[] NOT NULL DEFAULT '{}',
  match_checked_at TIMESTAMPTZ,
  client_notified_at TIMESTAMPTZ,
  client_notified_listing_id UUID,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  archived_by TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demand_leads_open
  ON demand_leads(status, asked_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_demand_leads_phone_key
  ON demand_leads(phone_key)
  WHERE phone_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS demand_lead_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_lead_id UUID NOT NULL REFERENCES demand_leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by TEXT,
  message TEXT,
  response TEXT NOT NULL DEFAULT 'awaiting',  -- awaiting | has_property | no_match | contacted_client | deal_done | no_response
  responded_at TIMESTAMPTZ,
  response_notes TEXT,
  nudged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demand_lead_referrals_lead
  ON demand_lead_referrals(demand_lead_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_demand_lead_referrals_awaiting
  ON demand_lead_referrals(sent_at)
  WHERE response = 'awaiting';

DROP TRIGGER IF EXISTS trg_demand_leads_updated_at ON demand_leads;
CREATE TRIGGER trg_demand_leads_updated_at
BEFORE UPDATE ON demand_leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
