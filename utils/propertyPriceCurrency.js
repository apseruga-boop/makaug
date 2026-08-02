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
  return SUPPORTED_PROPERTY_PRICE_CURRENCIES.has(normalized) ? normalized : '';
}

function sourceCurrencyForValue(value, explicitCurrency = '') {
  const explicit = String(explicitCurrency || '').trim();
  if (explicit) return normalizePropertyPriceCurrency(explicit);
  const raw = String(value ?? '').trim();
  if (/\b(?:RWF|FRW|KES|KSH|TZS|TSH|INR|LKR)\b|₹/i.test(raw)) return '';
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
  const multiplier = /\d(?:\.\d+)?\s*(b|bn|billions?)(?=\s*(?:ugx|ush|shs?)\b|\b|$)/.test(raw)
    ? 1000000000
    : /\d(?:\.\d+)?\s*(m|mn|millions?)(?=\s*(?:ugx|ush|shs?)\b|\b|$)/.test(raw)
      ? 1000000
      : /\d(?:\.\d+)?\s*(k|thousands?)(?=\s*(?:ugx|ush|shs?)\b|\b|$)/.test(raw)
        ? 1000
        : 1;
  return Math.round(amount * multiplier);
}

function propertyPriceMetadata(value, options = {}) {
  const currency = sourceCurrencyForValue(value, options.currency);
  if (!currency) {
    return {
      price: null,
      price_currency: null,
      price_original: null,
      price_fx_rate_ugx: null,
      price_fx_as_of: null,
      supported: false,
      rejection_reason: 'unsupported_property_price_currency'
    };
  }
  const originalAmount = sourcePriceAmount(value);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return {
      price: null,
      price_currency: currency,
      price_original: null,
      price_fx_rate_ugx: null,
      price_fx_as_of: null,
      supported: true,
      rejection_reason: ''
    };
  }

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
      : null,
    supported: true,
    rejection_reason: ''
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
