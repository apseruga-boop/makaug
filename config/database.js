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

/**
 * No single live query may run for more than a minute.
 *
 * 25 Oct 2026: one analysis query ran for 2 h 29 min and held the database CPU
 * at its limit the whole time, so every page waited behind it. PostgreSQL's
 * default statement_timeout is 0 (no limit), so nothing stopped it.
 *
 * Every connection in the live pool now starts with statement_timeout = 60 s:
 * PostgreSQL cancels any one statement that runs longer, and the caller gets
 * "canceling statement due to statement timeout" (code 57014) instead of a
 * page that never loads. A connection left idle inside an open transaction is
 * closed after five minutes, so a leaked transaction cannot hold locks forever.
 *
 * Exempt, because they are legitimately longer (Postgres slow-query log,
 * 22-25 Oct 2026):
 * - migrations (scripts/migrate.js): migration 180 ran one 101 s statement;
 * - the harvester's duplicate check (queueFoundOnlineSourcePostListings):
 *   85-243 s every ten minutes;
 * - the SEO snapshot cursor (publicSeoService): up to 31 s per page;
 * - the background pool below, which runs scheduled jobs one at a time.
 * Exempt work calls exemptTransactionFromStatementTimeout() inside its own
 * transaction, so the limit comes back by itself at COMMIT or ROLLBACK.
 *
 * DB_STATEMENT_TIMEOUT_MS / DB_IDLE_IN_TRANSACTION_TIMEOUT_MS override the
 * defaults; 0 turns a limit off (for example for a one-off bulk script).
 */
function timeoutMs(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = parseInt(String(raw), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 60000;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 300000;
const statementTimeoutMs = timeoutMs(process.env.DB_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS);
const idleInTransactionTimeoutMs = timeoutMs(
  process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: poolMax,
  min: poolMin,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // pg sends these as connection start-up settings; 0 sends nothing, which
  // leaves the server default (no limit).
  statement_timeout: statementTimeoutMs,
  idle_in_transaction_session_timeout: idleInTransactionTimeoutMs
});

// Lift the live statement limit for the rest of the caller's transaction.
// SET LOCAL ends with the transaction, so the connection goes back to the
// pool with its 60 s limit intact. Outside a transaction it would do nothing,
// which is why this is only for work that has already sent BEGIN.
async function exemptTransactionFromStatementTimeout(client) {
  await client.query('SET LOCAL statement_timeout = 0');
}

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
 * Background work has all day. A person on WhatsApp does not. Background
 * queries use a separate pool of one connection and run one job at a time,
 * so a drip scan cannot empty the pool that live traffic is waiting on.
 * The separate pool is the seam for moving those jobs to another process
 * later: they already call runBackgroundWork(), and only that pool would move.
 *
 * Work marks itself as background by running inside runBackgroundWork(), and
 * every query underneath inherits that through AsyncLocalStorage, so the
 * hundreds of call sites did not have to change.
 */
const { AsyncLocalStorage } = require('async_hooks');

const workClass = new AsyncLocalStorage();
// Reported for the live pool so a reader can still see how much of it is
// meant for people. Background work no longer borrows from this pool.
const liveReserve = Math.max(1, Math.min(
  poolMax - 1,
  parseInt(process.env.DB_LIVE_RESERVE || '', 10) || Math.ceil(poolMax * 0.6)
));
const backgroundCeiling = Math.max(1, poolMax - liveReserve);
const backgroundPoolMax = Math.max(1, Math.min(2, parseInt(process.env.DB_BACKGROUND_POOL_MAX || '1', 10) || 1));

const backgroundPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: backgroundPoolMax,
  min: 0,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});

backgroundPool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL background client error:', err);
});

let inFlight = 0;
let backgroundJobActive = false;
const backgroundJobQueue = [];

function isBackgroundWork() {
  return workClass.getStore() === 'background';
}

function acquireSlot() {
  inFlight += 1;
  return Promise.resolve();
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
}

function pumpBackgroundJobs() {
  if (backgroundJobActive || !backgroundJobQueue.length) return;
  backgroundJobActive = true;
  const job = backgroundJobQueue.shift();
  workClass.run('background', () => Promise.resolve().then(job.fn))
    .then(job.resolve, job.reject)
    .finally(() => {
      backgroundJobActive = false;
      setImmediate(pumpBackgroundJobs);
    });
}

/** Run fn — and everything it awaits — as background work, one job at a time. */
function runBackgroundWork(fn) {
  if (isBackgroundWork()) return Promise.resolve().then(fn);
  return new Promise((resolve, reject) => {
    backgroundJobQueue.push({ fn, resolve, reject });
    pumpBackgroundJobs();
  });
}

// Let a live request that is already waiting take the database first.
// Background work proceeds after a short pause. It is not failed.
async function yieldToLiveTraffic() {
  await new Promise((resolve) => setImmediate(resolve));
  if (pool.waitingCount <= 0) return;
  const deadline = Date.now() + 2000;
  while (pool.waitingCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (pool.waitingCount > 0) {
    logger.info('Background database work is proceeding while live traffic is still queued', {
      live_queued: pool.waitingCount
    });
  }
}

function poolPressure() {
  return {
    pool_max: poolMax,
    live_reserve: liveReserve,
    background_ceiling: backgroundCeiling,
    background_pool_max: backgroundPoolMax,
    in_flight: inFlight,
    background_waiting: backgroundJobQueue.length,
    background_jobs_queued: backgroundJobQueue.length,
    background_job_active: backgroundJobActive,
    total: pool.totalCount,
    idle: pool.idleCount,
    queued: pool.waitingCount
  };
}

function wrapClientQuery(client, { background = false } = {}) {
  if (client.__makaugParamRepair) return client;
  const originalQuery = client.query.bind(client);
  client.query = (text, params, ...rest) => {
    const callback = typeof params === 'function' || rest.some((item) => typeof item === 'function');
    const exec = () => (
      Array.isArray(params) ? originalQuery(text, repairParams(params), ...rest) : originalQuery(text, params, ...rest)
    );
    if (!background || callback) return exec();
    return yieldToLiveTraffic().then(exec);
  };
  client.__makaugParamRepair = true;
  return client;
}

async function query(text, params) {
  if (isBackgroundWork()) {
    await yieldToLiveTraffic();
    return backgroundPool.query(text, repairParams(params));
  }
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
  if (isBackgroundWork()) {
    await yieldToLiveTraffic();
    const client = await backgroundPool.connect();
    return wrapClientQuery(client, { background: true });
  }
  await acquireSlot();
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    releaseSlot();
    throw error;
  }
  attachSlotRelease(client, releaseSlot);
  return wrapClientQuery(client);
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
  DEFAULT_STATEMENT_TIMEOUT_MS,
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  exemptTransactionFromStatementTimeout,
  pool,
  backgroundPool,
  query,
  getClient,
  healthcheck,
  warmPool,
  runBackgroundWork,
  poolPressure,
  attachSlotRelease
};
