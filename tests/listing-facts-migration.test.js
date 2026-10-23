'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

// This test creates and destroys its own local cluster. It never reads DATABASE_URL.
// LFM_PG_BIN can point at a PostgreSQL bin directory when it is not in a common location.
const pgBin = [
  process.env.LFM_PG_BIN,
  '/opt/homebrew/opt/postgresql@16/bin',
  '/opt/homebrew/opt/postgresql@18/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/local/pgsql/bin'
].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

const MIGRATION = path.join(__dirname, '../db/migrations/164_reviewed_inventory_fact_corrections.sql');
const MARKER = 'inventory_fact_correction_164';
const MUTABLE = [
  'title', 'description', 'listing_type', 'transaction_type', 'property_type',
  'bedrooms', 'bathrooms', 'price', 'price_original', 'price_period',
  'price_currency', 'price_original_currency', 'price_fx_rate_ugx',
  'price_fx_as_of', 'price_on_application'
];
const DEFINITIONS = {
  id: 'uuid PRIMARY KEY', title: 'text', description: 'text',
  listing_type: 'text', transaction_type: 'text', property_type: 'text',
  bedrooms: 'integer', bathrooms: 'integer', price: 'numeric', price_original: 'numeric',
  price_period: 'text', price_currency: 'text', price_original_currency: 'text',
  price_fx_rate_ugx: 'numeric', price_fx_as_of: 'timestamptz', price_on_application: 'boolean',
  status: 'text', area: 'text', district: 'text', updated_at: 'timestamptz', extra_fields: 'jsonb',
  untouched_contact: 'text', untouched_media: 'jsonb', created_at: 'timestamptz'
};

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

function updateCount(result) {
  const results = Array.isArray(result) ? result : [result];
  return results.filter((item) => item.command === 'UPDATE').reduce((sum, item) => sum + item.rowCount, 0);
}

function rollbackStatement() {
  const setters = [...MUTABLE, 'updated_at'].map((key) => `${key} = (e.before_row).${key}`);
  const left = MUTABLE.map((key) => `p.${key}`).join(', ');
  const right = MUTABLE.map((key) => `after_row.${key}`).join(', ');
  return `
WITH eligible AS (
  SELECT p.id,
         jsonb_populate_record(NULL::properties, p.extra_fields->'${MARKER}'->'before') AS before_row,
         (p.extra_fields - '${MARKER}' - ARRAY(
           SELECT jsonb_array_elements_text(p.extra_fields->'${MARKER}'->'extra_keys')
         )) || (p.extra_fields->'${MARKER}'->'extra_before') AS previous_extra
    FROM properties p
    CROSS JOIN LATERAL jsonb_populate_record(NULL::properties, p.extra_fields->'${MARKER}'->'after') after_row
   WHERE current_setting('app.country_code', true) = 'UG'
     AND p.extra_fields ? '${MARKER}'
     AND p.updated_at = (p.extra_fields->'${MARKER}'->>'applied_at')::timestamptz
     AND ROW(${left}) IS NOT DISTINCT FROM ROW(${right})
     AND md5((p.extra_fields - '${MARKER}')::text) = p.extra_fields->'${MARKER}'->>'after_extra_md5'
)
UPDATE properties p
   SET ${setters.join(',\n       ')},
       extra_fields = e.previous_extra
  FROM eligible e
 WHERE p.id = e.id
   AND p.updated_at = (p.extra_fields->'${MARKER}'->>'applied_at')::timestamptz
   AND ROW(${left}) IS NOT DISTINCT FROM (
     SELECT ROW(${MUTABLE.map((key) => `a.${key}`).join(', ')})
       FROM jsonb_populate_record(NULL::properties, p.extra_fields->'${MARKER}'->'after') a
   )
   AND md5((p.extra_fields - '${MARKER}')::text) = p.extra_fields->'${MARKER}'->>'after_extra_md5';`;
}

