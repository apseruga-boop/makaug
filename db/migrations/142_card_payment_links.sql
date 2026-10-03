-- Payment links: card (Revolut, Whispers Global) or mobile money (3 Oct 2026)
--
-- Every fee (private listing, agent subscription, or a one-off amount) can be
-- sent as a link: makaug.com/pay/<code>. The page shows what is due and lets
-- the person choose:
--   * Card / Apple Pay / Google Pay — Revolut hosted checkout, charged in USD
--     (Revolut cannot hold UGX) into the WHISPERS GLOBAL LTD Revolut Business
--     account. Revolut confirms it, so it is recorded and verified by itself.
--   * Mobile money — the MTN MoMo number as today, with the link's code as
--     the reference; "I have paid" becomes a payment claim for the usual checks.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

INSERT INTO money_accounts (key, name, kind, currency, number_hint) VALUES
  ('revolut_whispers', 'Card payments — Revolut (Whispers Global)', 'card', 'USD', 'WHISPERS GLOBAL LTD · Revolut Business')
ON CONFLICT (key) DO NOTHING;

INSERT INTO billing_settings (key, value) VALUES
  ('card_payments', '{"enabled":true,"currency":"USD","ugx_per_unit":3700}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS pay_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,                     -- short, unguessable; also the MoMo reference
  purpose TEXT NOT NULL,                         -- listing_fee | agent_subscription | other
  property_id UUID,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount_ugx BIGINT NOT NULL CHECK (amount_ugx > 0),
  card_currency TEXT NOT NULL DEFAULT 'USD',
  card_amount_minor INTEGER NOT NULL CHECK (card_amount_minor > 0),  -- cents
  fx_rate_ugx NUMERIC(12,4) NOT NULL,
  payer_name TEXT,
  payer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open',           -- open | paid | cancelled
  provider_order_id TEXT,
  provider_checkout_url TEXT,
  provider_state TEXT,
  paid_method TEXT,                              -- card | mtn_momo
  paid_at TIMESTAMPTZ,
  entry_id UUID,
  claim_id UUID,
  sent_to TEXT,
  sent_at TIMESTAMPTZ,
  sent_status TEXT,
  opened_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pay_links_status ON pay_links (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_links_property ON pay_links (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_links_agent ON pay_links (agent_id) WHERE agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_links_provider_order ON pay_links (provider_order_id) WHERE provider_order_id IS NOT NULL;

ALTER TABLE payment_claims ADD COLUMN IF NOT EXISTS pay_link_id UUID;
