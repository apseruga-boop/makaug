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
  const input = {
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
  };
  const row = (id, price, title) => ({
    id,
    listing_type: 'sale',
    price,
    price_period: 'once',
    title,
    area: 'Kololo',
    district: 'Kampala'
  });

  // 100–110M beside 900–950M is two markets, not one range. The weighted
  // p75/p25 ratio is 9, above the ratio-2 cutoff, so the method refuses to
  // publish an estimate instead of pinning 110M next to 950M homes.
  const wide = valuation.buildEstimate(input, [
    row('a', 100_000_000, 'House A'),
    row('b', 110_000_000, 'House B'),
    row('c', 900_000_000, 'House C'),
    row('d', 950_000_000, 'House D')
  ], 'area', false);
  assert.equal(wide.sufficient, false);
  assert.equal(wide.insufficient_reason, 'range_too_wide');
  assert.equal(wide.estimate, null);

  // A published estimate has to sit inside the displayed evidence range
  // (the weighted p25–p75, or the ±30% cap centred on that estimate).
  const result = valuation.buildEstimate(input, [
    row('a', 100_000_000, 'House A'),
    row('b', 110_000_000, 'House B'),
    row('c', 120_000_000, 'House C'),
    row('d', 130_000_000, 'House D')
  ], 'area', false);
  assert.equal(result.sufficient, true);
  assert.ok(result.range_low != null && result.range_high != null);
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
  assert.match(read('index.html'), /k18c-rent-evidence-followup-20260725/);
  assert.match(read('index.html'), /k18c-source-evidence-precedence-20260725/);
});

test('source evidence precedence repairs unambiguous periods and holds contradictions', () => {
  const migration = read('db/migrations/100_k18c_source_evidence_precedence.sql');

  assert.match(migration, /p\.extra_fields->>'source_caption'/);
  assert.doesNotMatch(
    migration.match(/CREATE TEMP TABLE[\s\S]*?FROM properties p/)?.[0] || '',
    /p\.description/,
    'generated descriptions must not influence the source-evidence decision'
  );
  assert.match(migration, /price_period = 'night'/);
  assert.match(migration, /price_period = 'month'/);
  assert.match(migration, /listing_type = 'sale'/);
  assert.match(migration, /conflicting_rent_sale_source_evidence/);
  assert.match(migration, /status = 'pending'/);
});

test('rent period backfill uses explicit phrases and protects sale evidence', () => {
  const initialMigration = read('db/migrations/098_k18c_price_period_integrity.sql');
  const followupMigration = read('db/migrations/099_k18c_rent_evidence_followup.sql');

  for (const source of [initialMigration, followupMigration]) {
    assert.match(source, /source_text LIKE ANY \(ARRAY\[/);
    assert.match(source, /'%for rent%'/);
    assert.match(source, /NOT \(e\.source_text LIKE ANY \(ARRAY\[/);
    assert.match(source, /'%for sale%'/);
  }
  assert.match(followupMigration, /explicit_rent_source_evidence_v2/);
});
