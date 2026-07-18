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

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
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
