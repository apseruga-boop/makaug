const express = require('express');

const db = require('../config/database');
const { cleanText, toNullableFloat, toNullableInt } = require('../middleware/validation');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const { DISTRICTS } = require('../utils/constants');

const router = express.Router();

const VALUATION_MARKER = 'valuation-live-comparables-20260724';
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.VALUATION_CACHE_TTL_MS || 180_000));
const MIN_COMPARABLES = 3;
const DISTRICT_WIDEN_THRESHOLD = 5;
const MAX_PRICE_UGX = 100_000_000_000;
const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_DECIMAL = SQM_PER_ACRE / 100;
const valuationCache = new Map();

function normalizeCategory(value) {
  const key = cleanText(value).toLowerCase();
  if (['sale', 'residential_sale', 'buy'].includes(key)) return 'sale';
  if (['rent', 'residential_rent', 'rental'].includes(key)) return 'rent';
  if (['land', 'plot'].includes(key)) return 'land';
  if (['commercial', 'business'].includes(key)) return 'commercial';
  if (['student', 'students', 'hostel'].includes(key)) return 'student';
  return '';
}

function percentile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, Number(fraction) || 0));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
}

function trimmedMean(values, trimFraction = 0.1) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const trimCount = sorted.length >= 10 ? Math.floor(sorted.length * trimFraction) : 0;
  const kept = trimCount > 0 ? sorted.slice(trimCount, sorted.length - trimCount) : sorted;
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function landSizeSqm(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const direct = Number(extra.land_size_sqm || extra.size_sqm);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const value = Number(row.land_size_value || extra.land_size_value);
  const unit = cleanText(row.land_size_unit || extra.land_size_unit).toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit.includes('hectare') || unit === 'ha') return value * 10_000;
  if (unit.includes('acre')) return value * SQM_PER_ACRE;
  if (unit.includes('decimal')) return value * SQM_PER_DECIMAL;
  if (unit.includes('square') || unit.includes('sqm') || unit.includes('m²') || unit === 'm2') return value;
  if (unit.includes('sq ft') || unit.includes('square feet') || unit === 'ft2') return value * 0.09290304;
  return null;
}

function targetLandSizeSqm(value, unit) {
  return landSizeSqm({
    land_size_value: value,
    land_size_unit: unit,
    extra_fields: {}
  });
}

function normalizeRecurringPrice(row = {}, category = '') {
  const raw = Number(row.price);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const period = cleanText(row.price_period).toLowerCase();
  if (category === 'student') {
    if (['week', 'weekly', 'wk'].includes(period)) return raw * 17.38;
    if (['month', 'monthly'].includes(period)) return raw * 4;
    if (['year', 'yearly', 'annual', 'annually'].includes(period)) return raw / 3;
    return raw;
  }
  if (category !== 'rent' && !(category === 'commercial' && row.transaction_type === 'rent')) return raw;
  if (['week', 'weekly', 'wk'].includes(period)) return raw * 4.345;
  if (['semester', 'term'].includes(period)) return raw / 4;
  if (['year', 'yearly', 'annual', 'annually'].includes(period)) return raw / 12;
  return raw;
}

function valuationPriceBasis(input = {}) {
  if (input.category === 'student') return 'semester';
  if (input.category === 'rent' || (input.category === 'commercial' && input.transaction_type === 'rent')) return 'month';
  return 'total';
}

