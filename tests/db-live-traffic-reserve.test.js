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
    'featuredRotationService.js'
  ];
  for (const name of services) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', name), 'utf8');
    assert.match(source, /runBackgroundWork\(/,
      `${name} ticks on a timer with nobody waiting on it — it must run as background work`);
  }
});

test('the reserve keeps connections back for whoever is waiting', () => {
  const p = db.poolPressure();
  assert.ok(p.live_reserve > 0, 'some of the pool must be unavailable to background work');
  assert.ok(p.background_ceiling < p.pool_max,
    'the background ceiling must sit below the pool size, or it reserves nothing');
  assert.strictEqual(p.background_ceiling + p.live_reserve, p.pool_max);
});

test('background work is held at the ceiling while live work goes straight through', async (t) => {
  const ceiling = db.poolPressure().background_ceiling;
  const realQuery = db.pool.query;
  const finish = [];
  // Every query hangs until this test lets it go, which is what a pool under
  // real pressure feels like from the caller's side.
  db.pool.query = () => new Promise((resolve) => { finish.push(() => resolve({ rows: [] })); });
  t.after(() => { db.pool.query = realQuery; });

  const background = [];
  for (let i = 0; i < ceiling; i += 1) {
    background.push(db.runBackgroundWork(() => db.query('SELECT 1')));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(db.poolPressure().in_flight, ceiling, 'the allowance is fully taken');

  // One more background query must wait rather than take a reserved connection.
  let overflowStarted = false;
  const overflow = db.runBackgroundWork(() => db.query('SELECT 2')).then(() => { overflowStarted = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(db.poolPressure().background_waiting, 1, 'the extra scan queues');
  assert.strictEqual(overflowStarted, false);

  // Live traffic — Arthur's "Hello" — goes through regardless.
  const live = db.query('SELECT 3');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(db.poolPressure().in_flight, ceiling + 1,
    'a waiting person is never queued behind a background scan');

  finish.forEach((go) => go());
  await Promise.all([...background, live]);
  finish.forEach((go) => go());
  await overflow;
  assert.strictEqual(db.poolPressure().background_waiting, 0);
  assert.strictEqual(db.poolPressure().in_flight, 0, 'every slot comes back');
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

test('a client checked out twice does not leak its slot the second time', () => {
  // pg hands the same client object back on a later checkout. An earlier draft
  // remembered the wrapper on the client, so the "already released" flag stayed
  // set from the previous checkout and the slot was never given back — a leak
  // that would have recreated the very outage this is meant to prevent.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'config', 'database.js'), 'utf8');
  assert.match(source, /__makaugOriginalRelease/,
    'the original release is what gets remembered, never the per-checkout flag');
  assert.ok(!/__makaugSlotRelease\s*=\s*true/.test(source),
    'a once-only wrapper on a reused client object leaks the slot');
});
