-- PR G4 (rate card 2026-10-08): fee exemptions get an end date.
-- Schema only. Nullable, no default, no data change: the 14 real exempt agents
-- are given 2027-02-01 by db/manual/pricing/195_fee_exempt_until_20270201.sql,
-- which Arthur runs himself.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_exempt_until DATE;
