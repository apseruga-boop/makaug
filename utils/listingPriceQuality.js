'use strict';

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

function listingPriceQuality(row = {}, options = {}) {
  const category = normalizedCategory(row);
  const period = normalizedPeriod(row);
  const price = Number(row.price);
  const evidence = sourceEvidenceText(row);
  const recurring = RECURRING_PERIODS.has(period);
  const oneOff = ['once', 'one_off', 'total', 'sale', 'cash'].includes(period);
  const explicitSale = hasExplicitSaleEvidence(evidence);
  const explicitRent = hasExplicitRentEvidence(evidence);
  const wholeProperty = ['sale', 'land', 'commercial'].includes(category);
  const confirmedHighMonthly = options.highMonthlyPriceConfirmed === true;
  const reasons = [];
  const warnings = [];

  if (!Number.isFinite(price) || price <= 1) {
    reasons.push('missing_or_placeholder_price');
  } else if (wholeProperty && price < 100_000) {
    reasons.push('whole_property_price_below_100k');
  }

  if (options.requireSourcePriceEvidence === true && !hasPriceFigureEvidence(evidence)) {
    reasons.push('source_price_figure_missing');
  }

  if (category === 'sale' && recurring) reasons.push('sale_price_marked_recurring');
  if (category === 'land' && recurring) reasons.push('land_price_marked_recurring');
  if (category === 'rent' && oneOff) reasons.push('rent_price_marked_one_off');
  if (category === 'student' && oneOff) reasons.push('student_price_marked_one_off');

  if (category === 'commercial' && recurring) {
    if (explicitSale || clean(row.transaction_type || row.transactionType).toLowerCase() === 'sale') {
      reasons.push('commercial_sale_price_marked_recurring');
    } else if (!explicitRent) {
      reasons.push('commercial_monthly_price_without_rent_evidence');
    }
  }

  if (recurring && Number.isFinite(price) && price >= 100_000_000) {
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
    && price < LOW_RECURRING_PRICE_UGX
    && ['rent', 'student'].includes(category)
  ) {
    reasons.push('recurring_price_below_30k');
  }

  if (category === 'student' && recurring && Number.isFinite(price) && price > 5_000_000) {
    reasons.push('student_recurring_price_above_5m');
  }

  if (category === 'student' && !recurring && explicitSale) {
    reasons.push('student_category_contains_sale_asset');
  }

  return {
    ok: reasons.length === 0,
    category,
    price: Number.isFinite(price) ? price : null,
    period,
    recurring,
    explicit_sale_evidence: explicitSale,
    explicit_rent_evidence: explicitRent,
    price_figure_evidence: hasPriceFigureEvidence(evidence),
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)]
  };
}

module.exports = {
  RECURRING_PERIODS,
  LOW_RECURRING_PRICE_UGX,
  hasExplicitRentEvidence,
  hasExplicitSaleEvidence,
  hasPriceFigureEvidence,
  listingPriceQuality,
  normalizedCategory,
  normalizedPeriod,
  sourceEvidenceText
};
