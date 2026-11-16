-- Calling screen: payments from the screen, the morning plan and the 17:00
-- cash check.
--
-- call_payment_actions: every pay link / MoMo code sent from the screen and
--   every "payment claimed" tap. A claim also goes into payment_claims
--   (source 'calling_screen', status pending) so admin verifies it exactly like
--   any other claim. Nothing here confirms money; only the existing flow does.
-- call_day_plans: the plan King and the caller agree each morning, and how the
--   day actually went (filled at 17:00 or when the day is closed).
-- cash_checks: one row per account per day: balance, date, amount moved to the
--   main bank account, signed with initials. Accounts come from money_accounts
--   (names only; no account numbers are stored here).
--
-- call_number_submissions: a caller's own numbers now go straight into their
--   queue (status 'own'), with the mode and how they know them.
--
-- Rollback:
--   DROP INDEX IF EXISTS ux_call_number_submissions_own;
--   ALTER TABLE call_number_submissions DROP COLUMN IF EXISTS mode, DROP COLUMN IF EXISTS how_known;
--   DROP TABLE IF EXISTS cash_checks; DROP TABLE IF EXISTS call_day_plans;
--   DROP TABLE IF EXISTS call_payment_actions;
CREATE TABLE IF NOT EXISTS call_payment_actions (
  id BIGSERIAL PRIMARY KEY,
  phone_key TEXT NOT NULL,
  attempt_id UUID,
  person_key TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- link_sent | momo_sent | claimed
  pay_link_code TEXT,
  claim_id UUID,
  amount_ugx BIGINT,
  note TEXT,
  delivery TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_payment_actions_phone ON call_payment_actions (phone_key, at DESC);
CREATE INDEX IF NOT EXISTS idx_call_payment_actions_person ON call_payment_actions (person_key, at DESC);

CREATE TABLE IF NOT EXISTS call_day_plans (
  person_key TEXT NOT NULL,
  day DATE NOT NULL,
  calls_target INTEGER NOT NULL DEFAULT 40,
  closes_target INTEGER NOT NULL DEFAULT 2,
  payments_target INTEGER NOT NULL DEFAULT 0,
  focus TEXT,                         -- which numbers / mode to work
  goal TEXT,                          -- what he will achieve today
  numbers JSONB NOT NULL DEFAULT '[]'::jsonb,   -- phone keys agreed to call
  agreed_by TEXT,                     -- King's name
  caller_initials TEXT,
  agreed_at TIMESTAMPTZ,
  result JSONB,                       -- snapshot at 17:00 / day close
  result_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_key, day)
);

CREATE TABLE IF NOT EXISTS cash_checks (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  account_key TEXT NOT NULL,
  balance_ugx BIGINT NOT NULL,
  balance_date DATE NOT NULL,
  transferred_ugx BIGINT NOT NULL DEFAULT 0,
  previous_balance_ugx BIGINT,
  change_ugx BIGINT,
  person_key TEXT NOT NULL,
  initials TEXT NOT NULL,
  note TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (day, account_key)
);
CREATE INDEX IF NOT EXISTS idx_cash_checks_day ON cash_checks (day DESC);

ALTER TABLE call_number_submissions ADD COLUMN IF NOT EXISTS mode TEXT;
ALTER TABLE call_number_submissions ADD COLUMN IF NOT EXISTS how_known TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_call_number_submissions_own ON call_number_submissions (phone_key) WHERE status = 'own';
