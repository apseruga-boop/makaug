-- Advertising API-Day groundwork: explicit status machine for paid review.

ALTER TABLE advertising_campaigns
  DROP CONSTRAINT IF EXISTS advertising_campaigns_status_check;

ALTER TABLE advertising_campaigns
  ADD CONSTRAINT advertising_campaigns_status_check
  CHECK (status IN (
    'draft',
    'awaiting_payment',
    'paid',
    'paid_pending_approval',
    'changes_requested',
    'rejected',
    'live',
    'paused',
    'completed',
    'ended',
    'cancelled'
  ));

ALTER TABLE advertising_campaigns
  DROP CONSTRAINT IF EXISTS advertising_campaigns_payment_status_check;

ALTER TABLE advertising_campaigns
  ADD CONSTRAINT advertising_campaigns_payment_status_check
  CHECK (payment_status IN ('unpaid','invoiced','paid','refunded','refund_pending','waived'));

CREATE INDEX IF NOT EXISTS idx_advertising_campaigns_paid_approval_queue
  ON advertising_campaigns(payment_status, advertiser_approval_status, status, created_at DESC)
  WHERE status IN ('paid_pending_approval','paid') AND payment_status = 'paid';
