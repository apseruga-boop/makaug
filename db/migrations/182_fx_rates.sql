-- Daily exchange rates for showing and searching prices in UGX, USD, GBP
-- and EUR. services/fxRateService.js writes one row per currency per day
-- (UGX per one unit of the currency) and reads the newest row at boot, so a
-- restart keeps the last good rate even when the rate sources are down.
--
-- Listing prices are not touched. properties.price stays the stored UGX
-- amount; dollar-priced listings are converted from price_original at
-- today's rate when they are shown or searched.
--
-- 179 is reserved by another open change; 180 and 181 are used. This file
-- is 182. Rollback: scripts/rollback-182-fx-rates.sql.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('USD', 'GBP', 'EUR')),
  ugx_per_unit numeric(14, 4) NOT NULL CHECK (ugx_per_unit > 0),
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, currency)
);
