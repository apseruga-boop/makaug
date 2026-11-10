'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'db/migrations/215_st_listing_strip_contradictory_price_text.sql'),
  'utf8'
);
const rollback = fs.readFileSync(
  path.join(root, 'scripts/rollback-215-st-listing-desc-price-text.sql'),
  'utf8'
);

test('migration 215 backs up and cleans contradictory short-stay descriptions', () => {
  assert.match(migration, /st_listing_desc_price_215_backup/);
  assert.match(migration, /before_description/);
  assert.match(migration, /after_description/);
  assert.match(migration, /description_price_cleanup_215/);
  assert.match(migration, /status = 'approved'/);
  assert.match(migration, /price\[\[:space:\]\]\+\(on\|upon\)\[\[:space:\]\]\+application/);
  assert.match(migration, /\/month/);
  assert.match(migration, /\\ymonthly\\y/);
  assert.match(migration, /migration_215 skipped country_not_ug/);
  assert.match(migration, /rolled_back_at IS NULL/);
  assert.match(migration, /ON CONFLICT \(listing_id\) DO UPDATE/);
  assert.doesNotMatch(migration, /UPDATE\s+whatsapp|INSERT\s+INTO\s+whatsapp/i);
  assert.doesNotMatch(migration, /\+?256\d{9}|\b07\d{8}\b/);
});

test('rollback 215 restores descriptions and stays out of migrations', () => {
  assert.match(rollback, /st_listing_desc_price_215_backup/);
  assert.match(rollback, /description = b\.before_description/);
  assert.match(rollback, /description_price_cleanup_215/);
  assert.match(rollback, /rolled_back_at = NOW\(\)/);
  assert.match(rollback, /migration_215 rollback skipped country_not_ug/);
  assert.doesNotMatch(rollback, /\+?256\d{9}|\b07\d{8}\b/);
  assert.equal(
    fs.existsSync(path.join(root, 'db/migrations/rollback-215-st-listing-desc-price-text.sql')),
    false
  );
});
