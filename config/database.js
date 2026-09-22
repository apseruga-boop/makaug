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

async function query(text, params) {
  return pool.query(text, repairParams(params));
}

async function getClient() {
  const client = await pool.connect();
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
  warmPool
};
