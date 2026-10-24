'use strict';

// Plot size and per-unit price. Existing rows keep price_unit NULL, which
// means the stored price is already the total. Nothing here rewrites price.

const LAND_SIZE_UNITS = Object.freeze(['acres', 'decimals', 'sq_ft', 'm2']);
const PRICE_UNITS = Object.freeze(['total', 'per_acre', 'per_decimal']);

// 1 acre = 100 decimals (Uganda), 43,560 sq ft, 4,046.8564224 m².
const TO_ACRES = Object.freeze({
  acres: 1,
  decimals: 0.01,
  sq_ft: 1 / 43560,
  m2: 1 / 4046.8564224
});

function normalizeLandSizeUnit(value = '') {
  const text = String(value || '').trim().toLowerCase().replace(/²/g, '2').replace(/\s+/g, ' ');
  if (['acre', 'acres', 'ac'].includes(text)) return 'acres';
  if (['decimal', 'decimals', 'dec'].includes(text)) return 'decimals';
  if (['sq ft', 'sqft', 'sq_ft', 'square feet', 'square foot', 'ft2', 'ft²'].includes(text)) return 'sq_ft';
  if (['m2', 'sq m', 'sqm', 'sq_m', 'square metres', 'square meters', 'square metre', 'square meter'].includes(text)) return 'm2';
  return '';
}

function normalizePriceUnit(value = '') {
  const text = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!text || ['total', 'once', 'whole', 'listing'].includes(text)) return 'total';
  if (['per_acre', 'acre', 'peracre', '/acre'].includes(text)) return 'per_acre';
  if (['per_decimal', 'decimal', 'perdecimal', '/decimal'].includes(text)) return 'per_decimal';
  return '';
}

function landSizeAcres(value, unit) {
  const amount = Number(value);
  const key = normalizeLandSizeUnit(unit);
  if (!Number.isFinite(amount) || amount <= 0 || !TO_ACRES[key]) return null;
  return amount * TO_ACRES[key];
}

function sizeInUnit(value, unit, target) {
  const acres = landSizeAcres(value, unit);
  const targetKey = normalizeLandSizeUnit(target);
  if (acres == null || !TO_ACRES[targetKey]) return null;
  return acres / TO_ACRES[targetKey];
}

function listingPriceFacts(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const priceUnit = normalizePriceUnit(row.price_unit || extra.price_unit || '') || 'total';
  const sizeValue = row.land_size_value ?? extra.land_size_value;
  const sizeUnit = normalizeLandSizeUnit(row.land_size_unit || extra.land_size_unit || '');
  return { priceUnit, sizeValue, sizeUnit };
}

function computedListingTotal(row = {}) {
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const { priceUnit, sizeValue, sizeUnit } = listingPriceFacts(row);
  if (!priceUnit || priceUnit === 'total') return price;
  const target = priceUnit === 'per_acre' ? 'acres' : 'decimals';
  const size = sizeInUnit(sizeValue, sizeUnit, target);
  if (size == null) return null;
  const total = Math.round(price * size);
  if (!Number.isFinite(total) || total <= 0) return null;
  return total;
}

function publicLandSizeLabel(row = {}) {
  const { sizeValue, sizeUnit } = listingPriceFacts(row);
  const amount = Number(sizeValue);
  if (!Number.isFinite(amount) || amount <= 0 || !sizeUnit) return '';
  const shown = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  const labels = {
    acres: amount === 1 ? 'acre' : 'acres',
    decimals: amount === 1 ? 'decimal' : 'decimals',
    sq_ft: 'sq ft',
    m2: 'm²'
  };
  return `${shown} ${labels[sizeUnit]}`;
}

function priceUnitCaption(priceUnit = '') {
  if (priceUnit === 'per_acre') return 'per acre';
  if (priceUnit === 'per_decimal') return 'per decimal';
  return '';
}

// Sort and search compare the whole-listing total when size × unit price
// can be computed. Otherwise the stored price is used, unchanged.
function listingComparablePriceSql(alias = 'p') {
  const column = alias;
  return `(CASE
    WHEN ${column}.price IS NULL OR ${column}.price <= 0 THEN NULL
    WHEN COALESCE(${column}.price_unit, 'total') NOT IN ('per_acre', 'per_decimal') THEN ${column}.price
    WHEN ${column}.land_size_value IS NULL OR ${column}.land_size_value <= 0 THEN ${column}.price
    WHEN ${column}.price_unit = 'per_acre' THEN ROUND(${column}.price * (
      CASE ${column}.land_size_unit
        WHEN 'acres' THEN ${column}.land_size_value
        WHEN 'decimals' THEN ${column}.land_size_value / 100.0
        WHEN 'sq_ft' THEN ${column}.land_size_value / 43560.0
        WHEN 'm2' THEN ${column}.land_size_value / 4046.8564224
        ELSE NULL
      END
    ))
    WHEN ${column}.price_unit = 'per_decimal' THEN ROUND(${column}.price * (
      CASE ${column}.land_size_unit
        WHEN 'decimals' THEN ${column}.land_size_value
        WHEN 'acres' THEN ${column}.land_size_value * 100.0
        WHEN 'sq_ft' THEN ${column}.land_size_value / 435.6
        WHEN 'm2' THEN ${column}.land_size_value / 40.468564224
        ELSE NULL
      END
    ))
    ELSE ${column}.price
  END)`;
}

module.exports = {
  LAND_SIZE_UNITS,
  PRICE_UNITS,
  computedListingTotal,
  landSizeAcres,
  listingComparablePriceSql,
  listingPriceFacts,
  normalizeLandSizeUnit,
  normalizePriceUnit,
  priceUnitCaption,
  publicLandSizeLabel,
  sizeInUnit
};
