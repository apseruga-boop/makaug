-- Manual rollback for db/migrations/182_fx_rates.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
--
-- Deploy the previous application first. The new build tolerates a missing
-- fx_rates table (it falls back to the fixed rates), but the previous build
-- never reads it, so that order is the safe one.
--
-- Only the stored daily rates are removed. Listing prices are not affected.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

DROP TABLE IF EXISTS fx_rates;
