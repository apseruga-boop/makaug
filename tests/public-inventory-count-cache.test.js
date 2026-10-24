'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const htmlCache = require('../services/publicHtmlResponseCache');
const metrics = require('../services/publicInventoryMetricsService');
const propertiesRoutes = require('../routes/properties');

function countRow(total, fields = {}) {
  return {
    total,
    sale: fields.sale ?? 0,
    rent: fields.rent ?? 0,
    student: 0,
    commercial: 0,
    land: fields.land ?? 0,
    other: 0
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test.beforeEach(() => {
  metrics.resetPublicInventoryMetricsForTests();
  htmlCache.clear();
});

test.after(() => {
  metrics.resetPublicInventoryMetricsForTests();
  htmlCache.clear();
});

test('concurrent counts for the same filter share one query', async () => {
  let calls = 0;
  const gate = deferred();
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    calls += 1;
    await gate.promise;
    return { rows: [countRow(7, { sale: 7 })] };
  });
  const where = 'WHERE p.listing_type = $1';
  const values = ['sale'];
  const pending = Promise.all([
    metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 2000 }),
    metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 2000 }),
    metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 2000 })
  ]);
  await flush();
  assert.equal(calls, 1);
  gate.resolve();
  const results = await pending;
  for (const result of results) {
    assert.equal(result.summary.total, 7);
    assert.equal(result.meta.cache, 'miss');
  }
  const again = await metrics.loadPublicOpportunitySummary({ where, values });
  assert.equal(again.meta.cache, 'hit');
  assert.equal(again.summary.total, 7);
  assert.equal(calls, 1);
});

test('different filters do not share one in-flight count', async () => {
  let calls = 0;
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    calls += 1;
    return { rows: [countRow(1)] };
  });
  await Promise.all([
    metrics.loadPublicOpportunitySummary({ where: 'WHERE p.listing_type = $1', values: ['sale'] }),
    metrics.loadPublicOpportunitySummary({ where: 'WHERE p.listing_type = $1', values: ['rent'] })
  ]);
  assert.equal(calls, 2);
});

test('a stale count is returned immediately and refreshed once in the background', async () => {
  let now = 5_000_000;
  metrics.setPublicInventoryClockForTests(() => now);
  let calls = 0;
  const gate = deferred();
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    calls += 1;
    if (calls === 1) return { rows: [countRow(4, { sale: 4 })] };
    await gate.promise;
    return { rows: [countRow(9, { sale: 9 })] };
  });
  const where = 'WHERE p.listing_type = $1';
  const values = ['land'];
  const first = await metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 1000 });
  assert.equal(first.summary.total, 4);
  assert.equal(first.meta.cache, 'miss');

  now += metrics.PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS + 5;
  const started = Date.now();
  const stale = await metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 50 });
  const elapsed = Date.now() - started;
  assert.equal(stale.summary.total, 4);
  assert.equal(stale.meta.cache, 'stale');
  assert.equal(stale.meta.fallback_reason, undefined);
  assert.ok(elapsed < 200, `stale count waited ${elapsed}ms`);
  assert.equal(calls, 2);

  const duringRefresh = await metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 50 });
  assert.equal(duringRefresh.summary.total, 4);
  assert.equal(duringRefresh.meta.cache, 'stale');
  assert.equal(calls, 2);

  gate.resolve();
  await flush();
  await flush();
  const fresh = await metrics.loadPublicOpportunitySummary({ where, values });
  assert.equal(fresh.summary.total, 9);
  assert.equal(fresh.meta.cache, 'hit');
  assert.equal(calls, 2);
});

