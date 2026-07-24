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
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 4_000_000, price_period: 'semester' }, 'student'), 4_000_000);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 1_000_000, price_period: 'month' }, 'student'), 4_000_000);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 12_000_000, price_period: 'year' }, 'student'), 4_000_000);
assert.strictEqual(helpers.normalizeRecurringPrice({ price: 1_000_000, price_period: 'month' }, 'rent'), 1_000_000);
assert.strictEqual(helpers.valuationPriceBasis({ category: 'student' }), 'semester');
assert.strictEqual(helpers.valuationPriceBasis({ category: 'rent' }), 'month');

const estimate = helpers.buildEstimate({
  category: 'sale',
  size_value: null,
  size_unit: '',
  size_sqm: null
}, [
  { id: '1', price: 100_000_000, title: 'A' },
  { id: '2', price: 110_000_000, title: 'B' },
  { id: '3', price: 120_000_000, title: 'C' }
], 'area');
assert.strictEqual(estimate.sufficient, true);
assert.strictEqual(estimate.estimate, 110_000_000);
assert.strictEqual(estimate.comparable_count, 3);
assert.strictEqual(estimate.price_basis, 'total');

const landEstimate = helpers.buildEstimate({
  category: 'land',
  size_value: 50,
  size_unit: 'decimals',
  size_sqm: null
}, [
  { id: 'l1', price: 100_000_000, title: 'A', land_size_value: 50, land_size_unit: 'decimals' },
  { id: 'l2', price: 120_000_000, title: 'B', land_size_value: 60, land_size_unit: 'decimals' },
  { id: 'l3', price: 80_000_000, title: 'C', land_size_value: 40, land_size_unit: 'decimals' }
], 'area');
assert.strictEqual(landEstimate.estimate, 100_000_000);
assert.strictEqual(landEstimate.unit_rate_decimal, 2_000_000);
assert.strictEqual(landEstimate.methodology.size_adjusted, true);

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'routes', 'valuation.js'), 'utf8');

assert.ok(server.includes("app.use('/api/valuation', valuationRoutes)"), 'valuation API must be mounted');
assert.ok(html.includes('id="page-valuation"'), 'valuation page must render');
assert.ok(html.includes('valuation-live-comparables-20260724'), 'valuation marker must render');
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
assert.ok(app.includes('refreshValuationLocations'), 'valuation category changes must refresh counted locations');
assert.ok(app.includes('unit_rate_decimal'), 'land valuation must render the per-decimal rate');
assert.ok(app.includes('basisSemester'), 'student valuation must disclose the semester basis');

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
