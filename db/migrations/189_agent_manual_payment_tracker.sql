-- Agent payment tracker: the dates staff type in by hand (asked for by Arthur
-- on 26 Oct 2026). Adds three nullable columns to agents and changes no
-- existing row.
--
--   plan_started_on   first day of the agent's current paid (or free) period
--   last_payment_on   date of the last payment staff know about
--   last_payment_ugx  amount of that payment, in UGX
--
-- The payment ledger (revenue_entries, kind 'agent_subscription') stays the
-- main record. These columns only hold what staff were told outside it,
-- and every edit is written to audit_logs by the King agent manager.
--
-- Rollback: scripts/rollback-189-agent-manual-payment-tracker.sql

ALTER TABLE agents ADD COLUMN IF NOT EXISTS plan_started_on DATE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_payment_on DATE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_payment_ugx INTEGER;
