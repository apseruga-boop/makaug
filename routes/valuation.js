const express = require('express');

const db = require('../config/database');
const { cleanText, toNullableFloat, toNullableInt } = require('../middleware/validation');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const { publicLaunchTestListingFastCondition } = require('../services/publicInventoryMetricsService');
const { DISTRICTS } = require('../utils/constants');
const {
  canonicalizeUgandaLocation,
  canonicalizeLocationRows,
  canonicalLocationOptions,
  aliasesForCanonicalLocation,
  aliasesForDistrict,
  normalizeDistrict,
  normalizeLocationKey,
  haversineKm
} = require('../utils/ugandaLocationRegistry');

const router = express.Router();

const VALUATION_MARKER = 'valuation-canonical-confidence-cards-20260725';
const VALUATION_PUNCHLIST_MARKER = 'valuation-final-punchlist-20260725';
const VALUATION_K17_MARKER = 'valuation-k17-simple-range-20260725';
const VALUATION_CLOSEOUT_MARKER = 'valuation-k17-closeout-20260725';
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.VALUATION_CACHE_TTL_MS || 180_000));
const MIN_COMPARABLES = 3;
const DISTRICT_WIDEN_THRESHOLD = MIN_COMPARABLES;
const EVIDENCE_LIMIT = 10;
const MAX_PRICE_UGX = 100_000_000_000;
const MIN_RECURRING_PRICE_UGX = 30_000;
const MIN_TOTAL_PRICE_UGX = 1_000_000;
const NEARBY_RADIUS_KM = 12;
const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_DECIMAL = SQM_PER_ACRE / 100;
const SQM_PER_SQUARE_FOOT = 0.09290304;
const TRANSIENT_DATABASE_RETRY_MS = 125;
const valuationCache = new Map();

function valuationConfidenceLevel({ sufficient, widened, comparableCount }) {
  const count = Number(comparableCount) || 0;
  if (!sufficient || widened || count < 5) return 'low';
  return count >= 20 ? 'high' : 'medium';
}