test('listing changes mark cached counts stale instead of deleting them', async () => {
  const gate = deferred();
  let calls = 0;
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    calls += 1;
    if (calls === 1) return { rows: [countRow(11, { rent: 11 })] };
    await gate.promise;
    return { rows: [countRow(12, { rent: 12 })] };
  });
  const where = 'WHERE p.listing_type = $1';
  const values = ['rent'];
  const first = await metrics.loadPublicOpportunitySummary({ where, values });
  assert.equal(first.summary.total, 11);

  htmlCache.set('/to-rent', { html: '<p>rent</p>', headers: {} });
  const marked = metrics.invalidatePublicInventoryMetricsCache('listing_status_pending_to_approved');
  assert.equal(marked, 1);
  assert.equal(htmlCache.get('/to-rent'), null);
  assert.equal(metrics.publicInventoryMetricsCacheSizeForTests(), 1);

  const started = Date.now();
  const stale = await metrics.loadPublicOpportunitySummary({ where, values, timeoutMs: 30 });
  assert.ok(Date.now() - started < 200, 'a listing change must not make the next count wait');
  assert.equal(stale.summary.total, 11);
  assert.equal(stale.meta.cache, 'stale');
  assert.equal(metrics.publicInventoryMetricsCacheSizeForTests(), 1);
  assert.equal(calls, 2);

  gate.resolve();
  await flush();
  await flush();
  const fresh = await metrics.loadPublicOpportunitySummary({ where, values });
  assert.equal(fresh.summary.total, 12);
  assert.equal(fresh.meta.cache, 'hit');
});

test('a cold count stops waiting at the caller budget and still fills the cache afterwards', async () => {
  const gate = deferred();
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    await gate.promise;
    return { rows: [countRow(3, { sale: 3 })] };
  });
  const started = Date.now();
  await assert.rejects(
    () => metrics.loadPublicOpportunitySummary({ where: 'WHERE cold = 1', timeoutMs: 40 }),
    (error) => error && error.code === '57014'
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 300, `cold count waited ${elapsed}ms`);
  gate.resolve();
  await flush();
  await flush();
  const later = await metrics.loadPublicOpportunitySummary({ where: 'WHERE cold = 1', timeoutMs: 200 });
  assert.equal(later.summary.total, 3);
  assert.equal(later.meta.cache, 'hit');
});

test('the count cache evicts the least recently used entry past its cap', async () => {
  metrics.setPublicInventoryCacheLimitForTests(3);
  let calls = 0;
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    calls += 1;
    return { rows: [countRow(1)] };
  });
  for (let index = 0; index < 3; index += 1) {
    await metrics.loadPublicOpportunitySummary({ where: `WHERE id = ${index}` });
  }
  assert.equal(metrics.publicInventoryMetricsCacheSizeForTests(), 3);
  await metrics.loadPublicOpportunitySummary({ where: 'WHERE id = 0' });
  assert.equal(calls, 3);
  await metrics.loadPublicOpportunitySummary({ where: 'WHERE id = 99' });
  assert.equal(metrics.publicInventoryMetricsCacheSizeForTests(), 3);
  assert.equal(calls, 4);
  await metrics.loadPublicOpportunitySummary({ where: 'WHERE id = 0' });
  assert.equal(calls, 4);
  await metrics.loadPublicOpportunitySummary({ where: 'WHERE id = 1' });
  assert.equal(calls, 5);
  assert.equal(metrics.publicInventoryMetricsCacheSizeForTests(), 3);
});

test('warmup covers site-wide inventory plus homepage, for-sale, to-rent and land', async () => {
  let calls = 0;
  metrics.setPublicInventoryQueryRunnerForTests(async () => {
    calls += 1;
    return { rows: [countRow(2, { sale: 1, rent: 1 })] };
  });
  const queries = propertiesRoutes.mainPublicOpportunityCountQueries();
  assert.deepEqual(queries.map((query) => query.label), ['homepage', 'for-sale', 'to-rent', 'land']);
  const sale = queries.find((query) => query.label === 'for-sale');
  const rent = queries.find((query) => query.label === 'to-rent');
  const land = queries.find((query) => query.label === 'land');
  const home = queries.find((query) => query.label === 'homepage');
  assert.match(sale.where, /listing_type = \$1/);
  assert.deepEqual(sale.values, ['sale']);
  assert.deepEqual(rent.values, ['rent']);
  assert.deepEqual(land.values, ['land']);
  assert.match(home.where, /property_images/);
  assert.doesNotMatch(home.where, /listing_type/);
  assert.equal(sale.timeoutMs, 4000);

  const results = await metrics.warmPublicInventoryCounts(queries);
  assert.deepEqual(results.map((result) => result.label), ['site-wide', 'homepage', 'for-sale', 'to-rent', 'land']);
  assert.ok(results.every((result) => result.ok === true && result.cache === 'miss'));
  assert.equal(calls, 5);
  assert.equal(metrics.publicInventoryMetricsCacheSizeForTests(), 5);
});
