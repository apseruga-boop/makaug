-- 240: King "Asked for money" card (17 Nov 2026). Two data fixes, both on pay_links.
--
-- 1. Test links. A column so a test request (Arthur's UGX 1,000 link of 3 Oct,
--    "Test payment — makaug payment links") reads "Test" and is counted nowhere.
-- 2. Reminders that went out before 15 Nov carried a pay link but never stamped
--    it as sent (fixed in code by billingOpsService.markPayLinkSent). Those
--    people were asked for money and were missing from the list. sent_at is
--    filled from the agent's own reminder log: the first reminder queued within
--    two minutes of the link being made. A production read-only check on
--    17 Nov found three such links (agents: George W., Sewa s., Kaketo m.).
--
-- Backup: pay_links_chase_240_backup (the before values of every row touched).
-- Rollback: scripts/rollback-240-pay-links-chase-tidy.sql. Nothing is deleted.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE pay_links ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS pay_links_chase_240_backup (
  pay_link_id UUID PRIMARY KEY,
  code TEXT NOT NULL,
  change TEXT NOT NULL,
  before_is_test BOOLEAN,
  before_sent_at TIMESTAMPTZ,
  before_sent_status TEXT,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Test links: made by staff for a one-off "other" amount whose description says test.
WITH t AS (
  SELECT id, code, is_test FROM pay_links
   WHERE purpose = 'other' AND is_test = FALSE AND status = 'open'
     AND description ~* '^\s*test\y' AND amount_ugx <= 5000
)
INSERT INTO pay_links_chase_240_backup (pay_link_id, code, change, before_is_test, before_sent_at, before_sent_status)
SELECT t.id, t.code, 'is_test', t.is_test, l.sent_at, l.sent_status FROM t JOIN pay_links l ON l.id = t.id
ON CONFLICT (pay_link_id) DO NOTHING;

UPDATE pay_links l SET is_test = TRUE, updated_at = NOW()
  FROM pay_links_chase_240_backup b
 WHERE b.pay_link_id = l.id AND b.change = 'is_test' AND l.is_test = FALSE;

-- 2. Reminder links never stamped as sent.
WITH r AS (
  SELECT l.id, l.code, l.sent_at, l.sent_status,
         (SELECT MIN((v->>'at')::timestamptz) FROM jsonb_each(COALESCE(a.billing_reminder_log, '{}'::jsonb)) AS e(k, v)
           WHERE jsonb_typeof(v) = 'object' AND v ? 'at'
             AND COALESCE(v->>'status', '') NOT IN ('skipped', 'failed')
             AND ABS(EXTRACT(EPOCH FROM ((v->>'at')::timestamptz - l.created_at))) <= 120) AS reminder_at
    FROM pay_links l JOIN agents a ON a.id = l.agent_id
   WHERE l.status = 'open' AND l.sent_at IS NULL AND l.created_by = 'billing'
)
INSERT INTO pay_links_chase_240_backup (pay_link_id, code, change, before_is_test, before_sent_at, before_sent_status)
SELECT r.id, r.code, 'sent_at:' || r.reminder_at::text, FALSE, r.sent_at, r.sent_status FROM r WHERE r.reminder_at IS NOT NULL
ON CONFLICT (pay_link_id) DO NOTHING;

UPDATE pay_links l
   SET sent_at = SUBSTRING(b.change FROM 9)::timestamptz,
       sent_status = 'queued',
       updated_at = NOW()
  FROM pay_links_chase_240_backup b
 WHERE b.pay_link_id = l.id AND b.change LIKE 'sent_at:%' AND l.sent_at IS NULL;
