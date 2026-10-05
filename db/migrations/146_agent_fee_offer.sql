-- Approving an agent without a payment, on purpose: a free offer period, "pay
-- later" (approve now and send the pay link), or waiving the fee. Recorded so
-- it is clear who gave the offer and why.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_offer_mode TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_offer_reason TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_offer_until DATE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_offer_by TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_offer_at TIMESTAMPTZ;
