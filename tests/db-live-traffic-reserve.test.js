'use strict';

/**
 * 28 Sep 2026, 06:30. Arthur sent "Hello" to the WhatsApp assistant and waited
 * six minutes for the greeting.
 *
 * The app was not slow. Once the message reached it the reply was built in
 * 905ms. It could not reach it:
 *
 *   05:34:30.690 [WARN] X source drip scheduler tick failed
 *                       Connection terminated due to connection timeout
 *   05:34:30.690 [WARN] Marketplace national drip scheduler tick failed
 *   05:34:30.690 [WARN] YouTube source drip scheduler tick failed
 *                       reason: 'pool_timeout', code: 'POOL_TIMEOUT'
 *   05:35:20.153 [INFO] WhatsApp message from 447757773202: "Hello"
 *   05:35:21.058 [INFO] WhatsApp reply ready in 905ms
 *
 * Three background scans emptied the connection pool at the same moment.
 * Everything else queued behind them, the bridge's handover timed out, and the
 * fifty seconds after the pool freed up were the only fifty seconds in which
 * anything worked.
 *
 * Background work has all day; a person on WhatsApp does not. These tests hold
 * the rule that came out of it: background queries are capped below the pool's
 * size, live traffic is never made to wait behind them, and a scheduler that
 * has to queue is delayed rather than failed.
 */

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');

test('the schedulers that emptied the pool now declare themselves background', () => {
  const fs = require('fs');
  const path = require('path');
  const services = [
    'xSourceDripService.js',
    'youtubeSourceDripService.js',
    'marketplaceNationalDripService.js',
    'marketplaceLifecycleService.js',
    'featuredRotationService.js',
    'agentBookingService.js'
  ];
  for (const name of services) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', name), 'utf8');
    assert.match(source, /runBackgroundWork\(/,
      `${name} ticks on a timer with nobody waiting on it — it must run as background work`);
  }
});

test('background work has its own one-connection pool and does not borrow a live slot', () => {
  const p = db.poolPressure();
  assert.strictEqual(p.background_pool_max, 1, 'background scans share one connection');
  assert.ok(p.live_reserve > 0, 'the live pool still keeps room for a person who is waiting');
  assert.ok(p.pool_max <= 10, 'the live pool stays sized for the 0.1 CPU database');
  assert.strictEqual(db.backgroundPool.options.max, 1);
});

test('background work is queued on its own pool while live work goes straight through', async (t) => {
  const realLive = db.pool.query.bind(db.pool);
  const realBackground = db.backgroundPool.query.bind(db.backgroundPool);
  const liveCalls = [];
  const backgroundCalls = [];
  const releaseBackground = [];
  let releaseLive = null;
  db.pool.query = (sql) => new Promise((resolve) => {
    liveCalls.push(sql);
    releaseLive = () => resolve({ rows: [] });
  });
  db.backgroundPool.query = (sql) => new Promise((resolve) => {
    backgroundCalls.push(sql);
    releaseBackground.push(() => resolve({ rows: [] }));
  });
  t.after(() => {
    db.pool.query = realLive;
    db.backgroundPool.query = realBackground;
    releaseBackground.splice(0).forEach((go) => go());
    if (releaseLive) releaseLive();
  });

  const first = db.runBackgroundWork(() => db.query('SELECT background'));
  for (let i = 0; i < 8 && backgroundCalls.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepStrictEqual(backgroundCalls, ['SELECT background']);
  assert.strictEqual(liveCalls.length, 0, 'the background scan does not use the live pool');
  assert.strictEqual(db.poolPressure().in_flight, 0, 'and it does not occupy a live slot');

  let secondStarted = false;
  const second = db.runBackgroundWork(() => db.query('SELECT queued')).then(() => { secondStarted = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(db.poolPressure().background_jobs_queued, 1, 'a second scan waits instead of opening another connection');
  assert.strictEqual(secondStarted, false);

  const live = db.query('SELECT live');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(liveCalls, ['SELECT live']);
  assert.strictEqual(db.poolPressure().in_flight, 1, 'a waiting person is served on the live pool');
  releaseLive();
  await live;
  assert.strictEqual(db.poolPressure().in_flight, 0);

  releaseBackground.shift()();
  await first;
  for (let i = 0; i < 8 && backgroundCalls.length < 2; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepStrictEqual(backgroundCalls, ['SELECT background', 'SELECT queued']);
  releaseBackground.shift()();
  await second;
  assert.strictEqual(db.poolPressure().background_jobs_queued, 0);
  assert.strictEqual(db.poolPressure().in_flight, 0, 'every live slot comes back');
});

test('a background query waits its turn rather than being refused', async () => {
  // DATABASE_URL is absent in the test environment, so the query itself fails —
  // what matters here is that the gate let it through and released afterwards,
  // leaving nothing stuck.
  const before = db.poolPressure().in_flight;
  await db.runBackgroundWork(() => db.query('SELECT 1')).catch(() => {});
  assert.strictEqual(db.poolPressure().in_flight, before,
    'the slot is given back even when the query fails, or the pool bleeds away');
});

test('live work releases its slot too, success or failure', async () => {
  const before = db.poolPressure().in_flight;
  await db.query('SELECT 1').catch(() => {});
  assert.strictEqual(db.poolPressure().in_flight, before);
});

test('this file must not be the only thing guarding the release wrapper', () => {
  // What used to stand here read database.js as a string and asserted that the
  // variable `__makaugOriginalRelease` was present. It passed while that exact
  // variable was leaking every connection and taking the WhatsApp assistant
  // down for an hour on 28 Sep 2026. A name is not a behaviour.
  //
  // The real guard now lives in db-client-release-leak.test.js, which checks a
  // client out of a real pool five times over and insists it comes back. This
  // only makes sure that file has not quietly disappeared.
  const fs = require('fs');
  const path = require('path');
  const guard = path.join(__dirname, 'db-client-release-leak.test.js');
  assert.ok(fs.existsSync(guard), 'the behavioural test for the release wrapper must exist');
  const source = fs.readFileSync(guard, 'utf8');
  assert.match(source, /attachSlotRelease/,
    'and it must exercise the shipped function, not a copy of it pasted into the test');
});

test('the pool is sized for the database that actually exists', () => {
  // makaug-postgres is Basic-256mb: 0.1 CPU, 256 MB. Twenty concurrent queries
  // against a tenth of a core is how `timeout exceeded when trying to connect`
  // kept reaching the WhatsApp route.
  const p = db.poolPressure();
  assert.ok(p.pool_max <= 10,
    'a pool larger than a 0.1 CPU database can serve makes every query slower, not faster');
  assert.ok(p.background_ceiling >= 1, 'background work must still be able to run at all');
  assert.ok(p.live_reserve >= 1, 'and something must always be held back for a person waiting');
});
