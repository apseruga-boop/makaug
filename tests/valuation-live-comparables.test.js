const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const route = require('../routes/valuation');
const helpers = route._test;

assert.strictEqual(helpers.normalizeCategory('students'), 'student');
assert.strictEqual(helpers.normalizeCategory('buy'), 'sale');
assert.strictEqual(helpers.percentile([10, 20, 30, 40, 50], 0.1), 14);
assert.strictEqual(helpers.percentile([10, 20, 30, 40, 50], 0.9), 46);
assert.strictEqual(helpers.trimmedMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]), 5.5);
assert.ok(Math.abs(helpers.targetLandSizeSqm(1, 'acres') - 4046.8564224) < 0.01);
assert.ok(Math.abs(helpers.targetLandSizeSqm(100, 'decimals') - 4046.8564224) < 0.01);
assert.ok(Math.abs(helpers.parseLandSizeText('Size 50ft X 100ft') - 464.5152) < 0.01);
assert.ok(Math.abs(helpers.parseLandSizeText('50*100 in Najjera') - 464.5152) < 0.01);
assert.ok(Math.abs(helpers.parseLandSizeText('Magnificent Prime 2Acres') - 8093.7128448) < 0.01);
assert.ok(Math.abs(helpers.parseLandSizeText('20 DCMLS title land') - 809.37128448) < 0.01);
assert.ok(Math.abs(helpers.landSizeSqm({
  title: 'Plot in Najjera',
  extra_fields: { source_hover_description: 'Size 50ft X 100ft' }
}) - 464.5152) < 0.01);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 4_000_000, price_period: 'semester' }, 'student'), 4_000_000);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 1_000_000, price_period: 'month' }, 'student'), 4_000_000);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 12_000_000, price_period: 'year' }, 'student'), 4_000_000);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 90_000_000, price_period: 'once' }, 'student'), null);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 1_000_000, price_period: 'month' }, 'rent'), 1_000_000);
assert.strictEqual(helpers.valuationPriceBasis({ category: 'student' }), 'semester');
assert.strictEqual(helpers.valuationPriceBasis({ category: 'rent' }), 'month');

const estimate = helpers.buildEstimate({
  category: 'sale',
  size_value: null,
  size_unit: '',
  size_sqm: null
}, [
  { id: '1', listing_type: 'sale', price: 100_000_000, title: 'A' },
  { id: '2', listing_type: 'sale', price: 110_000_000, title: 'B' },
  { id: '3', listing_type: 'sale', price: 120_000_000, title: 'C' }
], 'area');
assert.strictEqual(estimate.sufficient, true);
assert.strictEqual(estimate.estimate, 110_000_000);
assert.strictEqual(estimate.comparable_count, 3);
assert.strictEqual(estimate.price_basis, 'total');
assert.strictEqual(estimate.confidence, 'low');

const landEstimate = helpers.buildEstimate({
  category: 'land',
  size_value: 50,
  size_unit: 'decimals',
  size_sqm: null
}, [
  { id: 'l1', listing_type: 'land', price: 100_000_000, title: 'A', land_size_value: 50, land_size_unit: 'decimals' },
  { id: 'l2', listing_type: 'land', price: 120_000_000, title: 'B', land_size_value: 60, land_size_unit: 'decimals' },
  { id: 'l3', listing_type: 'land', price: 80_000_000, title: 'C', land_size_value: 40, land_size_unit: 'decimals' }
], 'area');
assert.strictEqual(landEstimate.estimate, 100_000_000);
assert.strictEqual(landEstimate.unit_rate_decimal, 2_000_000);
assert.strictEqual(landEstimate.methodology.size_adjusted, true);

