'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const classification = require('../utils/commercialClassification');

const migration = read('db/migrations/079_commercial_transaction_subtype.sql');
const correctionMigration = read('db/migrations/080_commercial_transaction_period_correction.sql');
const propertiesRoute = read('routes/properties.js');
const aiRoute = read('routes/ai.js');
const aiService = read('services/aiService.js');
const adminRoute = read('routes/admin.js');
const staffRoute = read('routes/staff.js');
const sourceIntake = read('services/socialSearchSourcedListingsService.js');
const app = read('assets/makaug-app.js');
const html = read('index.html');

test('commercial transaction and subtype normalizers use independent axes', () => {
  assert.equal(classification.normalizeCommercialTransactionType('to let'), 'rent');
  assert.equal(classification.normalizeCommercialTransactionType('', { pricePeriod: 'month' }), 'rent');
  assert.equal(classification.normalizeCommercialTransactionType('', { text: 'Office for sale in Kololo' }), 'sale');
  assert.equal(classification.normalizeCommercialPropertyType('Retail / Shop'), 'shop_retail');
  assert.equal(classification.normalizeCommercialPropertyType('', { text: 'Warehouse and distribution centre' }), 'warehouse_industrial');
  assert.equal(classification.normalizeCommercialPropertyType('', { text: 'Commercial land, two acres' }), 'commercial_land');
  assert.equal(classification.normalizeCommercialPropertyType('', { text: 'Boutique hotel in Kampala' }), 'hospitality');
  assert.equal(
    classification.commercialMisclassificationWarning({ listing_type: 'commercial', title: '6-bed house for rent in Bugolobi' }),
    'Possible residential listing classified as commercial; confirm category before approval.'
  );
});

test('migration adds, backfills, constrains and indexes the transaction axis', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS transaction_type TEXT/);
  assert.match(migration, /CHECK \(transaction_type IS NULL OR transaction_type IN \('rent', 'sale'\)\)/);
  assert.match(migration, /WHERE listing_type IN \('commercial', 'land'\)/);
  assert.match(migration, /price_period[\s\S]*'month'[\s\S]*THEN 'rent'/);
  assert.match(migration, /price_period[\s\S]*'once'[\s\S]*THEN 'sale'/);
  assert.match(migration, /commercial_land/);
  assert.match(migration, /warehouse_industrial/);
  assert.match(migration, /idx_properties_commercial_transaction_subtype/);
  assert.match(migration, /ELSE NULL[\s\S]*WHERE listing_type = 'commercial'/);
  assert.match(correctionMigration, /stored price period is the authoritative transaction signal/);
  assert.match(correctionMigration, /WHERE listing_type IN \('commercial', 'land'\)/);
  assert.match(correctionMigration, /ANALYZE properties/);
});

test('public properties API filters and returns transaction and canonical subtype', () => {
  assert.match(propertiesRoute, /req\.query\.transactionType \|\| req\.query\.transaction_type/);
  assert.match(propertiesRoute, /p\.transaction_type = \?/);
  assert.match(propertiesRoute, /LOWER\(COALESCE\(p\.property_type, p\.extra_fields->>'commercial_type', ''\)\) = \?/);
  assert.match(propertiesRoute, /transaction_type: row\.transaction_type \|\| null/);
  assert.match(propertiesRoute, /transaction_type is required for commercial listings and must be rent or sale/);
  assert.match(propertiesRoute, /property_type is required for commercial listings/);
  assert.match(propertiesRoute, /Commercial transaction and property type are required before approval/);
});

test('source intake extracts both axes and holds incomplete or misclassified commercial rows', () => {
  assert.match(sourceIntake, /transactionType: transactionType \|\| null/);
  assert.match(sourceIntake, /property_type: propertyType \|\| null/);
  assert.match(sourceIntake, /Commercial transaction and subtype need staff confirmation before publication/);
  assert.match(sourceIntake, /commercialMisclassificationWarning/);
  assert.match(sourceIntake, /listing_type, transaction_type, title, description/);
  assert.match(sourceIntake, /transaction_type = \$3/);
});

test('admin and staff editing persist the commercial transaction axis', () => {
  assert.match(adminRoute, /transaction_type: \{ column: 'transaction_type'/);
  assert.match(staffRoute, /transaction_type: \(value\) => normalizeCommercialTransactionType/);
  assert.match(app, /id="admin-review-transaction-type-edit"/);
  assert.match(app, /id="admin-review-commercial-type-edit"/);
  assert.match(app, /Choose the commercial transaction and property type before approving/);
});

test('commercial public controls are segmented, canonical and carried through URLs', () => {
  assert.match(html, /commercial-transaction-subtype-20260719/);
  assert.match(html, /id="hero-transaction-f"/);
  assert.match(html, /id="commercial-transaction-f"/);
  assert.match(html, /value="commercial_land">Commercial land/);
  assert.match(app, /params\.set\("transaction_type", filters\.transactionType\)/);
  assert.match(app, /data-section-transaction="rent"/);
  assert.match(app, /data-section-transaction="sale"/);
  assert.match(app, /commercialTransactionForProperty/);
  assert.match(app, /canonicalCommercialTypeForProperty/);
});

test('Ask AI parses and passes transaction_type without prematurely relaxing subtype', () => {
  assert.match(aiService, /transactionType/);
  assert.match(aiService, /"transactionType": "rent\|sale\|null"/);
  assert.match(aiRoute, /params\.set\('transaction_type'/);
  assert.match(aiRoute, /if \(result\.total === 0 && parsed\?\.propertyType\)/);
  assert.match(aiRoute, /transaction_type: effectiveParsed\?\.transactionType \|\| null/);
});
