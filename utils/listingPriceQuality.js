'use strict';

const { monthlyFactor, normalizePricePeriod } = require('../config/pricePeriods');

const RECURRING_PERIODS = new Set([
  'month',
  'monthly',
  'mo',
  'per_month',
  'week',
  'weekly',
  'per_week',
  'night',
  'nightly',
  'day',
  'daily',
  'semester',
  'sem',
  'term',
  'year',
  'yearly',
  'annual',
  'annually'
]);

const LOW_RECURRING_PRICE_UGX = 30_000;
// Sensible ranges (UGX). Outside them a person must confirm the price basis.
const ONE_OFF_MIN_UGX = 1_000_000;
const ONE_OFF_MAX_UGX = 20_000_000_000;
const MONTHLY_MIN_UGX = 50_000;
const MONTHLY_MAX_UGX = 100_000_000;
// Never possible, and never approvable even with a staff override.
const IMPOSSIBLE_PRICE_UGX = 1e12;
const MAX_PLAUSIBLE_USD_ORIGINAL = 3_000_000;
const MONTHLY_PERIODS = new Set(['month', 'monthly', 'mo', 'per_month']);
const NIGHTLY_PERIODS = new Set(['night', 'nightly', 'day', 'daily']);

function clean(value = '') {
  return String(value ?? '').trim();
}

function normalizedCategory(row = {}) {
  const raw = clean(row.listing_type || row.listingType || row.category).toLowerCase();
  return raw === 'students' ? 'student' : raw;
}

function normalizedPeriod(row = {}) {
  return clean(row.price_period || row.pricePeriod || row.period)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function sourceEvidenceText(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object'
    ? row.extra_fields
    : {};
  return [
    row.title,
    row.description,
    row.source_title,
    row.sourceTitle,
    row.source_caption,
    row.sourceCaption,
    row.source_text,
    row.sourceText,
    row.source_visual_text,
    row.sourceVisualText,
    extra.source_title,
    extra.source_caption,
    extra.source_text,
    extra.source_visual_text,
    extra.source_card_description,
    extra.raw_source_post?.title,
    extra.raw_source_post?.caption,
    extra.raw_source_post?.description,
    extra.raw_source_post?.source_text
  ].map(clean).filter(Boolean).join(' ').toLowerCase();
}

function hasExplicitSaleEvidence(text = '') {
  return /\b(for sale|on sale|available for sale|selling|guide price|asking price|cash price|purchase price)\b/i.test(text);
}

function hasExplicitRentEvidence(text = '') {
  return /\b(for rent|to rent|to let|for lease|available to rent|monthly rent|rent per month|per month|\/month|\/mo)\b/i.test(text);
}

function hasPriceFigureEvidence(text = '') {
  return /(?:\b(?:ugx|ush|shs?|usd|us\$)\s*\d|\$\s*\d|\b\d+(?:\.\d+)?\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands)\b)/i.test(text);
}

function isPriceOnApplication(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return row.price_on_application === true
    || row.priceOnApplication === true
    || extra.price_on_application === true
    || extra.price_upon_application === true
    || normalizePricePeriod(normalizedPeriod(row)) === 'poa';
}

