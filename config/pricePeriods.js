'use strict';

// One source of truth for listing price periods (C20, 10 Oct 2026).
//
// #162 added a strict per-category allow-list in listingDataIntegrity.js that
// didn't match what the listing forms offer, and the write normaliser had no
// spelling for wk, neg, poa, acre or plot. So anyone who picked Per Week, Per
// Year, Negotiable, Per Acre or POA got a listing that could not be approved.
// The forms (served to the browser through /config.js), the write normaliser,
// the integrity gate, the price-quality gate and the display suffixes all read
// this file now, so they can't drift apart again.

// Canonical stored spellings and how each one prints.
const PRICE_PERIODS = Object.freeze({
  once: { suffix: '', words: '' },
  neg: { suffix: '', words: 'Negotiable' },
  poa: { suffix: '', words: 'Price on application' },
  month: { suffix: '/month', words: 'per month', monthly_factor: 1 },
  week: { suffix: '/week', words: 'per week', monthly_factor: 52 / 12 },
  year: { suffix: '/year', words: 'per year', monthly_factor: 1 / 12 },
  semester: { suffix: '/semester', words: 'per semester', monthly_factor: 1 / 4 },
  acre: { suffix: '/acre', words: 'per acre' },
  plot: { suffix: '/plot', words: 'per plot' },
  acre_yr: { suffix: '/acre/year', words: 'per acre per year' },
  night: { suffix: '/night', words: 'per night' }
});

// Every spelling the forms, intake and old rows use, mapped to one canonical value.
const PRICE_PERIOD_ALIASES = Object.freeze({
  once: 'once', one_off: 'once', 'one-off': 'once', total: 'once', sale: 'once', cash: 'once', outright: 'once',
  neg: 'neg', negotiable: 'neg', nego: 'neg', ono: 'neg',
  poa: 'poa', price_on_application: 'poa', price_upon_application: 'poa', on_application: 'poa', on_request: 'poa', price_on_request: 'poa',
  mo: 'month', month: 'month', monthly: 'month', per_month: 'month', pm: 'month', 'p/m': 'month', '/month': 'month', mth: 'month',
  wk: 'week', week: 'week', weekly: 'week', per_week: 'week', pw: 'week', '/week': 'week',
  yr: 'year', year: 'year', yearly: 'year', annual: 'year', annually: 'year', per_year: 'year', pa: 'year', per_annum: 'year', '/year': 'year',
  sem: 'semester', semester: 'semester', per_semester: 'semester', term: 'semester', per_term: 'semester',
  acre: 'acre', per_acre: 'acre', '/acre': 'acre',
  plot: 'plot', per_plot: 'plot', '/plot': 'plot',
  acre_yr: 'acre_yr', acre_year: 'acre_yr', per_acre_per_year: 'acre_yr', per_acre_year: 'acre_yr',
  night: 'night', nightly: 'night', per_night: 'night', day: 'night', daily: 'night', per_day: 'night'
});

// Exactly what the listing forms offer, per form section. `value` is the form
// value the browser sends; it normalises to the canonical spelling above.
const PRICE_PERIOD_FORM_OPTIONS = Object.freeze({
  sale: [
    { value: 'once', label: 'Total / Once off' },
    { value: 'neg', label: 'Negotiable' },
    { value: 'poa', label: 'Price on application (POA)' }
  ],
  rent: [
    { value: 'mo', label: 'Per Month' },
    { value: 'yr', label: 'Per Year' },
    { value: 'wk', label: 'Per Week' }
  ],
  land_sale: [
    { value: 'once', label: 'Total / Once off' },
    { value: 'acre', label: 'Per Acre' },
    { value: 'plot', label: 'Per Plot' },
    { value: 'neg', label: 'Negotiable' },
    { value: 'poa', label: 'Price on application (POA)' }
  ],
  land_rent: [
    { value: 'yr', label: 'Per Year' },
    { value: 'mo', label: 'Per Month' },
    { value: 'acre_yr', label: 'Per Acre per Year' }
  ],
  commercial_sale: [
    { value: 'once', label: 'Total / Sale Price' },
    { value: 'neg', label: 'Negotiable' },
    { value: 'poa', label: 'Price on application (POA)' }
  ],
  commercial_rent: [
    { value: 'mo', label: 'Per Month' },
    { value: 'yr', label: 'Per Year' },
    { value: 'wk', label: 'Per Week' }
  ],
  student: [
    { value: 'sem', label: 'Per Semester' },
    { value: 'yr', label: 'Per Year' },
    { value: 'mo', label: 'Per Month' }
  ]
});

function normalizePricePeriod(value) {
  if (value == null) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return PRICE_PERIOD_ALIASES[key] || PRICE_PERIOD_ALIASES[raw.toLowerCase()] || raw;
}

// The form section a listing belongs to.
function pricePeriodSection(listingType = '', transactionType = '') {
  const type = String(listingType || '').trim().toLowerCase().replace(/^students$/, 'student');
  const transaction = String(transactionType || '').trim().toLowerCase();
  if (type === 'land') return transaction === 'rent' ? 'land_rent' : 'land_sale';
  if (type === 'commercial') return transaction === 'sale' ? 'commercial_sale' : (transaction === 'rent' ? 'commercial_rent' : '');
  if (['sale', 'rent', 'student'].includes(type)) return type;
  return '';
}

// Canonical periods allowed for a listing. Land that is being rented accepts
// the land-sale periods as well (a plot "for rent or sale" keeps its options).
function allowedPricePeriods(listingType = '', transactionType = '') {
  const section = pricePeriodSection(listingType, transactionType);
  const forSection = (key) => (PRICE_PERIOD_FORM_OPTIONS[key] || []).map((option) => normalizePricePeriod(option.value));
  if (!section) {
    if (String(listingType || '').trim().toLowerCase() === 'commercial') {
      return new Set([...forSection('commercial_sale'), ...forSection('commercial_rent')]);
    }
    return null;
  }
  const periods = new Set(forSection(section));
  if (section === 'land_rent') forSection('land_sale').forEach((period) => periods.add(period));
  return periods;
}

function pricePeriodSuffix(value) {
  return PRICE_PERIODS[normalizePricePeriod(value)]?.suffix || '';
}

function pricePeriodWords(value) {
  return PRICE_PERIODS[normalizePricePeriod(value)]?.words || '';
}

// Multiply a price for this period by the factor to get a monthly amount.
function monthlyFactor(value) {
  const factor = PRICE_PERIODS[normalizePricePeriod(value)]?.monthly_factor;
  return Number.isFinite(factor) ? factor : null;
}

const RECURRING_CANONICAL_PERIODS = Object.freeze(new Set(['month', 'week', 'year', 'semester', 'night', 'acre_yr']));

module.exports = {
  PRICE_PERIODS,
  PRICE_PERIOD_ALIASES,
  PRICE_PERIOD_FORM_OPTIONS,
  RECURRING_CANONICAL_PERIODS,
  allowedPricePeriods,
  monthlyFactor,
  normalizePricePeriod,
  pricePeriodSection,
  pricePeriodSuffix,
  pricePeriodWords
};
