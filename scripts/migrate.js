require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const logger = require('../config/logger');

const SOUTH_AFRICA_BOOTSTRAP_MARKER = 'za-separate-db-seed-isolation-v1-20260811';
const SOUTH_AFRICA_SEEDED_TABLES = Object.freeze([
  'admin_audit_logs',
  'advertising_placements',
  'agents',
  'ai_agents',
  'ai_sites',
  'ai_tenants',
  'integrity_review_116',
  'marketing_campaigns',
  'marketplace_businesses',
  'marketplace_drip_state',
  'migration_115_location_decisions',
  'mortgage_providers',
  'products',
  'properties',
  'property_harvest_channels',
  'property_images',
  'property_moderation_events',
  'property_source_registry',
  'source_drip_state',
  'whatsapp_conversation_state'
]);

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

function splitSqlStatements(sql = '') {
  const statements = [];
  let current = '';
  let inSingle = false;
  let dollarTag = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (!inSingle && !dollarTag && ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const line = end === -1 ? sql.slice(i) : sql.slice(i, end + 1);
      current += line;
      i += line.length - 1;
      continue;
    }
    if (!inSingle && ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match && (!dollarTag || match[0] === dollarTag)) {
        dollarTag = dollarTag ? '' : match[0];
        current += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (!dollarTag && ch === "'") {
      if (inSingle && sql[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
    }
    if (!inSingle && !dollarTag && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

function migrationRunsOutsideTransaction(sql = '') {
  return /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql);
}

async function applyMigration(filename, sql) {
  if (migrationRunsOutsideTransaction(sql)) {
    await applyAutocommitMigration(filename, sql);
    return;
  }
  const client = await db.getClient();
  const onNotice = (notice) => logger.info(`Migration notice (${filename}): ${notice.message || notice}`);
  client.on('notice', onNotice);
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.country_code', $1, true)",
      [String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() || 'UG']
    );
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    logger.info(`Applied migration: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.removeListener('notice', onNotice);
    client.release();
  }
}

async function applyAutocommitMigration(filename, sql) {
  const client = await db.getClient();
  try {
    // CREATE INDEX CONCURRENTLY cannot run inside a transaction. Each
    // statement is its own implicit transaction. The migration row is written
    // only after every statement succeeds, so a failed index is retried.
    for (const statement of splitSqlStatements(sql)) {
      await client.query(statement);
    }
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    logger.info(`Applied migration: ${filename}`);
  } finally {
    client.release();
  }
}

function isSouthAfricaBootstrapResetEnabled() {
  return String(process.env.COUNTRY_CODE || '').trim().toUpperCase() === 'ZA'
    && String(process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA || '').trim().toLowerCase() === 'true';
}

async function isolateSouthAfricaBootstrapData() {
  if (!isSouthAfricaBootstrapResetEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_tenant_bootstrap (
        marker TEXT PRIMARY KEY,
        country_code TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const prior = await client.query(
      'SELECT marker FROM platform_tenant_bootstrap WHERE marker = $1 FOR UPDATE',
      [SOUTH_AFRICA_BOOTSTRAP_MARKER]
    );
    if (prior.rows.length) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'already_applied' };
    }

    const usersTable = await client.query("SELECT to_regclass('public.users') AS table_name");
    if (usersTable.rows[0]?.table_name) {
      const users = await client.query('SELECT COUNT(*)::int AS total FROM users');
      if (Number(users.rows[0]?.total || 0) > 0) {
        throw new Error('Refusing South Africa bootstrap reset because the target database already contains users');
      }
    }

    const existing = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [SOUTH_AFRICA_SEEDED_TABLES]
    );
    const tables = existing.rows.map((row) => row.tablename);
    if (tables.length) {
      const quoted = tables.map((name) => `"${name}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    }

    await client.query(
      `INSERT INTO platform_tenant_bootstrap (marker, country_code, details)
       VALUES ($1, 'ZA', $2::jsonb)`,
      [SOUTH_AFRICA_BOOTSTRAP_MARKER, JSON.stringify({ truncated_tables: tables })]
    );
    await client.query('COMMIT');
    logger.warn('South Africa new-database seed isolation applied', {
      marker: SOUTH_AFRICA_BOOTSTRAP_MARKER,
      tableCount: tables.length
    });
    return { skipped: false, marker: SOUTH_AFRICA_BOOTSTRAP_MARKER, tables };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const AREA_INDEX_MIGRATION = '168_area_category_lookup_indexes.sql';

function classifyMigrationFiles(files = [], appliedNames = new Set()) {
  const applied = appliedNames instanceof Set ? appliedNames : new Set(appliedNames);
  const skipped = [];
  const pending = [];
  for (const file of files) {
    if (applied.has(file)) skipped.push(file);
    else pending.push(file);
  }
  let areaIndex = 'missing';
  if (files.includes(AREA_INDEX_MIGRATION)) {
    areaIndex = applied.has(AREA_INDEX_MIGRATION) ? 'skipped' : 'pending';
  }
  return { skipped, pending, areaIndex, areaIndexFile: AREA_INDEX_MIGRATION };
}

function logMigrationPlan(plan, log = logger) {
  for (const file of plan.skipped) log.info(`Migration skipped (already applied): ${file}`);
  for (const file of plan.pending) log.info(`Migration pending: ${file}`);
  log.info(`Migration 168 area index: ${plan.areaIndex} (${plan.areaIndexFile})`);
  return plan;
}

async function runMigrations({ closePool = false } = {}) {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await ensureMigrationsTable();
  const applied = await getAppliedMigrationNames();
  const plan = logMigrationPlan(classifyMigrationFiles(files, applied));

  for (const file of plan.pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await applyMigration(file, sql);
  }

  await isolateSouthAfricaBootstrapData();

  const areaIndex = plan.pending.includes(AREA_INDEX_MIGRATION)
    ? 'applied'
    : plan.areaIndex;
  logger.info('Migrations complete', {
    applied: plan.pending,
    skipped: plan.skipped,
    areaIndex,
    areaIndexFile: AREA_INDEX_MIGRATION
  });
  if (closePool) {
    await db.pool.end();
  }
}

if (require.main === module) {
  runMigrations({ closePool: true }).catch(async (error) => {
    logger.error('Migration failed', error);
    await db.pool.end();
    process.exit(1);
  });
}

module.exports = {
  AREA_INDEX_MIGRATION,
  SOUTH_AFRICA_BOOTSTRAP_MARKER,
  SOUTH_AFRICA_SEEDED_TABLES,
  classifyMigrationFiles,
  isSouthAfricaBootstrapResetEnabled,
  logMigrationPlan,
  migrationRunsOutsideTransaction,
  splitSqlStatements,
  isolateSouthAfricaBootstrapData,
  runMigrations
};