function comparableSizeSqm(row = {}, category = '') {
  if (category === 'land') return landSizeSqm(row);
  if (category === 'commercial') {
    const value = Number(row.floor_area_sqm || row.usable_size_sqm);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

function categorySql(category) {
  if (category === 'student') {
    return "(p.listing_type IN ('student','students') OR p.students_welcome = TRUE OR p.nearest_university IS NOT NULL)";
  }
  return 'p.listing_type = $CATEGORY';
}

function cacheKey(input) {
  return JSON.stringify(input);
}

function cachedValue(key) {
  const entry = valuationCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) valuationCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue(key, value) {
  valuationCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (valuationCache.size > 200) {
    const oldestKey = valuationCache.keys().next().value;
    valuationCache.delete(oldestKey);
  }
}

async function loadComparableRows(input, scope) {
  const values = [];
  const where = [
    publicLivePropertyStatusSql('p'),
    'p.price > 0',
    `p.price <= ${MAX_PRICE_UGX}`
  ];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  const categoryCondition = categorySql(input.category);
  if (categoryCondition.includes('$CATEGORY')) add(categoryCondition.replace('$CATEGORY', '?'), input.category);
  else where.push(categoryCondition);

  if (scope === 'district') {
    add('LOWER(COALESCE(p.district, \'\')) = LOWER(?)', input.district);
  } else {
    const needle = `%${input.location}%`;
    values.push(needle);
    const param = `$${values.length}`;
    where.push(`(
      COALESCE(p.area, '') ILIKE ${param}
      OR COALESCE(p.address, '') ILIKE ${param}
      OR COALESCE(p.extra_fields->>'neighborhood', '') ILIKE ${param}
      OR COALESCE(p.extra_fields->>'city', '') ILIKE ${param}
      OR LOWER(COALESCE(p.district, '')) = LOWER($${values.push(input.location)})
    )`);
  }

  if (input.bedrooms != null && ['sale', 'rent', 'student'].includes(input.category)) {
    add('p.bedrooms = ?', input.bedrooms);
  }
  if (input.property_type) {
    values.push(`%${input.property_type}%`);
    const param = `$${values.length}`;
    where.push(`(
      COALESCE(p.property_type, '') ILIKE ${param}
      OR COALESCE(p.extra_fields->>'room_type', '') ILIKE ${param}
      OR COALESCE(p.extra_fields->>'commercial_type', '') ILIKE ${param}
    )`);
  }
  if (input.university && input.category === 'student') {
    values.push(`%${input.university}%`);
    const param = `$${values.length}`;
    where.push(`(
      COALESCE(p.nearest_university, '') ILIKE ${param}
      OR COALESCE(p.extra_fields->>'student_campus', '') ILIKE ${param}
      OR COALESCE(p.description, '') ILIKE ${param}
    )`);
  }
  if (input.category === 'commercial' && input.transaction_type) {
    add('p.transaction_type = ?', input.transaction_type);
  }

  const result = await db.query(
    `SELECT
       p.id,
       p.title,
       p.area,
       p.district,
       p.price,
       p.price_period,
       p.listing_type,
       p.transaction_type,
       p.property_type,
       p.bedrooms,
       p.bathrooms,
       p.land_size_value,
       p.land_size_unit,
       p.floor_area_sqm,
       p.usable_size_sqm,
       p.nearest_university,
       p.room_type,
       p.extra_fields,
       (
         SELECT i.url
         FROM property_images i
         WHERE i.property_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
         LIMIT 1
       ) AS image_url
     FROM properties p
     WHERE ${where.join('\n       AND ')}
     ORDER BY p.created_at DESC
     LIMIT 300`,
    values
  );
  return result.rows || [];
}

function buildEstimate(input, rows, scope) {
  const prepared = rows
    .map((row) => {
      const normalizedPrice = normalizeRecurringPrice(row, input.category);
      const sizeSqm = comparableSizeSqm(row, input.category);
      return {
        ...row,
        normalizedPrice,
        sizeSqm,
        ratePerSqm: normalizedPrice && sizeSqm ? normalizedPrice / sizeSqm : null
      };
    })
    .filter((row) => Number.isFinite(row.normalizedPrice) && row.normalizedPrice > 0);

  const targetSizeSqm = input.category === 'land'
    ? targetLandSizeSqm(input.size_value, input.size_unit)
    : (input.category === 'commercial' ? input.size_sqm : null);
  const rateRows = prepared.filter((row) => Number.isFinite(row.ratePerSqm) && row.ratePerSqm > 0);
  const useRate = targetSizeSqm && rateRows.length >= MIN_COMPARABLES;
  const values = useRate
    ? rateRows.map((row) => row.ratePerSqm * targetSizeSqm)
    : prepared.map((row) => row.normalizedPrice);
  const estimate = trimmedMean(values);
  const low = percentile(values, 0.1);
  const high = percentile(values, 0.9);
  const unitRate = rateRows.length >= MIN_COMPARABLES
    ? trimmedMean(rateRows.map((row) => row.ratePerSqm))
    : null;
  const ranked = prepared
    .map((row) => ({ ...row, valuationDifference: estimate == null ? 0 : Math.abs(row.normalizedPrice - estimate) }))
    .sort((a, b) => a.valuationDifference - b.valuationDifference)
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      title: row.title,
      area: row.area,
      district: row.district,
      price: Number(row.price),
      normalized_price: Math.round(row.normalizedPrice),
      price_period: row.price_period,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      property_type: row.property_type,
      land_size_value: row.land_size_value,
      land_size_unit: row.land_size_unit,
      size_sqm: row.sizeSqm ? Math.round(row.sizeSqm * 10) / 10 : null,
      image_url: row.image_url || null,
      url: `/property/${encodeURIComponent(row.id)}`
    }));

  return {
    sufficient: values.length >= MIN_COMPARABLES,
    estimate: values.length >= MIN_COMPARABLES && estimate != null ? Math.round(estimate) : null,
    range_low: values.length >= MIN_COMPARABLES && low != null ? Math.round(low) : null,
    range_high: values.length >= MIN_COMPARABLES && high != null ? Math.round(high) : null,
    comparable_count: values.length,
    raw_comparable_count: prepared.length,
    scope,
    widened: scope === 'district',
    target_size_sqm: targetSizeSqm ? Math.round(targetSizeSqm * 10) / 10 : null,
    unit_rate_sqm: unitRate ? Math.round(unitRate) : null,
    unit_rate_decimal: input.category === 'land' && unitRate
      ? Math.round(unitRate * SQM_PER_DECIMAL)
      : null,
    price_basis: valuationPriceBasis(input),
    comparables: ranked,
    methodology: {
      estimator: 'trimmed_mean',
      trim_each_side_percent: prepared.length >= 10 ? 10 : 0,
      range_percentiles: [10, 90],
      price_normalization: valuationPriceBasis(input),
      minimum_comparables: MIN_COMPARABLES,
      size_adjusted: Boolean(useRate)
    }
  };
}

