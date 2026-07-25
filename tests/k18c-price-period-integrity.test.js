'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const valuation = require('../routes/valuation')._test;

test('student list and suggestion filters accept singular and legacy plural rows', () => {
  const source = read('routes/properties.js');
  assert.match(source, /p\.listing_type IN \(\?, \?\)/, 'student list filter must query both stored variants');
  assert.match(source, /'student', 'students'/, 'student list filter must include the plural legacy value');
  assert.match(source, /listing_type IN \(\$2, \$3\)/, 'student suggestions must include both stored variants');
});

test('valuation estimate is constrained to its displayed evidence range', () => {
  const result = valuation.buildEstimate({
    category: 'sale',
    location: 'Kololo',
    district: 'Kampala',
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
  }, [
    { id: 'a', listing_type: 'sale', price: 100_000_000, price_period: 'once', title: 'House A', area: 'Kololo', district: 'Kampala' },
    { id: 'b', listing_type: 'sale', price: 110_000_000, price_period: 'once', title: 'House B', area: 'Kololo', district: 'Kampala' },
    { id: 'c', listing_type: 'sale', price: 900_000_000, price_period: 'once', title: 'House C', area: 'Kololo', district: 'Kampala' },
    { id: 'd', listing_type: 'sale', price: 950_000_000, price_period: 'once', title: 'House D', area: 'Kololo', district: 'Kampala' }
  ], 'area', false);

  assert.equal(result.sufficient, true);
  assert.ok(result.estimate >= result.range_low);
  assert.ok(result.estimate <= result.range_high);
});

test('API paths are excluded from every SPA index fallback', () => {
  const source = read('server.js');
  assert.match(source, /req\.path\.startsWith\('\/api\/'\)/);
  assert.match(source, /if \(req\.path\.startsWith\('\/api\/'\)\) return next\(\);/);
  assert.match(source, /app\.use\(notFound\);[\s\S]*app\.use\(errorHandler\);/);
  assert.match(read('middleware/errorHandler.js'), /res\.status\(status\)\.json\(/);
});

test('release marker identifies the K18c deployment', () => {
  assert.match(read('index.html'), /k18c-price-period-integrity-20260725/);
});
