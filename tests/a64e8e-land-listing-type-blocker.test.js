'use strict';

// A64E8E: a "Land for sale" listing stored with listing_type 'sale' was blocked
// with "Source evidence indicates land, not sale. Proposed category: land".
// The moderator read the title, saw "for sale", and could not tell which field
// was wrong. The block is correct; the message must name the Listing type field,
// use the option labels the editor shows, and highlight that field.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { listingDataIntegrityReport, listingTypeOptionLabel } = require('../utils/listingDataIntegrity');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const landForSale = (overrides = {}) => ({
  title: 'Land for sale in Mutundwe',
  description: 'Land for sale in Mutundwe, Kampala, listed at UGX 1,400,000,000 (1.4 billion). One acre in Mutundwe near Victoria Primary School.',
  listing_type: 'sale',
  transaction_type: null,
  property_type: null,
  price: 1400000000,
  currency: 'UGX',
  district: 'Kampala',
  area: 'Mutundwe',
  land_size_value: 1,
  land_size_unit: 'acres',
  extra_fields: { source_caption: 'One acre Mutundwe near Victoria Primary school UGX 1.4 billion 0768524008' },
  ...overrides,
});

test('land listed under "For sale" names the Listing type field and its labels', () => {
  const report = listingDataIntegrityReport(landForSale());
  assert.equal(report.ok, false);
  const issue = report.issues.find((item) => item.code === 'category_conflicts_with_source_evidence');
  assert.ok(issue, JSON.stringify(report.issues));
  assert.equal(issue.field, 'listing_type');
  assert.equal(issue.current_listing_type, 'sale');
  assert.equal(issue.proposed_listing_type, 'land');
  assert.equal(issue.message, 'Listing type is set to "For sale", but the source evidence shows Land. Change Listing type to "Land".');
});

test('the same listing passes once Listing type is Land (sale transaction)', () => {
  const report = listingDataIntegrityReport(landForSale({ listing_type: 'land', transaction_type: 'sale' }));
  assert.deepEqual(report.issues.filter((item) => item.code === 'category_conflicts_with_source_evidence'), []);
});

test('option labels match the staff editor select', () => {
  assert.equal(listingTypeOptionLabel('sale'), 'For sale');
  assert.equal(listingTypeOptionLabel('rent'), 'To rent');
  assert.equal(listingTypeOptionLabel('land'), 'Land');
  assert.equal(listingTypeOptionLabel('commercial'), 'Commercial');
  assert.equal(listingTypeOptionLabel('student'), 'Student accommodation');
});

test('approve blocker sends the issue field so the editor highlights Listing type', () => {
  const routes = read('routes/properties.js');
  assert.match(routes, /code: 'data_integrity',[\s\S]{0,400}missingFields: \[\.\.\.new Set\(dataIntegrity\.issues\.map\(\(issue\) => issue\.field\)/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /listing_type: \["admin-review-listing-type-edit", "staff-preview-listing-type"\]/);
  assert.match(app, /Set Listing type to: \$\{listingTypeOptionLabelForBlocker\(issue\.proposed_listing_type\)\}/);
  assert.doesNotMatch(app, /Proposed category: \$\{issue\.proposed_listing_type\}/);
});
