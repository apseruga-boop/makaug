'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'db/migrations/208_found_online_short_stay_rentals_to_queue.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'scripts/rollback-208-found-online-short-stay-rentals.sql'), 'utf8');

const APPROVED_REFS = [
  'MK-20260630-3E7717',
  'MK-20260630-75E303',
  'MK-20260630-78D934',
  'MK-20260710-AC303E',
  'MK-20260802-74C46B',
  'MK-20260802-A8CD6F',
  'MK-20260810-754137',
  'MK-20260810-D381F1',
  'MK-20260927-F3399B',
  'MK-20260717-3B1148',
];

test('migration 208 backs up the rental rows, queues short stays, and hides the originals', () => {
  assert.match(migration, /short_stay_found_online_208_backup/);
  assert.match(migration, /before_status/);
  assert.doesNotMatch(migration, /before_extra_fields|to_jsonb\(p\)/);
  assert.equal((migration.match(/'MK-\d{8}-[0-9A-F]{6}'/g) || []).length, 73);
  for (const ref of APPROVED_REFS) assert.match(migration, new RegExp(ref));
  assert.doesNotMatch(migration, /MK-20260925-B55754/);
  assert.doesNotMatch(migration, /MK-20261007-874814/);

  assert.match(migration, /'pending',\s*\n\s*'submitted'/);
  assert.match(migration, /'imported',\s*\n\s*'import'/);
  assert.match(migration, /'Found online'/);
  assert.match(migration, /found_online_label', 'Found online'/);
  assert.match(migration, /do_not_message', true/);
  assert.match(migration, /INSERT INTO st_listing_media/);
  assert.match(migration, /p\.latitude, p\.longitude/);
  assert.match(migration, /status = 'hidden'/);
  assert.match(migration, /moved_to_st_listing_id/);
  assert.doesNotMatch(migration, /status = 'deleted'/);
  assert.match(migration, /king_facts_confirmed/);
  assert.match(migration, /FALSE/);
  assert.match(migration, /migration_208 skipped country_not_ug/);
  assert.match(migration, /rolled_back_at IS NULL/);
  assert.match(migration, /ON CONFLICT \(property_id\) DO UPDATE/);
});

test('migration 208 does not message anyone or copy a phone into the new stay', () => {
  assert.doesNotMatch(migration, /lister_phone|contact_phone|whatsapp|outbound_message/i);
  assert.match(migration, /host_name, host_phone, host_type/);
  assert.match(migration, /'Found online',\s*\n\s*'',\s*\n\s*'owner'/);
  assert.match(migration, /256\[\\s\.\\-\]\*\[37\]\\d\{8\}/);
  assert.doesNotMatch(migration, /\+?256\d{9}|\b07\d{8}\b/);
  assert.doesNotMatch(rollback, /\+?256\d{9}|\b07\d{8}\b/);
});

test('rollback 208 restores the hidden rentals and removes only the stays it created', () => {
  assert.match(rollback, /short_stay_found_online_208_backup/);
  assert.match(rollback, /DELETE FROM st_listing/);
  assert.match(rollback, /migration_208/);
  assert.match(rollback, /status = b\.before_status/);
  assert.match(rollback, /extra_fields = COALESCE\(p\.extra_fields, '\{\}'::jsonb\)/);
  assert.match(rollback, /'moved_to_st_listing_id'/);
  assert.match(rollback, /rolled_back_at = NOW\(\)/);
  assert.equal(fs.existsSync(path.join(root, 'db/migrations/rollback-208-found-online-short-stay-rentals.sql')), false);
});