const legacyLandEstimate = helpers.buildEstimate({
  category: 'land',
  size_value: 50,
  size_unit: 'decimals',
  size_sqm: null
}, [
  {
    id: 'legacy-50x100',
    listing_type: 'land',
    price: 75_000_000,
    price_period: 'once',
    title: 'Plot in Najjera',
    extra_fields: { source_hover_description: 'Size 50ft X 100ft' }
  },
  {
    id: 'legacy-acre',
    listing_type: 'land',
    price: 600_000_000,
    price_period: 'once',
    title: '1 acre in Najjera'
  },
  {
    id: 'legacy-decimals',
    listing_type: 'land',
    price: 150_000_000,
    price_period: 'once',
    title: '25 decimals in Najjera'
  },
  {
    id: 'legacy-usd',
    listing_type: 'land',
    price: 11_400,
    price_period: 'once',
    title: '$3Million USD Per Acre'
  }
], 'area');
assert.strictEqual(legacyLandEstimate.methodology.size_adjusted, true);
assert.strictEqual(legacyLandEstimate.analysis_comparable_count, 3);
assert.strictEqual(legacyLandEstimate.comparables.some((row) => row.id === 'legacy-usd'), false);
assert.ok(legacyLandEstimate.unit_rate_decimal > 0);

const studentEstimate = helpers.buildEstimate({
  category: 'student',
  location: 'Makerere',
  size_value: null,
  size_unit: '',
  size_sqm: null
}, [
  { id: 's1', listing_type: 'student', price: 1_000_000, price_period: 'semester', title: 'Student room' },
  { id: 's2', listing_type: 'student', price: 1_200_000, price_period: 'semester', title: 'Hostel room' },
  { id: 's3', listing_type: 'rent', students_welcome: true, price: 350_000, price_period: 'month', title: 'Student bedsitter' },
  { id: 'bad-land', listing_type: 'land', price: 5_000_000_000, price_period: 'once', title: 'Land near university' },
  { id: 'bad-sale', listing_type: 'student', transaction_type: 'sale', price: 800_000_000, price_period: 'once', title: 'Hostel for sale' }
], 'area');
assert.strictEqual(studentEstimate.sufficient, true);
assert.strictEqual(studentEstimate.analysis_comparable_count, 3);
assert.deepStrictEqual(studentEstimate.comparables.map((row) => row.id).sort(), ['s1', 's2', 's3']);
assert.ok(studentEstimate.estimate < 2_000_000, 'student estimate must stay on a semester-rent scale');

assert.strictEqual(helpers.isCategoryCompatibleComparable({
  listing_type: 'sale',
  title: 'Cost to build a three-bedroom house',
  description: 'Construction cost guide'
}, { category: 'sale' }), false);
assert.strictEqual(helpers.isCategoryCompatibleComparable({
  listing_type: 'land',
  transaction_type: 'rent',
  price_period: 'month',
  title: 'Land for monthly rent'
}, { category: 'land' }), false);
assert.strictEqual(helpers.hasAmbiguousForeignCurrency({
  listing_type: 'land',
  price: 11_400,
  title: '$3Million USD Per Acre'
}), true);
assert.strictEqual(helpers.isCategoryCompatibleComparable({
  listing_type: 'land',
  price: 11_400,
  price_period: 'once',
  title: '$3Million USD Per Acre'
}, { category: 'land' }), false);
assert.strictEqual(helpers.isCategoryCompatibleComparable({
  listing_type: 'land',
  price: 85_000_000,
  price_period: 'once',
  title: 'Land in Bujjuko at UGX 85M'
}, { category: 'land' }), true);
assert.strictEqual(helpers.minimumPlausiblePrice({ category: 'sale' }), 1_000_000);
assert.strictEqual(helpers.minimumPlausiblePrice({ category: 'land' }), 1_000_000);
assert.strictEqual(helpers.minimumPlausiblePrice({ category: 'rent' }), 10_000);
assert.strictEqual(helpers.minimumPlausiblePrice({ category: 'commercial', transaction_type: 'rent' }), 10_000);
assert.strictEqual(helpers.isCategoryCompatibleComparable({
  listing_type: 'sale',
  price: 3,
  price_period: 'once',
  title: 'Outside a 450m UGX three bedroom house'
}, { category: 'sale' }), false);
assert.strictEqual(helpers.isTransientDatabaseError({ code: 'POOL_TIMEOUT' }), true);
assert.strictEqual(helpers.isTransientDatabaseError({ code: '23505' }), false);

