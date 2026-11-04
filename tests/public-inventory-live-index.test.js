const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const service = require('../services/publicInventoryMetricsService');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '202_public_live_bucket_count_index.sql'),
  'utf8'
);

test('migration 202 index predicate matches the live test-listing filter word for word', () => {
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_public_live_bucket_count_v3/);
  assert(migration.includes(`AND NOT ${service.publicLaunchTestListingFastCondition('').trim()};`));
  assert(migration.includes("LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')"));
});

test('public inventory count splits live and recently-sold rows into disjoint halves', async () => {
  const seen = [];
  service.resetPublicInventoryMetricsForTests();
  service.setPublicInventoryQueryRunnerForTests(async (sql) => {
    seen.push(sql);
    return { rows: [{ total: 0, sale: 0, rent: 0, student: 0, commercial: 0, land: 0, other: 0 }] };
  });
  try {
    await service.loadPublicOpportunitySummary({ forceRefresh: true, timeoutMs: 1000 });
  } finally {
    service.setPublicInventoryQueryRunnerForTests(null);
    service.resetPublicInventoryMetricsForTests();
  }
  const sql = seen.find((entry) => entry.includes('public_inventory'));
  assert(sql, 'count query should run');
  assert.match(sql, /UNION ALL/);
  assert.match(sql, /LOWER\(COALESCE\(p\.status, ''\)\) IN \('approved', 'live', 'published'\) AND/);
  assert.match(sql, /\(LOWER\(COALESCE\(p\.status, ''\)\) = 'sold' AND p\.sold_at >= NOW\(\) - INTERVAL '7 days'\)/);
  assert.doesNotMatch(sql, /'published'\) OR \(LOWER/);
});
