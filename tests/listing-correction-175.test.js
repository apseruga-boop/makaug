'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION = path.join(__dirname, '../db/migrations/175_clear_seeta_bedrooms_and_kigo_pin.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-175-listing-corrections.sql');
const SEETA_ID = '496006a9-d203-437c-a722-d99fe7d8df03';
const KIGO_ID = 'b1014d2d-ec8c-4127-b898-0207a573e959';

const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollback = fs.readFileSync(ROLLBACK, 'utf8');

test('migration 175 clears Seeta bedrooms and moves the Kigo pin under guards', () => {
  assert.match(sql, new RegExp(SEETA_ID));
  assert.match(sql, new RegExp(KIGO_ID));
  assert.match(sql, /kigo_lat numeric := 0\.2052/);
  assert.match(sql, /kigo_lng numeric := 32\.5967/);
  assert.match(sql, /hoima_lat numeric := 1\.434/);
  assert.match(sql, /hoima_lng numeric := 31\.352/);
  assert.match(sql, /SET LOCAL client_min_messages = NOTICE/);
  assert.match(sql, /listing_correction_175_backup/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % applied clear_bedrooms'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % applied move_pin'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped bedrooms_not_3'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped not_mixed_use'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped already_clear'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped already_at_kigo'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped not_labelled_kigo'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped pin_changed'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_175 % skipped country_not_ug'/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(sql, /p\.bedrooms IS DISTINCT FROM 3/);
  assert.match(sql, /mixed-use/);
  assert.match(sql, /wakiso:kigo/);
  assert.match(sql, /abs\(target\.latitude - hoima_lat\) <= 0\.0005/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(sql, /scripts\/whatsapp|routes\/whatsapp|WAHA/);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-175-listing-corrections.sql')), false);
});

test('migration 175 rollback is manual and restores only an unedited stamp', () => {
  assert.match(rollback, /listing_correction_175_backup/);
  assert.match(rollback, /listing_correction_175/);
  assert.match(rollback, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(rollback, /p\.updated_at = \(p\.extra_fields->'listing_correction_175'->>'applied_at'\)::timestamptz/);
  assert.match(rollback, /bedrooms/);
  assert.match(rollback, /latitude/);
  assert.match(rollback, /longitude/);
  assert.doesNotMatch(rollback, /DELETE\s+FROM\s+listing_correction_175_backup/i);
  assert.equal(path.basename(path.dirname(ROLLBACK)), 'scripts');
});
