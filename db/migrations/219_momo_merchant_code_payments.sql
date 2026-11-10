-- 219_momo_merchant_code_payments.sql
-- MoMo merchant code 27248497 replaces "send money to 0780 863 394" and the MK
-- payment reference (Arthur, 10 Nov 2026).
--
-- 1. The merchant code pays into its own wallet, so it gets its own money
--    account. Its SMS forwarder posts with &account=mtn_momopay, and its
--    balance line is checked against this account, not the old line's.
-- 2. Payment claims remember the business name the payer gave and the number
--    they paid from (a merchant payment asks for no reference, so these are
--    what the merchant line's SMS is matched on), and how a match was made.
-- 3. The day-3 "seen by N people" message asks for the merchant code instead
--    of "pay to <number> and send me the transaction ID". Only that sentence
--    is replaced; any other wording the team edited stays.
--
-- Sends nothing. Rollback: the columns and the account are unused without the
-- code; put the sentence back in Sales & Revenue > Settings.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

INSERT INTO money_accounts (key, name, kind, currency, number_hint)
VALUES ('mtn_momopay', 'MTN MoMo merchant code', 'mobile_money', 'UGX', '27248497')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE payment_claims ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE payment_claims ADD COLUMN IF NOT EXISTS paid_from_phone TEXT;
ALTER TABLE payment_claims ADD COLUMN IF NOT EXISTS match_how TEXT;
CREATE INDEX IF NOT EXISTS idx_payment_claims_sms ON payment_claims (sms_id) WHERE sms_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_money_sms_unmatched_in ON money_sms_inbox (received_at DESC)
  WHERE direction = 'in' AND matched_entry_id IS NULL;

UPDATE billing_settings
   SET value = jsonb_set(
         value,
         '{text}',
         to_jsonb(replace(value->>'text', ' — pay to {pay_to} and send me the transaction ID here.', E'.\n{how_to_pay}')),
         false
       ),
       updated_by = 'migration_219_momo_merchant_code',
       updated_at = NOW()
 WHERE key = 'lister_views_message'
   AND (value->>'text') LIKE '% — pay to {pay_to} and send me the transaction ID here.%';