const evidenceEstimate = helpers.buildEstimate({
  category: 'sale',
  location: 'Kira',
  size_value: null,
  size_unit: '',
  size_sqm: null
}, Array.from({ length: 14 }, (_, index) => ({
  id: `e${index + 1}`,
  listing_type: 'sale',
  price: (index + 1) * 10_000_000,
  title: `Sale ${index + 1}`
})), 'area');
assert.strictEqual(evidenceEstimate.analysis_comparable_count, 14);
assert.strictEqual(evidenceEstimate.comparable_count, 10);
assert.strictEqual(evidenceEstimate.comparables.length, 10);
const displayedValues = evidenceEstimate.comparables.map((row) => row.valuation_value);
assert.strictEqual(evidenceEstimate.range_low, Math.round(helpers.percentile(displayedValues, 0.1)));
assert.strictEqual(evidenceEstimate.range_high, Math.round(helpers.percentile(displayedValues, 0.9)));
assert.strictEqual(evidenceEstimate.methodology.displayed_range_only, true);
assert.strictEqual(evidenceEstimate.view_all_url, '/for-sale?area=Kira');
assert.strictEqual(evidenceEstimate.confidence, 'high');

assert.strictEqual(helpers.canonicalizeUgandaLocation('Kira Town', 'Wakiso').name, 'Kira');
assert.strictEqual(helpers.canonicalizeUgandaLocation('Kira Town', 'Wakiso').district, 'Wakiso');
assert.strictEqual(helpers.canonicalizeUgandaLocation('Naalya Estate', 'Wakiso').name, 'Naalya');
assert.strictEqual(helpers.canonicalizeUgandaLocation('Entebbe', 'Kampala').district, 'Wakiso');
assert.strictEqual(helpers.canonicalizeUgandaLocation('Lake Victoria', 'Wakiso'), null);
assert.deepStrictEqual(
  helpers.canonicalizeLocationRows([
    { location: 'Kira', district: 'Wakiso', listing_count: 2 },
    { location: 'Kira Town', district: 'Wakiso', listing_count: 3 },
    { location: 'Bombo Road', district: 'Kampala', listing_count: 9 }
  ]),
  [{
    location: 'Kira',
    district: 'Wakiso',
    level: 'city',
    latitude: 0.3978,
    longitude: 32.6414,
    listing_count: 5
  }]
);

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'routes', 'valuation.js'), 'utf8');
const metricsSource = fs.readFileSync(path.join(root, 'services', 'publicInventoryMetricsService.js'), 'utf8');
const canonicalLocationMigration = fs.readFileSync(
  path.join(root, 'db', 'migrations', '091_valuation_canonical_location_performance.sql'),
  'utf8'
);

