-- Calling screen Texts tab (Arthur, 21 Nov 2026): every text a caller opens in the
-- texting app (sms: link via Phone Link) is logged with the template it used, so the
-- contact timeline says which text went out. Additive only.
--
-- Rollback: scripts/rollback-247-call-sms-template.sql
--   ALTER TABLE call_sms_log DROP COLUMN IF EXISTS template;
ALTER TABLE call_sms_log ADD COLUMN IF NOT EXISTS template TEXT;
