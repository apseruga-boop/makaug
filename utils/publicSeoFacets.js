'use strict';

const { UNIVERSITIES } = require('./constants');
const { normalizeUniversityName } = require('./universityMatcher');

const SEO_FACET_MIN_LISTINGS = Math.max(3, Number(process.env.PUBLIC_SEO_FACET_MIN_LISTINGS || 3) || 3);

const FACET_DEFINITIONS = Object.freeze({
  sale: Object.freeze({
    apartments: { label: 'Apartments for sale', kind: 'property_type', pattern: 'apartment|flat', searchValue: 'apartment' },
    houses: { label: 'Houses for sale', kind: 'property_type', pattern: 'house|home|mansion|residence', searchValue: 'house' },
    bungalows: { label: 'Bungalows for sale', kind: 'property_type', pattern: 'bungalow' },
    villas: { label: 'Villas for sale', kind: 'property_type', pattern: 'villa' },
    townhouses: { label: 'Townhouses for sale', kind: 'property_type', pattern: 'townhouse|town house' },
    '3-bedroom': { label: '3-bedroom property for sale', kind: 'bedrooms', value: 3 },
    '4-bedroom': { label: '4-bedroom property for sale', kind: 'bedrooms', value: 4 },
    '5-bedroom': { label: '5-bedroom property for sale', kind: 'bedrooms', value: 5 },
    cheap: { label: 'Affordable houses for sale', kind: 'max_price', value: 250000000, pattern: 'house|home|bungalow|villa|townhouse|mansion' },
    luxury: { label: 'Luxury houses for sale', kind: 'min_price', value: 800000000, pattern: 'house|home|bungalow|villa|townhouse|mansion' }
  }),
  rent: Object.freeze({
    apartments: { label: 'Apartments for rent', kind: 'property_type', pattern: 'apartment|flat', searchValue: 'apartment' },
    studios: { label: 'Studios for rent', kind: 'property_type', pattern: 'studio|bedsitter|bed sitter', searchValue: 'studio' },
    houses: { label: 'Houses for rent', kind: 'property_type', pattern: 'house|home|bungalow|villa|townhouse', searchValue: 'house' },
    '1-bedroom': { label: '1-bedroom property for rent', kind: 'bedrooms', value: 1 },
    '2-bedroom': { label: '2-bedroom property for rent', kind: 'bedrooms', value: 2 },
    '3-bedroom': { label: '3-bedroom property for rent', kind: 'bedrooms', value: 3 },
    affordable: { label: 'Affordable houses for rent', kind: 'max_price', value: 1500000, pattern: 'house|home|bungalow|villa|townhouse' }
  }),
  land: Object.freeze({
    'residential-plots': { label: 'Residential plots for sale', kind: 'property_type', pattern: 'residential|housing|estate plot|plot', searchValue: 'Residential' },
    agricultural: { label: 'Agricultural land for sale', kind: 'property_type', pattern: 'agricultural|farm|farmland|ranch', searchValue: 'Agricultural' },
    'commercial-plots': { label: 'Commercial plots for sale', kind: 'property_type', pattern: 'commercial|business|industrial', searchValue: 'Commercial' },
    mailo: { label: 'Mailo land for sale', kind: 'title_type', value: 'mailo' },
    freehold: { label: 'Freehold land for sale', kind: 'title_type', value: 'freehold' },
    leasehold: { label: 'Leasehold land for sale', kind: 'title_type', value: 'leasehold' },
    'plots-under-50m': { label: 'Plots under USh 50M', kind: 'max_price', value: 50000000 }
  }),
  commercial: Object.freeze({
    'office-space': { label: 'Office space', kind: 'property_type', pattern: 'office|workspace|business centre|business center', searchValue: 'office' },
    'shops-retail': { label: 'Shops and retail space', kind: 'property_type', pattern: 'shop|retail|store|arcade', searchValue: 'shop_retail' },
    warehouses: { label: 'Warehouses', kind: 'property_type', pattern: 'warehouse|industrial|factory|storage', searchValue: 'warehouse_industrial' },
    'commercial-land': { label: 'Commercial land', kind: 'property_type', pattern: 'commercial land|industrial land|business plot', searchValue: 'commercial_land' },
    hospitality: { label: 'Hospitality property', kind: 'property_type', pattern: 'hotel|guest house|lodge|restaurant|hospitality', searchValue: 'hospitality' }
  })
});

