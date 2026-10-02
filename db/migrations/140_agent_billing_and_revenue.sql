-- Agent subscriptions, removals and a money ledger (2 Oct 2026)
--
-- From Monday 5 Oct 2026 every new agent pays UGX 50,000 a month for their
-- profile and listings. An agent cannot be approved without the payment being
-- recorded: how it was paid, into which account, and its transaction ID.
--
-- revenue_entries is the ledger of money in and out of each account (MTN MoMo,
-- Airtel Money, bank, cash). A transaction ID can be used once per account.
-- Money SMS from the MoMo phone can be forwarded in (money_sms_inbox), so the
-- wallet's own receipts are matched against what staff typed, and its balance
-- line is checked against the ledger.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS billing_plan TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS monthly_fee_ugx INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS paid_until DATE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_exempt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_exempt_reason TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS removed_reason TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS removed_by TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS removal_snapshot JSONB;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ;

-- Everyone approved before the fee starts keeps their free listing.
UPDATE agents
   SET fee_exempt = true,
       fee_exempt_reason = COALESCE(fee_exempt_reason, 'Approved before the monthly fee started on 5 Oct 2026')
 WHERE status = 'approved' AND fee_exempt = false AND COALESCE(approved_at, created_at) < TIMESTAMPTZ '2026-10-05 00:00:00+03';

CREATE TABLE IF NOT EXISTS money_accounts (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- mobile_money | bank | cash
  number_hint TEXT,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO money_accounts (key, name, kind) VALUES
  ('mtn_momo', 'MTN Mobile Money', 'mobile_money'),
  ('airtel_money', 'Airtel Money', 'mobile_money'),
  ('bank', 'Bank account', 'bank'),
  ('cash', 'Cash (held by staff)', 'cash')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS revenue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind TEXT NOT NULL,                       -- agent_subscription | other_income | withdrawal | expense | transfer
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  amount_ugx BIGINT NOT NULL CHECK (amount_ugx > 0),
  account_key TEXT NOT NULL REFERENCES money_accounts(key),
  method TEXT NOT NULL,                     -- mtn_momo | airtel_money | bank_transfer | cash
  reference TEXT,                           -- transaction ID from the receipt
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start DATE,
  period_end DATE,
  payer_name TEXT,
  payer_phone TEXT,
  note TEXT,
  receipt_url TEXT,
  recorded_by TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_status TEXT NOT NULL DEFAULT 'unverified',  -- unverified | verified | disputed
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  verification_source TEXT,                 -- sms_match | statement | manual
  sms_id UUID,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  voided_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_revenue_entries_account_reference
  ON revenue_entries (account_key, LOWER(reference))
  WHERE reference IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_entries_paid ON revenue_entries (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_entries_agent ON revenue_entries (agent_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS money_sms_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender TEXT,
  body TEXT NOT NULL,
  body_sha256 TEXT NOT NULL UNIQUE,
  account_key TEXT,
  direction TEXT,                           -- in | out | unknown
  amount_ugx BIGINT,
  reference TEXT,
  counterparty TEXT,
  balance_ugx BIGINT,
  matched_entry_id UUID,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_money_sms_reference ON money_sms_inbox (LOWER(reference)) WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS money_balance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key TEXT NOT NULL REFERENCES money_accounts(key),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actual_balance BIGINT NOT NULL,
  expected_balance BIGINT NOT NULL,
  difference BIGINT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',    -- manual | sms
  note TEXT,
  evidence_url TEXT,
  checked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_money_balance_checks_account ON money_balance_checks (account_key, checked_at DESC);
