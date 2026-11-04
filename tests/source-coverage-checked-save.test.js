const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { releaseExpiredSourceCoverageLeases, MAX_COVERAGE_ITEM_ATTEMPTS } = require('../services/sourceCoverageService');

test('expired leases are released and items with 3+ attempts are parked', async () => {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values }); return { rowCount: calls.length }; } };
  const out = await releaseExpiredSourceCoverageLeases(client, 'run-1');
  assert.equal(MAX_COVERAGE_ITEM_ATTEMPTS, 3);
  assert.match(calls[0].sql, /SET status = 'blocked'/);
  assert.match(calls[0].sql, /attempts >= \$2/);
  assert.deepEqual(calls[0].values, ['run-1', 3]);
  assert.match(calls[1].sql, /SET status = 'retry'/);
  assert.deepEqual(out, { parked: 1, released: 2 });
});

test('coverage UI shows per-item save result, keeps failed items and times out loads', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  assert.ok(src.includes('Mark checked: no results'));
  assert.ok(!src.includes('Checked — no results'));
  assert.ok(src.includes('staff-source-coverage-result-'));
  assert.ok(src.includes('This source stays here'));
  assert.match(src, /staffApiRequestWithTimeout\("\/api\/staff\/source-intake\/coverage\/runs\?limit=1"/);
});

test('complete endpoint treats repeated clicks as already saved', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
  assert.ok(src.includes('already_recorded: true'));
  assert.ok(src.includes("['processing', 'retry'].includes(item.status)"));
});