router.post('/estimate', async (req, res, next) => {
  try {
    const category = normalizeCategory(req.body?.category);
    const location = cleanText(req.body?.location || req.body?.area);
    const districtRaw = cleanText(req.body?.district);
    const district = DISTRICTS.find((item) => item.toLowerCase() === districtRaw.toLowerCase())
      || DISTRICTS.find((item) => item.toLowerCase() === location.toLowerCase())
      || '';
    const transactionType = cleanText(req.body?.transaction_type).toLowerCase();
    const input = {
      category,
      location,
      district,
      bedrooms: toNullableInt(req.body?.bedrooms),
      property_type: cleanText(req.body?.property_type),
      transaction_type: ['rent', 'sale'].includes(transactionType) ? transactionType : '',
      size_value: toNullableFloat(req.body?.size_value),
      size_unit: cleanText(req.body?.size_unit),
      size_sqm: toNullableFloat(req.body?.size_sqm),
      university: cleanText(req.body?.university)
    };

    if (!category || !location) {
      return res.status(400).json({
        ok: false,
        error: 'Choose a property category and enter a Uganda area or district.'
      });
    }
    if (input.category === 'commercial' && !input.transaction_type) {
      return res.status(400).json({ ok: false, error: 'Choose whether the commercial property is for rent or sale.' });
    }

    const key = cacheKey(input);
    const cached = cachedValue(key);
    if (cached) {
      res.set('X-Makaug-Valuation-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    let scope = 'area';
    let rows = await loadComparableRows(input, scope);
    if (rows.length < DISTRICT_WIDEN_THRESHOLD && district) {
      scope = 'district';
      rows = await loadComparableRows(input, scope);
    }
    const result = buildEstimate(input, rows, scope);
    const payload = {
      ok: true,
      marker: VALUATION_MARKER,
      input,
      ...result,
      scope_label: scope === 'district'
        ? `Not enough exact matches in ${location}; using ${district} District comparables.`
        : `Using comparable listings in ${location}.`,
      currency: 'UGX',
      generated_at: new Date().toISOString(),
      cache_ttl_seconds: Math.round(CACHE_TTL_MS / 1000)
    };
    setCachedValue(key, payload);
    res.set('Cache-Control', 'private, max-age=0, must-revalidate');
    res.set('X-Makaug-Valuation-Cache', 'MISS');
    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/locations', async (req, res, next) => {
  try {
    const category = normalizeCategory(req.query.category) || 'sale';
    const values = [];
    const where = [
      publicLivePropertyStatusSql('p'),
      `NULLIF(TRIM(COALESCE(p.area, p.district, '')), '') IS NOT NULL`
    ];
    const categoryCondition = categorySql(category);
    if (categoryCondition.includes('$CATEGORY')) {
      values.push(category);
      where.push(categoryCondition.replace('$CATEGORY', `$${values.length}`));
    } else {
      where.push(categoryCondition);
    }
    const rows = await db.query(
      `SELECT
         TRIM(COALESCE(NULLIF(p.area, ''), p.district)) AS location,
         TRIM(COALESCE(p.district, '')) AS district,
         COUNT(*)::int AS listing_count
       FROM properties p
       WHERE ${where.join('\n         AND ')}
       GROUP BY 1, 2
       ORDER BY COUNT(*) DESC, 1 ASC
       LIMIT 500`,
      values
    );
    return res.status(200).json({
      ok: true,
      marker: VALUATION_MARKER,
      category,
      data: rows.rows || []
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/config', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    ok: true,
    marker: VALUATION_MARKER,
    categories: ['sale', 'rent', 'land', 'commercial', 'student'],
    districts: DISTRICTS,
    minimum_comparables: MIN_COMPARABLES,
    widen_below: DISTRICT_WIDEN_THRESHOLD
  });
});

module.exports = router;
module.exports._test = {
  normalizeCategory,
  percentile,
  trimmedMean,
  landSizeSqm,
  targetLandSizeSqm,
  normalizeRecurringPrice,
  valuationPriceBasis,
  buildEstimate
};