function listingPriceQuality(row = {}, options = {}) {
  const category = normalizedCategory(row);
  const rawPeriod = normalizedPeriod(row);
  // C20: compare canonical spellings (wk -> week, yr -> year, sem -> semester).
  const period = normalizePricePeriod(rawPeriod) || '';
  const price = Number(row.price);
  const priceOnApplication = isPriceOnApplication(row);
  const transaction = clean(row.transaction_type || row.transactionType).toLowerCase();
  // Land let by the year or month (or per acre per year) is a recurring price.
  const landRent = category === 'land' && transaction === 'rent';
  const evidence = sourceEvidenceText(row);
  const recurring = RECURRING_PERIODS.has(period) || period === 'acre_yr';
  const factor = monthlyFactor(period);
  // Monthly equivalent for range checks: a yearly rent of UGX 120M is 10M a month.
  const monthlyEquivalent = Number.isFinite(price) && factor ? price * factor : null;
  const oneOff = ['once', 'one_off', 'total', 'sale', 'cash'].includes(period);
  const explicitSale = hasExplicitSaleEvidence(evidence);
  const explicitRent = hasExplicitRentEvidence(evidence);
  const wholeProperty = ['sale', 'land', 'commercial'].includes(category);
  const confirmedHighMonthly = options.highMonthlyPriceConfirmed === true;
  const reasons = [];
  const warnings = [];
  const hardReasons = [];
  const originalCurrency = clean(row.price_original_currency || row.priceOriginalCurrency).toUpperCase();
  const originalAmount = Number(row.price_original ?? row.priceOriginal);
  if (Number.isFinite(price) && price > IMPOSSIBLE_PRICE_UGX) hardReasons.push('price_impossible_above_1e12');
  if (originalCurrency === 'USD' && Number.isFinite(originalAmount) && originalAmount > MAX_PLAUSIBLE_USD_ORIGINAL) {
    hardReasons.push('usd_original_looks_like_ugx');
  }

  if ((!Number.isFinite(price) || price <= 1) && priceOnApplication) {
    // C20: Price on application with no number is a valid listing.
  } else if (!Number.isFinite(price) || price <= 1) {
    reasons.push('missing_or_placeholder_price');
  } else if (wholeProperty && price < 100_000) {
    reasons.push('whole_property_price_below_100k');
  }

  if (options.requireSourcePriceEvidence === true && !hasPriceFigureEvidence(evidence)) {
    reasons.push('source_price_figure_missing');
  }

  if (category === 'sale' && recurring) reasons.push('sale_price_marked_recurring');
  if (category === 'land' && recurring && !landRent) reasons.push('land_price_marked_recurring');
  if (category === 'rent' && oneOff) reasons.push('rent_price_marked_one_off');
  if (category === 'student' && oneOff) reasons.push('student_price_marked_one_off');

  if (category === 'commercial' && recurring) {
    if (explicitSale || clean(row.transaction_type || row.transactionType).toLowerCase() === 'sale') {
      reasons.push('commercial_sale_price_marked_recurring');
    } else if (!explicitRent) {
      reasons.push('commercial_monthly_price_without_rent_evidence');
    }
  }

  if (recurring && !NIGHTLY_PERIODS.has(period) && Number.isFinite(monthlyEquivalent ?? price) && (monthlyEquivalent ?? price) >= 100_000_000) {
    if (confirmedHighMonthly) {
      warnings.push('high_monthly_price_staff_confirmed');
    } else {
      reasons.push('high_monthly_price_requires_staff_confirmation');
    }
  }

  if (
    recurring
    && !NIGHTLY_PERIODS.has(period)
    && Number.isFinite(price)
    && price > 1
    && (monthlyEquivalent ?? price) < LOW_RECURRING_PRICE_UGX
    && ['rent', 'student'].includes(category)
  ) {
    reasons.push('recurring_price_below_30k');
  }

  // Range checks: one-off (sale / land / commercial sale) and monthly prices.
  const priceBasisConfirmed = confirmedHighMonthly || options.priceBasisConfirmed === true;
  if (Number.isFinite(price) && price > 1) {
    const oneOffPrice = !recurring && wholeProperty;
    if (oneOffPrice && price < ONE_OFF_MIN_UGX) {
      if (priceBasisConfirmed) warnings.push('low_one_off_price_staff_confirmed'); else reasons.push('one_off_price_below_1m');
    }
    if (oneOffPrice && price > ONE_OFF_MAX_UGX) {
      if (priceBasisConfirmed) warnings.push('high_one_off_price_staff_confirmed'); else reasons.push('one_off_price_above_20bn');
    }
    if (MONTHLY_PERIODS.has(period) && price < MONTHLY_MIN_UGX && ['rent', 'commercial'].includes(category)) {
      if (priceBasisConfirmed) warnings.push('low_monthly_price_staff_confirmed'); else reasons.push('monthly_price_below_50k');
    }
  }

  if (category === 'student' && recurring && Number.isFinite(monthlyEquivalent ?? price) && (monthlyEquivalent ?? price) > 5_000_000) {
    reasons.push('student_recurring_price_above_5m');
  }

  if (category === 'student' && !recurring && explicitSale) {
    reasons.push('student_category_contains_sale_asset');
  }

  reasons.push(...hardReasons);
  return {
    ok: reasons.length === 0,
    // Hard reasons can't be overridden by anyone; the price must be corrected.
    hard_reasons: [...new Set(hardReasons)],
    blocked_even_with_override: hardReasons.length > 0,
    category,
    price: Number.isFinite(price) ? price : null,
    period,
    price_on_application: priceOnApplication,
    monthly_equivalent: monthlyEquivalent,
    recurring,
    explicit_sale_evidence: explicitSale,
    explicit_rent_evidence: explicitRent,
    price_figure_evidence: hasPriceFigureEvidence(evidence),
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)]
  };
}

module.exports = {
  IMPOSSIBLE_PRICE_UGX,
  MONTHLY_MAX_UGX,
  MONTHLY_MIN_UGX,
  ONE_OFF_MAX_UGX,
  ONE_OFF_MIN_UGX,
  RECURRING_PERIODS,
  LOW_RECURRING_PRICE_UGX,
  hasExplicitRentEvidence,
  hasExplicitSaleEvidence,
  hasPriceFigureEvidence,
  isPriceOnApplication,
  listingPriceQuality,
  normalizedCategory,
  normalizedPeriod,
  sourceEvidenceText
};
