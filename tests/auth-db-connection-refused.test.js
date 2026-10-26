'use strict';

// When the database briefly refuses connections, the sign-in check must
// answer 503 and the process must stay up. This points the real pool at a
// closed port, so the refusal comes from node-postgres itself.
process.env.DATABASE_URL = 'postgres://refused@127.0.0.1:1/refused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-auth-db-refused';
process.env.AUTH_DB_RETRY_BASE_MS = '5';

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const auth = require('../middleware/auth');

const realQuery = db.query;
let attempts = 0;
db.query = (...args) => { attempts += 1; return realQuery(...args); };

const token = jwt.sign({ sub: '00000000-0000-4000-8000-000000000001' }, process.env.JWT_SECRET);

function fakeReq() {
  const headers = { authorization: `Bearer ${token}` };
  return { headers, get: (name) => headers[String(name).toLowerCase()] };
}

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (name, value) => { res.headers[String(name).toLowerCase()] = value; return res; };
  return res;
}

// Resolves when the middleware answers or calls next, as Express would see it.
// A rejected promise here is what took the server down: Express 4 does not
// catch it, so Node treats it as an unhandled rejection.
async function run(middleware) {
  attempts = 0;
  const req = fakeReq();
  const res = fakeRes();
  let nextArg = 'not-called';
  await new Promise((resolve, reject) => {
    res.json = (body) => { res.body = body; resolve(); return res; };
    Promise.resolve(middleware(req, res, (arg) => { nextArg = arg; resolve(); })).catch(reject);
  });
  return { res, nextArg };
}

const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(error));

for (const name of ['requireListingModerationAccess', 'requireStaffAccess', 'requireAuthenticatedUser', 'requireAdminApiKey']) {
  test(`${name}: a refused database connection answers 503 after brief retries`, async () => {
    const { res, nextArg } = await run(auth[name]);
    // requireAdminApiKey hands the error to Express; the others answer directly.
    const status = nextArg && nextArg !== 'not-called' ? nextArg.status : res.statusCode;
    assert.equal(status, 503, `${name} answered ${status}`);
    if (nextArg === 'not-called' || !nextArg) {
      assert.equal(res.body?.ok, false);
      assert.equal(res.headers['retry-after'], '5');
    }
    assert.equal(attempts, 3, 'tries the database three times before giving up');
  });
}

test('the staff check used by hidden listings throws a 503, not an auth failure', async () => {
  attempts = 0;
  await assert.rejects(auth.hasStaffOrAdminAccess(fakeReq()), (error) => error.status === 503);
});

test('a pool error is logged and does not crash the process', () => {
  assert.ok(db.pool.listenerCount('error') >= 1);
  assert.ok(db.backgroundPool.listenerCount('error') >= 1);
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
  assert.doesNotThrow(() => db.pool.emit('error', refused));
  assert.doesNotThrow(() => db.backgroundPool.emit('error', refused));
});

test('nothing was left as an unhandled rejection', async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(unhandled.map((e) => e?.message), []);
});

test.after(async () => {
  db.query = realQuery;
  await Promise.allSettled([db.pool.end(), db.backgroundPool.end()]);
});

test('only connection trouble is retried, not a broken query', () => {
  assert.equal(auth.isTransientDbError({ code: 'ECONNREFUSED' }), true);
  assert.equal(auth.isTransientDbError({ code: '57P03' }), true);
  assert.equal(auth.isTransientDbError(new Error('timeout exceeded when trying to connect')), true);
  assert.equal(auth.isTransientDbError({ errors: [{ code: 'ECONNREFUSED' }] }), true);
  assert.equal(auth.isTransientDbError({ code: '42703', message: 'column "x" does not exist' }), false);
  assert.equal(auth.isTransientDbError(null), false);
});
