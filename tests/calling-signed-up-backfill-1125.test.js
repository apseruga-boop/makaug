'use strict';

/**
 * 25 Nov 2026 (Arthur): "Un named" …680 was logged Signed up before #878, so no
 * profile was opened and nothing showed in King or on the staff desk. At
 * start-up, Signed up calls with no agent profile get the pending profile they
 * should have had. Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const queries = [];
let candidates = [];
const fakeDb = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (/FROM call_attempts c/.test(sql)) return { rows: candidates };
    if (/INSERT INTO agents/.test(sql)) return { rows: [{ id: `agent-${params[2]}`, status: 'pending', full_name: params[0] }] };
    return { rows: [] };
  }
};
require.cache[require.resolve('../config/database')] = { id: 'fake-db', filename: 'fake-db', loaded: true, exports: fakeDb };

const ft = require('../services/callingFollowThrough');

test('a Signed up call with no profile gets its pending profile; a stand-in name stays a stand-in for the names-to-fix list', async () => {
  queries.length = 0;
  candidates = [
    { id: 'call-1', phone_key: '771234680', phone: '+256771234680', person_key: 'ronald', full_name: 'Un named', task_key: 'new_agents', outcome: 'signed_up' },
    { id: 'call-2', phone_key: '700000105', phone: '+256700000105', person_key: 'ronald', full_name: 'Practice Person', task_key: 'new_agents', outcome: 'signed_up' }
  ];
  const opened = await ft.openMissedSignups({ days: 14 });
  assert.strictEqual(opened.length, 1, 'a practice number never gets a profile');
  assert.strictEqual(opened[0].attempt_id, 'call-1');
  assert.strictEqual(opened[0].phone_tail, '680');
  const insert = queries.find((q) => /INSERT INTO agents/.test(q.sql));
  assert.strictEqual(insert.params[0], 'Un named');
  assert.strictEqual(insert.params[2], '+256771234680');
  assert.strictEqual(insert.params[3], 'calling_interested', 'approved by itself when they say Hi, like Interested');
  assert.match(insert.params[4], /logged Signed up on a call/);
  const select = queries.find((q) => /FROM call_attempts c/.test(q.sql)).sql;
  assert.match(select, /c\.outcome = 'signed_up'/);
  assert.match(select, /NOT EXISTS \(\s*SELECT 1 FROM agents a/);
  assert.doesNotMatch(select, /removed_at IS NULL/, 'a number with a removed profile is left for a person');
});

test('nothing to open: nothing written', async () => {
  queries.length = 0;
  candidates = [];
  assert.deepStrictEqual(await ft.openMissedSignups(), []);
  assert.ok(!queries.some((q) => /INSERT/.test(q.sql)));
});

test('it runs once at start-up, after the other boot jobs, and can be switched off', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /SIGNED_UP_BACKFILL !== 'false'/);
  assert.match(server, /openMissedSignups\(\{ days: 14 \}\)/);
  assert.match(server, /staggeredBootDelay\('signed_up_backfill'\)/);
  assert.strictEqual(require('../utils/schedulerStagger').BOOT_DELAY_MS?.signed_up_backfill ?? 790_000, 790_000);
});