assert.ok(server.includes("app.use('/api/valuation', valuationRoutes)"), 'valuation API must be mounted');
assert.ok(
  server.includes('/api/properties?status=approved&public_only=1&search=Kira&limit=24&page=1&include_summary=1'),
  'the common broad Kira search must be warmed before consumers arrive'
);
assert.ok(html.includes('id="page-valuation"'), 'valuation page must render');
assert.ok(html.includes('valuation-canonical-confidence-cards-20260725'), 'valuation marker must render');
assert.ok(html.includes('Property Value Calculator'), 'valuation H1 must use the approved calculator label');
assert.ok(html.includes('id="nav-valuation"') && html.includes('>Property Value</a>'), 'valuation navigation must use the shorter label');
assert.ok(html.includes('id="valuation-view-all"'), 'valuation evidence must include a view-all control');
assert.ok(html.includes('/marketplace?category=surveyors'), 'valuation must route to surveyors');
assert.ok(app.includes('"/valuation": "valuation"'), 'public route must resolve to valuation page');
assert.ok(app.includes('openValuationForProperty'), 'property detail must link into valuation');
assert.ok(app.includes('applyValuationLanguageUI'), 'valuation UI must participate in language changes');
assert.ok(routeSource.includes("router.get('/locations'"), 'valuation location counts endpoint must exist');
assert.ok(routeSource.includes('COUNT(*)::int AS listing_count'), 'valuation locations must expose real listing counts');
assert.ok(
  routeSource.includes("publicLaunchTestListingFastCondition('p')"),
  'valuation evidence and location counts must exclude launch and QA listings'
);
assert.ok(
  routeSource.includes('const DISTRICT_WIDEN_THRESHOLD = MIN_COMPARABLES'),
  'valuation must keep three or more exact-area comparables instead of widening prematurely'
);
assert.ok(
  metricsSource.includes("'MAKAUG TRAINING'") && metricsSource.includes("'REMOVE AFTER QA'"),
  'the shared public exclusion must recognize legacy training rows'
);
assert.ok(app.includes('refreshValuationLocations'), 'valuation category changes must refresh counted locations');
assert.ok(app.includes('unit_rate_decimal'), 'land valuation must render the per-decimal rate');
assert.ok(app.includes('basisSemester'), 'student valuation must disclose the semester basis');
assert.ok(app.includes('function safeImageUrl'), 'valuation evidence cards must guard image URLs');
assert.ok(
  app.includes('return propCard(valuationComparableProperty(row, category)')
    && app.includes('return socialImportListingCardHtml(p, options)'),
  'valuation evidence must reuse the shared property card and playable found-online card paths'
);
assert.ok(html.includes('id="valuation-confidence-badge"'), 'valuation results must show confidence');
assert.ok(html.includes('id="valuation-disclaimer"'), 'valuation results must show the red disclaimer');
assert.ok(app.includes('limitedDisclaimerBody'), 'thin or widened evidence must render the stronger warning');
assert.ok(
  app.includes('response.input?.canonical_location?.name || response.input?.location'),
  'translated valuation scope must render the canonical name instead of the canonical object'
);
assert.ok(app.includes('methodLegal'), 'methodology must include the liability limitation');
assert.ok(!app.includes('UGANDA_DISTRICTS'), 'valuation selectors must use the canonical DISTRICTS registry');
assert.ok(
  routeSource.includes('withTransientDatabaseRetry')
    && routeSource.includes('hasAmbiguousForeignCurrency')
    && routeSource.includes('parseLandSizeText')
    && routeSource.includes("loadComparableRows(input, 'nearby')"),
  'valuation must retry transient database failures, reject ambiguous foreign currency, parse legacy land sizes, and try nearby canonical areas before district widening'
);
assert.ok(
  canonicalLocationMigration.includes('idx_properties_valuation_public_type_normalized_area_created')
    && canonicalLocationMigration.includes('REGEXP_REPLACE'),
  'canonical valuation matching must have a production expression index'
);

function frozenObject(name) {
  const token = `const ${name} = Object.freeze(`;
  const index = app.indexOf(token);
  assert.ok(index >= 0, `${name} must exist`);
  const start = app.indexOf('(', index) + 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let cursor = start; cursor < app.length; cursor += 1) {
    const character = app[cursor];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (character === ')' && depth === 0) {
      return vm.runInNewContext(`(${app.slice(start, cursor)})`);
    }
  }
  throw new Error(`Could not parse ${name}`);
}

const valuationEnglish = frozenObject('VALUATION_UI_EN');
const valuationOverrides = frozenObject('VALUATION_UI_OVERRIDES');
const valuationSupplements = frozenObject('VALUATION_UI_SUPPLEMENTS');
for (const language of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
  const translated = { ...(valuationSupplements[language] || {}), ...(valuationOverrides[language] || {}) };
  assert.deepStrictEqual(
    Object.keys(valuationEnglish).filter((key) => !translated[key]),
    [],
    `valuation language ${language} must not fall back to English`
  );
}

console.log('valuation live comparables tests passed');
