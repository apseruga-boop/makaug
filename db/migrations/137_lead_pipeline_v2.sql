-- Lead pipeline v2 (28 Sept 2026)
--
-- One lead per real enquiry, a record of whether it actually reached the
-- lister, and test leads kept out of the numbers.
--
--   * dedupe_key / repeat_count: the same person asking about the same listing
--     (or the same need) inside the dedupe window updates one lead instead of
--     creating another. Billable counts stop inflating on repeat clicks.
--   * handoff_*: what makaug did with the lead — sent to the lister, queued on
--     the WhatsApp bridge, contact shown only (found-online), or failed.
--   * is_test: admin self-checks and QA runs never reach counts or exports.
--   * contacts.phone_key: anonymous enquirers are matched by phone/email, so one
--     person is one contact rather than a new row per click.
--   * lead_status canonical set: open, handed_over, contacted, qualified, won,
--     lost, spam, closed. "Open" in every dashboard means the first four.
--
-- Production safety: this runs at startup inside one transaction while the old
-- instance is still serving. Everything here is metadata-only or touches a
-- handful of rows; the one large backfill (contacts.phone_key) is done in
-- batches afterwards by scripts/backfill-lead-pipeline-v2.js. If a lock cannot
-- be taken quickly the migration fails and the deploy is retried, rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_repeat_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handoff_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handoff_detail JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS dedupe_day DATE;

CREATE INDEX IF NOT EXISTS idx_leads_dedupe_recent
  ON leads(dedupe_key, created_at DESC)
  WHERE dedupe_key IS NOT NULL;

-- Two submissions racing each other (a double tap on slow 3G) cannot both
-- create a lead: the second hits this and becomes a repeat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_dedupe_day
  ON leads(dedupe_key, dedupe_day)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_listing_created
  ON leads(listing_id, created_at DESC)
  WHERE listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_real_status
  ON leads(lead_status, created_at DESC)
  WHERE is_test = FALSE;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_key TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_key
  ON contacts(phone_key)
  WHERE phone_key IS NOT NULL;

ALTER TABLE property_inquiries ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE property_inquiries ADD COLUMN IF NOT EXISTS is_repeat BOOLEAN NOT NULL DEFAULT FALSE;

-- Test and QA leads already in the CRM.
UPDATE leads
   SET is_test = TRUE
 WHERE is_test = FALSE
   AND (
     source ~* '(^|_)(qa|test|demo|smoke|soft_launch|launch_proof)(_|$)'
     OR COALESCE(metadata->>'launch_proof', '') ~* '^(true|1|yes)$'
     OR COALESCE(metadata->>'is_test', '') ~* '^(true|1|yes)$'
   );

-- Status: 'new' was never written by the app but is harmless to fold in.
UPDATE leads SET lead_status = 'open' WHERE lead_status IN ('new', 'New', 'NEW');

-- Agent counters: same columns as before, but test leads and listing-owner
-- self-submissions no longer count as buyer leads.
CREATE OR REPLACE VIEW agent_monthly_lead_counters AS
SELECT
  agent_id,
  date_trunc('month', created_at)::date AS month_start,
  COUNT(*)::int AS lead_count,
  COUNT(*) FILTER (WHERE billable = true)::int AS billable_count,
  COUNT(*) FILTER (WHERE charged = true)::int AS charged_count,
  MAX(created_at) AS last_lead_at
FROM leads
WHERE agent_id IS NOT NULL
  AND is_test = FALSE
  AND lead_type IN ('enquiry', 'viewing', 'callback')
GROUP BY agent_id, date_trunc('month', created_at)::date;
