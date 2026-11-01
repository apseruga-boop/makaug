'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { listingDataIntegrityReport } = require('../utils/listingDataIntegrity');

const land = (overrides = {}) => ({
  listing_type: 'land',
  property_type: 'Land',
  transaction_type: 'sale',
  title: '5 acres of land for sale near Busitema, Tororo',
  area: 'Tororo Eastern',
  district: 'Tororo',
  price: 24000000,
  price_currency: 'UGX',
  extra_fields: {},
  ...overrides
});

test('C95C82: a land sale priced per acre cannot be stored as a once-off total', () => {
  const report = listingDataIntegrityReport(land({ price_period: 'once', price_unit: 'per_acre' }));
  const issue = report.issues.find((item) => item.code === 'land_price_unit_period_conflict');
  assert.ok(issue, 'per_acre unit with once period must be flagged');
  assert.equal(issue.proposed_price_period, 'acre');
});

test('a per-acre land sale stored with the acre period passes the unit check', () => {
  const report = listingDataIntegrityReport(land({ price_period: 'acre', price_unit: 'per_acre' }));
  assert.ok(!report.issue_codes.includes('land_price_unit_period_conflict'));
  assert.ok(!report.issue_codes.includes('price_period_conflicts_with_category'));
});

test('a total land price with no per-acre unit is not flagged', () => {
  const report = listingDataIntegrityReport(land({ price_period: 'once', price_unit: 'total' }));
  assert.ok(!report.issue_codes.includes('land_price_unit_period_conflict'));
});

test('land rent per acre proposes acre_yr', () => {
  const report = listingDataIntegrityReport(land({ transaction_type: 'rent', price_period: 'once', price_unit: 'per_acre' }));
  const issue = report.issues.find((item) => item.code === 'land_price_unit_period_conflict');
  assert.equal(issue?.proposed_price_period, 'acre_yr');
});

test('approval resolves the stored data_integrity_review instead of leaving stale issues', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  assert.match(source, /data_integrity_review: resolvedDataIntegrityReview\(currentExtraFields\.data_integrity_review, actorId\)/);
  assert.match(source, /function resolvedDataIntegrityReview[\s\S]{0,200}ok: true,\s*issues: \[\],\s*issue_codes: \[\],\s*resolved_issues: issues/);
});
