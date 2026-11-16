-- Calling screen: "Text them our WhatsApp number" (SMS from the company SIM via
-- an sms: link, logged here) and the agent-video unlock flow:
-- locked until the number has messaged our WhatsApp first -> caller requests
-- -> King approves -> makaug's WhatsApp sends a ref-tagged link (/v/<ref>).
--
-- Rollback:
--   DROP TABLE IF EXISTS call_video_requests;
--   DROP TABLE IF EXISTS call_sms_log;
CREATE TABLE IF NOT EXISTS call_sms_log (
  id BIGSERIAL PRIMARY KEY,
  phone_key TEXT NOT NULL,
  attempt_id UUID,
  person_key TEXT,
  lang TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_call_sms_log_phone ON call_sms_log (phone_key, at DESC);
CREATE TABLE IF NOT EXISTS call_video_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_key TEXT NOT NULL,
  phone TEXT NOT NULL,
  full_name TEXT,
  attempt_id UUID,
  person_key TEXT NOT NULL,
  video_key TEXT NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'sent')),
  hello_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  sent_at TIMESTAMPTZ,
  sent_via TEXT,
  send_reason TEXT,
  opens INTEGER NOT NULL DEFAULT 0,
  first_opened_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_call_video_requests_open ON call_video_requests (phone_key) WHERE status IN ('requested', 'approved');
