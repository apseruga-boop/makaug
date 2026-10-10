-- C21 (10 Oct 2026, Arthur and Finance): two dates on the agent billing record.
-- Schema only. Nullable, no default, no data change.
--   fee_exempt_until: a fee-exempt agent stays free until this date. Staff set
--     2027-02-01 in Admin for Finance's list; nothing here writes it.
--   trial_ends_at: the last free day of a new agent's trial (approval + 14 days).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_exempt_until DATE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS trial_ends_at DATE;
