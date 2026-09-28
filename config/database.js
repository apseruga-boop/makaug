const { Pool } = require('pg');
const logger = require('./logger');

if (!process.env.DATABASE_URL) {
  logger.warn('DATABASE_URL is not set. Database calls will fail until configured.');
}

/**
 * A pool bigger than the database can serve makes things slower, not faster.
 *
 * makaug-postgres is a Basic-256mb instance: **0.1 CPU** and 256 MB of memory.
 * A tenth of a core cannot run twenty queries at once. Asking it to means every
 * query gets a twentieth of a tenth of a core, all of them crawl, and a new
 * connection cannot be established inside the ten-second budget — which is the
 * `timeout exceeded when trying to connect` that has been eating WhatsApp
 * replies all week: Ronald's 72 photos on the 25th, the six-minute "Hello" at
 * 06:30 on the 28th, and the one that produced this change half an hour later.
 *
 * Eight is not a downgrade. Queueing briefly in the application, where waiting
 * is cheap, beats thrashing a database that has no capacity to give. The real
 * answer is a larger instance; this keeps the service upright until then, and
 * DB_POOL_MAX still overrides it the moment that changes.
 */
const poolMax = Math.max(1, parseInt(process.env.DB_POOL_MAX || '8', 10) || 8);
const poolMin = Math.max(
  0,
  Math.min(poolMax, parseInt(process.env.DB_POOL_MIN || '2', 10) || 2)
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: poolMax,
  min: poolMin,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error:', err);
});

/**
 * Broken emoji must never break a write.
 *
 * Most emoji are two UTF-16 code units. Cutting text with `.slice(0, n)` can
 * split one in half, and JSON.stringify then writes the orphan half as an
 * escape such as "\ud83c". PostgreSQL rejects that in json/jsonb with
 * "invalid input syntax for type json", so the whole statement fails.
 *
 * That is what made the WhatsApp bot repeat a property card eight times on
 * 21 Sep 2026: the card was delivered, recording it as sent failed on a
 * 240-character preview cut through an emoji, and the send was retried.
 *
 * So every string parameter is repaired here, once, for every query: a lone
 * surrogate becomes U+FFFD (the replacement character). Well-formed text is
 * returned untouched, and the check is skipped for strings that cannot contain
 * the problem.
 */
const LONE_HIGH_ESCAPE = /\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F][0-9a-fA-F]{2})/g;

function repairLoneSurrogates(value) {
  if (typeof value !== 'string' || !value) return value;
  let out = value;
  if (typeof out.isWellFormed === 'function' && !out.isWellFormed()) out = out.toWellFormed();
  if (out.includes('\\u') && /\\u[dD][89a-fA-F]/.test(out)) {
    out = out.replace(LONE_HIGH_ESCAPE, '\\ufffd');
    // A low half is only an orphan when no high half sits right before it.
    out = out.replace(/(\\u[dD][89abAB][0-9a-fA-F]{2})?(\\u[dD][c-fC-F][0-9a-fA-F]{2})/g,
      (match, high, low) => (high ? match : '\\ufffd'));
  }
  return out;
}

function repairParams(params) {
  if (!Array.isArray(params)) return params;
  let changed = false;
  const next = params.map((param) => {
    const fixed = repairLoneSurrogates(param);
    if (fixed !== param) changed = true;
    return fixed;
  });
  return changed ? next : params;
}

/**
 * Keep connections free for someone who is waiting for a reply.
 *
 * 28 Sep 2026, 06:30. Arthur sent "Hello" and waited six minutes for the
 * greeting. The app was not slow — once the message reached it, the reply was
 * built in 905ms. It could not reach it: three background drip schedulers
 * reported `code: 'POOL_TIMEOUT'` in the same second, the pool had nothing left
 * to give, and the bridge's handover timed out over and over.
 *
 * Background work has all day. A person on WhatsApp does not. So background
 * work is held to a ceiling below the pool's size, and the difference is kept
 * for whoever is actually waiting. Nothing is refused, only queued — a drip
 * scan that starts a few seconds later costs nobody anything.
 *
 * Work marks itself as background by running inside runBackgroundWork(), and
 * every query underneath inherits that through AsyncLocalStorage, so the
 * hundreds of call sites did not have to change.
 */
const { AsyncLocalStorage } = require('async_hooks');

const workClass = new AsyncLocalStorage();
// Scaled to the pool rather than fixed, so shrinking the pool for a small
// database does not quietly leave background work with nothing, or with
// everything. Roughly a third stays background, the rest is held for people.
const liveReserve = Math.max(1, Math.min(
  poolMax - 1,
  parseInt(process.env.DB_LIVE_RESERVE || '', 10) || Math.ceil(poolMax * 0.6)
));
const backgroundCeiling = Math.max(1, poolMax - liveReserve);
const backgroundWaitMs = Math.max(1000, parseInt(process.env.DB_BACKGROUND_WAIT_MS || '20000', 10) || 20000);

