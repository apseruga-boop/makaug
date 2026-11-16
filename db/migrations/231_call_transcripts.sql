-- Calling screen: live call transcripts (text only, never audio) and a next
-- step on every call.
--
-- The browser turns the call into text live (Chrome speech-to-text, phone on
-- loudspeaker). No audio file is ever created or kept. Only the text, a
-- rule-based summary, the suggested outcome and next step, and what the
-- caller confirmed are stored. next_step closes the loop: every call that is
-- not a close or a final "no" must say what happens next.
--
-- Rollback:
--   ALTER TABLE call_attempts DROP COLUMN IF EXISTS transcript;
--   ALTER TABLE call_attempts DROP COLUMN IF EXISTS next_step;
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS transcript JSONB;
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS next_step TEXT;
