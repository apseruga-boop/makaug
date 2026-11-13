'use strict';

// Data fix 224 (Arthur, 13 Nov 2026): MK-20261111-9D6051 to Mukono with
// no bedrooms and a typed title; its duplicate MK-20261112-004179 taken
// down. Only those two rows, matched by id and reference, after boot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fix = require('../scripts/run-benard-mukono-fix-224');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const migration = read('db', 'migrations', '224_benard_mukono_listing_fix.sql');
const runner = read('scripts', 'run-benard-mukono-fix-224.js');
const rollback = read('scripts', 'rollback-224-benard-mukono-fix.sql');
const server = read('server.js');

test('migration 224 only creates the backup table', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS benard_mukono_fix_224_backup/);
  assert.match(migration, /lock_timeout = '3s'/);
  assert.match(migration, /statement_timeout = '15s'/);
  assert.doesNotMatch(migration, /UPDATE properties|DELETE FROM|DISABLE TRIGGER/);
  assert.doesNotMatch(runner + rollback, /DELETE FROM|DISABLE TRIGGER/);
  assert.match(runner, /SET LOCAL lock_timeout/);
  assert.match(runner, /SET LOCAL statement_timeout/);
  assert.match(server, /runBenardMukonoFix224\(db, \{ logger \}\)/);
  assert.ok(server.indexOf('runBenardMukonoFix224') > server.indexOf("staggeredBootDelay('startup_data_repairs')") - 4000, 'post-boot repair block');
  assert.match(rollback, /p\.updated_at = b\.applied_at/);
});

test('only the two approved rows, by id and reference', () => {
  assert.deepEqual(fix.SPECS.map((s) => [s.id, s.ref]), [
    ['000f79c1-ca94-44e8-a25c-994d93c7b0a2', 'MK-20261111-9D6051'],
    ['ce81a13b-4132-4243-8399-48e0a7a8f686', 'MK-20261112-004179']
  ]);
  assert.match(runner, /WHERE id = \$1 AND inquiry_reference = \$2/);
  assert.equal(fix.NEW_TITLE, '6 acres with warehouse for sale in Mukono');
  assert.match(fix.UPDATE_SQL.correct_to_mukono, /bedrooms = NULL/);
  assert.match(fix.UPDATE_SQL.correct_to_mukono, /district = 'Mukono'/);
  assert.doesNotMatch(fix.UPDATE_SQL.correct_to_mukono, /status =/);
  assert.match(fix.UPDATE_SQL.take_down_duplicate, /SET status = 'hidden'/);
  assert.doesNotMatch(runner, /sendWhatsApp|sendMessage|notif[a-z]*\(|require\([^)]*(whatsapp|notification|email)/i);
});

test('the auto-added lead sentence is removed and Benard\'s text kept', () => {
  const re = new RegExp(fix.AUTO_LEAD_RE.replace('[[:space:]]', '\\s'));
  const description = 'Commercial property in Transformer, Nakaseke, listed at UGX 2,300,000,000. *LAND + HUGE WAREHOUSE FOR SALE - MUKONO*';
  assert.equal(description.replace(re, ''), '*LAND + HUGE WAREHOUSE FOR SALE - MUKONO*');
});

function fakeDb(rows) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT id, status, updated_at/.test(sql)) {
        const row = rows[params[0]];
        return { rows: row && row.ref === params[1] ? [row] : [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return { calls, db: { getClient: async () => client } };
}

test('the runner applies both, skips a changed or already fixed row', async () => {
  const base = { status: 'approved', updated_at: '2026-11-13T05:39:23Z', guard_ok: true, already_done: false };
  let { calls, db } = fakeDb({
    [fix.MUKONO.id]: { ...base, ref: fix.MUKONO.ref, area: 'Transformer' },
    [fix.DUPLICATE.id]: { ...base, ref: fix.DUPLICATE.ref, area: 'Transformer' }
  });
  let result = await fix.runBenardMukonoFix224(db, { logger: { warn() {} } });
  assert.equal(result.updated, 2, JSON.stringify(result));
  assert.equal(calls.filter((c) => /INSERT INTO benard_mukono_fix_224_backup/.test(c.sql)).length, 2);
  assert.equal(calls.filter((c) => /^\s*UPDATE properties/.test(c.sql)).length, 2);
  assert.ok(calls.some((c) => /agent_manager_take_down/.test(c.sql)));

  ({ calls, db } = fakeDb({
    [fix.MUKONO.id]: { ...base, ref: fix.MUKONO.ref, guard_ok: false },
    [fix.DUPLICATE.id]: { ...base, ref: fix.DUPLICATE.ref, already_done: true }
  }));
  result = await fix.runBenardMukonoFix224(db, { logger: { warn() {} } });
  assert.equal(result.updated, 0);
  assert.deepEqual(result.results, { 'MK-20261111-9D6051': 'state_changed_skipped', 'MK-20261112-004179': 'already_done' });
  assert.equal(calls.filter((c) => /^\s*UPDATE properties/.test(c.sql)).length, 0);
});
