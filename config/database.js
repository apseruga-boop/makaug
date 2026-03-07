const { Pool } = require('pg');
const logger = require('./logger');

if (!process.env.DATABASE_URL) {
  logger.warn('DATABASE_URL is not set. Database calls will fail until configured.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
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

module.exports = {
  pool,
  query,
  getClient,
  healthcheck
};
