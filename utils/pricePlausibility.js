'use strict';

// Plausibility bounds for listing prices (C17, 10 Oct 2026; Arthur: "make sure
// you fix this, use price upon application"). One helper for every write path
// and every display: a price outside these bounds is never stored or shown as
// a number. It becomes "Price on application" and staff see a "check price" tag.
//
//   sale or commercial sale   UGX 5M  to 50B
//   land                      UGX 1M  to 50B   (per acre / per plot too)
//   rent, student, land rent, short-term
//                             UGX 50k to 100M a month (weekly, yearly and
//                             semester prices are turned into a monthly figure first)
//   commercial rent           UGX 50k to 2B a month (a warehouse or a whole
//                             office block can pass 100M a month; staff still
//                             confirm anything above 100M in listingPriceQuality)

const { monthlyFactor, normalizePricePeriod } = require('../config/pricePeriods');

const PRICE_BOUNDS_UGX = Object.freeze({
  sale: [5_000_000, 50_000_000_000],
  land: [1_000_000, 50_000_000_000],
  monthly: [50_000, 100_000_000],
  commercial_monthly: [50_000, 2_000_000_000]
});

const RECURRING = new Set(['month', 'week', 'year', 'semester', 'acre_yr', 'night']);

function clean(value) {
  return String(value ?? '').trim().toLowerCase();
}

function categoryOf(record = {}) {
  const raw = clean(record.listing_type || record.listingType || record.category);
  return raw === 'students' ? 'student' : raw;
}

// Which bound applies: 'sale', 'land' or 'monthly'.
function priceBoundKind(record = {}) {
  const category = categoryOf(record);
  const period = normalizePricePeriod(clean(record.price_period || record.pricePeriod)) || '';
  const transaction = clean(record.transaction_type || record.transactionType || record?.extra_fields?.transaction_type);
  if (['rent', 'student', 'short_term', 'short-term'].includes(category)) return 'monthly';
  if (category === 'land') return RECURRING.has(period) && transaction !== 'sale' ? 'monthly' : 'land';
  if (category === 'commercial') return transaction === 'rent' || RECURRING.has(period) ? 'commercial_monthly' : 'sale';
  return RECURRING.has(period) ? 'monthly' : 'sale';
}

/**
 * { plausible, kind, price, monthly_price, bounds, reason }. A missing price is
 * not "implausible" (it is POA or simply missing); only a number outside the
 * bounds is.
 */
function pricePlausibility(record = {}) {
  const price = Number(record.price);
  const kind = priceBoundKind(record);
  const bounds = PRICE_BOUNDS_UGX[kind];
  // The bounds are Uganda shillings; other markets (South Africa, ZAR) don't use them.
  if (String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() !== 'UG') {
    return { plausible: true, kind, price: Number.isFinite(price) && price > 0 ? price : null, monthly_price: null, bounds, reason: 'bounds_not_configured_for_country' };
  }
  if (record.price == null || record.price === '' || !Number.isFinite(price) || price <= 0) {
    return { plausible: true, kind, price: null, monthly_price: null, bounds, reason: 'no_price' };
  }
  const period = normalizePricePeriod(clean(record.price_period || record.pricePeriod)) || '';
  let compared = price;
  const monthlyKind = kind === 'monthly' || kind === 'commercial_monthly';
  if (monthlyKind) {
    // A nightly price is compared as 30 nights; acre_yr as a yearly figure.
    const factor = period === 'night' ? 30 : (period === 'acre_yr' ? 1 / 12 : monthlyFactor(period));
    compared = factor ? price * factor : price;
  }
  const [min, max] = bounds;
  if (compared > max) return { plausible: false, kind, price, monthly_price: monthlyKind ? compared : null, bounds, reason: 'price_above_plausible_bounds' };
  if (compared < min) return { plausible: false, kind, price, monthly_price: monthlyKind ? compared : null, bounds, reason: 'price_below_plausible_bounds' };
  return { plausible: true, kind, price, monthly_price: monthlyKind ? compared : null, bounds, reason: '' };
}

function isPriceImplausible(record = {}) {
  return pricePlausibility(record).plausible === false;
}

// For write paths. Returns a copy of the record: an implausible price becomes
// POA (price NULL, price_on_application true, extra_fields.price_review =
// 'implausible') and the raw figures are kept in extra_fields. Don't guess a
// corrected number.
function applyPricePlausibility(record = {}, { now = new Date().toISOString(), source = '' } = {}) {
  const check = pricePlausibility(record);
  if (check.plausible) return { record, changed: false, check };
  const extra = record.extra_fields && typeof record.extra_fields === 'object' ? { ...record.extra_fields } : {};
  extra.price_review = 'implausible';
  extra.price_review_reason = check.reason;
  extra.price_review_at = now;
  if (source) extra.price_review_source = source;
  extra.implausible_price_raw = {
    price: record.price,
    price_original: record.price_original ?? null,
    price_original_currency: record.price_original_currency ?? null,
    price_period: record.price_period ?? null,
    bounds_ugx: check.bounds,
    monthly_price_ugx: check.monthly_price
  };
  extra.price_on_application = true;
  return {
    changed: true,
    check,
    record: {
      ...record,
      price: null,
      price_original: null,
      price_fx_rate_ugx: null,
      price_fx_as_of: null,
      price_on_application: true,
      extra_fields: extra
    }
  };
}

// For read paths: a listing that should show "Price on application".
function showsPriceOnApplication(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' ? record.extra_fields : {};
  return record.price_on_application === true
    || extra.price_on_application === true
    || extra.price_upon_application === true
    || extra.price_review === 'implausible'
    || isPriceImplausible(record)
    || !(Number(record.price) > 0);
}

module.exports = {
  PRICE_BOUNDS_UGX,
  applyPricePlausibility,
  isPriceImplausible,
  priceBoundKind,
  pricePlausibility,
  showsPriceOnApplication
};