let inFlight = 0;
const backgroundWaiters = [];

function isBackgroundWork() {
  return workClass.getStore() === 'background';
}

function acquireSlot() {
  if (!isBackgroundWork() || inFlight < backgroundCeiling) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        const at = backgroundWaiters.indexOf(waiter);
        if (at >= 0) backgroundWaiters.splice(at, 1);
        const error = new Error('Background database work waited too long behind live traffic');
        error.code = 'DB_BACKGROUND_BUSY';
        reject(error);
      }, backgroundWaitMs)
    };
    backgroundWaiters.push(waiter);
  });
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  while (backgroundWaiters.length && inFlight < backgroundCeiling) {
    const waiter = backgroundWaiters.shift();
    clearTimeout(waiter.timer);
    inFlight += 1;
    waiter.resolve();
  }
}

/** Run fn — and everything it awaits — as background work. */
function runBackgroundWork(fn) {
  return workClass.run('background', fn);
}

function poolPressure() {
  return {
    pool_max: poolMax,
    live_reserve: liveReserve,
    background_ceiling: backgroundCeiling,
    in_flight: inFlight,
    background_waiting: backgroundWaiters.length,
    total: pool.totalCount,
    idle: pool.idleCount,
    queued: pool.waitingCount
  };
}

async function query(text, params) {
  await acquireSlot();
  try {
    return await pool.query(text, repairParams(params));
  } finally {
    releaseSlot();
  }
}

/**
 * Wrap a checked-out client's release so it also gives back its pool slot.
 *
 * node-postgres builds a BRAND NEW release for every checkout —
 * `client.release = this._releaseOnce(client, idleListener)` in pg-pool — and
 * each one refuses to run twice:
 *
 *   Release called on client which has already been released to the pool.
 *
 * An earlier version of this cached the first checkout's release and reused it
 * forever. From the second checkout on it called a spent function, that threw,
 * and the connection was never handed back. Eight of those emptied the pool:
 * makaug answered nothing for an hour on 28 Sep 2026 until it was restarted,
 * and every WhatsApp message in that hour went unanswered.
 *
 * So the current release is read fresh each time, and the wrapper marks itself,
 * so wrapping a wrapper is impossible however pg changes. This is exported so
 * the test can run it against a real pool rather than a copy of it — the test
 * that was supposed to catch the original only read this file for a variable
 * name, and passed happily while production was down.
 */
function attachSlotRelease(client, onRelease = () => {}) {
  const currentRelease = client.release;
  const pgRelease = currentRelease && currentRelease.__makaugWrapsPgRelease
    ? currentRelease.__makaugPgRelease
    : currentRelease;
  let slotReleased = false;
  const wrappedRelease = (...args) => {
    if (!slotReleased) {
      slotReleased = true;
      onRelease();
    }
    return pgRelease.apply(client, args);
  };
  wrappedRelease.__makaugWrapsPgRelease = true;
  wrappedRelease.__makaugPgRelease = pgRelease;
  client.release = wrappedRelease;
  return client;
}

async function getClient() {
  await acquireSlot();
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    releaseSlot();
    throw error;
  }
  attachSlotRelease(client, releaseSlot);
  if (!client.__makaugParamRepair) {
    const originalQuery = client.query.bind(client);
    client.query = (text, params, ...rest) => (
      Array.isArray(params) ? originalQuery(text, repairParams(params), ...rest) : originalQuery(text, params, ...rest)
    );
    client.__makaugParamRepair = true;
  }
  return client;
}

async function healthcheck() {
  const result = await pool.query('SELECT NOW() AS now');
  return result.rows[0];
}

async function warmPool(targetConnections = process.env.DB_POOL_WARM_CONNECTIONS || poolMin) {
  if (!process.env.DATABASE_URL) return { warmed: 0, skipped: true };
  const target = Math.max(0, Math.min(poolMax, parseInt(String(targetConnections), 10) || poolMin));
  if (!target) return { warmed: 0, skipped: true };

  const clients = [];
  try {
    for (let i = 0; i < target; i += 1) {
      clients.push(await pool.connect());
    }
    await Promise.all(clients.map((client) => client.query('SELECT 1')));
    return { warmed: clients.length, skipped: false };
  } finally {
    clients.forEach((client) => client.release());
  }
}

module.exports = {
  pool,
  query,
  getClient,
  healthcheck,
  warmPool,
  runBackgroundWork,
  poolPressure,
  attachSlotRelease
};
