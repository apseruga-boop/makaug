-- Running the fees by hand, with the machine doing the remembering (2 Oct 2026)
--
-- - billing_settings: who people pay (number + registered name), who confirms
--   payments, reminder timing, the private-lister fee and the editable messages.
-- - Agents: reminder log, and a billing takedown that hides their listings and
--   brings everything back unchanged the moment they pay.
-- - payment_claims: "I have paid" from WhatsApp (a transaction ID, a MoMo
--   screenshot, a bank slip). Three checks before money counts: the ID is read
--   (by the bot or AI from the screenshot), the wallet's own SMS matches it, and
--   Ronald or Arthur confirms.
-- - Absa UGX and USD accounts; entries keep their original currency.
-- - Statement lines uploaded for the weekly reconciliation.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS billing_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO billing_settings (key, value) VALUES
  ('pay_to', '{"method":"MTN Mobile Money","number":"","name":""}'::jsonb),
  ('confirmers', '[{"name":"Ronald","phone":"256709402189"},{"name":"Arthur","phone":"447757773202"}]'::jsonb),
  ('agent_fee', '{"monthly_ugx":50000,"remind_days_before":3,"final_after_days_overdue":7}'::jsonb),
  ('lister_fee', '{"free_days":7,"monthly_ugx":20000,"views_message_day":3,"start_date":"2026-10-05"}'::jsonb),
  ('lister_views_message', '{"text":"Hi {name} 👋 Your {property} on makaug has been seen by {views} people since it went live{shares_line}.\n\nYour free week ends on {free_until}. To keep it live for a month it is UGX {monthly_fee} — pay to {pay_to} and send me the transaction ID here.\n\nSee it: {link}"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS billing_reminder_log JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS billing_suspended_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS billing_snapshot JSONB;

ALTER TABLE money_accounts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UGX';
INSERT INTO money_accounts (key, name, kind, currency) VALUES
  ('absa_ugx', 'Absa — UGX account', 'bank', 'UGX'),
  ('absa_usd', 'Absa — USD account', 'bank', 'USD')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UGX';
ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS amount_original NUMERIC(14,2);
ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS fx_rate_ugx NUMERIC(12,4);
ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS property_id UUID;
ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS claim_id UUID;
ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS statement_line_id UUID;

CREATE TABLE IF NOT EXISTS payment_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'whatsapp',
  payer_phone TEXT,
  payer_name TEXT,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  property_id UUID,
  purpose TEXT NOT NULL DEFAULT 'agent_subscription',   -- agent_subscription | listing_fee | other
  reference TEXT,
  amount_ugx BIGINT,
  method TEXT,
  receipt_url TEXT,
  message TEXT,
  ai_reading JSONB,
  sms_id UUID,
  sms_matched_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',               -- pending | confirmed | rejected
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  entry_id UUID
);
CREATE INDEX IF NOT EXISTS idx_payment_claims_status ON payment_claims (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_claims_reference ON payment_claims (LOWER(reference)) WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key TEXT NOT NULL REFERENCES money_accounts(key),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT,
  batch_id UUID NOT NULL,
  line_date DATE,
  description TEXT,
  reference TEXT,
  amount NUMERIC(14,2) NOT NULL,                        -- + money in, - money out, account currency
  balance NUMERIC(16,2),
  line_sha256 TEXT NOT NULL UNIQUE,
  matched_entry_id UUID
);
CREATE INDEX IF NOT EXISTS idx_statement_lines_account ON bank_statement_lines (account_key, line_date DESC);

-- Private listers: seven days free, then a monthly fee.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lister_paid_until DATE;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lister_billing_log JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lister_billing_suspended_at TIMESTAMPTZ;
