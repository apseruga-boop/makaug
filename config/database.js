const { Pool } = require('pg');
const logger = require('./logger');

if (!process.env.DATABASE_URL) {
  logger.warn('DATABASE_URL is not set. Database calls will fail until configured.');
}

const poolMax = Math.max(1, parseInt(process.env.DB_POOL_MAX || '20', 10) || 20);
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
const liveReserve = Math.max(0, Math.min(
  poolMax - 1,
  parseInt(process.env.DB_LIVE_RESERVE || '6', 10) || 6
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

async function getClient() {
  await acquireSlot();
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    releaseSlot();
    throw error;
  }
  // pg hands the same client object back on a later checkout, so the wrapper is
  // rebuilt every time. Remembering it once would leave the "already released"
  // flag stuck from the previous checkout and leak the slot for good.
  if (!client.__makaugOriginalRelease) {
    client.__makaugOriginalRelease = client.release.bind(client);
  }
  const originalRelease = client.__makaugOriginalRelease;
  let slotReleased = false;
  client.release = (...args) => {
    if (!slotReleased) {
      slotReleased = true;
      releaseSlot();
    }
    return originalRelease(...args);
  };
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
  poolPressure
};
