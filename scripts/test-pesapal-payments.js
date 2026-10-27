#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { Client } = require('pg');

const repo = path.resolve(__dirname, '..');
const pgBin = process.env.PESAPAL_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin';

function run(binary, args, options = {}) {
  const result = spawnSync(path.join(pgBin, binary), args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr || result.stdout || result.error}`);
}

function statements(sql) {
  const found = [];
  let start = 0;
  let quoted = false;
  let dollar = '';
  for (let i = 0; i < sql.length; i += 1) {
    if (!quoted && !dollar && sql.slice(i, i + 2) === '--') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (!quoted && sql[i] === '$') {
      const tag = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)?.[0];
      if (tag && (!dollar || tag === dollar)) {
        dollar = dollar ? '' : tag;
        i += tag.length - 1;
        continue;
      }
    }
    if (!dollar && sql[i] === "'") {
      if (quoted && sql[i + 1] === "'") { i += 1; continue; }
      quoted = !quoted;
    }
    if (!quoted && !dollar && sql[i] === ';') {
      if (sql.slice(start, i).trim()) found.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  if (sql.slice(start).trim()) found.push(sql.slice(start));
  return found;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  // This runner never accepts an existing DATABASE_URL and never loads .env.
  const root = fs.mkdtempSync(path.join(path.dirname(repo), 'pesapal-harness-'));
  const data = path.join(root, 'postgres');
  const port = await unusedPort();
  const sentinel = crypto.randomUUID();
  const suffix = crypto.randomBytes(5).toString('hex');
  const database = `makaug_pesapal_test_${suffix}`;
  const owner = `pesapal_owner_${suffix}`;
  const role = `pesapal_app_${suffix}`;
  const adminUrl = `postgresql://${owner}@127.0.0.1:${port}/postgres`;
  const migrationUrl = `postgresql://${owner}@127.0.0.1:${port}/${database}`;
  const applicationUrl = `postgresql://${role}@127.0.0.1:${port}/${database}`;
  let started = false;
  let admin;
  let migration;
  let child;
  const stop = () => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    if (started || fs.existsSync(path.join(data, 'postmaster.pid'))) {
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      started = false;
    }
  };
  const interrupted = () => { try { stop(); } finally { process.exit(130); } };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    run('initdb', ['-D', data, '-U', owner, '--auth=trust', '--no-locale', '--encoding=UTF8']);
    try {
      run('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c fsync=off -c synchronous_commit=off`, '-w', 'start']);
    } catch (error) {
      const log = path.join(root, 'postgres.log');
      if (fs.existsSync(log)) error.message += `\n${fs.readFileSync(log, 'utf8')}`;
      throw error;
    }
    started = true;
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`CREATE DATABASE ${database}`);
    migration = new Client({ connectionString: migrationUrl });
    await migration.connect();
    await migration.query("SELECT set_config('app.country_code', 'UG', false)");
    await migration.query('CREATE TABLE schema_migrations (id bigserial PRIMARY KEY, filename text UNIQUE NOT NULL, applied_at timestamptz DEFAULT now())');
    const directory = path.join(repo, 'db', 'migrations');
    const files = fs.readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(directory, file), 'utf8');
      try {
        if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql)) {
          for (const statement of statements(sql)) await migration.query(statement);
        } else {
          await migration.query('BEGIN');
          await migration.query(sql);
          await migration.query('COMMIT');
        }
        await migration.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
      } catch (error) {
        await migration.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
      }
    }
    await migration.query('CREATE TABLE pesapal_test_guard (sentinel uuid PRIMARY KEY)');
    await migration.query('INSERT INTO pesapal_test_guard VALUES ($1)', [sentinel]);
    await migration.query(`
      CREATE TABLE pesapal_test_faults (table_name text NOT NULL, target_id uuid NOT NULL, PRIMARY KEY(table_name,target_id));
      CREATE FUNCTION pesapal_test_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pesapal_test_faults WHERE table_name = TG_TABLE_NAME
          AND target_id = CASE WHEN TG_TABLE_NAME = 'account_entitlements' THEN (to_jsonb(NEW)->>'payment_id')::uuid ELSE NEW.id END) THEN
          RAISE EXCEPTION 'Injected payment fulfillment failure';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER pesapal_test_agent_fault AFTER UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION pesapal_test_injected_failure();
      CREATE TRIGGER pesapal_test_listing_fault AFTER UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION pesapal_test_injected_failure();
      CREATE TRIGGER pesapal_test_hosted_fault AFTER INSERT ON account_entitlements FOR EACH ROW EXECUTE FUNCTION pesapal_test_injected_failure();
      CREATE TRIGGER pesapal_test_short_stay_fault AFTER UPDATE ON st_listing FOR EACH ROW EXECUTE FUNCTION pesapal_test_injected_failure();
      CREATE TRIGGER pesapal_test_campaign_fault AFTER UPDATE ON advertising_campaigns FOR EACH ROW EXECUTE FUNCTION pesapal_test_injected_failure();
      CREATE TRIGGER pesapal_test_invoice_fault AFTER UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION pesapal_test_injected_failure();
    `);
    await migration.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await migration.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await migration.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await migration.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await migration.end(); migration = null;
    await admin.end(); admin = null;
    console.log(`Disposable PostgreSQL ready on loopback port ${port}; non-superuser app role; ${files.length} migrations.`);
    if (process.argv.includes('--schema-only')) return;
    // Deliberately construct the child's complete environment. Provider/transport
    // credentials from the operator's shell are not inherited.
    const env = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      LANG: 'en_US.UTF-8', TZ: 'UTC', NODE_ENV: 'test', COUNTRY_CODE: 'UG',
      DATABASE_URL: applicationUrl, DB_SSL: 'false',
      PESAPAL_TEST_DATABASE_URL: applicationUrl, PESAPAL_TEST_SENTINEL: sentinel,
      PESAPAL_TEST_ROLE: role, PESAPAL_TEST_RUN: suffix,
      WHATSAPP_DELIVERY_MODE: 'test', WHATSAPP_MOCK: 'true',
      DISABLE_SCHEDULERS: 'true', LOG_LEVEL: 'error',
      PAYMENT_NOTICE_DISPATCH_ENABLED: 'false', PAY_LINK_SWEEP_ENABLED: 'false'
    };
    if (process.env.PESAPAL_PROOF_DIR) env.PESAPAL_PROOF_DIR = path.resolve(process.env.PESAPAL_PROOF_DIR);
    child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/pesapal-payments.integration.test.js', 'tests/payment-notice.test.js'], { cwd: repo, env, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) process.exitCode = Number(code) || 1;
  } finally {
    if (migration) await migration.end().catch(() => {});
    if (admin) await admin.end().catch(() => {});
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
