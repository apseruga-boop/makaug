-- Advertising campaigns, listing boosts and other products bought online now
-- check out through a makaug pay link instead of a third-party gateway (3 Oct 2026).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE pay_links ADD COLUMN IF NOT EXISTS payment_id UUID;
CREATE INDEX IF NOT EXISTS idx_pay_links_payment ON pay_links (payment_id) WHERE payment_id IS NOT NULL;
