-- Payment SMS proof: a screenshot of the MoMo / Airtel confirmation SMS,
-- read in the browser (Tesseract.js, free), checked and corrected by the
-- caller, stored as proof, and turned into a payment claim for King. King's
-- confirm goes through the existing claim path (payments, finance, Road to
-- 1000, commission). A transaction ID can only be used once.
--
-- Rollback:
--   DROP TABLE IF EXISTS payment_sms_proofs;
CREATE TABLE IF NOT EXISTS payment_sms_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID,
  attempt_id UUID,
  phone_key TEXT NOT NULL,
  agent_id UUID,
  purpose TEXT,
  uploaded_by TEXT NOT NULL,
  image_ref TEXT NOT NULL,
  image_bytes INTEGER,
  ocr_text TEXT,
  ocr_confidence NUMERIC,
  parsed JSONB NOT NULL DEFAULT '{}'::jsonb,
  network TEXT,
  amount_ugx INTEGER NOT NULL,
  sender_name TEXT,
  sender_phone_key TEXT,
  txn_id TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  flags TEXT[] NOT NULL DEFAULT '{}',
  edited_fields TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_sms_proofs_txn ON payment_sms_proofs (LOWER(txn_id)) WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS ix_payment_sms_proofs_status ON payment_sms_proofs (status, created_at DESC);
