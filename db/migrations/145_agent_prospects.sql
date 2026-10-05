-- The people we have pitched, before they are agents (5 Oct 2026)
--
-- An employee sends the join-as-an-agent film from WhatsApp, and until now
-- nothing remembered that it happened. The only trace was an audit_logs row and
-- the outbound queue entry, neither of which carries a status, so "who did we
-- pitch and who has actually signed up" could not be answered.
--
-- A prospect is not an agent: agents_status_check only allows
-- pending/approved/rejected/suspended, full_name and licence_number are NOT
-- NULL, and the invite route additionally demands an email, a district and a
-- bio. None of that exists when all we have is a name and a phone number. So
-- prospects live in their own table and graduate into agents by phone.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS agent_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  -- Last 9 digits, the key every other phone match in this codebase uses, so a
  -- prospect can be found however the number was typed.
  phone_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pitched'
    CHECK (status IN ('pitched', 'interested', 'signed_up', 'approved', 'declined', 'archived')),
  -- What we sent and who sent it. pitched_by is the employee's WhatsApp number;
  -- demand_lead_referrals.sent_by is the precedent.
  video_kind TEXT NOT NULL DEFAULT 'agent',
  pitched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pitched_by TEXT,
  pitched_by_name TEXT,
  -- Set when this prospect turns into a row in agents.
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  signed_up_at TIMESTAMPTZ,
  last_nudged_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One prospect per number. A second pitch updates the row rather than making a
-- duplicate, which is also how we can tell the employee it has already gone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prospects_phone_key ON agent_prospects (phone_key);
CREATE INDEX IF NOT EXISTS idx_agent_prospects_status ON agent_prospects (status);
CREATE INDEX IF NOT EXISTS idx_agent_prospects_pitched_at ON agent_prospects (pitched_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_prospects_pitched_by ON agent_prospects (pitched_by) WHERE pitched_by IS NOT NULL;

-- Who registered this agent, and whether they asked for the fee link.
--
-- Until now the only record of which employee set an agent up was the literal
-- [WHATSAPP_EMPLOYEE_AGENT_007] prefix in verification_reason — so "how many
-- agents did Ronald bring in" could not be answered, and when an agent was
-- approved there was nobody to tell.
--
-- pay_link_on_approval is the employee's answer to "shall I send the UGX 50,000
-- link when this is approved?", carried from the WhatsApp intake to the moment
-- a moderator actually approves, which may be days later.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS registered_by_phone TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS registered_by_name TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pay_link_on_approval BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pay_link_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_registered_by ON agents (registered_by_phone) WHERE registered_by_phone IS NOT NULL;