test('reviewed inventory migration: real PostgreSQL guards, idempotency and rollback', {
  skip: pgBin ? false : 'Install PostgreSQL or set LFM_PG_BIN to run the isolated database test.',
  timeout: 180000
}, async (t) => {
  const originalSql = fs.readFileSync(MIGRATION, 'utf8');
  const payload = originalSql.match(/\$reviewed_inventory\$([\s\S]*?)\$reviewed_inventory\$::jsonb/);
  assert.ok(payload, 'migration contains its reviewed repair specifications');
  const specs = JSON.parse(payload[1]);
  const cohortCount = specs.length;
  assert.ok(cohortCount > 0);
  t.diagnostic(`Migration SHA256 ${createHash('sha256').update(originalSql).digest('hex')}; ${cohortCount} synthetic fixtures, original guard/update SQL.`);
  assert.equal(new Set(specs.map((spec) => spec.id)).size, cohortCount);

  const fixtureRows = specs.map((spec, index) => {
    const row = Object.fromEntries(Object.entries(spec.expected).filter(([key]) => !key.endsWith('_md5')));
    const extra = {
      source_caption: `Synthetic source caption ${index}`,
      source_description: `Synthetic source description ${index}`,
      preserved_null: null,
      preserved_nested: { images: ['fixture-image'], approved: true }
    };
    Object.keys(spec.extraPatch).forEach((key, keyIndex) => {
      if (keyIndex % 3 === 1) extra[key] = null;
      else if (keyIndex % 3 === 2) extra[key] = `previous metadata ${key}`;
    });
    return {
      ...row, id: spec.id, title: `Synthetic listing ${index}`,
      description: `Synthetic description ${index}`, extra_fields: extra,
      untouched_contact: `Fixture contact ${index}`, untouched_media: { photos: ['fixture-photo'] },
      created_at: '2025-01-01T00:00:00Z'
    };
  });

  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-164-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let started = false;
  let client;
  let writer;
  try {
    execFileSync(path.join(pgBin, 'initdb'), ['-D', data, '--username=lfm_test', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = process.env.LFM_PG_PORT ? Number(process.env.LFM_PG_PORT) : await freePort();
    assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
    execFileSync(path.join(pgBin, 'pg_ctl'), [
      '-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '15',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'
    ], { stdio: 'pipe' });
    started = true;
    const connection = { host: '127.0.0.1', port, user: 'lfm_test', database: 'postgres' };
    client = new Client(connection);
    writer = new Client(connection);
    await client.connect();
    await writer.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await writer.query("SET TIME ZONE 'UTC'");
    await client.query(`CREATE TABLE properties (${Object.entries(DEFINITIONS).map(([key, type]) => `${key} ${type}`).join(', ')})`);
    await client.query('CREATE TABLE property_video_ocr (property_id uuid, override jsonb, resolution text, conflicts jsonb)');
    const seed = async () => {
      await client.query('TRUNCATE properties, property_video_ocr');
      await client.query('INSERT INTO properties SELECT * FROM jsonb_populate_recordset(NULL::properties, $1::jsonb)', [JSON.stringify(fixtureRows)]);
    };
    await seed();
    await client.query('CREATE TEMP TABLE fixture_before AS SELECT id, to_jsonb(p) AS snapshot FROM properties p');
    const hashes = await client.query("SELECT id, md5(title) AS title_md5, md5(description) AS description_md5, md5(extra_fields::text) AS extra_md5 FROM properties");
    const byId = new Map(hashes.rows.map((row) => [row.id, row]));
    for (const spec of specs) {
      for (const key of ['title_md5', 'description_md5', 'extra_md5']) spec.expected[key] = byId.get(spec.id)[key];
    }
    // Only the three expected fixture hashes change. The actual guard/update SQL is unchanged.
    const sql = originalSql.replace(payload[0], `$reviewed_inventory$${JSON.stringify(specs)}$reviewed_inventory$::jsonb`);
    const apply = async (country = 'UG') => {
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      return updateCount(await client.query(sql));
    };
    const exactBaselineCount = async () => Number((await client.query('SELECT COUNT(*) FROM properties p JOIN fixture_before b USING(id) WHERE to_jsonb(p) = b.snapshot')).rows[0].count);
    const rollbackSql = rollbackStatement();
    t.afterEach(async () => { await client.query('ROLLBACK'); });
    if (process.env.LFM_EVIDENCE_DIR) {
      fs.writeFileSync(path.join(process.env.LFM_EVIDENCE_DIR, 'guarded-rollback-164.sql'),
        `-- Guarded rollback for reviewed inventory migration 164.\n-- Restores only unchanged migration results and preserves subsequent staff edits.\nBEGIN;\nSET LOCAL lock_timeout = '8s';\nSET LOCAL statement_timeout = '90s';\nSET LOCAL TIME ZONE 'UTC';\nSET LOCAL app.country_code = 'UG';\n${rollbackSql}\nCOMMIT;\n`);
    }

    await t.test(`all ${cohortCount} exact synthetic fixtures apply, preserve unrelated facts and are idempotent`, async () => {
      await client.query('BEGIN');
      assert.equal(await apply(), cohortCount);
      const patched = await client.query(`SELECT COUNT(*) FROM properties p JOIN jsonb_array_elements($1::jsonb) s ON p.id=(s->>'id')::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(s->'patch') keys(key)
           WHERE to_jsonb(p)->key IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::properties,s->'patch'))->key
        ) AND p.extra_fields @> (s->'extraPatch')`, [JSON.stringify(specs)]);
      assert.equal(Number(patched.rows[0].count), cohortCount);
      const untouched = await client.query(`SELECT COUNT(*) FROM properties p JOIN fixture_before b USING(id)
        WHERE to_jsonb(p) - $1::text[] = b.snapshot - $1::text[]
          AND p.extra_fields->'source_caption' = b.snapshot->'extra_fields'->'source_caption'
          AND p.extra_fields->'source_description' = b.snapshot->'extra_fields'->'source_description'`, [[...MUTABLE, 'updated_at', 'extra_fields']]);
      assert.equal(Number(untouched.rows[0].count), cohortCount, 'location, moderation, contact, media and raw source remain unchanged');
      assert.equal(await apply(), 0, 'repeat execution does not duplicate or change results');
      assert.equal(updateCount(await client.query(rollbackSql)), cohortCount);
      assert.equal(await exactBaselineCount(), cohortCount, 'rollback restores every column and all extra metadata exactly');
      assert.equal(updateCount(await client.query(rollbackSql)), 0);
      await client.query('ROLLBACK');
    });

    await t.test('the country guard rejects ZA and an unset country', async () => {
      for (const country of ['ZA', '']) {
        await client.query('BEGIN');
        assert.equal(await apply(country), 0);
        assert.equal(await exactBaselineCount(), cohortCount);
        await client.query('ROLLBACK');
      }
    });

    const target = specs[0].id;
    const guardFields = Object.keys(specs[0].expected);
    for (const key of guardFields) {
      await t.test(`intervening ${key} changes are not overwritten`, async () => {
        await client.query('BEGIN');
        const field = key === 'title_md5' ? 'title' : key === 'description_md5' ? 'description' : key === 'extra_md5' ? 'extra_fields' : key;
        let expression;
        if (field === 'extra_fields') expression = "extra_fields || '{\"intervening_staff_change\":true}'::jsonb";
        else if (['bedrooms', 'bathrooms', 'price', 'price_original', 'price_fx_rate_ugx'].includes(field)) expression = `COALESCE(${field}, 0) + 1`;
        else if (field === 'price_on_application') expression = 'NOT COALESCE(price_on_application, false)';
        else if (['updated_at', 'price_fx_as_of'].includes(field)) expression = `COALESCE(${field}, '2027-01-01'::timestamptz) + INTERVAL '1 second'`;
        else expression = `COALESCE(${field}, '') || ' changed by staff'`;
        await client.query(`UPDATE properties SET ${field} = ${expression} WHERE id=$1`, [target]);
        await client.query('CREATE TEMP TABLE intervening_row AS SELECT to_jsonb(p) AS snapshot FROM properties p WHERE id=$1', [target]);
        assert.equal(await apply(), cohortCount - 1);
        const preserved = await client.query('SELECT to_jsonb(p) = i.snapshot AS preserved FROM properties p CROSS JOIN intervening_row i WHERE p.id=$1', [target]);
        assert.equal(preserved.rows[0].preserved, true);
        await client.query('ROLLBACK');
      });
    }

    await t.test('a pre-existing correction marker blocks a second correction', async () => {
      await client.query('BEGIN');
      await client.query('UPDATE properties SET extra_fields=extra_fields || jsonb_build_object($1::text, $2::jsonb) WHERE id=$3', [MARKER, JSON.stringify({ applied_at: 'previous correction' }), target]);
      assert.equal(await apply(), cohortCount - 1);
      assert.deepEqual((await client.query('SELECT extra_fields->$1::text AS marker FROM properties WHERE id=$2', [MARKER, target])).rows[0].marker, { applied_at: 'previous correction' });
      await client.query('ROLLBACK');
    });

    await t.test('an unrelated listing outside the reviewed UUID cohort is preserved', async () => {
      await client.query('BEGIN');
      const unrelated = { ...fixtureRows[0], id: '00000000-0000-4000-8000-000000000164' };
      assert.equal(specs.some((spec) => spec.id === unrelated.id), false);
      await client.query('INSERT INTO properties SELECT * FROM jsonb_populate_recordset(NULL::properties,$1::jsonb)', [JSON.stringify([unrelated])]);
      await client.query('CREATE TEMP TABLE unrelated_before AS SELECT to_jsonb(p) AS snapshot FROM properties p WHERE id=$1', [unrelated.id]);
      assert.equal(await apply(), cohortCount);
      const result = await client.query('SELECT to_jsonb(p)=b.snapshot AS preserved FROM properties p CROSS JOIN unrelated_before b WHERE p.id=$1', [unrelated.id]);
      assert.equal(result.rows[0].preserved, true);
      await client.query('ROLLBACK');
    });

    await t.test('unresolved OCR conflicts block corrections; resolved and empty records do not', async () => {
      for (const [conflicts, override, resolution, expected] of [
        [[{ field: 'price' }], null, null, cohortCount - 1], [[], null, null, cohortCount],
        [null, null, null, cohortCount - 1], [{ legacy: 'object' }, null, null, cohortCount - 1],
        [[{ field: 'price' }], { reviewed: true }, null, cohortCount],
        [[{ field: 'price' }], null, 'reviewed', cohortCount]
      ]) {
        await client.query('BEGIN');
        await client.query('INSERT INTO property_video_ocr VALUES ($1,$2::jsonb,$3,$4::jsonb)', [target, override && JSON.stringify(override), resolution, conflicts && JSON.stringify(conflicts)]);
        assert.equal(await apply(), expected);
        await client.query('ROLLBACK');
      }
    });

    await t.test('rollback distinguishes absent metadata keys from explicit JSON null', async () => {
      await client.query('BEGIN');
      assert.equal(await apply(), cohortCount);
      const keyStates = await client.query(`SELECT COUNT(*) FILTER (WHERE p.extra_fields->'${MARKER}'->'extra_before' ? k) AS present,
          COUNT(*) FILTER (WHERE NOT (p.extra_fields->'${MARKER}'->'extra_before' ? k)) AS absent,
          COUNT(*) FILTER (WHERE p.extra_fields->'${MARKER}'->'extra_before'->k = 'null'::jsonb) AS explicit_null
        FROM properties p CROSS JOIN LATERAL jsonb_array_elements_text(p.extra_fields->'${MARKER}'->'extra_keys') k`);
      for (const key of ['present', 'absent', 'explicit_null']) assert.ok(Number(keyStates.rows[0][key]) > 0, key);
      assert.equal(updateCount(await client.query(rollbackSql)), cohortCount);
      assert.equal(await exactBaselineCount(), cohortCount);
      await client.query('ROLLBACK');
    });

    await t.test('rollback protects later staff fact, timestamp and metadata edits', async () => {
      for (const edit of ["title=title || ' staff revision'", "updated_at=updated_at + INTERVAL '1 second'", "extra_fields=extra_fields || '{\"later_review\":true}'::jsonb"]) {
        await client.query('BEGIN');
        assert.equal(await apply(), cohortCount);
        await client.query(`UPDATE properties SET ${edit} WHERE id=$1`, [target]);
        await client.query('CREATE TEMP TABLE intervening_row AS SELECT to_jsonb(p) AS snapshot FROM properties p WHERE id=$1', [target]);
        assert.equal(updateCount(await client.query(rollbackSql)), cohortCount - 1);
        const preserved = await client.query('SELECT to_jsonb(p) = i.snapshot AS preserved FROM properties p CROSS JOIN intervening_row i WHERE p.id=$1', [target]);
        assert.equal(preserved.rows[0].preserved, true);
        await client.query('ROLLBACK');
      }
    });

    await t.test('a concurrent staff edit committed while the migration waits for a row lock is preserved', async () => {
      await writer.query('BEGIN');
      await writer.query("UPDATE properties SET title=title || ' concurrent staff revision' WHERE id=$1", [target]);
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.country_code','UG',true)");
      const migrationPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = client.query(sql);
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        blocked = (await writer.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [migrationPid])).rows[0].blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(blocked, true, 'the migration really waited on the concurrent writer');
      await writer.query('COMMIT');
      assert.equal(updateCount(await pending), cohortCount - 1);
      const row = (await client.query(`SELECT title, extra_fields ? '${MARKER}' AS corrected FROM properties WHERE id=$1`, [target])).rows[0];
      assert.match(row.title, /concurrent staff revision$/);
      assert.equal(row.corrected, false);
      await client.query('ROLLBACK');
      await seed();
    });
  } finally {
    if (writer) await writer.end().catch(() => {});
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(pgBin, 'pg_ctl'), ['-D', data, '-w', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
