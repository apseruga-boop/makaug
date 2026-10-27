'use strict';

// Display exchange rates for the currency switch. One place: the browser reads
// these from /config.js (window.MAKAUG_FX) and GET /api/fx.
// Prices are stored in UGX; these only convert for display and search.
//
// Since 25 Oct 2026 the rates are fetched once a day (services/fxRateService).
// The fixed rates below are only the last resort, used when no daily rate has
// ever been accepted:
//   USD: USD_TO_UGX_RATE (utils/propertyPriceCurrency), else 3,800
//   GBP / EUR: GBP_TO_UGX_RATE / EUR_TO_UGX_RATE, else 4,900 / 4,100
//   as_of: FX_RATES_AS_OF (YYYY-MM-DD), else the date the defaults were last set

const {
  DEFAULT_EUR_TO_UGX_RATE,
  DEFAULT_FX_AS_OF,
  DEFAULT_GBP_TO_UGX_RATE,
  displayRates
} = require('../services/fxRateService');

function publicDisplayFx(env = process.env) {
  return displayRates(env);
}

module.exports = { DEFAULT_EUR_TO_UGX_RATE, DEFAULT_FX_AS_OF, DEFAULT_GBP_TO_UGX_RATE, publicDisplayFx };
