const DEFAULT_USD_TO_UGX_RATE = 3800;
const SUPPORTED_PROPERTY_PRICE_CURRENCIES = new Set(['UGX', 'USD']);

function configuredUsdToUgxRate() {
  const configured = Number(process.env.USD_TO_UGX_RATE || process.env.USD_TO_UGX_GUIDE_RATE);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_USD_TO_UGX_RATE;
}

function normalizePropertyPriceCurrency(value = 'UGX') {
  const normalized = String(value || 'UGX').trim().toUpperCase();
  if (normalized === 'USH' || normalized === 'UGS') return 'UGX';
  return SUPPORTED_PROPERTY_PRICE_CURRENCIES.has(normalized) ? normalized : 'UGX';
}

function sourceCurrencyForValue(value, explicitCurrency = '') {
  const explicit = String(explicitCurrency || '').trim();
  if (explicit) return normalizePropertyPriceCurrency(explicit);
  const raw = String(value ?? '').trim();
  return /(?:^|\s)(?:USD|US\$)\s*[\d.]|\$\s*[\d.]/i.test(raw) ? 'USD' : 'UGX';
}

function sourcePriceAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const raw = String(value || '').toLowerCase().replace(/,/g, '').trim();
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = /\d(?:\.\d+)?\s*(b|bn|billions?)\b/.test(raw)
    ? 1000000000
    : /\d(?:\.\d+)?\s*(m|mn|millions?)\b/.test(raw)
      ? 1000000
      : /\d(?:\.\d+)?\s*(k|thousands?)\b/.test(raw)
        ? 1000
        : 1;
  return Math.round(amount * multiplier);
}

function propertyPriceMetadata(value, options = {}) {
  const originalAmount = sourcePriceAmount(value);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return {
      price: null,
      price_currency: normalizePropertyPriceCurrency(options.currency),
      price_original: null,
      price_fx_rate_ugx: null,
      price_fx_as_of: null
    };
  }

  const currency = sourceCurrencyForValue(value, options.currency);
  const fxRate = currency === 'USD'
    ? Number(options.usdToUgxRate || configuredUsdToUgxRate())
    : 1;
  return {
    price: Math.round(originalAmount * fxRate),
    price_currency: currency,
    price_original: originalAmount,
    price_fx_rate_ugx: currency === 'USD' ? fxRate : null,
    price_fx_as_of: currency === 'USD'
      ? (options.fxAsOf || new Date().toISOString())
      : null
  };
}

module.exports = {
  DEFAULT_USD_TO_UGX_RATE,
  configuredUsdToUgxRate,
  normalizePropertyPriceCurrency,
  propertyPriceMetadata,
  sourceCurrencyForValue,
  sourcePriceAmount
};
