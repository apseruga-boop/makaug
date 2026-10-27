SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

INSERT INTO money_accounts (key, name, kind, currency, number_hint)
VALUES ('pesapal_ugx', 'Pesapal Uganda receivable', 'gateway', 'UGX', 'MAKAUG ONLINE REAL ESTATE LTD')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE pay_links ADD COLUMN voluntary_payment boolean NOT NULL DEFAULT false;

CREATE TABLE pesapal_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_link_id uuid NOT NULL REFERENCES pay_links(id),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  merchant_profile text NOT NULL DEFAULT 'default',
  merchant_reference varchar(50) NOT NULL CHECK (merchant_reference ~ '^[A-Za-z0-9_.:-]+$'),
  amount_ugx bigint NOT NULL CHECK (amount_ugx > 0),
  currency text NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  purchase_snapshot jsonb NOT NULL CHECK (jsonb_typeof(purchase_snapshot) = 'object'),
  creation_state text NOT NULL DEFAULT 'reserved'
    CHECK (creation_state IN ('reserved', 'sending', 'unknown', 'tracked', 'rejected')),
  submit_started_at timestamptz,
  submit_claim_id uuid,
  tracking_id uuid,
  redirect_url text,
  provider_status_code smallint CHECK (provider_status_code BETWEEN 0 AND 3),
  provider_method text,
  provider_confirmation_code text,
  observed_at timestamptz,
  observation_started_at timestamptz,
  reversed_at timestamptz,
  review_reason text,
  application text NOT NULL DEFAULT 'not_applied'
    CHECK (application IN ('not_applied', 'applied', 'unapplied_collection')),
  ledger_entry_id uuid REFERENCES revenue_entries(id),
  recorded_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  check_count integer NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  check_claim_until timestamptz,
  last_error_code text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, merchant_profile, merchant_reference),
  UNIQUE (environment, merchant_profile, tracking_id),
  CHECK (creation_state <> 'tracked' OR tracking_id IS NOT NULL),
  CHECK (creation_state <> 'sending' OR submit_started_at IS NOT NULL),
  CHECK (redirect_url IS NULL OR tracking_id IS NOT NULL),
  CHECK ((application = 'not_applied' AND ledger_entry_id IS NULL AND recorded_at IS NULL)
    OR (application IN ('applied', 'unapplied_collection') AND ledger_entry_id IS NOT NULL AND recorded_at IS NOT NULL))
);

CREATE UNIQUE INDEX pesapal_one_active_attempt_per_debt
  ON pesapal_payment_attempts(pay_link_id, environment) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX pesapal_attempt_receipt
  ON pesapal_payment_attempts(ledger_entry_id) WHERE ledger_entry_id IS NOT NULL;
CREATE INDEX pesapal_attempt_reconcile
  ON pesapal_payment_attempts(environment, next_check_at, id);
CREATE INDEX pesapal_attempt_review
  ON pesapal_payment_attempts(updated_at) WHERE review_reason IS NOT NULL;
CREATE INDEX pesapal_attempt_link_history
  ON pesapal_payment_attempts(pay_link_id, created_at DESC);

CREATE FUNCTION preserve_pesapal_attempt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.pay_link_id, NEW.environment, NEW.merchant_profile, NEW.merchant_reference,
         NEW.amount_ugx, NEW.currency, NEW.purchase_snapshot)
     IS DISTINCT FROM
     ROW(OLD.pay_link_id, OLD.environment, OLD.merchant_profile, OLD.merchant_reference,
         OLD.amount_ugx, OLD.currency, OLD.purchase_snapshot) THEN
    RAISE EXCEPTION 'Pesapal attempt identity and purchase snapshot are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.tracking_id IS NOT NULL AND NEW.tracking_id IS DISTINCT FROM OLD.tracking_id THEN
    RAISE EXCEPTION 'Pesapal tracking identity cannot be rebound' USING ERRCODE = '23514';
  END IF;
  IF OLD.ledger_entry_id IS NOT NULL AND NEW.ledger_entry_id IS DISTINCT FROM OLD.ledger_entry_id THEN
    RAISE EXCEPTION 'Pesapal receipt linkage is permanent' USING ERRCODE = '23514';
  END IF;
  IF OLD.application <> 'not_applied' AND NEW.application IS DISTINCT FROM OLD.application THEN
    RAISE EXCEPTION 'Pesapal receipt application is permanent' USING ERRCODE = '23514';
  END IF;
  IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    RAISE EXCEPTION 'Pesapal reversal marker is permanent' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER pesapal_attempt_identity
  BEFORE UPDATE ON pesapal_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION preserve_pesapal_attempt_identity();

