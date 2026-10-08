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

// Above this a "USD" original is almost certainly a shilling figure that was
// tagged USD (and would be multiplied by ~3,800 again).
const MAX_PLAUSIBLE_USD_ORIGINAL = 3_000_000;

const MULTIPLIERS = { b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9, m: 1e6, mn: 1e6, million: 1e6, millions: 1e6, k: 1e3, thousand: 1e3, thousands: 1e3 };

/**
 * Find the price in free text. It prefers the number next to a currency or a
 * price word ("UGX 9,500,000", "$2000/mo", "price 650m"), reads b/bn/m/k, and
 * for "X or Y" takes the first. Numbers that are bedrooms, plot sizes,
 * distances or phone numbers are skipped. Returns { amount, currency } where
 * currency is 'UGX' / 'USD' when the text says so next to the number, else ''.
 */
function parseSourcePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return { amount: Math.round(value), currency: '' };
  const raw = String(value || '').toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1') // 9,500,000 -> 9500000
    .replace(/(\d)\s(?=\d{3}\b)/g, '$1'); // 9 500 000 -> 9500000
  const rx = /(ugx|ush|shs?|usd|us\$|\$)?\s*(\d+(?:\.\d+)?)\s*(bn|billions?|b|mn|millions?|m|k|thousands?)?(?=ugx|ush|shs|usd|[^a-z0-9]|$)\s*(ugx|ush|shs?|usd|\/=|\/-)?/g;
  const candidates = [];
  let m;
  while ((m = rx.exec(raw))) {
    if (!m[2]) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    const before = raw.slice(Math.max(0, start - 24), start);
    const after = raw.slice(end, end + 18);
    const near = raw.slice(Math.max(0, start - 2), Math.min(raw.length, end + 3));
    const suffix = m[3] || '';
    const amount = Number(m[2]) * (MULTIPLIERS[suffix] || 1);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const curToken = m[1] || m[4] || '';
    const currency = /usd|\$/.test(curToken) ? 'USD' : (/ugx|ush|shs?|\/=|\/-/.test(curToken) ? 'UGX' : '');
    let score = 0;
    if (curToken) score += 4;
    if (suffix) score += 2;
    if (/(price|cost|asking|selling at|sale price|going for|rent|@|\bat\b|for\b|only|negotiable|nego)\W*$/.test(before)) score += 2;
    if (/^\s*(per|\/|a)\s*(month|mo|year|yr|semester|sem|night)/.test(after)) score += 2;
    if (/^\s*(bed|bedroom|br\b|bath|toilet|acre|decimal|ft|feet|sqm|sq|m2|km|miles?|minutes?|mins?|%|units?|rooms?|storey|floors?|plots?\b)/.test(after)) score -= 8;
    if (/x\s*$/.test(before) || /^\s*x\s*\d/.test(after) || /\d\s*x\s*\d/.test(near)) score -= 8; // 50x100
    if (/^(?:0|256)7\d{8}$/.test(m[2]) || m[2].length >= 10 && !suffix) score -= 8; // phone numbers
    if (amount < 1000 && !suffix && !curToken) score -= 3;
    candidates.push({ amount: Math.round(amount), currency, score, start });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.score - a.score) || (a.start - b.start));
  const best = candidates[0];
  if (best.score < -2) return null;
  return { amount: best.amount, currency: best.currency };
}

function sourcePriceAmount(value) {
  const parsed = parseSourcePrice(value);
  return parsed ? parsed.amount : null;
}

function propertyPriceMetadata(value, options = {}) {
  const parsed = parseSourcePrice(value);
  // The currency written next to the chosen number wins over a "$" elsewhere in
  // the text ("USh 9,500,000 … $" was read as USD and multiplied by 3,800).
  const currency = options.currency
    ? normalizePropertyPriceCurrency(options.currency)
    : (ACTIVE_COUNTRY_CODE !== 'ZA' && parsed?.currency ? parsed.currency : sourceCurrencyForValue(value, ''));
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
  const originalAmount = parsed ? parsed.amount : null;
  if (currency === 'USD' && CANONICAL_PROPERTY_CURRENCY === 'UGX' && Number(originalAmount) > MAX_PLAUSIBLE_USD_ORIGINAL) {
    return {
      price: null,
      price_currency: CANONICAL_PROPERTY_CURRENCY,
      price_original_currency: null,
      price_original: null,
      price_fx_rate_ugx: null,
      price_fx_as_of: null,
      supported: false,
      rejection_reason: 'usd_original_looks_like_ugx'
    };
  }
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

// One spelling per price period when saving: once | month | semester | year | night.
const PRICE_PERIOD_ALIASES = {
  mo: 'month', month: 'month', monthly: 'month', per_month: 'month', pm: 'month', 'p/m': 'month', '/month': 'month',
  sem: 'semester', semester: 'semester', per_semester: 'semester', term: 'semester',
  yr: 'year', year: 'year', yearly: 'year', annual: 'year', annually: 'year', per_year: 'year', pa: 'year',
  night: 'night', nightly: 'night', per_night: 'night',
  once: 'once', one_off: 'once', 'one-off': 'once', total: 'once', sale: 'once', cash: 'once', outright: 'once'
};

function normalizePricePeriodForWrite(value) {
  if (value == null) return value;
  const key = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  if (!key) return null;
  return PRICE_PERIOD_ALIASES[key] || String(value).trim();
}

module.exports = {
  MAX_PLAUSIBLE_USD_ORIGINAL,
  normalizePricePeriodForWrite,
  parseSourcePrice,
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
