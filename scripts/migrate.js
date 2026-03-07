require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const logger = require('../config/logger');

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrationNames() {
  const result = await db.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((r) => r.filename));
}

async function applyMigration(filename, sql) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    logger.info(`Applied migration: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await ensureMigrationsTable();
  const applied = await getAppliedMigrationNames();

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug(`Skipping already applied migration: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await applyMigration(file, sql);
  }

  logger.info('Migrations complete');
  await db.pool.end();
}

run().catch(async (error) => {
  logger.error('Migration failed', error);
  await db.pool.end();
  process.exit(1);
});
