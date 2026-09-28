'use strict';

/**
 * The connection leak that took the WhatsApp assistant down on 28 Sep 2026.
 *
 * config/database.js wraps `client.release()` so a checked-out client also
 * holds one of the pool slots that keep background scans off live traffic. The
 * first version of that wrapper cached the client's release the first time it
 * saw it and reused the cached copy on every later checkout.
 *
 * node-postgres does not work that way. pg-pool assigns a new release on each
 * acquire:
 *
 *   client.release = this._releaseOnce(client, idleListener)
 *
 * and `_releaseOnce` refuses to run a second time — "Release called on client
 * which has already been released to the pool." So every checkout after the
 * first called a spent function, it threw, and the connection was never
 * returned. Eight of those emptied the pool, and every request after that,
 * including every WhatsApp message, failed with `timeout exceeded when trying
 * to connect`. It looked exactly like a slow database, which is what made it
 * expensive to find: it worked perfectly for the first hour after each restart.
 *
 * There WAS a test guarding this. It read database.js as a string and checked
 * for a variable name. It passed while the code was broken, because a name is
 * not a behaviour. This file checks out the same client twice from a real pool
 * and insists it comes back both times.
 */

const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');

const db = require('../config/database');

// A stand-in for a real connection: enough of the shape that pg-pool will
// acquire, release and reuse it, with no network anywhere.
const { EventEmitter } = require('events');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    // pg-pool discards a client on release unless it looks usable, and a
    // discarded client is never handed back — which would quietly stop this
    // test from reproducing the reuse that the bug depended on.
    this._queryable = true;
    this._ending = false;
  }

  connect(cb) { setImmediate(() => cb(null, this)); }
  query(_text, _params, cb) {
    if (typeof cb === 'function') return setImmediate(() => cb(null, { rows: [] }));
    return Promise.resolve({ rows: [] });
  }
  end() { return Promise.resolve(); }
}

function fakeClientPool() {
  return new Pool({ max: 2, Client: FakeClient });
}

test('pg really does replace release on every checkout', () => {
  // The assumption the broken wrapper got wrong, pinned against the installed
  // version of pg rather than against memory.
  const source = require('fs').readFileSync(require.resolve('pg-pool'), 'utf8');
  assert.match(source, /client\.release = this\._releaseOnce\(/,
    'if pg stops doing this, the wrapper in database.js should be revisited');
  assert.match(source, /already been released to the pool/,
    'and a spent release still throws rather than being ignored');
});

// With a pool of one, a connection that is not returned makes the next
// checkout hang forever. That is the outage, reproduced in miniature.
const checkoutWithin = (pool, ms) => Promise.race([
  pool.connect(),
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error('pool exhausted: the connection was never returned')), ms))
]);

test('a client checked out repeatedly keeps coming back to the pool', async (t) => {
  const pool = new Pool({ max: 1, Client: FakeClient });
  t.after(() => pool.end().catch(() => {}));

  let releases = 0;
  for (let checkout = 1; checkout <= 5; checkout += 1) {
    const client = await checkoutWithin(pool, 1500);
    db.attachSlotRelease(client, () => { releases += 1; });
    client.release();
  }
  assert.strictEqual(releases, 5, 'every checkout released exactly once');
});

test('a release is spent once used — which is what the cache got wrong', async (t) => {
  const pool = new Pool({ max: 2, Client: FakeClient });
  t.after(() => pool.end().catch(() => {}));

  const client = await pool.connect();
  const cached = client.release.bind(client); // the mistake, exactly as shipped
  cached();

  // Reusing it on a later checkout is what the broken wrapper did every time
  // after the first. pg refuses, the real release never runs, and the
  // connection stays checked out for the life of the process.
  assert.throws(() => cached(), /already been released/,
    'a spent release throws instead of returning the connection');
});

test('the shipped wrapper survives being applied twice to the same client', async (t) => {
  // Belt and braces: even if something wraps an already-wrapped client, the
  // real pg release must still be the one that runs.
  const pool = new Pool({ max: 1, Client: FakeClient });
  t.after(() => pool.end().catch(() => {}));

  const client = await pool.connect();
  let releases = 0;
  db.attachSlotRelease(client, () => { releases += 1; });
  db.attachSlotRelease(client, () => { releases += 1; });
  client.release();
  assert.strictEqual(releases, 1, 'the slot is given back once, not twice');

  const next = await checkoutWithin(pool, 1500);
  assert.ok(next, 'and the connection really did return to the pool');
  db.attachSlotRelease(next, () => {});
  next.release();
});

test('the slot is still returned exactly once per checkout', async () => {
  const before = db.poolPressure().in_flight;
  await db.query('SELECT 1').catch(() => {});
  await db.runBackgroundWork(() => db.query('SELECT 1')).catch(() => {});
  assert.strictEqual(db.poolPressure().in_flight, before,
    'a leaked slot is the same outage in a different costume');
});
