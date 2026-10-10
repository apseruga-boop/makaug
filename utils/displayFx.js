'use strict';

// Display exchange rates for the currency switch (C6, 10 Oct 2026). One place:
// the browser reads these from /config.js (window.MAKAUG_FX) and GET /api/fx.
// Prices are stored and charged in UGX; these only convert for display.
//   USD: the same USD_TO_UGX_RATE the price import uses (utils/propertyPriceCurrency)
//   GBP / EUR: GBP_TO_UGX_RATE / EUR_TO_UGX_RATE, else the long-standing defaults
//   as_of: FX_RATES_AS_OF (YYYY-MM-DD), else the date the defaults were last set

const { configuredUsdToUgxRate } = require('./propertyPriceCurrency');

const DEFAULT_GBP_TO_UGX_RATE = 4900;
const DEFAULT_EUR_TO_UGX_RATE = 4100;
const DEFAULT_FX_AS_OF = '2026-10-01';

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function publicDisplayFx(env = process.env) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(env.FX_RATES_AS_OF || '').trim()) ? String(env.FX_RATES_AS_OF).trim() : DEFAULT_FX_AS_OF;
  return {
    base: 'UGX',
    as_of: asOf,
    rates: {
      USD: configuredUsdToUgxRate(),
      GBP: positiveNumber(env.GBP_TO_UGX_RATE, DEFAULT_GBP_TO_UGX_RATE),
      EUR: positiveNumber(env.EUR_TO_UGX_RATE, DEFAULT_EUR_TO_UGX_RATE)
    },
    note: 'Approximate display rates. Prices are set in Uganda shillings.'
  };
}

module.exports = { DEFAULT_EUR_TO_UGX_RATE, DEFAULT_FX_AS_OF, DEFAULT_GBP_TO_UGX_RATE, publicDisplayFx };