ALTER TABLE revenue_entries ADD COLUMN pay_link_id uuid REFERENCES pay_links(id);
ALTER TABLE revenue_entries ADD COLUMN pesapal_attempt_id uuid REFERENCES pesapal_payment_attempts(id);
ALTER TABLE revenue_entries ADD COLUMN payment_application text
  CHECK (payment_application IN ('applied', 'excess', 'review'));
ALTER TABLE revenue_entries ADD COLUMN payment_review_reason text;
ALTER TABLE revenue_entries ADD CONSTRAINT payment_application_has_debt
  CHECK (payment_application IS NULL OR pay_link_id IS NOT NULL);
ALTER TABLE revenue_entries ADD CONSTRAINT pesapal_receipt_has_reference
  CHECK (account_key <> 'pesapal_ugx' OR NULLIF(trim(reference), '') IS NOT NULL);

CREATE UNIQUE INDEX revenue_one_applied_receipt_per_link
  ON revenue_entries(pay_link_id) WHERE payment_application = 'applied';
CREATE UNIQUE INDEX revenue_one_receipt_per_pesapal_attempt
  ON revenue_entries(pesapal_attempt_id) WHERE pesapal_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX revenue_pesapal_permanent_external_identity
  ON revenue_entries(account_key, lower(reference)) WHERE account_key = 'pesapal_ugx';
CREATE INDEX revenue_pay_link_receipts ON revenue_entries(pay_link_id, paid_at DESC);

ALTER TABLE st_listing_payment ADD COLUMN revenue_entry_id uuid REFERENCES revenue_entries(id);
CREATE UNIQUE INDEX short_stay_payment_receipt
  ON st_listing_payment(revenue_entry_id) WHERE revenue_entry_id IS NOT NULL;

CREATE FUNCTION preserve_payment_receipt_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.pay_link_id IS NOT NULL AND NEW.pay_link_id IS DISTINCT FROM OLD.pay_link_id)
    OR (OLD.pesapal_attempt_id IS NOT NULL AND NEW.pesapal_attempt_id IS DISTINCT FROM OLD.pesapal_attempt_id)
    OR (OLD.payment_application IS NOT NULL AND NEW.payment_application IS DISTINCT FROM OLD.payment_application) THEN
    RAISE EXCEPTION 'Payment receipt linkage and application are permanent' USING ERRCODE = '23514';
  END IF;
  IF OLD.account_key = 'pesapal_ugx' AND
    ROW(NEW.account_key, NEW.reference, NEW.direction, NEW.amount_ugx, NEW.currency, NEW.amount_original, NEW.fx_rate_ugx)
    IS DISTINCT FROM
    ROW(OLD.account_key, OLD.reference, OLD.direction, OLD.amount_ugx, OLD.currency, OLD.amount_original, OLD.fx_rate_ugx) THEN
    RAISE EXCEPTION 'Pesapal receipt external identity and money are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_receipt_application
  BEFORE UPDATE ON revenue_entries
  FOR EACH ROW EXECUTE FUNCTION preserve_payment_receipt_application();

CREATE TABLE payment_notice_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  pay_link_id uuid NOT NULL REFERENCES pay_links(id),
  ledger_entry_id uuid REFERENCES revenue_entries(id),
  pesapal_attempt_id uuid REFERENCES pesapal_payment_attempts(id),
  notice_kind text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'event')),
  recipient text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retry', 'queued', 'sent', 'simulated', 'review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  claim_id uuid,
  delivered_at timestamptz,
  transport_reference text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_notice_due ON payment_notice_retries(next_attempt_at, id)
  WHERE status IN ('pending', 'retry');

CREATE FUNCTION preserve_payment_notice_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.event_key, NEW.pay_link_id, NEW.ledger_entry_id, NEW.pesapal_attempt_id,
         NEW.notice_kind, NEW.channel, NEW.recipient, NEW.body, NEW.payload)
     IS DISTINCT FROM
     ROW(OLD.event_key, OLD.pay_link_id, OLD.ledger_entry_id, OLD.pesapal_attempt_id,
         OLD.notice_kind, OLD.channel, OLD.recipient, OLD.body, OLD.payload) THEN
    RAISE EXCEPTION 'Payment notification intent is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_notice_intent
  BEFORE UPDATE ON payment_notice_retries
  FOR EACH ROW EXECUTE FUNCTION preserve_payment_notice_intent();
