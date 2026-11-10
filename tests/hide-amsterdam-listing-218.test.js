'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION = path.join(__dirname, '../db/migrations/218_hide_amsterdam_listing.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-218-hide-amsterdam-listing.sql');

test('migration 218 hides the Amsterdam listing without deleting it and stays off the trigger-disable path', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const rollback = fs.readFileSync(ROLLBACK, 'utf8');

  assert.match(sql, /MK-20261012-B3A4F7/);
  assert.match(sql, /ae2a86c6-e26b-4674-b74a-897d895451bd/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS amsterdam_hide_218_backup/);
  assert.match(sql, /status = 'hidden'/);
  assert.match(sql, /unpublished_from_status/);
  assert.match(sql, /unpublished_by', 'migration_218'/);
  assert.match(sql, /lock_timeout = '3s'/);
  assert.match(sql, /statement_timeout = '15s'/);
  assert.match(sql, /already_recorded/);
  assert.doesNotMatch(sql, /DELETE FROM properties/);
  assert.doesNotMatch(sql, /DISABLE TRIGGER/);

  assert.match(rollback, /Not run by scripts\/migrate\.js/);
  assert.match(rollback, /amsterdam_hide_218_backup/);
  assert.match(rollback, /status = b\.before_status/);
  assert.match(rollback, /MK-20261012-B3A4F7/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/);
  assert.doesNotMatch(rollback, /ALTER TABLE\s+\w+\s+DISABLE TRIGGER/);
  assert.doesNotMatch(rollback, /DROP TABLE/i);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-218-hide-amsterdam-listing.sql')), false);
});
