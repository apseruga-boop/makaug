-- Payment links reach every fee that is collected today (3 Oct 2026)
--
-- * Short-term listings (UGX 50,000 for 3 months): a pay link per listing, so
--   the host is asked to pay when the listing is approved and the payment
--   lands in the same ledger as everything else.
-- * Pending agents who pay before they are approved are flagged, so the team
--   knows to finish their checks and approve them.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE pay_links ADD COLUMN IF NOT EXISTS st_listing_id UUID;
CREATE INDEX IF NOT EXISTS idx_pay_links_st_listing ON pay_links (st_listing_id) WHERE st_listing_id IS NOT NULL;

ALTER TABLE revenue_entries ADD COLUMN IF NOT EXISTS st_listing_id UUID;
ALTER TABLE payment_claims ADD COLUMN IF NOT EXISTS st_listing_id UUID;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS paid_awaiting_approval_at TIMESTAMPTZ;
