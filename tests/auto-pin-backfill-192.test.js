'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { isOnUgandaLand } = require('../utils/ugandaLand');
const { canonicalLocationByKey, canonicalLocationPinPoint } = require('../utils/ugandaLocationRegistry');

const MIGRATION = path.join(__dirname, '../db/migrations/192_auto_pin_unpinned_listings.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-192-auto-pin.sql');
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin', '/opt/homebrew/opt/postgresql@17/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');

function payload(source) {
  const tag = '$auto_pin_192_payload$';
  const from = source.indexOf(tag) + tag.length;
  const close = source.indexOf(tag, from);
  assert.ok(from > tag.length - 1 && close > from, 'payload tag');
  return JSON.parse(source.slice(from, close));
}
const rows = payload(sql);

test('migration 192 pins each listing once at its canonical area centre on Uganda land', () => {
  assert.equal(rows.length, 760);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.match(sql, /expected integer := 760/);
  for (const row of rows) {
    assert.equal(isOnUgandaLand(row.lat, row.lng), true, row.id);
    const entry = canonicalLocationByKey(row.to_key);
    assert.ok(entry, row.to_key);
    const point = canonicalLocationPinPoint(entry);
    assert.equal(point.lat, row.lat, row.id);
    assert.equal(point.lng, row.lng, row.id);
    assert.equal(row.to_key.split(':')[0].length > 0, true);
  }
  assert.match(sql, /p\.status = 'approved'/);
  assert.match(sql, /p\.latitude IS NULL/);
  assert.match(sql, /'location_precision', 'area'/);
  assert.match(sql, /'batch', 'auto_pin_20261027'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS auto_pin_192_backup/);
  const setBlock = sql.slice(sql.indexOf('UPDATE properties p'), sql.indexOf('FROM auto_pin_192_eligible e'));
  assert.ok(setBlock.length > 0);
  assert.doesNotMatch(setBlock, /^\s*(title|area|district|price|status)\s*=/m);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-192-auto-pin.sql')), false);
  assert.match(rollbackSql, /auto_pin_192_backup/);
  assert.match(rollbackSql, /round\(p\.latitude::numeric, 6\) = round\(b\.new_latitude::numeric, 6\)/);
  assert.doesNotMatch(rollbackSql, /DROP TABLE/i);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('migration 192 pins only approved unpinned rows, keeps updated_at, and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-192-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_192', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_192', database: 'postgres' });
    client.on('notice', (notice) => notices.push(notice.message));
    await client.connect();
    await client.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY, title text, status text, latitude numeric, longitude numeric,
      extra_fields jsonb, updated_at timestamptz)`);
    await client.query(`CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN NEW.updated_at := NOW(); RETURN NEW; END $f$`);
    await client.query(`CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()`);
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.country_code', 'UG', true)");
    await client.query(`INSERT INTO properties (id, title, status, latitude, longitude, extra_fields, updated_at)
      SELECT (s->>'id')::uuid, 'kept title', 'approved', NULL, NULL,
             '{"source":"whatsapp_employee_intake","location_precision":"district"}'::jsonb,
             TIMESTAMPTZ '2026-10-01 00:00:00+00'
      FROM jsonb_array_elements($1::jsonb) s`, [JSON.stringify(rows)]);
    const pending = rows[1].id;
    const pinned = rows[2].id;
    await client.query("UPDATE properties SET status = 'pending' WHERE id = $1", [pending]);
    await client.query('UPDATE properties SET latitude = 0.3, longitude = 32.6 WHERE id = $1', [pinned]);
    await client.query('ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at');
    await client.query("UPDATE properties SET updated_at = TIMESTAMPTZ '2026-10-01 00:00:00+00'");
    await client.query('ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at');

    await client.query(sql);
    const changed = await client.query("SELECT count(*)::int AS n FROM properties WHERE extra_fields->'coords_fix'->>'batch' = 'auto_pin_20261027'");
    assert.equal(changed.rows[0].n, rows.length - 2);
    assert.ok(notices.some((m) => m.includes(`auto_pin_192 changed ${rows.length - 2} rows, expected ${rows.length}`)));
    const first = (await client.query('SELECT * FROM properties WHERE id = $1', [rows[0].id])).rows[0];
    assert.equal(Number(first.latitude), rows[0].lat);
    assert.equal(Number(first.longitude), rows[0].lng);
    assert.equal(first.title, 'kept title');
    assert.equal(first.updated_at.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(first.extra_fields.location_precision, 'area');
    assert.equal(first.extra_fields.auto_pinned, true);
    assert.equal(first.extra_fields.source, 'whatsapp_employee_intake');
    assert.equal(first.extra_fields.coords_fix.previous.location_precision, 'district');
    assert.equal(first.extra_fields.coords_fix.to_key, rows[0].to_key);
    const untouched = (await client.query('SELECT latitude, extra_fields FROM properties WHERE id = ANY($1::uuid[]) ORDER BY id', [[pending, pinned]])).rows;
    assert.ok(untouched.every((row) => !row.extra_fields.coords_fix));
    assert.equal((await client.query('SELECT latitude FROM properties WHERE id = $1', [pending])).rows[0].latitude, null);

    notices.length = 0;
    await client.query(sql);
    assert.ok(notices.some((m) => m.includes(`auto_pin_192 changed 0 rows, expected ${rows.length}`)));

    // A listing someone moved afterwards keeps its new pin through the rollback.
    await client.query('UPDATE properties SET latitude = 0.31 WHERE id = $1', [rows[3].id]);
    await client.query(rollbackSql);
    const left = await client.query("SELECT count(*)::int AS n FROM properties WHERE extra_fields->'coords_fix'->>'batch' = 'auto_pin_20261027'");
    assert.equal(left.rows[0].n, 1);
    const back = (await client.query('SELECT * FROM properties WHERE id = $1', [rows[0].id])).rows[0];
    assert.equal(back.latitude, null);
    assert.equal(back.longitude, null);
    assert.deepEqual(back.extra_fields, { source: 'whatsapp_employee_intake', location_precision: 'district' });
    assert.equal(back.updated_at.toISOString(), '2026-10-01T00:00:00.000Z');
    const backup = await client.query('SELECT count(*)::int AS n FROM auto_pin_192_backup');
    assert.equal(backup.rows[0].n, rows.length - 2);
    await client.query('ROLLBACK');
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});

test('migration 192 does nothing outside Uganda', () => {
  assert.match(sql, /IF current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG' THEN\s+RAISE NOTICE 'auto_pin_192 skipped country_not_ug';\s+RETURN;/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
});