function stableComparableImageUrl(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const firstUrl = (values) => values
    .map((value) => cleanText(value, 2000))
    .find((value) => /^https?:\/\//i.test(value)) || null;
  const persistent = firstUrl([
    extra.tiktok_thumbnail_cache_url,
    extra.thumbnail_cache_url,
    extra.source_thumbnail_cache_url,
    extra.cached_thumbnail_url,
    extra.cached_image_url
  ]);
  if (persistent) return persistent;

  const fallback = firstUrl([
    row.image_url,
    extra.image_url,
    extra.thumbnail_url,
    extra.source_thumbnail_url
  ]);
  if (!fallback) return null;

  const looksTransientTikTokImage = /(?:tiktokcdn|byteimg|p16-|p19-|p77-|tos-)/i.test(fallback);
  return looksTransientTikTokImage ? null : fallback;
}

function publicComparableExtraFields(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const safeUrl = (value) => {
    const url = cleanText(value, 2000);
    if (!/^https?:\/\//i.test(url)) return null;
    return /(?:tiktokcdn|byteimg|p16-|p19-|p77-|tos-)/i.test(url) ? null : url;
  };
  const fields = {
    found_online: extra.found_online === true || extra.found_online === 'true',
    source_url: safeUrl(extra.source_url || row.source_url),
    tiktok_url: safeUrl(extra.tiktok_url || row.tiktok_url),
    video_url: safeUrl(extra.video_url || row.video_url)
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== false));
}

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

function valuationSourceText(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return [
    row.title,
    row.description,
    row.size_raw,
    extra.source_hover_description,
    extra.source_card_description,
    extra.source_caption,
    extra.source_description,
    extra.land_size,
    extra.size_raw
  ].map((value) => cleanText(value)).filter(Boolean).join(' ');
}

function parseLandSizeText(value = '') {
  const text = cleanText(value, 4000)
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const dimensions = text.match(
    /\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*[*x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\b/i
  );
  if (dimensions) {
    const width = Number(dimensions[1]);
    const length = Number(dimensions[2]);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(length) && length > 0) {
      return width * length * SQM_PER_SQUARE_FOOT;
    }
  }

  const units = [
    { pattern: /\b(\d+(?:\.\d+)?)\s*(?:hectares?|hectres?|ha)\b/i, multiplier: 10_000 },
    { pattern: /\b(\d+(?:\.\d+)?)\s*(?:acres?|ac)\b/i, multiplier: SQM_PER_ACRE },
    { pattern: /\b(\d+(?:\.\d+)?)\s*(?:decimals?|dec|dcmls?)\b/i, multiplier: SQM_PER_DECIMAL },
    { pattern: /\b(\d+(?:\.\d+)?)\s*(?:square\s*met(?:res?|ers?)|sq\.?\s*m|sqm|m²|m2)\b/i, multiplier: 1 },
    { pattern: /\b(\d+(?:\.\d+)?)\s*(?:square\s*feet|sq\.?\s*ft|ft²|ft2)\b/i, multiplier: SQM_PER_SQUARE_FOOT }
  ];
  for (const unit of units) {
    const match = text.match(unit.pattern);
    const number = Number(match?.[1]);
    if (Number.isFinite(number) && number > 0) return number * unit.multiplier;
  }
  return null;
}

function landSizeSqm(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const direct = Number(extra.land_size_sqm || extra.size_sqm);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const value = Number(row.land_size_value || extra.land_size_value);
  const unit = cleanText(row.land_size_unit || extra.land_size_unit).toLowerCase();
  if (Number.isFinite(value) && value > 0) {
    if (unit.includes('hectare') || unit === 'ha') return value * 10_000;
    if (unit.includes('acre')) return value * SQM_PER_ACRE;
    if (unit.includes('decimal')) return value * SQM_PER_DECIMAL;
    if (unit.includes('square') || unit.includes('sqm') || unit.includes('m²') || unit === 'm2') return value;
    if (unit.includes('sq ft') || unit.includes('square feet') || unit === 'ft2') {
      return value * SQM_PER_SQUARE_FOOT;
    }
  }
  return parseLandSizeText(valuationSourceText(row));
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
    if (['once', 'total', 'sale'].includes(period)) return null;
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
  if (['sale', 'rent', 'commercial'].includes(category)) {
    const value = Number(row.floor_area_sqm || row.usable_size_sqm);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

function landPriceUnitSqm(row = {}) {
  const text = valuationSourceText(row);
  if (/\b(?:per|each)\s+acres?\b|\bacres?\b[^.]{0,100}\beach\b/i.test(text)) return SQM_PER_ACRE;
  if (/\b(?:per|each)\s+decimals?\b|\bdecimals?\b[^.]{0,100}\beach\b/i.test(text)) return SQM_PER_DECIMAL;
  if (/\b(?:per|each)\s+(?:square\s+metre|square\s+meter|sqm|m2|m²)\b/i.test(text)) return 1;
  return null;
}

function comparableText(row = {}) {
  return [
    row.title,
    row.description,
    row.property_type,
    row.room_type,
    row.extra_fields?.room_type,
    row.extra_fields?.commercial_type
  ].map((value) => cleanText(value).toLowerCase()).filter(Boolean).join(' ');
}

function hasAmbiguousForeignCurrency(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const currency = cleanText(
    row.currency || extra.currency || extra.price_currency || extra.source_currency
  ).toUpperCase();
  if (currency && !['UGX', 'USH', 'UGANDA SHILLINGS', 'UGANDA SHILLING'].includes(currency)) {
    return true;
  }
  return /(?:\bUSD\b|\bUS\s*DOLLARS?\b|US\$|\$|€|£)/i.test(valuationSourceText(row));
}

function minimumPlausiblePrice(input = {}) {
  if (input.category === 'rent' || input.category === 'student') return MIN_RECURRING_PRICE_UGX;
  if (input.category === 'commercial' && input.transaction_type === 'rent') return MIN_RECURRING_PRICE_UGX;
  return MIN_TOTAL_PRICE_UGX;
}

function filterComparablePriceOutliers(rows = [], input = {}) {
  const normalizedRows = rows.filter((row) => Number.isFinite(row.normalizedPrice) && row.normalizedPrice > 0);
  if (normalizedRows.length < MIN_COMPARABLES) {
    return {
      rows: normalizedRows,
      excluded_count: 0,
      price_floor: minimumPlausiblePrice(input),
      price_ceiling: MAX_PRICE_UGX
    };
  }
  const medianPrice = percentile(normalizedRows.map((row) => row.normalizedPrice), 0.5);
  const recurring = input.category === 'rent'
    || input.category === 'student'
    || (input.category === 'commercial' && input.transaction_type === 'rent');
  const lowerMedianFactor = recurring ? 0.01 : 0.05;
  const priceFloor = Math.max(
    minimumPlausiblePrice(input),
    Number(medianPrice || 0) * lowerMedianFactor
  );
  const priceCeiling = Math.min(MAX_PRICE_UGX, Number(medianPrice || MAX_PRICE_UGX) * 100);
  const filteredRows = normalizedRows.filter((row) => (
    row.normalizedPrice >= priceFloor
    && row.normalizedPrice <= priceCeiling
  ));
  return {
    rows: filteredRows,
    excluded_count: normalizedRows.length - filteredRows.length,
    price_floor: Math.round(priceFloor),
    price_ceiling: Math.round(priceCeiling)
  };
}

function isCategoryCompatibleComparable(row = {}, input = {}) {
  const category = input.category;
  const rawPrice = Number(row.price);
  const listingType = cleanText(row.listing_type).toLowerCase();
  const transactionType = cleanText(row.transaction_type).toLowerCase();
  const period = cleanText(row.price_period).toLowerCase();
  const text = comparableText(row);
  const recurringPeriod = ['week', 'weekly', 'wk', 'month', 'monthly', 'mo', 'per_month', 'semester', 'sem', 'term', 'year', 'yearly', 'annual', 'annually'].includes(period);
  const constructionOnly = /\b(?:cost to build|cost of building|construction cost|building cost|to start building|house plan|building plan|how to build|build this house)\b/i.test(text);
  if (
    !Number.isFinite(rawPrice)
    || rawPrice < minimumPlausiblePrice(input)
    || rawPrice > MAX_PRICE_UGX
    || constructionOnly
    || hasAmbiguousForeignCurrency(row)
  ) return false;

  if (category === 'student') {
    const studentInventory = ['student', 'students'].includes(listingType)
      || (listingType === 'rent' && row.students_welcome === true);
    if (!studentInventory || transactionType === 'sale') return false;
    if (['once', 'total', 'sale'].includes(period)) return false;
    if (/\b(?:land|plot|acre|decimal|commercial property|hostel for sale|property for sale)\b/i.test(text)) return false;
    return true;
  }
  if (category === 'land') {
    return listingType === 'land' && transactionType !== 'rent' && !recurringPeriod;
  }
  if (category === 'sale') {
    return listingType === 'sale' && transactionType !== 'rent' && !recurringPeriod;
  }
  if (category === 'rent') {
    return listingType === 'rent' && transactionType !== 'sale' && !['once', 'total', 'sale'].includes(period);
  }
  if (category === 'commercial') {
    if (listingType !== 'commercial') return false;
    if (input.transaction_type && transactionType && transactionType !== input.transaction_type) return false;
    if (input.transaction_type === 'sale' && recurringPeriod) return false;
    if (input.transaction_type === 'rent' && ['once', 'total', 'sale'].includes(period)) return false;
    return true;
  }
  return false;
}

function comparableFacetText(row = {}, facet = '') {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const values = {
    property_type: [
      row.property_type,
      row.room_type,
      extra.room_type,
      extra.commercial_type,
      extra.property_type
    ],
    condition: [extra.condition, extra.property_condition, row.description],
    tenure: [extra.tenure, extra.land_tenure, row.description],
    furnished: [row.furnishing, extra.furnished, extra.furnishing, row.description]
  };
  return (values[facet] || [])
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function normalizedRefinementValue(value = '') {
  return cleanText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function applyOptionalRefinements(rows = [], input = {}) {
  let refined = rows;
  const feedback = {};
  const definitions = [
    {
      key: 'bathrooms',
      requested: input.bathrooms,
      available: (row) => Number(row.bathrooms) > 0,
      matches: (row) => Number(row.bathrooms) === Number(input.bathrooms)
    },
    {
      key: 'property_type',
      requested: input.property_type,
      available: (row) => Boolean(comparableFacetText(row, 'property_type')),
      matches: (row) => comparableFacetText(row, 'property_type').includes(normalizedRefinementValue(input.property_type))
    },
    {
      key: 'condition',
      requested: input.condition,
      available: (row) => /\b(?:brand new|new build|newly built|excellent condition|good condition|needs work|needs renovation|fixer upper)\b/.test(
        comparableFacetText(row, 'condition')
      ),
      matches: (row) => comparableFacetText(row, 'condition').includes(normalizedRefinementValue(input.condition))
    },
    {
      key: 'tenure',
      requested: input.tenure,
      available: (row) => /\b(?:mailo|freehold|leasehold)\b/.test(comparableFacetText(row, 'tenure')),
      matches: (row) => comparableFacetText(row, 'tenure').includes(normalizedRefinementValue(input.tenure))
    },
    {
      key: 'furnished',
      requested: input.furnished,
      available: (row) => /\b(?:furnished|unfurnished|semi furnished|part furnished)\b/.test(
        comparableFacetText(row, 'furnished')
      ),
      matches: (row) => {
        const text = comparableFacetText(row, 'furnished');
        const requested = normalizedRefinementValue(input.furnished);
        if (requested === 'unfurnished') return /\bunfurnished\b|\bnot furnished\b/.test(text);
        if (requested === 'semi furnished') return /\bsemi furnished\b|\bpart furnished\b/.test(text);
        return /\bfurnished\b/.test(text) && !/\bunfurnished\b|\bsemi furnished\b|\bpart furnished\b/.test(text);
      }
    },
    {
      key: 'parking',
      requested: input.parking,
      available: (row) => {
        const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
        return Number.isFinite(Number(row.parking_bays))
          || extra.parking != null
          || extra.has_parking != null;
      },
      matches: (row) => {
        const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
        const hasParking = Number(row.parking_bays) > 0
          || extra.parking === true
          || extra.has_parking === true
          || ['yes', 'true', 'available'].includes(normalizedRefinementValue(extra.parking || extra.has_parking));
        return normalizedRefinementValue(input.parking) === 'yes' ? hasParking : !hasParking;
      }
    }
  ];

  definitions.forEach((definition) => {
    if (definition.requested == null || definition.requested === '') return;
    const availableRows = refined.filter(definition.available);
    const matchingRows = availableRows.filter(definition.matches);
    const applied = matchingRows.length >= MIN_COMPARABLES;
    feedback[definition.key] = {
      requested: definition.requested,
      applied,
      available_count: availableRows.length,
      matching_count: matchingRows.length,
      reason: applied ? 'applied' : 'insufficient_facet_data'
    };
    if (applied) refined = matchingRows;
  });

  return { rows: refined, feedback };
}

function categorySql(category) {
  if (category === 'student') {
    return "(p.listing_type IN ('student','students') OR (p.listing_type = 'rent' AND p.students_welcome = TRUE))";
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

async function loadComparableRows(input, scope, { includeImages = true } = {}) {
  const minimumPrice = minimumPlausiblePrice(input);
  const values = [];
  const where = [
    publicLivePropertyStatusSql('p'),
    `NOT ${publicLaunchTestListingFastCondition('p')}`,
    `p.price >= ${minimumPrice}`,
    `p.price <= ${MAX_PRICE_UGX}`
  ];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  const categoryCondition = categorySql(input.category);
  if (categoryCondition.includes('$CATEGORY')) add(categoryCondition.replace('$CATEGORY', '?'), input.category);
  else where.push(categoryCondition);

  const canonicalLocation = input.canonical_location
    || canonicalizeUgandaLocation(input.location, input.district);
  const normalizedAreaSql = "REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(COALESCE(p.area, ''), ',', 1))), '[^a-z0-9]+', ' ', 'g')";
  if (scope === 'district' || scope === 'nearby') {
    const districtAliases = aliasesForDistrict(input.district);
    values.push(input.district);
    const districtParam = `$${values.length}`;
    if (districtAliases.length) {
      values.push(districtAliases);
      const aliasParam = `$${values.length}`;
      where.push(`(
        LOWER(TRIM(COALESCE(p.district, ''))) = LOWER(${districtParam})
        OR ${normalizedAreaSql} = ANY(${aliasParam}::text[])
      )`);
    } else {
      where.push(`LOWER(TRIM(COALESCE(p.district, ''))) = LOWER(${districtParam})`);
    }
  } else {
    const areaAliases = aliasesForCanonicalLocation(canonicalLocation || {
      name: input.location,
      district: input.district
    });
    values.push(areaAliases.length ? areaAliases : [normalizeLocationKey(input.location)]);
    where.push(`${normalizedAreaSql} = ANY($${values.length}::text[])`);
  }

  if (input.bedrooms != null && ['sale', 'rent', 'student'].includes(input.category)) {
    add(input.bedrooms_plus ? 'p.bedrooms >= ?' : 'p.bedrooms = ?', input.bedrooms);
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
       p.description,
       p.area,
       p.district,
       p.price,
       p.price_period,
       p.listing_type,
       p.transaction_type,
       p.property_type,
       p.bedrooms,
       p.bathrooms,
       p.furnishing,
       p.parking_bays,
       p.land_size_value,
       p.land_size_unit,
       p.floor_area_sqm,
       p.usable_size_sqm,
       p.nearest_university,
       p.room_type,
       p.students_welcome,
       p.source,
       p.listed_via,
       p.status,
       p.created_at,
       p.extra_fields,
       ${includeImages ? `(
         SELECT i.url
         FROM property_images i
         WHERE i.property_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
         LIMIT 1
       )` : 'NULL'} AS image_url
     FROM properties p
     WHERE ${where.join('\n       AND ')}
     ORDER BY p.created_at DESC
     LIMIT 500`,
    values
  );
  const rows = (result.rows || []).map((row) => {
    const canonical = canonicalizeUgandaLocation(row.area, row.district);
    const distance = canonicalLocation && canonical
      ? haversineKm(canonicalLocation, canonical)
      : null;
    return {
      ...row,
      area: canonical?.name || cleanText(row.area),
      district: canonical?.district || normalizeDistrict(row.district) || cleanText(row.district),
      canonical_location: canonical,
      valuation_distance_km: distance
    };
  });
  if (!canonicalLocation) return rows;
  if (scope === 'area') {
    return rows.filter((row) => row.canonical_location?.key === canonicalLocation.key);
  }
  if (scope === 'nearby') {
    return rows
      .filter((row) => (
        row.canonical_location?.district === canonicalLocation.district
        && Number.isFinite(row.valuation_distance_km)
        && row.valuation_distance_km <= NEARBY_RADIUS_KM
      ))
      .sort((a, b) => (
        Number(a.valuation_distance_km || 0) - Number(b.valuation_distance_km || 0)
      ));
  }
  return rows.filter((row) => row.district === input.district);
}

async function inferDistrictForLocation(location) {
  const canonical = canonicalizeUgandaLocation(location);
  if (canonical?.district) return canonical.district;
  const result = await db.query(
    `SELECT TRIM(COALESCE(p.district, '')) AS district, COUNT(*)::int AS listing_count
     FROM properties p
     WHERE ${publicLivePropertyStatusSql('p')}
       AND NOT ${publicLaunchTestListingFastCondition('p')}
       AND LOWER(TRIM(SPLIT_PART(COALESCE(p.area, ''), ',', 1))) = LOWER($1)
       AND NULLIF(TRIM(COALESCE(p.district, '')), '') IS NOT NULL
     GROUP BY 1
     ORDER BY COUNT(*) DESC, 1 ASC
     LIMIT 1`,
    [location]
  );
  const candidate = cleanText(result.rows[0]?.district);
  return DISTRICTS.find((district) => district.toLowerCase() === candidate.toLowerCase()) || '';
}

function isTransientDatabaseError(error = {}) {
  if (['POOL_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', '53300', '57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(error.code)) {
    return true;
  }
  return /client acquisition timed out|connection timeout|connection terminated|timeout exceeded/i.test(
    String(error.message || '')
  );
}

async function withTransientDatabaseRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_DATABASE_RETRY_MS));
    return operation();
  }
}

function categoryResultsPath(input = {}) {
  const paths = {
    sale: '/for-sale',
    rent: '/to-rent',
    land: '/land',
    commercial: '/commercial',
    student: '/student-accommodation'
  };
  const params = new URLSearchParams();
  params.set('area', input.location);
  if (input.category === 'commercial' && input.transaction_type) {
    params.set('transaction_type', input.transaction_type);
  }
  return `${paths[input.category] || '/for-sale'}?${params.toString()}`;
}

function buildEstimate(input, rows, scope, widened = scope === 'district') {
  const normalizedCompatibleRows = rows
    .filter((row) => isCategoryCompatibleComparable(row, input))
    .map((row) => {
      const normalizedPrice = normalizeRecurringPrice(row, input.category);
      const sizeSqm = comparableSizeSqm(row, input.category);
      const quotedUnitSqm = input.category === 'land' ? landPriceUnitSqm(row) : null;
      return {
        ...row,
        normalizedPrice,
        sizeSqm,
        ratePerSqm: normalizedPrice && (quotedUnitSqm || sizeSqm)
          ? normalizedPrice / (quotedUnitSqm || sizeSqm)
          : null
      };
    })
    .filter((row) => Number.isFinite(row.normalizedPrice) && row.normalizedPrice > 0);
  const outlierResult = filterComparablePriceOutliers(normalizedCompatibleRows, input);
  const compatibleRows = outlierResult.rows;
  const refinementResult = applyOptionalRefinements(compatibleRows, input);
  const prepared = refinementResult.rows;

  const targetSizeSqm = input.category === 'land'
    ? targetLandSizeSqm(input.size_value, input.size_unit)
    : (['sale', 'rent', 'commercial'].includes(input.category) ? input.size_sqm : null);
  const rateRows = prepared.filter((row) => Number.isFinite(row.ratePerSqm) && row.ratePerSqm > 0);
  const useRate = targetSizeSqm && rateRows.length >= MIN_COMPARABLES;
  if (targetSizeSqm) {
    refinementResult.feedback.size = {
      requested: targetSizeSqm,
      applied: Boolean(useRate),
      available_count: rateRows.length,
      matching_count: rateRows.length,
      reason: useRate ? 'applied' : 'insufficient_facet_data'
    };
  }
  const evidencePool = useRate ? rateRows : prepared;
  const analysisValues = evidencePool.map((row) => (
    useRate ? row.ratePerSqm * targetSizeSqm : row.normalizedPrice
  ));
  const estimate = trimmedMean(analysisValues);
  const unitRate = rateRows.length >= MIN_COMPARABLES
    ? trimmedMean(rateRows.map((row) => row.ratePerSqm))
    : null;
  const ranked = evidencePool
    .map((row) => {
      const valuationValue = useRate ? row.ratePerSqm * targetSizeSqm : row.normalizedPrice;
      return {
        ...row,
        valuationValue,
        valuationDifference: estimate == null ? 0 : Math.abs(valuationValue - estimate)
      };
    })
    .sort((a, b) => a.valuationDifference - b.valuationDifference)
    .slice(0, EVIDENCE_LIMIT)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      area: row.area,
      district: row.district,
      price: Number(row.price),
      normalized_price: Math.round(row.normalizedPrice),
      valuation_value: Math.round(row.valuationValue),
      price_period: row.price_period,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      listing_type: row.listing_type,
      transaction_type: row.transaction_type,
      property_type: row.property_type,
      room_type: row.room_type,
      students_welcome: row.students_welcome,
      nearest_university: row.nearest_university,
      land_size_value: row.land_size_value,
      land_size_unit: row.land_size_unit,
      size_sqm: row.sizeSqm ? Math.round(row.sizeSqm * 10) / 10 : null,
      image_url: stableComparableImageUrl(row),
      source: row.source || null,
      listed_via: row.listed_via || null,
      status: row.status || null,
      created_at: row.created_at || null,
      extra_fields: publicComparableExtraFields(row),
      url: `/property/${encodeURIComponent(row.id)}`
    }));
  const evidenceValues = ranked.map((row) => row.valuation_value);
  const low = percentile(evidenceValues, 0.1);
  const high = percentile(evidenceValues, 0.9);
  const boundedEstimate = estimate == null || low == null || high == null
    ? estimate
    : Math.min(high, Math.max(low, estimate));
  const sufficient = analysisValues.length >= MIN_COMPARABLES;
  const scopeAreas = Array.from(new Set(ranked.map((row) => cleanText(row.area)).filter(Boolean)));
  const confidence = valuationConfidenceLevel({
    sufficient,
    widened,
    comparableCount: analysisValues.length
  });

  return {
    sufficient,
    estimate: sufficient && boundedEstimate != null ? Math.round(boundedEstimate) : null,
    range_low: sufficient && low != null ? Math.round(low) : null,
    range_high: sufficient && high != null ? Math.round(high) : null,
    comparable_count: ranked.length,
    analysis_comparable_count: analysisValues.length,
    raw_comparable_count: normalizedCompatibleRows.length,
    outlier_excluded_count: outlierResult.excluded_count,
    scope,
    widened,
    confidence,
    scope_areas: scopeAreas,
    target_size_sqm: targetSizeSqm ? Math.round(targetSizeSqm * 10) / 10 : null,
    unit_rate_sqm: unitRate ? Math.round(unitRate) : null,
    unit_rate_decimal: input.category === 'land' && unitRate
      ? Math.round(unitRate * SQM_PER_DECIMAL)
      : null,
    price_basis: valuationPriceBasis(input),
    refinement_feedback: refinementResult.feedback,
    comparables: ranked,
    view_all_url: categoryResultsPath(input),
    methodology: {
      estimator: 'trimmed_mean',
      trim_each_side_percent: analysisValues.length >= 10 ? 10 : 0,
      range_percentiles: [10, 90],
      price_normalization: valuationPriceBasis(input),
      minimum_comparables: MIN_COMPARABLES,
      size_adjusted: Boolean(useRate),
      outlier_excluded_count: outlierResult.excluded_count,
      outlier_price_floor: outlierResult.price_floor,
      outlier_price_ceiling: outlierResult.price_ceiling,
      analysis_comparable_count: analysisValues.length,
      displayed_evidence_count: ranked.length,
      displayed_range_only: true
    }
  };
}

async function valuationInputFromBody(body = {}) {
  const category = normalizeCategory(body.category);
  const locationRaw = cleanText(body.location || body.area);
  const districtRaw = cleanText(body.district);
  const canonicalLocation = canonicalizeUgandaLocation(locationRaw, districtRaw);
  const location = canonicalLocation?.name || locationRaw;
  let district = canonicalLocation?.district
    || normalizeDistrict(districtRaw)
    || normalizeDistrict(location)
    || '';
  const transactionType = cleanText(body.transaction_type).toLowerCase();
  const bedroomsRaw = cleanText(body.bedrooms);
  const input = {
    category,
    location,
    district,
    canonical_location: canonicalLocation,
    bedrooms: toNullableInt(bedroomsRaw.replace('+', '')),
    bedrooms_plus: bedroomsRaw.includes('+') || body.bedrooms_plus === true,
    bathrooms: toNullableInt(body.bathrooms),
    property_type: cleanText(body.property_type),
    transaction_type: ['rent', 'sale'].includes(transactionType) ? transactionType : '',
    size_value: toNullableFloat(body.size_value),
    size_unit: cleanText(body.size_unit),
    size_sqm: toNullableFloat(body.size_sqm),
    university: cleanText(body.university),
    condition: normalizedRefinementValue(body.condition),
    tenure: normalizedRefinementValue(body.tenure),
    furnished: normalizedRefinementValue(body.furnished),
    parking: normalizedRefinementValue(body.parking)
  };
  const locationIsDistrict = canonicalLocation?.level === 'district'
    || DISTRICTS.some((item) => item.toLowerCase() === location.toLowerCase());
  if (!locationIsDistrict && !district) {
    district = await withTransientDatabaseRetry(() => inferDistrictForLocation(location));
    input.district = district;
  }
  return { input, locationIsDistrict };
}

router.post('/matches', async (req, res, next) => {
  try {
    const { input, locationIsDistrict } = await valuationInputFromBody(req.body || {});
    if (!input.category || !input.location) {
      return res.status(400).json({ ok: false, error: 'Choose a location and property category.' });
    }
    if (input.category === 'commercial' && !input.transaction_type) {
      return res.status(400).json({ ok: false, error: 'Choose commercial rent or sale.' });
    }
    const scope = locationIsDistrict ? 'district' : 'area';
    const rows = await withTransientDatabaseRetry(() => loadComparableRows(input, scope, { includeImages: false }));
    const summary = buildEstimate(input, rows, scope, false);
    return res.status(200).json({
      ok: true,
      marker: VALUATION_K17_MARKER,
      closeout_marker: VALUATION_CLOSEOUT_MARKER,
      location: input.location,
      district: input.district,
      scope,
      matching_count: summary.analysis_comparable_count,
      refinement_feedback: summary.refinement_feedback
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/estimate', async (req, res, next) => {
  try {
    const { input, locationIsDistrict } = await valuationInputFromBody(req.body || {});

    if (!input.category || !input.location) {
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

    let scope = locationIsDistrict ? 'district' : 'area';
    let widened = false;
    let rows = await withTransientDatabaseRetry(() => loadComparableRows(input, scope));
    const exactCompatibleCount = buildEstimate(input, rows, scope, false).analysis_comparable_count;
    if (scope === 'area' && exactCompatibleCount < DISTRICT_WIDEN_THRESHOLD && input.district) {
      if (
        input.canonical_location
        && Number.isFinite(input.canonical_location.lat)
        && Number.isFinite(input.canonical_location.lng)
      ) {
        const nearbyRows = await withTransientDatabaseRetry(() => loadComparableRows(input, 'nearby'));
        const nearbyCompatibleCount = buildEstimate(input, nearbyRows, 'nearby', true).analysis_comparable_count;
        if (nearbyCompatibleCount >= DISTRICT_WIDEN_THRESHOLD) {
          scope = 'nearby';
          widened = true;
          rows = nearbyRows;
        }
      }
      if (scope === 'area') {
        scope = 'district';
        widened = true;
        rows = await withTransientDatabaseRetry(() => loadComparableRows(input, scope));
      }
    }
    let result = buildEstimate(input, rows, scope, widened);
    if (!result.sufficient && input.district) {
      const broadInput = {
        ...input,
        bedrooms: null,
        bedrooms_plus: false,
        bathrooms: null,
        property_type: '',
        size_value: null,
        size_unit: '',
        size_sqm: null,
        university: '',
        condition: '',
        tenure: '',
        furnished: '',
        parking: ''
      };
      const broadRows = await withTransientDatabaseRetry(() => loadComparableRows(broadInput, 'district'));
      const broadResult = buildEstimate(broadInput, broadRows, 'district_average', true);
      if (broadResult.sufficient) {
        result = {
          ...broadResult,
          input,
          broad_average: true,
          refinement_feedback: result.refinement_feedback
        };
      }
    }
    const payload = {
      ok: true,
      marker: VALUATION_MARKER,
      fix_marker: VALUATION_PUNCHLIST_MARKER,
      ux_marker: VALUATION_K17_MARKER,
      closeout_marker: VALUATION_CLOSEOUT_MARKER,
      input,
      ...result,
      exact_comparable_count: exactCompatibleCount,
      widen_reason: widened
        ? `Only ${exactCompatibleCount} exact compatible comparable${exactCompatibleCount === 1 ? '' : 's'} found; at least ${MIN_COMPARABLES} are required.`
        : null,
      scope_label: result.broad_average
        ? `Broad ${input.district} District average — not an estimate for this property.`
        : widened
        ? (scope === 'nearby'
          ? `Not enough exact matches in ${input.location}; using nearby ${input.district} comparables.`
          : `Not enough exact matches in ${input.location}; using ${input.district} District comparables.`)
        : `Using comparable listings in ${scope === 'district' ? `${input.district} District` : input.location}.`,
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
      `NOT ${publicLaunchTestListingFastCondition('p')}`,
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
       LIMIT 1500`,
      values
    );
    const canonicalRows = canonicalizeLocationRows(rows.rows || []);
    const counts = new Map(canonicalRows.map((row) => [row.canonical_key, row.listing_count]));
    const locationOptions = canonicalLocationOptions()
      .map((row) => ({
        ...row,
        listing_count: counts.get(row.canonical_key) || 0
      }))
      .sort((a, b) => (
        b.listing_count - a.listing_count
        || a.district.localeCompare(b.district)
        || a.location.localeCompare(b.location)
      ));
    return res.status(200).json({
      ok: true,
      marker: VALUATION_MARKER,
      fix_marker: VALUATION_PUNCHLIST_MARKER,
      ux_marker: VALUATION_K17_MARKER,
      closeout_marker: VALUATION_CLOSEOUT_MARKER,
      category,
      data: locationOptions
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
    fix_marker: VALUATION_PUNCHLIST_MARKER,
    ux_marker: VALUATION_K17_MARKER,
    closeout_marker: VALUATION_CLOSEOUT_MARKER,
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
  parseLandSizeText,
  landSizeSqm,
  targetLandSizeSqm,
  landPriceUnitSqm,
  normalizeRecurringPrice,
  valuationPriceBasis,
  hasAmbiguousForeignCurrency,
  isCategoryCompatibleComparable,
  isTransientDatabaseError,
  categoryResultsPath,
  buildEstimate,
  applyOptionalRefinements,
  valuationConfidenceLevel,
  stableComparableImageUrl,
  filterComparablePriceOutliers,
  minimumPlausiblePrice,
  canonicalizeUgandaLocation,
  canonicalizeLocationRows,
  canonicalLocationOptions,
  aliasesForCanonicalLocation
};