const COMMERCIAL_TRANSACTION_FACETS = Object.freeze({
  'for-rent': { label: 'Commercial property for rent', kind: 'transaction_type', value: 'rent' },
  'for-sale': { label: 'Commercial property for sale', kind: 'transaction_type', value: 'sale' }
});

const UNIVERSITY_SLUG_OVERRIDES = Object.freeze({
  'Mbarara University of Science and Technology (MUST)': 'must-mbarara',
  'Makerere University Business School (MUBS)': 'mubs',
  'Uganda Christian University (UCU)': 'ucu-mukono',
  'Kampala International University (KIU)': 'kiu',
  'Uganda Martyrs University (UMU)': 'umu-nkozi',
  'Islamic University in Uganda (IUIU)': 'iuiu'
});

function slugify(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:university|uganda|of|the|in|campus)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function universitySlug(name = '') {
  return UNIVERSITY_SLUG_OVERRIDES[name] || slugify(name);
}

const UNIVERSITY_LANDINGS = Object.freeze(UNIVERSITIES.map((name) => ({ name, slug: universitySlug(name) })));

function universityForSlug(slug = '') {
  const key = slugify(slug);
  return UNIVERSITY_LANDINGS.find((item) => item.slug === slug || slugify(item.slug) === key) || null;
}

function facetDefinition(categoryKey, slug) {
  return FACET_DEFINITIONS[categoryKey]?.[slug] || null;
}

function commercialTransactionFacet(slug) {
  return COMMERCIAL_TRANSACTION_FACETS[slug] || null;
}

function facetMatchesRow(definition, row = {}) {
  if (!definition) return false;
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const typeText = [row.property_type, row.title, row.description, extra.room_type, extra.commercial_type]
    .filter(Boolean).join(' ').toLowerCase();
  const matchesPattern = !definition.pattern || new RegExp(`\\b(?:${definition.pattern})\\b`, 'i').test(typeText);
  if (definition.kind === 'bedrooms') return Number(row.bedrooms || 0) === Number(definition.value);
  if (definition.kind === 'max_price') return matchesPattern && Number(row.price || 0) > 0 && Number(row.price) <= Number(definition.value);
  if (definition.kind === 'min_price') return matchesPattern && Number(row.price || 0) >= Number(definition.value);
  if (definition.kind === 'title_type') {
    return String(row.title_type || extra.title_type || '').toLowerCase().includes(String(definition.value).toLowerCase());
  }
  if (definition.kind === 'transaction_type') {
    const transaction = String(row.transaction_type || extra.transaction_type || '').toLowerCase();
    const period = String(row.price_period || '').toLowerCase();
    return transaction === definition.value
      || (definition.value === 'rent' && ['mo', 'month', 'monthly', 'per_month'].includes(period))
      || (definition.value === 'sale' && ['once', 'sale'].includes(period));
  }
  if (definition.kind === 'property_type') {
    return matchesPattern;
  }
  return false;
}

function facetSlugsForRow(categoryKey, row = {}) {
  return Object.entries(FACET_DEFINITIONS[categoryKey] || {})
    .filter(([, definition]) => facetMatchesRow(definition, row))
    .map(([slug]) => slug);
}

function commercialTransactionSlugsForRow(row = {}) {
  return Object.entries(COMMERCIAL_TRANSACTION_FACETS)
    .filter(([, definition]) => facetMatchesRow(definition, row))
    .map(([slug]) => slug);
}

function universityLandingForRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const university = normalizeUniversityName(
    row.nearest_university
    || extra.nearest_university
    || extra.student_university
    || extra.student_campus
  );
  return university ? UNIVERSITY_LANDINGS.find((item) => item.name === university) || null : null;
}

module.exports = {
  SEO_FACET_MIN_LISTINGS,
  FACET_DEFINITIONS,
  COMMERCIAL_TRANSACTION_FACETS,
  UNIVERSITY_LANDINGS,
  slugify,
  universitySlug,
  universityForSlug,
  facetDefinition,
  commercialTransactionFacet,
  facetMatchesRow,
  facetSlugsForRow,
  commercialTransactionSlugsForRow,
  universityLandingForRow
};
