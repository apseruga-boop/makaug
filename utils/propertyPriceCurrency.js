const DEFAULT_USD_TO_UGX_RATE = 3800;
const DEFAULT_USD_TO_ZAR_RATE = 18;
const DEFAULT_EUR_TO_ZAR_RATE = 21;
const DEFAULT_GBP_TO_ZAR_RATE = 24;
const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const CANONICAL_PROPERTY_CURRENCY = ACTIVE_COUNTRY_CODE === 'ZA' ? 'ZAR' : 'UGX';
const SUPPORTED_PROPERTY_PRICE_CURRENCIES = new Set(
  ACTIVE_COUNTRY_CODE === 'ZA' ? ['ZAR', 'USD', 'EUR', 'GBP'] : ['UGX', 'USD']
);

function configuredUsdToUgxRate() {
  const configured = Number(process.env.USD_TO_UGX_RATE || process.env.USD_TO_UGX_GUIDE_RATE);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_USD_TO_UGX_RATE;
}

function configuredRateToCanonicalCurrency(currency = 'USD') {
  const normalized = String(currency || '').toUpperCase();
  if (normalized === CANONICAL_PROPERTY_CURRENCY) return 1;
  if (CANONICAL_PROPERTY_CURRENCY === 'UGX' && normalized === 'USD') return configuredUsdToUgxRate();
  const defaults = { USD: DEFAULT_USD_TO_ZAR_RATE, EUR: DEFAULT_EUR_TO_ZAR_RATE, GBP: DEFAULT_GBP_TO_ZAR_RATE };
  const configured = Number(process.env[`${normalized}_TO_ZAR_RATE`]);
  return Number.isFinite(configured) && configured > 0 ? configured : (defaults[normalized] || NaN);
}

function normalizePropertyPriceCurrency(value = CANONICAL_PROPERTY_CURRENCY) {
  const normalized = String(value || CANONICAL_PROPERTY_CURRENCY).trim().toUpperCase();
  if (normalized === 'USH' || normalized === 'UGS') return 'UGX';
  if (normalized === 'R' || normalized === 'RAND') return 'ZAR';
  return SUPPORTED_PROPERTY_PRICE_CURRENCIES.has(normalized) ? normalized : '';
}

function sourceCurrencyForValue(value, explicitCurrency = '') {
  const explicit = String(explicitCurrency || '').trim();
  if (explicit) return normalizePropertyPriceCurrency(explicit);
  const raw = String(value ?? '').trim();
  if (ACTIVE_COUNTRY_CODE === 'ZA') {
    if (/\b(?:UGX|USH|RWF|FRW|KES|KSH|TZS|TSH|INR|LKR|NGN)\b|₹|₦/i.test(raw)) return '';
    if (/(?:^|\s)(?:USD|US\$)\s*[\d.]|\$\s*[\d.]/i.test(raw)) return 'USD';
    if (/(?:^|\s)EUR\s*[\d.]|€\s*[\d.]/i.test(raw)) return 'EUR';
    if (/(?:^|\s)GBP\s*[\d.]|£\s*[\d.]/i.test(raw)) return 'GBP';
    if (/(?:^|[\s(])R\s*\d|\bZAR\s*\d/i.test(raw)) return 'ZAR';
    return 'ZAR';
  }
  if (/\b(?:ZAR|RWF|FRW|KES|KSH|TZS|TSH|INR|LKR)\b|₹/i.test(raw)) return '';
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
      price_original_currency: null,
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
      price_currency: CANONICAL_PROPERTY_CURRENCY,
      price_original_currency: currency,
      price_original: null,
      price_fx_rate_ugx: null,
      price_fx_as_of: null,
      supported: true,
      rejection_reason: ''
    };
  }

  const optionRate = currency === 'USD'
    ? Number(options.usdToUgxRate || options.usdToZarRate)
    : Number(options[`${currency.toLowerCase()}ToZarRate`]);
  const fxRate = currency === CANONICAL_PROPERTY_CURRENCY
    ? 1
    : (Number.isFinite(optionRate) && optionRate > 0 ? optionRate : configuredRateToCanonicalCurrency(currency));
  return {
    price: Math.round(originalAmount * fxRate),
    // `price` is the canonical country value used by search and sorting.
    // Preserve source-currency provenance separately.
    price_currency: CANONICAL_PROPERTY_CURRENCY,
    price_original_currency: currency,
    price_original: originalAmount,
    price_fx_rate_ugx: currency === CANONICAL_PROPERTY_CURRENCY ? null : fxRate,
    price_fx_rate: currency === CANONICAL_PROPERTY_CURRENCY ? null : fxRate,
    price_fx_as_of: currency !== CANONICAL_PROPERTY_CURRENCY
      ? (options.fxAsOf || new Date().toISOString())
      : null,
    supported: true,
    rejection_reason: ''
  };
}

module.exports = {
  DEFAULT_USD_TO_UGX_RATE,
  DEFAULT_USD_TO_ZAR_RATE,
  CANONICAL_PROPERTY_CURRENCY,
  configuredRateToCanonicalCurrency,
  configuredUsdToUgxRate,
  normalizePropertyPriceCurrency,
  propertyPriceMetadata,
  sourceCurrencyForValue,
  sourcePriceAmount
};
