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
const { MIGRATION_170_IDS } = require('../services/mapPinAuditPlan');
const { canonicalLocationOptions, normalizeLocationKey } = require('../utils/ugandaLocationRegistry');

const MIGRATION = path.join(__dirname, '../db/migrations/171_fix_flagged_map_pins.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-171-map-pin-fix.sql');
const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const LAND = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/uganda-land.geojson'), 'utf8'));
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function payload(sql) {
  const open = sql.indexOf('$map_pin_fix_171_payload$');
  assert.ok(open >= 0, 'migration payload tag missing');
  const from = open + '$map_pin_fix_171_payload$'.length;
  const close = sql.indexOf('$map_pin_fix_171_payload$', from);
  assert.ok(close > from, 'migration payload tag is not closed');
  return JSON.parse(sql.slice(from, close));
}

function extractConst(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} missing from the client`);
  const end = source.indexOf(';\n', start);
  return JSON.parse(source.slice(start + marker.length, end));
}

const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const rows = payload(sql);

test('map pin migration 171 guards stored coordinates and reports the row count', () => {
  const ids = rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, 'each property id appears once');
  assert.equal(rows.length, 451);
  assert.match(sql, /map_pin_fix_171 changed % rows, expected %/);
  assert.match(sql, /expected integer := 451/);
  assert.match(sql, /round\(p\.latitude::numeric, 6\) = round\(\(s\.value->>'old_lat'\)::numeric, 6\)/);
  assert.match(sql, /round\(p\.longitude::numeric, 6\) = round\(\(s\.value->>'old_lng'\)::numeric, 6\)/);
  assert.match(sql, /p\.latitude IS NULL/);
  assert.match(sql, /NOT \(COALESCE\(p\.extra_fields, '\{\}'::jsonb\) \? 'map_pin_fix_171'\)/);
  assert.match(sql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS map_pin_fix_171_backup/);
  assert.doesNotMatch(sql, /p\.title\s*=/);
  assert.doesNotMatch(sql, /p\.area\s*=/);
  assert.doesNotMatch(sql, /p\.price\s*=/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-171-map-pin-fix.sql')), false);
  assert.match(rollbackSql, /map_pin_fix_171_backup/);
  assert.match(rollbackSql, /round\(p\.latitude::numeric, 6\) = round\(b\.new_latitude::numeric, 6\)/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE/i);

  const counts = {};
  for (const row of rows) {
    counts[row.confidence] = (counts[row.confidence] || 0) + 1;
    assert.equal(isOnUgandaLand(row.new_lat, row.new_lng), true, row.id);
    assert.equal(MIGRATION_170_IDS.has(row.id), false, row.id);
  }
  assert.deepEqual(counts, { high: 22, medium: 271, low: 158 });
  const kigo = rows.find((row) => row.id === 'b5f0d38f-09bf-45df-89ca-76699c09ee35');
  assert.equal(kigo.old_lat, 0.196);
  assert.equal(kigo.new_lat, 0.2052);
  assert.equal(kigo.new_lng, 32.5967);
  assert.equal(rows.some((row) => row.id === 'b1014d2d-ec8c-4127-b898-0207a573e959'), false);
  assert.equal(rows.some((row) => row.id === '84967db4-d0e7-473b-a064-01e8c47b7f3a'), false);
});

test('the client uses the same land polygon and does not spiral agent pins', () => {
  assert.deepEqual(extractConst(APP, 'UGANDA_LAND_GEOMETRY'), LAND.features[0].geometry);
  const centroids = extractConst(APP, 'UG_PLACE_CENTROIDS');
  assert.deepEqual(centroids['wakiso|kigo'], [0.2052, 32.5967]);
  assert.deepEqual(centroids['jinja|masese'], [0.45, 33.2333]);
  assert.deepEqual(centroids['tororo|malaba'], [0.6407, 34.263]);
  for (const option of canonicalLocationOptions()) {
    if (!Number.isFinite(option.latitude) || !Number.isFinite(option.longitude)) continue;
    const key = `${normalizeLocationKey(option.district)}|${normalizeLocationKey(option.location)}`;
    assert.ok(centroids[key], key);
  }
  assert.match(APP, /leaflet@1\.9\.4/);
  assert.doesNotMatch(APP, /0\.004 \* n/);
  assert.match(APP, /Approximate area/);
  assert.match(APP, /MAP_APPROXIMATE_ZOOM = 13/);
  assert.match(APP, /<b>\$\{count\}<\/b>/);
  assert.doesNotMatch(APP, /latSum \+= p\.lat/);
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

test('map pin migration 171 updates every matching row and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-171-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_171', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_171', database: 'postgres' });
    client.on('notice', (notice) => notices.push(notice.message));
    await client.connect();
    await client.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY,
      title text,
      latitude numeric,
      longitude numeric,
      extra_fields jsonb,
      updated_at timestamptz
    )`);
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.country_code', 'UG', true)");
    await client.query(`
      INSERT INTO properties (id, title, latitude, longitude, extra_fields, updated_at)
      SELECT
        (s->>'id')::uuid,
        'stored title that does not match the audit',
        CASE WHEN s->>'old_lat' IS NULL OR s->>'old_lat' = 'null' THEN NULL ELSE (s->>'old_lat')::numeric END,
        CASE WHEN s->>'old_lng' IS NULL OR s->>'old_lng' = 'null' THEN NULL ELSE (s->>'old_lng')::numeric END,
        '{}'::jsonb,
        TIMESTAMPTZ '2026-10-01 00:00:00+00'
      FROM jsonb_array_elements($1::jsonb) s
    `, [JSON.stringify(rows)]);
    const drifted = rows.find((row) => row.old_lat != null);
    await client.query('UPDATE properties SET latitude = latitude + 1 WHERE id = $1', [drifted.id]);
    await client.query(sql);
    const changed = await client.query("SELECT count(*)::int AS n FROM properties WHERE extra_fields ? 'map_pin_fix_171'");
    assert.equal(changed.rows[0].n, rows.length - 1);
    const kigo = await client.query('SELECT latitude::float AS lat, longitude::float AS lng FROM properties WHERE id = $1', ['b5f0d38f-09bf-45df-89ca-76699c09ee35']);
    assert.equal(kigo.rows[0].lat, 0.2052);
    assert.equal(kigo.rows[0].lng, 32.5967);
    const kept = await client.query('SELECT title FROM properties WHERE id = $1', [rows[0].id]);
    assert.equal(kept.rows[0].title, 'stored title that does not match the audit');
    const driftedRow = await client.query('SELECT latitude::float AS lat, extra_fields FROM properties WHERE id = $1', [drifted.id]);
    assert.equal(driftedRow.rows[0].extra_fields.map_pin_fix_171, undefined);
    assert.ok(notices.some((message) => message.includes(`map_pin_fix_171 changed ${rows.length - 1} rows, expected ${rows.length}`)));
    notices.length = 0;
    await client.query(sql);
    assert.ok(notices.some((message) => message.includes(`map_pin_fix_171 changed 0 rows, expected ${rows.length}`)));
    await client.query(rollbackSql);
    const restored = await client.query("SELECT count(*)::int AS n FROM properties WHERE extra_fields ? 'map_pin_fix_171'");
    assert.equal(restored.rows[0].n, 0);
    const backup = await client.query('SELECT count(*)::int AS n FROM map_pin_fix_171_backup');
    assert.equal(backup.rows[0].n, rows.length - 1);
    await client.query('ROLLBACK');
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) {
      execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', 'stop'], { stdio: 'pipe' });
    }
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
