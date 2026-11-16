-- Staff commission (16 Nov 2026)
--
-- Arthur, 16 Nov 2026: mass WhatsApp sends got the number blocked, so Staff
-- Performance is now judged on agents closed, not films sent. Ronald earns
-- 20% of the subscription payment of each agent he signs up (UGX 10,000 on
-- the UGX 50,000 agent plan), but only once that agent has BOTH paid AND
-- listed a property. First payment only by default; one setting switches it
-- to every payment (Arthur has not decided on renewals yet). Commission
-- is paid on the 25th of each month. Sharon and Arthur are not closing.
-- Anyone else can be brought on as commission-only and earns the same way.
--
-- Additive only. New tables; nothing existing is changed or backfilled.
--   commission_settings      the rules (rate, minimum payment, hold days,
--                            cut-off day, payday, scheme start). Editable.
--   commission_staff         who earns commission and at what rate.
--   commission_payouts       one row per payday batch: draft -> reviewed ->
--                            paid (or cancelled).
--   commission_payout_items  which agents are in a batch. A unique index
--                            means one agent (and one phone) is paid once.
--   commission_audit         append-only log of every commission action.
--   commission_photo_hashes  cached photo fingerprints used to spot a
--                            qualifying listing that copies another one.
--
-- Eligibility is never stored or typed in: it is worked out each time from
-- agents, agent_prospects, revenue_entries and properties.
--
-- Rollback: DROP TABLE commission_photo_hashes, commission_audit,
-- commission_payout_items, commission_payouts, commission_staff,
-- commission_settings; (no other table refers to them).

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS commission_settings (
  key TEXT PRIMARY KEY,
  -- Percent of the agent's confirmed payment, for new recruits.
  default_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (default_rate_pct >= 0 AND default_rate_pct <= 100),
  -- 'first_payment' (default) or 'every_payment' (renewals earn too).
  pays_on TEXT NOT NULL DEFAULT 'first_payment' CHECK (pays_on IN ('first_payment', 'every_payment')),
  -- The agent plan is UGX 50,000 a month; a smaller or zero payment never counts.
  min_payment_ugx INTEGER NOT NULL DEFAULT 50000 CHECK (min_payment_ugx > 0),
  -- Days after an agent qualifies before commission can go into a payout, in
  -- case the payment is refunded or the listing is removed or rejected.
  hold_days INTEGER NOT NULL DEFAULT 7 CHECK (hold_days >= 0 AND hold_days <= 90),
  -- Commission whose hold ends on or before this day of the month (Kampala)
  -- is paid on that month's payday; later than that waits for the next one.
  cutoff_day INTEGER NOT NULL DEFAULT 20 CHECK (cutoff_day BETWEEN 1 AND 28),
  payday_day INTEGER NOT NULL DEFAULT 25 CHECK (payday_day BETWEEN 1 AND 28),
  -- Only first payments on or after this day earn commission.
  scheme_starts_on DATE NOT NULL DEFAULT DATE '2026-11-16',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cutoff_day <= payday_day)
);

INSERT INTO commission_settings (key, updated_by) VALUES ('default', 'migration 227')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS commission_staff (
  person_key TEXT PRIMARY KEY CHECK (person_key ~ '^[a-z0-9]{1,40}$'),
  name TEXT NOT NULL,
  -- closer (staff who call and close), commission_only (recruits), not_closing
  role TEXT NOT NULL CHECK (role IN ('closer', 'commission_only', 'not_closing')),
  -- Percent of each qualifying payment.
  rate_pct NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (rate_pct >= 0 AND rate_pct <= 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Last nine digits only (never a full number), to stop self-referral.
  phone_key TEXT CHECK (phone_key IS NULL OR phone_key ~ '^[0-9]{9}$'),
  user_id TEXT,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO commission_staff (person_key, name, role, rate_pct, active, added_by) VALUES
  ('ronald', 'Ronald', 'closer', 20, TRUE, 'Arthur, 16 Nov 2026'),
  ('sharon', 'Sharon', 'not_closing', 0, FALSE, 'Arthur, 16 Nov 2026'),
  ('arthur', 'Arthur', 'not_closing', 0, FALSE, 'Arthur, 16 Nov 2026')
ON CONFLICT (person_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payday DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'paid', 'cancelled')),
  total_ugx BIGINT NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  paid_by TEXT,
  paid_at TIMESTAMPTZ,
  paid_reference TEXT,
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT
);

-- One open (draft or reviewed) batch per payday at a time. Once a batch is
-- paid, a late batch for the same payday can still be built.
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_payouts_open_payday
  ON commission_payouts (payday) WHERE status IN ('draft', 'reviewed');

CREATE TABLE IF NOT EXISTS commission_payout_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES commission_payouts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  phone_key TEXT NOT NULL,
  person_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'commission' CHECK (kind IN ('commission', 'clawback')),
  amount_ugx INTEGER NOT NULL,
  rate_pct NUMERIC(5,2),
  payment_ugx BIGINT,
  -- The agent's first qualifying payment (the one that makes them count).
  is_first BOOLEAN NOT NULL DEFAULT TRUE,
  payment_entry_id UUID,
  listing_id UUID,
  -- Flags an admin looked at and accepted for this agent, with their note.
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  override_note TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  CHECK ((kind = 'commission' AND amount_ugx > 0) OR (kind = 'clawback' AND amount_ugx < 0))
);

-- One agent earns one first-payment commission, ever; the same phone cannot
-- earn it twice under a second account; one payment is never paid on twice.
-- Voided items (a cancelled batch) free the agent again.
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_items_agent
  ON commission_payout_items (agent_id) WHERE kind = 'commission' AND is_first AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_items_phone
  ON commission_payout_items (phone_key) WHERE kind = 'commission' AND is_first AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_items_payment
  ON commission_payout_items (payment_entry_id) WHERE kind = 'commission' AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_items_clawback
  ON commission_payout_items (payment_entry_id) WHERE kind = 'clawback' AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_commission_items_payout ON commission_payout_items (payout_id);

CREATE TABLE IF NOT EXISTS commission_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor TEXT,
  actor_id TEXT,
  payout_id UUID,
  person_key TEXT,
  agent_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_audit_created ON commission_audit (created_at DESC);

CREATE TABLE IF NOT EXISTS commission_photo_hashes (
  url TEXT PRIMARY KEY,
  property_id UUID,
  dhash TEXT,
  reason TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_photo_hashes_property ON commission_photo_hashes (property_id);
