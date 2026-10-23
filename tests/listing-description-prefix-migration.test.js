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

const PG_BIN = [process.env.LFM_PG_BIN, '/opt/homebrew/opt/postgresql@16/bin', '/opt/homebrew/opt/postgresql@18/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));
const ID = '8f1a194f-6edf-4892-adfc-e6eac8cf97c5';
const MARKER = 'inventory_copy_correction_165';
const OLD_PREFIX = 'Land for sale in Ntinda, Kampala, ';
const NEW_PREFIX = 'Bungalows for sale in Ntinda, Kampala, ';
const TAIL = 'Synthetic source: two bungalows, three bedrooms each; UGX 550M asking, tenants paying USD 1500 per month.\nKeep punctuation [x], whitespace and Unicode 🔥 exactly.\n';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

function updates(result) {
  return (Array.isArray(result) ? result : [result]).filter((item) => item.command === 'UPDATE').reduce((sum, item) => sum + item.rowCount, 0);
}

const FACT_GUARDS = `title = 'Bungalows for sale in Ntinda'
   AND listing_type = 'sale' AND transaction_type = 'sale' AND property_type = 'Bungalows'
   AND price = 550000000 AND price_original = 550000000
   AND price_currency = 'UGX' AND price_original_currency = 'UGX'
   AND price_fx_rate_ugx IS NULL AND price_fx_as_of IS NULL
   AND price_period = 'once' AND price_on_application = FALSE
   AND status = 'approved' AND area = 'Ntinda' AND district = 'Kampala'`;
const ROLLBACK_SQL = `UPDATE properties
   SET description = extra_fields->'${MARKER}'->>'before_description',
       updated_at = (extra_fields->'${MARKER}'->>'before_updated_at')::timestamptz,
       extra_fields = extra_fields - '${MARKER}'
 WHERE current_setting('app.country_code', true) = 'UG'
   AND id = '${ID}'::uuid AND extra_fields ? '${MARKER}'
   AND ${FACT_GUARDS}
   AND updated_at = (extra_fields->'${MARKER}'->>'applied_at')::timestamptz
   AND md5(description) = extra_fields->'${MARKER}'->>'after_description_md5'
   AND md5((extra_fields - '${MARKER}')::text) = extra_fields->'${MARKER}'->>'before_extra_md5';`;

test('Ntinda description-prefix migration: isolated PostgreSQL application and rollback', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 90000
}, async (t) => {
  const migrationPath = path.join(__dirname, '../db/migrations/165_ntinda_bungalows_description_prefix.sql');
  const originalSql = fs.readFileSync(migrationPath, 'utf8');
  const originalDescriptionHash = originalSql.match(/md5\(description\) = '([a-f0-9]{32})'/)?.[1];
  const originalExtraHash = originalSql.match(/md5\(COALESCE\(extra_fields, '\{\}'::jsonb\)::text\) = '([a-f0-9]{32})'/)?.[1];
  const originalTimestamp = originalSql.match(/updated_at = '([^']+)'::timestamptz/)?.[1];
  assert.ok(originalDescriptionHash && originalExtraHash && originalTimestamp);
  t.diagnostic(`Migration SHA256 ${createHash('sha256').update(originalSql).digest('hex')}; one synthetic fixture; only expected description/extra hashes substituted.`);

  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-165-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_prefix_test', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = process.env.LFM_PG_PORT ? Number(process.env.LFM_PG_PORT) : await freePort();
    assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '15', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    // Deliberately independent of DATABASE_URL or any externally supplied database.
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_prefix_test', database: 'postgres' });
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY, title text, description text, listing_type text, transaction_type text,
      property_type text, price numeric, price_original numeric, price_currency text,
      price_original_currency text, price_fx_rate_ugx numeric, price_fx_as_of timestamptz,
      price_period text, price_on_application boolean, status text, area text, district text,
      updated_at timestamptz, extra_fields jsonb, bedrooms integer, bathrooms integer,
      media jsonb, source_contact text, created_at timestamptz
    )`);
    const fixture = {
      id: ID, title: 'Bungalows for sale in Ntinda', description: OLD_PREFIX + TAIL,
      listing_type: 'sale', transaction_type: 'sale', property_type: 'Bungalows',
      price: 550000000, price_original: 550000000, price_currency: 'UGX', price_original_currency: 'UGX',
      price_fx_rate_ugx: null, price_fx_as_of: null, price_period: 'once', price_on_application: false,
      status: 'approved', area: 'Ntinda', district: 'Kampala', updated_at: originalTimestamp,
      bedrooms: null, bathrooms: null, media: { videos: ['preserve fixture video'] },
      source_contact: 'unchanged fixture contact', created_at: '2025-01-01T00:00:00Z',
      extra_fields: {
        source_caption: 'Synthetic original source: two existing bungalows; price550M, tenant income1500USD.',
        explicit_null: null,
        inventory_fact_correction_164: {
          applied_at: originalTimestamp, before: { bedrooms: 3, property_type: null },
          after: { bedrooms: null, property_type: 'Bungalows' }, source_evidence: [{ synthetic: true }]
        }
      }
    };
    const unrelated = { ...fixture, id: '00000000-0000-4000-8000-000000000165' };
    await client.query('INSERT INTO properties SELECT * FROM jsonb_populate_recordset(NULL::properties,$1::jsonb)', [JSON.stringify([fixture, unrelated])]);
    await client.query('CREATE TEMP TABLE fixture_before AS SELECT id,to_jsonb(p) AS snapshot FROM properties p');
    const hashes = (await client.query('SELECT md5(description) AS description_hash,md5(extra_fields::text) AS extra_hash FROM properties WHERE id=$1', [ID])).rows[0];
    const sql = originalSql.replace(originalDescriptionHash, hashes.description_hash).replace(originalExtraHash, hashes.extra_hash);
    const apply = async (country = 'UG', statement = sql) => {
      await client.query("SELECT set_config('app.country_code',$1,true)", [country]);
      return updates(await client.query(statement));
    };
    const snapshot = async () => (await client.query('SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS snapshot FROM properties p')).rows[0].snapshot;
    const baselineCount = async () => Number((await client.query('SELECT COUNT(*) FROM properties p JOIN fixture_before b USING(id) WHERE to_jsonb(p)=b.snapshot')).rows[0].count);
    t.afterEach(async () => { await client.query('ROLLBACK'); });
    if (process.env.LFM_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.LFM_EVIDENCE_DIR, 'guarded-rollback-165.sql'), `-- Guarded rollback for the Ntinda description-prefix correction.\nBEGIN;\nSET LOCAL TIME ZONE 'UTC';\nSET LOCAL app.country_code='UG';\n${ROLLBACK_SQL}\nCOMMIT;\n`);

    await t.test('only the prefix changes; remainder, price, source and prior164 marker are preserved', async () => {
      await client.query('BEGIN');
      assert.equal(await apply(), 1);
      const after = (await client.query('SELECT * FROM properties WHERE id=$1', [ID])).rows[0];
      assert.equal(after.description, NEW_PREFIX + TAIL);
      assert.ok(Buffer.from(after.description.slice(NEW_PREFIX.length)).equals(Buffer.from(TAIL)));
      assert.equal(after.price, '550000000');
      assert.equal(after.price_original, '550000000');
      assert.deepEqual(after.extra_fields.inventory_fact_correction_164, fixture.extra_fields.inventory_fact_correction_164);
      const unchanged = await client.query(`SELECT to_jsonb(p)-ARRAY['description','extra_fields','updated_at'] = b.snapshot-ARRAY['description','extra_fields','updated_at'] AS facts,
        p.extra_fields-$1::text = b.snapshot->'extra_fields' AS metadata
        FROM properties p JOIN fixture_before b USING(id) WHERE p.id=$2`, [MARKER, ID]);
      assert.deepEqual(unchanged.rows[0], { facts: true, metadata: true });
      assert.equal(await baselineCount(), 1, 'the unrelated listing remains byte-for-byte unchanged');
      assert.equal(await apply(), 0, 'the correction is idempotent');
      assert.equal(updates(await client.query(ROLLBACK_SQL)), 1);
      assert.equal(await baselineCount(), 2, 'rollback restores the full row including the prior164 marker');
      assert.equal(updates(await client.query(ROLLBACK_SQL)), 0);
      await client.query('ROLLBACK');
    });

    await t.test('country guard rejects ZA and an unset country', async () => {
      for (const country of ['ZA', '']) {
        await client.query('BEGIN');
        assert.equal(await apply(country), 0);
        assert.equal(await baselineCount(), 2);
        await client.query('ROLLBACK');
      }
    });

    const mutations = {
      id: "'00000000-0000-4000-8000-000000001165'::uuid", title: "title||' changed'",
      listing_type: "'rent'", transaction_type: "'rent'", property_type: "'Land'",
      price: 'price+1', price_original: 'price_original+1', price_currency: "'USD'",
      price_original_currency: "'USD'", price_fx_rate_ugx: '3800', price_fx_as_of: "'2026-10-01'::timestamptz",
      price_period: "'month'", price_on_application: 'TRUE', status: "'pending'",
      area: "'Other area'", district: "'Other district'",
      description: "description||' later edit'", updated_at: "updated_at+INTERVAL '1 second'",
      extra_fields: "extra_fields||'{\"later_metadata\":true}'::jsonb"
    };
    for (const [field, expression] of Object.entries(mutations)) {
      await t.test(`intervening ${field} change prevents correction`, async () => {
        await client.query('BEGIN');
        await client.query(`UPDATE properties SET ${field}=${expression} WHERE id=$1`, [ID]);
        const before = await snapshot();
        assert.equal(await apply(), 0);
        assert.deepEqual(await snapshot(), before);
        await client.query('ROLLBACK');
      });
    }

    await t.test('an existing165 marker blocks application even when its metadata hash matches', async () => {
      await client.query('BEGIN');
      await client.query('UPDATE properties SET extra_fields=extra_fields||jsonb_build_object($1::text,$2::jsonb) WHERE id=$3', [MARKER, JSON.stringify({ already_applied: true }), ID]);
      const hash = (await client.query('SELECT md5(extra_fields::text) AS hash FROM properties WHERE id=$1', [ID])).rows[0].hash;
      assert.equal(await apply('UG', sql.replace(hashes.extra_hash, hash)), 0);
      await client.query('ROLLBACK');
    });

    await t.test('a different prefix is preserved even when its description hash matches', async () => {
      await client.query('BEGIN');
      await client.query("UPDATE properties SET description='Different source prefix: '||description WHERE id=$1", [ID]);
      const before = await snapshot();
      const hash = (await client.query('SELECT md5(description) AS hash FROM properties WHERE id=$1', [ID])).rows[0].hash;
      assert.equal(await apply('UG', sql.replace(hashes.description_hash, hash)), 0);
      assert.deepEqual(await snapshot(), before);
      await client.query('ROLLBACK');
    });

    await t.test('rollback refuses wrong country and protects later copy, metadata, timestamp or price edits', async () => {
      for (const edit of [null, "description=description||' staff edit'", "updated_at=updated_at+INTERVAL '1 second'", "extra_fields=extra_fields||'{\"staff_edit\":true}'::jsonb", 'price=price+1']) {
        await client.query('BEGIN');
        assert.equal(await apply(), 1);
        if (edit) await client.query(`UPDATE properties SET ${edit} WHERE id=$1`, [ID]);
        else await client.query("SELECT set_config('app.country_code','ZA',true)");
        const before = await snapshot();
        assert.equal(updates(await client.query(ROLLBACK_SQL)), 0);
        assert.deepEqual(await snapshot(), before);
        await client.query('ROLLBACK');
      }
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
