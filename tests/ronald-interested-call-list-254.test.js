'use strict';
/**
 * Migration 254 (Arthur, 28 Nov 2026 09:25 UK): add interested-not-joined
 * people to Ronald's Get new agents call list. Phone-call only. The repo is
 * public: no full phone numbers. Every name here is already on the public
 * report (last three digits only).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('migration 254 writes only Ronald\'s call list, never a WhatsApp or text send', () => {
  const sql = read('db/migrations/254_ronald_interested_call_list.sql');
  const rb = read('scripts/rollback-254-ronald-interested-call-list.sql');
  assert.match(sql, /INSERT INTO call_number_submissions/);
  assert.match(sql, /mode,\s*how_known/);
  assert.match(sql, /'new_agents'/);
  assert.match(sql, /'migration_254_call_list'/);
  assert.match(sql, /Phone call only/);
  assert.match(sql, /do_not_contact/);
  assert.match(sql, /already_on_own_list/);
  assert.match(sql, /person_key.*'ronald'/s);
  const inserts = [...sql.matchAll(/^\s*INSERT INTO\s+(\S+)/gim)].map((m) => m[1]);
  assert.deepEqual(inserts, ['migration_254_ronald_call_list_backup', 'call_number_submissions']);
  assert.doesNotMatch(sql, /wa\.me|sendMessage|\/api\/.*sms/i);
  assert.doesNotMatch(rb, /INSERT INTO/);
  assert.match(rb, /DELETE FROM call_number_submissions/);
  assert.match(rb, /migration_254_call_list/);
  // Public repo: no full Ugandan numbers (9+ consecutive digits). Last 3 are fine.
  assert.doesNotMatch(sql, /[0-9]{9,}/);
  assert.doesNotMatch(rb, /[0-9]{9,}/);
  const pairs = [...sql.matchAll(/\('(\d{3})', '([^']+)'\)/g)];
  assert.equal(pairs.length, 18, 'allowlist must have 18 unique people');
  assert.ok(pairs.some((p) => p[1] === '214' && p[2] === 'tiktok.com'));
  assert.ok(pairs.some((p) => p[1] === '032' && p[2] === 'tiktok.com'));
  assert.ok(pairs.some((p) => p[1] === '803' && p[2] === 'wilken property services ltd'));
});
